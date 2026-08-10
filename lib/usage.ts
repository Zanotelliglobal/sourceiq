import { getDb } from "@/lib/db";
import type { Organization } from "@/lib/db";
import { getTier, UNLIMITED, type Tier, type TierLimits } from "@/lib/plans";
type Db = ReturnType<typeof getDb>;

// ─── TOKEN ACCOUNTING ─────────────────────────────────────────────────────────
// Records real token usage from every Claude call so cost is measured, not
// estimated. Agents report usage via an onUsage callback; routes persist it.

// Per-model pricing ($ per 1M tokens). Cache reads are 0.1x input; cache writes
// 1.25x input, for every model. Unrecognized models fall back to Opus (the
// most expensive tier) so a mislabeled call over-, never under-, counts cost.
const DEFAULT_MODEL = "claude-opus-4-7";
const PRICE_TABLE: Record<string, { input: number; output: number; cache_read: number; cache_write: number }> = {
  "claude-opus-4-7": { input: 5.0 / 1_000_000, output: 25.0 / 1_000_000, cache_read: 0.5 / 1_000_000, cache_write: 6.25 / 1_000_000 },
  "claude-sonnet-4-6": { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000, cache_read: 0.3 / 1_000_000, cache_write: 3.75 / 1_000_000 },
  "claude-haiku-4-5": { input: 1.0 / 1_000_000, output: 5.0 / 1_000_000, cache_read: 0.1 / 1_000_000, cache_write: 1.25 / 1_000_000 },
};
const WEB_SEARCH_PRICE = 10.0 / 1_000; // $10 per 1,000 searches — a tool fee, flat across models

// Raw shape returned by the Anthropic SDK's response.usage (fields optional).
export type RawUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  server_tool_use?: { web_search_requests?: number };
};

export type UsageRecord = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  web_searches: number;
  cost_usd: number;
};

export function normalizeUsage(u: RawUsage | undefined | null, model: string = DEFAULT_MODEL): UsageRecord {
  const input = u?.input_tokens ?? 0;
  const output = u?.output_tokens ?? 0;
  const cacheRead = u?.cache_read_input_tokens ?? 0;
  const cacheWrite = u?.cache_creation_input_tokens ?? 0;
  const searches = u?.server_tool_use?.web_search_requests ?? 0;
  const price = PRICE_TABLE[model] ?? PRICE_TABLE[DEFAULT_MODEL];
  const cost =
    input * price.input +
    output * price.output +
    cacheRead * price.cache_read +
    cacheWrite * price.cache_write +
    searches * WEB_SEARCH_PRICE;
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    web_searches: searches,
    cost_usd: cost,
  };
}

/** Persist one usage record for a given event + pipeline stage. */
export async function recordUsage(
  db: Db,
  eventId: number,
  stage: string,
  raw: RawUsage | undefined | null,
  model: string = DEFAULT_MODEL
): Promise<UsageRecord> {
  const r = normalizeUsage(raw, model);
  // Resolve the owning tenant from the parent event so every usage row is
  // attributable to an organization for billing. Falls back to org 1.
  const evt = await db.prepare("SELECT org_id FROM sourcing_events WHERE id = ?").get(eventId) as { org_id?: number } | undefined;
  const orgId = evt?.org_id ?? 1;
  await db.prepare(
    `INSERT INTO token_usage
       (org_id, event_id, stage, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, cost_usd)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(orgId, eventId, stage, model, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens, r.web_searches, r.cost_usd);
  return r;
}

export type UsageSummary = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  web_searches: number;
  total_tokens: number;
  cost_usd: number;
  by_stage: { stage: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: number }[];
};

/** Aggregate all usage for an event, overall and per stage. */
export async function usageSummary(db: Db, eventId: number): Promise<UsageSummary> {
  const totalsRaw = await db.prepare(
    `SELECT
       COALESCE(SUM(input_tokens),0)      AS input_tokens,
       COALESCE(SUM(output_tokens),0)     AS output_tokens,
       COALESCE(SUM(cache_read_tokens),0) AS cache_read_tokens,
       COALESCE(SUM(cache_write_tokens),0) AS cache_write_tokens,
       COALESCE(SUM(web_searches),0)      AS web_searches,
       COALESCE(SUM(cost_usd),0)          AS cost_usd
     FROM token_usage WHERE event_id = ?`
  ).get(eventId) as Record<string, unknown>;

  // Postgres returns SUM() over integers as bigint strings — coerce to numbers.
  const totals = {
    input_tokens: Number(totalsRaw.input_tokens),
    output_tokens: Number(totalsRaw.output_tokens),
    cache_read_tokens: Number(totalsRaw.cache_read_tokens),
    cache_write_tokens: Number(totalsRaw.cache_write_tokens),
    web_searches: Number(totalsRaw.web_searches),
    cost_usd: Number(totalsRaw.cost_usd),
  };

  const by_stage = (await db.prepare(
    `SELECT stage,
            COUNT(*)                       AS calls,
            COALESCE(SUM(input_tokens),0)  AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens,
            COALESCE(SUM(cost_usd),0)      AS cost_usd
     FROM token_usage WHERE event_id = ?
     GROUP BY stage ORDER BY cost_usd DESC`
  ).all(eventId) as Record<string, unknown>[]).map(r => ({
    stage: String(r.stage),
    calls: Number(r.calls),
    input_tokens: Number(r.input_tokens),
    output_tokens: Number(r.output_tokens),
    cost_usd: Number(r.cost_usd),
  }));

  return {
    ...totals,
    total_tokens: totals.input_tokens + totals.output_tokens + totals.cache_read_tokens + totals.cache_write_tokens,
    by_stage,
  };
}

// ─── TIER LIMITS & METERING ───────────────────────────────────────────────────
// Resolves the plan a tenant is effectively on and measures its consumption
// against that tier's limits, so paid actions can be gated per plan.

/** The plan an org is effectively entitled to right now. */
export function effectiveTier(org: Organization): Tier {
  const byPlan = getTier(org.plan);
  if (byPlan) return byPlan;
  // Trials are cardless (no payment method on file) and must not carry
  // unbounded LLM cost exposure — cap them at Basic-equivalent limits rather
  // than Premium. Anything else unrecognized falls to Free.
  if (org.subscription_status === "trialing" || org.plan === "trial") return getTier("basic")!;
  return getTier("free")!;
}

export type TierUsage = {
  tier: Tier;
  limits: TierLimits;
  events_this_month: number;
  tokens_used: number;
  cost_usd: number;
  bonus_events: number;        // extra monthly events earned via referrals
  effective_limit: number | null; // plan limit + bonus (null = unlimited)
  events_remaining: number | null; // null = unlimited
};

/**
 * The effective monthly event allowance for an org: the plan's base limit plus
 * any referral bonus events. Returns UNLIMITED unchanged.
 */
export function effectiveEventLimit(org: Organization, baseLimit: number): number {
  if (baseLimit === UNLIMITED) return UNLIMITED;
  return baseLimit + Math.max(0, Number(org.bonus_events ?? 0));
}

/** Current-month consumption for an org measured against its effective tier. */
export async function getTierUsage(db: Db, org: Organization): Promise<TierUsage> {
  const tier = effectiveTier(org);

  const evtRow = await db.prepare(
    `SELECT COUNT(*) AS c FROM sourcing_events
      WHERE org_id = ? AND created_at >= date_trunc('month', now())`
  ).get(org.id) as Record<string, unknown> | undefined;
  const eventsThisMonth = Number(evtRow?.c ?? 0);

  const tokRow = await db.prepare(
    `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
            COALESCE(SUM(cost_usd), 0)                     AS cost
       FROM token_usage
      WHERE org_id = ? AND created_at >= date_trunc('month', now())`
  ).get(org.id) as Record<string, unknown> | undefined;

  const baseLimit = tier.limits.eventsPerMonth;
  const limit = effectiveEventLimit(org, baseLimit);
  const eventsRemaining = limit === UNLIMITED ? null : Math.max(0, limit - eventsThisMonth);

  return {
    tier,
    limits: tier.limits,
    events_this_month: eventsThisMonth,
    tokens_used: Number(tokRow?.tokens ?? 0),
    cost_usd: Number(tokRow?.cost ?? 0),
    bonus_events: Math.max(0, Number(org.bonus_events ?? 0)),
    effective_limit: limit === UNLIMITED ? null : limit,
    events_remaining: eventsRemaining,
  };
}

export type EventLimitCheck = { ok: true } | { ok: false; reason: string; limit: number; used: number };

/** Whether the org may create another sourcing event this month under its tier. */
export async function checkEventLimit(db: Db, org: Organization): Promise<EventLimitCheck> {
  const usage = await getTierUsage(db, org);
  const baseLimit = usage.limits.eventsPerMonth;
  if (baseLimit === UNLIMITED) return { ok: true };
  const limit = effectiveEventLimit(org, baseLimit);
  if (usage.events_this_month >= limit) {
    return { ok: false, reason: "event_limit_reached", limit, used: usage.events_this_month };
  }
  return { ok: true };
}

export type LimitCheck = { ok: true } | { ok: false; reason: string; limit: number; used: number };

/** Whether the org may run another discovery wave on this event under its tier. */
export function checkWaveLimit(tier: Tier, waveNumber: number): LimitCheck {
  const limit = tier.limits.wavesPerEvent;
  if (limit === UNLIMITED) return { ok: true };
  if (waveNumber > limit) return { ok: false, reason: "wave_limit_reached", limit, used: waveNumber - 1 };
  return { ok: true };
}

/** Whether the event has room for more suppliers under the tier's per-event cap. */
export async function checkSupplierLimit(db: Db, tier: Tier, eventId: number): Promise<LimitCheck> {
  const limit = tier.limits.suppliersPerEvent;
  if (limit === UNLIMITED) return { ok: true };
  const row = await db.prepare("SELECT COUNT(*)::int AS c FROM suppliers WHERE event_id = ?").get(eventId) as { c: number } | undefined;
  const used = Number(row?.c ?? 0);
  if (used >= limit) return { ok: false, reason: "supplier_limit_reached", limit, used };
  return { ok: true };
}

/** Whether the tier includes live supplier outreach at all. */
export function checkOutreachAllowed(tier: Tier): LimitCheck {
  if (!tier.limits.outreach) return { ok: false, reason: "outreach_not_included", limit: 0, used: 0 };
  return { ok: true };
}

/**
 * Whether this event's cumulative AI/agent spend is still under the tier's
 * hard per-event cost ceiling (#65). Unlike the count-based checks above,
 * `limit`/`used` here are USD amounts, not counts — callers should format
 * them as currency. Every agent-invoking action that has an event_id in
 * scope (discovery waves, outreach, follow-ups, contact discovery) should
 * call this before spending more, so a single event can never blow through
 * its cost cap even mid-run.
 */
export async function checkSpendCeiling(db: Db, tier: Tier, eventId: number): Promise<LimitCheck> {
  const limit = tier.limits.maxEventSpendUsd;
  if (limit === UNLIMITED) return { ok: true };
  const row = await db.prepare(
    "SELECT COALESCE(SUM(cost_usd),0) AS c FROM token_usage WHERE event_id = ?"
  ).get(eventId) as { c: number } | undefined;
  const used = Number(row?.c ?? 0);
  if (used >= limit) return { ok: false, reason: "spend_ceiling_reached", limit, used };
  return { ok: true };
}

export type OrgUsageSummary = {
  org_id: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  web_searches: number;
  total_tokens: number;
  cost_usd: number;
  events: number;
  by_event: { event_id: number; title: string; calls: number; cost_usd: number }[];
};

/** Aggregate all usage for a whole organization — the per-tenant billing rollup. */
export async function orgUsageSummary(db: Db, orgId: number): Promise<OrgUsageSummary> {
  const t = await db.prepare(
    `SELECT
       COALESCE(SUM(input_tokens),0)       AS input_tokens,
       COALESCE(SUM(output_tokens),0)      AS output_tokens,
       COALESCE(SUM(cache_read_tokens),0)  AS cache_read_tokens,
       COALESCE(SUM(cache_write_tokens),0) AS cache_write_tokens,
       COALESCE(SUM(web_searches),0)       AS web_searches,
       COALESCE(SUM(cost_usd),0)           AS cost_usd,
       COUNT(DISTINCT event_id)            AS events
     FROM token_usage WHERE org_id = ?`
  ).get(orgId) as Record<string, unknown>;

  const totals = {
    input_tokens: Number(t.input_tokens),
    output_tokens: Number(t.output_tokens),
    cache_read_tokens: Number(t.cache_read_tokens),
    cache_write_tokens: Number(t.cache_write_tokens),
    web_searches: Number(t.web_searches),
    cost_usd: Number(t.cost_usd),
    events: Number(t.events),
  };

  const by_event = (await db.prepare(
    `SELECT tu.event_id                     AS event_id,
            COALESCE(se.title, '(deleted)') AS title,
            COUNT(*)                        AS calls,
            COALESCE(SUM(tu.cost_usd),0)    AS cost_usd
     FROM token_usage tu
     LEFT JOIN sourcing_events se ON se.id = tu.event_id
     WHERE tu.org_id = ?
     GROUP BY tu.event_id, se.title ORDER BY cost_usd DESC`
  ).all(orgId) as Record<string, unknown>[]).map(r => ({
    event_id: Number(r.event_id),
    title: String(r.title),
    calls: Number(r.calls),
    cost_usd: Number(r.cost_usd),
  }));

  return {
    org_id: orgId,
    ...totals,
    total_tokens: totals.input_tokens + totals.output_tokens + totals.cache_read_tokens + totals.cache_write_tokens,
    by_event,
  };
}
