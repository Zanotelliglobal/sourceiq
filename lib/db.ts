import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// The Neon serverless driver ships two transports:
//   • Pool  → talks Postgres over a WebSocket (needs the `ws` package in Node).
//   • neon() → stateless HTTP driver over plain `fetch`/HTTPS.
// We use the HTTP driver. It avoids the `ws` dependency entirely (which webpack
// mangles in Next.js, producing `bufferUtil.mask is not a function`), and it is
// the recommended transport for serverless/edge runtimes like Vercel. The only
// tradeoff: each call is its own HTTP round-trip and multi-statement SQL is not
// allowed — so schema DDL is split into individual statements below.

// ─── POSTGRES DATA LAYER ──────────────────────────────────────────────────────
// The app was originally built on synchronous better-sqlite3. To run on Vercel
// (serverless, read-only FS) we moved to hosted Postgres (Neon). To keep the
// hundreds of existing call sites nearly unchanged, getDb() returns a thin
// wrapper that mimics better-sqlite3's `prepare().get/all/run` shape — except
// every method is async (Postgres is async). Route code therefore just `await`s
// the same calls it already made.
//
// The wrapper also normalizes the SQL dialect at runtime:
//   • `?` positional placeholders  → `$1, $2, ...`
//   • `datetime('now')`            → `now()`
//   • bare INSERTs (no RETURNING)  → append `RETURNING id` so `.run()` can
//                                     expose `lastInsertRowid` like SQLite did.

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.NEON_DATABASE_URL ||
  "";

// The HTTP driver query function. `fullResults` makes `.query()` return the
// full result object ({ rows, rowCount, ... }) instead of a bare rows array,
// so we can expose `changes`/`lastInsertRowid` like the old wrapper did.
let sql: NeonQueryFunction<false, true> | null = null;
function getSql(): NeonQueryFunction<false, true> {
  if (!sql) {
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Point it at your Neon/Postgres connection string."
      );
    }
    sql = neon(connectionString, { fullResults: true });
  }
  return sql;
}

// Translate a better-sqlite3 style SQL string into Postgres dialect.
function toPg(sql: string): string {
  let i = 0;
  // Replace each unquoted `?` with an incrementing $n placeholder.
  const withParams = sql.replace(/\?/g, () => `$${++i}`);
  // SQLite datetime('now') → Postgres now().
  return withParams.replace(/datetime\(\s*'now'\s*\)/gi, "now()");
}

// Split a multi-statement SQL string into individual statements for the HTTP
// driver. Our DDL contains no semicolons inside string literals or column
// bodies, so a naive split on `;` is otherwise safe here — EXCEPT that `--`
// line comments are free-form prose and can easily contain a semicolon of
// their own (an incident: a comment reading "...list; archive hides..." split
// into a bogus statement starting with "archive", crashing initSchema() and
// every DB-backed route with it — see #40 postmortem). Strip comments first so
// punctuation inside them can never corrupt the split.
export function splitStatements(ddl: string): string[] {
  const withoutComments = ddl
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
  return withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type RunResult = { changes: number; lastInsertRowid: number | undefined };

class Statement {
  private text: string;
  constructor(sql: string) {
    this.text = toPg(sql);
  }

  private async exec(params: unknown[]) {
    await ensureInit();
    return getSql().query(this.text, params);
  }

  async get<T = unknown>(...params: unknown[]): Promise<T | undefined> {
    const res = await this.exec(params);
    return res.rows[0] as T | undefined;
  }

  async all<T = unknown>(...params: unknown[]): Promise<T[]> {
    const res = await this.exec(params);
    return res.rows as T[];
  }

  async run(...params: unknown[]): Promise<RunResult> {
    // Emulate SQLite's lastInsertRowid: for INSERTs without an explicit
    // RETURNING clause, append `RETURNING id` and read it back.
    let text = this.text;
    const isInsert = /^\s*insert/i.test(text);
    if (isInsert && !/returning/i.test(text)) {
      text = `${text.replace(/;\s*$/, "")} RETURNING id`;
    }
    const res = await (async () => {
      await ensureInit();
      return getSql().query(text, params);
    })();
    return {
      changes: res.rowCount ?? 0,
      lastInsertRowid: (res.rows[0] as { id?: number } | undefined)?.id,
    };
  }
}

class Db {
  prepare(sql: string): Statement {
    return new Statement(sql);
  }
  // Multi-statement DDL (schema creation). The HTTP driver rejects multiple
  // statements in one request, so split on `;` and run each individually.
  async exec(ddl: string): Promise<void> {
    const q = getSql();
    for (const stmt of splitStatements(ddl)) {
      await q.query(stmt);
    }
  }
}

const dbInstance = new Db();
export function getDb(): Db {
  return dbInstance;
}

// ─── SCHEMA (created once per cold start) ─────────────────────────────────────
let initPromise: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  if (!initPromise) initPromise = initSchema();
  return initPromise;
}

async function initSchema(): Promise<void> {
  const q = getSql();
  const ddl = `
    CREATE TABLE IF NOT EXISTS organizations (
      id            BIGSERIAL PRIMARY KEY,
      clerk_org_id  TEXT UNIQUE,
      name          TEXT NOT NULL,
      plan          TEXT NOT NULL DEFAULT 'trial',
      subscription_status TEXT NOT NULL DEFAULT 'trialing',
      stripe_customer_id  TEXT,
      stripe_subscription_id TEXT,
      trial_ends_at TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Referral growth loop: each org has a shareable code, may be attributed to
    -- one referrer at creation, and can accrue bonus event credits when a
    -- referral converts. See lib/referrals.ts for the attribution/reward logic.
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS referral_code TEXT;
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS referred_by BIGINT REFERENCES organizations(id) ON DELETE SET NULL;
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bonus_events INTEGER NOT NULL DEFAULT 0;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_org_referral_code ON organizations(referral_code) WHERE referral_code IS NOT NULL;

    -- Quick-start checklist progress: a JSON object of {taskKey: isoTimestamp}
    -- recording when each onboarding task was completed. See lib/onboarding.ts.
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS checklist_progress TEXT NOT NULL DEFAULT '{}';

    CREATE TABLE IF NOT EXISTS sourcing_events (
      id            BIGSERIAL PRIMARY KEY,
      org_id        BIGINT NOT NULL DEFAULT 1 REFERENCES organizations(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      category      TEXT NOT NULL,
      subcategory   TEXT,
      description   TEXT NOT NULL,
      requirements  TEXT NOT NULL,
      annual_spend  TEXT,
      timeline      TEXT,
      target_countries TEXT,
      outreach_anonymous BOOLEAN NOT NULL DEFAULT true,
      buyer_name    TEXT,
      buyer_role    TEXT,
      buyer_company TEXT,
      status        TEXT NOT NULL DEFAULT 'idle',
      wave_count    INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE sourcing_events ADD COLUMN IF NOT EXISTS outreach_anonymous BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE sourcing_events ADD COLUMN IF NOT EXISTS buyer_name TEXT;
    ALTER TABLE sourcing_events ADD COLUMN IF NOT EXISTS buyer_role TEXT;
    ALTER TABLE sourcing_events ADD COLUMN IF NOT EXISTS buyer_company TEXT;
    -- Ship-to: the destination market suppliers must be able to deliver/export to
    -- (e.g. "Italy", "EU"). Agents qualify supplier serviceability against this.
    ALTER TABLE sourcing_events ADD COLUMN IF NOT EXISTS ship_to TEXT;
    -- Project-management ergonomics (#40): pin surfaces a project at the top of
    -- the dashboard list. Archive hides it from the default view without
    -- deleting any of its data (suppliers/outreach history stay intact).
    ALTER TABLE sourcing_events ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE sourcing_events ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
    -- Multi-user visibility: the Clerk user id of whoever created the event.
    -- Admins/owners see every event in the org (plus who started it); regular
    -- members are scoped to their own (see GET /api/sourcing-events). Nullable
    -- so pre-existing rows (created before this column existed) stay visible
    -- to everyone rather than being silently orphaned.
    ALTER TABLE sourcing_events ADD COLUMN IF NOT EXISTS created_by TEXT;
    -- Advanced search: buyer-specified filters/attributes beyond the base
    -- brief (required certifications, employee/revenue floors, excluded
    -- countries, must-have keywords) captured on the "advanced brief" form.
    -- Stored as a JSON object and folded into the scout/qualifier prompts at
    -- discovery time — see effectiveRequirements in app/api/orchestrate/route.ts.
    ALTER TABLE sourcing_events ADD COLUMN IF NOT EXISTS advanced_filters TEXT;

    CREATE TABLE IF NOT EXISTS suppliers (
      id            BIGSERIAL PRIMARY KEY,
      event_id      BIGINT NOT NULL REFERENCES sourcing_events(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      country       TEXT NOT NULL,
      city          TEXT,
      description   TEXT NOT NULL,
      capabilities  TEXT NOT NULL,
      certifications TEXT,
      employees     TEXT,
      annual_revenue TEXT,
      founded       TEXT,
      website       TEXT,
      contact_email TEXT,
      contact_url   TEXT,
      contact_phone TEXT,
      contact_linkedin TEXT,
      data_sources  TEXT,
      scout_agent   TEXT,
      wave          INTEGER NOT NULL DEFAULT 1,
      ai_score      INTEGER,
      score_rationale TEXT,
      score_breakdown TEXT,
      enrichment    TEXT,
      funnel_stage  TEXT NOT NULL DEFAULT 'long_list',
      outreach_status TEXT NOT NULL DEFAULT 'pending',
      outreach_sent_at TIMESTAMPTZ,
      supplier_responded_at TIMESTAMPTZ,
      buyer_approved_at TIMESTAMPTZ,
      response_detail TEXT,
      reply_token   TEXT,
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_url TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_phone TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_linkedin TEXT;
    -- Anti-spam suppression: a supplier who unsubscribes is never emailed again.
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS opted_out BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ;
    -- Serviceability: markets/regions the supplier can deliver or export to, as
    -- assessed by the qualifier against the event's ship-to destination.
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS serviceable_regions TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ships_to_target BOOLEAN;
    -- Structured supplier record (Epic 1 — credibility layer): coarse business
    -- type, banded headcount, numeric founding year, a 0-5 review score, and a
    -- controlled capability-tag vocabulary (JSON array of tags). Populated by the
    -- scout during discovery and normalized to the controlled sets in
    -- lib/taxonomy.ts before insert, so stored values are always in-vocabulary.
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS business_type TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS employee_count TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS founded_year INTEGER;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS review_score DOUBLE PRECISION;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS capability_tags TEXT;
    -- Trust-signal fields (Epic 1 continuation — issue #39): named customers
    -- the supplier already ships to, markets it already exports to, and
    -- lightweight verification badges (e.g. "website-live") computed
    -- automatically rather than model-generated. Free text/JSON arrays with
    -- no fixed vocabulary except verification_badges (see lib/taxonomy.ts).
    -- All nullable — populated best-effort, never block insert on their absence.
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS partnered_customers TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS partnered_customer_count INTEGER;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS key_export_markets TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS verification_badges TEXT;
    -- Lightweight answer-quality signal (#46 — chat/UX polish bundle 1): a
    -- thumbs up/down on the AI's qualification for a supplier, mirroring the
    -- single-column + timestamp pattern used for opted_out above rather than a
    -- separate audit table (fine for a v1 quality signal, not a legal record).
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS feedback_signal SMALLINT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS feedback_updated_at TIMESTAMPTZ;
    -- #62: atomic-claim timestamps so concurrent send_outreach/send_followup
    -- requests for the same supplier (double-click, two open tabs) can't both
    -- pass the read-then-write gap and send duplicate emails. A claim is a
    -- timestamp, not just a boolean, so a request that crashes mid-send
    -- (leaving the claim set) self-heals after STALE_CLAIM_MINUTES instead of
    -- locking the supplier out of outreach forever — see lib/outreach-claim.ts.
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS outreach_claimed_at TIMESTAMPTZ;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS followup_claimed_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS agent_runs (
      id            BIGSERIAL PRIMARY KEY,
      event_id      BIGINT NOT NULL REFERENCES sourcing_events(id) ON DELETE CASCADE,
      agent_id      TEXT NOT NULL,
      agent_type    TEXT NOT NULL,
      agent_label   TEXT NOT NULL,
      wave          INTEGER NOT NULL DEFAULT 1,
      status        TEXT NOT NULL DEFAULT 'queued',
      message       TEXT,
      suppliers_found INTEGER DEFAULT 0,
      started_at    TIMESTAMPTZ,
      completed_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS token_usage (
      id            BIGSERIAL PRIMARY KEY,
      org_id        BIGINT NOT NULL DEFAULT 1,
      event_id      BIGINT NOT NULL REFERENCES sourcing_events(id) ON DELETE CASCADE,
      stage         TEXT NOT NULL,
      model         TEXT,
      input_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      web_searches  INTEGER NOT NULL DEFAULT 0,
      cost_usd      DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS outreach_logs (
      id            BIGSERIAL PRIMARY KEY,
      supplier_id   BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      direction     TEXT NOT NULL,
      subject       TEXT,
      body          TEXT NOT NULL,
      sent_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Website-contact outreach channel: when a supplier has no email but does
    -- have a contact_url, we can't submit an arbitrary third-party form
    -- automatically, so we draft the RFI text and log it here tagged
    -- channel='website_form' for the buyer to paste in manually, instead of
    -- silently skipping the supplier. Defaults to 'email' for every existing
    -- and ordinary outbound/inbound row.
    ALTER TABLE outreach_logs ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'email';

    CREATE TABLE IF NOT EXISTS audit_log (
      id            BIGSERIAL PRIMARY KEY,
      org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      event_id      BIGINT REFERENCES sourcing_events(id) ON DELETE CASCADE,
      actor_id      TEXT,
      action        TEXT NOT NULL,
      summary       TEXT NOT NULL,
      metadata      TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- In-app notification feed. Org-scoped (any member sees the org's feed) with
    -- a single read/unread flag per row. Populated on key events: discovery
    -- complete, supplier reply, outreach delivery failure. Email delivery is a
    -- best-effort side-channel (see lib/notifications.ts), not stored here.
    CREATE TABLE IF NOT EXISTS notifications (
      id            BIGSERIAL PRIMARY KEY,
      org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      event_id      BIGINT REFERENCES sourcing_events(id) ON DELETE CASCADE,
      type          TEXT NOT NULL,
      title         TEXT NOT NULL,
      body          TEXT,
      url           TEXT,
      read          BOOLEAN NOT NULL DEFAULT false,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- One row per successful referral attribution. referred_org_id is UNIQUE so
    -- an org can only ever be attributed to a single referrer (one attribution per
    -- org). status moves pending -> rewarded when the referred org converts.
    CREATE TABLE IF NOT EXISTS referrals (
      id              BIGSERIAL PRIMARY KEY,
      referrer_org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      referred_org_id BIGINT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
      code            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      reward_events   INTEGER NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      rewarded_at     TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS webhook_events (
      id            TEXT PRIMARY KEY,
      source        TEXT NOT NULL,
      processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket        TEXT NOT NULL,
      window_start  TIMESTAMPTZ NOT NULL,
      count         INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (bucket, window_start)
    );

    -- Durable, org-wide do-not-contact list (#98). suppliers.opted_out only
    -- suppresses a single supplier ROW; the same email would still be
    -- contactable from a brand-new sourcing event (a fresh row, opted_out
    -- defaults false). This table is keyed by (org_id, normalized email) so
    -- an opt-out or erasure request is honored across every future event the
    -- org runs, not just the one where the contact originally unsubscribed.
    CREATE TABLE IF NOT EXISTS suppression_list (
      id            BIGSERIAL PRIMARY KEY,
      org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email         TEXT NOT NULL,
      reason        TEXT NOT NULL DEFAULT 'unsubscribed',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (org_id, email)
    );

    CREATE INDEX IF NOT EXISTS idx_suppliers_event ON suppliers(event_id);
    CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log(org_id);
    CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event_id);
    CREATE INDEX IF NOT EXISTS idx_events_org ON sourcing_events(org_id);
    -- Cross-project search (#40) filters/joins suppliers by their parent
    -- event's org_id. This index makes that join selective.
    CREATE INDEX IF NOT EXISTS idx_events_org_archived ON sourcing_events(org_id, archived);
    CREATE INDEX IF NOT EXISTS idx_usage_event ON token_usage(event_id);
    CREATE INDEX IF NOT EXISTS idx_usage_org ON token_usage(org_id);
    CREATE INDEX IF NOT EXISTS idx_agentruns_event ON agent_runs(event_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications(org_id, read, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_org_id);
  `;
  // HTTP driver runs one statement per request — execute each in order.
  for (const stmt of splitStatements(ddl)) {
    await q.query(stmt);
  }

  // Ensure a default organization exists so pre-auth / seed rows have a home.
  await q.query(
    `INSERT INTO organizations (id, name, plan, subscription_status)
     VALUES (1, 'Default Organization', 'trial', 'trialing')
     ON CONFLICT (id) DO NOTHING`
  );
  // Keep the sequence ahead of the manually-inserted id=1 row.
  await q.query(
    `SELECT setval(pg_get_serial_sequence('organizations','id'),
                   GREATEST((SELECT MAX(id) FROM organizations), 1))`
  );
}

export type SourcingEvent = {
  id: number;
  org_id: number;
  title: string;
  category: string;
  subcategory: string | null;
  description: string;
  requirements: string;
  annual_spend: string | null;
  timeline: string | null;
  target_countries: string | null;
  ship_to: string | null;
  outreach_anonymous: boolean;
  buyer_name: string | null;
  buyer_role: string | null;
  buyer_company: string | null;
  status: string;
  wave_count: number;
  pinned: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type Supplier = {
  id: number;
  event_id: number;
  name: string;
  country: string;
  city: string | null;
  description: string;
  capabilities: string;
  certifications: string | null;
  employees: string | null;
  annual_revenue: string | null;
  founded: string | null;
  // Structured supplier record (Epic 1). business_type ∈ BUSINESS_TYPES,
  // employee_count is a banded label ∈ EMPLOYEE_BANDS, founded_year is numeric,
  // review_score is 0-5, capability_tags is a JSON array of CAPABILITY_TAGS
  // (see lib/taxonomy.ts). All nullable — legacy rows predate these columns.
  business_type: string | null;
  employee_count: string | null;
  founded_year: number | null;
  review_score: number | null;
  capability_tags: string | null;
  // Trust-signal fields (Epic 1 continuation — issue #39): see the matching
  // ALTER TABLE comment above for what each column holds. All nullable.
  partnered_customers: string | null;
  partnered_customer_count: number | null;
  key_export_markets: string | null;
  verification_badges: string | null;
  website: string | null;
  data_sources: string | null;
  contact_email: string | null;
  contact_url: string | null;
  contact_phone: string | null;
  contact_linkedin: string | null;
  scout_agent: string | null;
  wave: number;
  ai_score: number | null;
  score_rationale: string | null;
  score_breakdown: string | null;
  enrichment: string | null;
  funnel_stage: string;
  outreach_status: string;
  outreach_sent_at: string | null;
  supplier_responded_at: string | null;
  buyer_approved_at: string | null;
  response_detail: string | null;
  reply_token: string | null;
  notes: string | null;
  created_at: string;
};

export type AgentRun = {
  id: number;
  event_id: number;
  agent_id: string;
  agent_type: string;
  agent_label: string;
  wave: number;
  status: string;
  message: string | null;
  suppliers_found: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

// An immutable record of a governance-relevant action taken in an org.
export type AuditLog = {
  id: number;
  org_id: number;
  event_id: number | null;
  actor_id: string | null;
  action: string;
  summary: string;
  metadata: string | null;
  created_at: string;
};

// One message (outbound RFI/follow-up or inbound supplier reply) in a
// supplier's outreach correspondence. Together, all rows for a supplier_id
// form its revisitable outreach thread — see lib/outreach-log.ts.
export type OutreachLog = {
  id: number;
  supplier_id: number;
  direction: string; // 'inbound' | 'outbound'
  subject: string | null;
  body: string;
  sent_at: string;
};

// Organizations carry the billing/tenancy state.
export type Organization = {
  id: number;
  clerk_org_id: string | null;
  name: string;
  plan: string;
  subscription_status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  trial_ends_at: string | null;
  referral_code: string | null;
  referred_by: number | null;
  bonus_events: number;
  checklist_progress: string;
  created_at: string;
  updated_at: string;
};
