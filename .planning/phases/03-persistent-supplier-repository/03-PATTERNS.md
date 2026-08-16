# Phase 3: Persistent Supplier Repository - Pattern Map

**Mapped:** 2026-08-15
**Files analyzed:** 6 (2 new, 4 modified)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `lib/db.ts` (add `supplier_identities` + `org_supplier_data` DDL) | model/config (schema) | CRUD | same file, `suppliers`/`sourcing_events` DDL blocks (lines 175-254) | exact (same file, same pattern) |
| `lib/supplier-repository.ts` (new) | service | CRUD + read-side matching | `lib/tenant.ts` (org-scoped read helpers: `getOwnedEvent`, `orgOwnsEvent`, `orgOwnsSupplier`) + `lib/dedup.ts` (pure normalization functions) | role-match |
| `lib/process-supplier.ts` (modify `makeProcessSupplier`, `makeProcessSupplierQuick`, `makeProcessSupplierDeepen`) | service (write path) | CRUD (upsert) | same file's existing `INSERT INTO suppliers` / `UPDATE suppliers` blocks | exact (same file) |
| `app/api/orchestrate/route.ts` (modify — pre-search step before `runOrchestrator()` call) | route | request-response | same file's existing `avoidNames`/`existing` supplier lookup (~line 236) and its `runOrchestrator()` call site (~line 192) | exact (same file) |
| `tests/supplier-repository.test.ts` (new) | test | CRUD / isolation | `tests/process-supplier.test.ts` (`fakeDb()` pattern, lines 1-76) | role-match |
| `tests/process-supplier.test.ts` / `tests/quick-scan.test.ts` (extend `fakeDb()`) | test | CRUD | same files, existing `fakeDb()` SQL-regex-matching implementation | exact (same file) |

## Pattern Assignments

### `lib/db.ts` (schema, CRUD)

**Analog:** same file — `sourcing_events` and `suppliers` `CREATE TABLE IF NOT EXISTS` blocks.

**Imports/location pattern** — schema lives inside `initSchema()`, one big template-literal DDL string, executed via `splitStatements()` (confirmed at top of function, line 147 `async function initSchema(): Promise<void> { const q = getSql(); const ddl = ...`).

**Core pattern** (lines 150-169, `organizations` table — shows the exact `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS` idiom to copy):
```sql
CREATE TABLE IF NOT EXISTS organizations (
  id            BIGSERIAL PRIMARY KEY,
  clerk_org_id  TEXT UNIQUE,
  name          TEXT NOT NULL,
  ...
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS referred_by BIGINT REFERENCES organizations(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_referral_code ON organizations(referral_code) WHERE referral_code IS NOT NULL;
```

**Org-scoping/FK pattern** (`sourcing_events`, lines 175-177):
```sql
CREATE TABLE IF NOT EXISTS sourcing_events (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT NOT NULL DEFAULT 1 REFERENCES organizations(id) ON DELETE CASCADE,
  ...
```

**Indexing pattern** (lines 425-436, all in one trailing block):
```sql
CREATE INDEX IF NOT EXISTS idx_events_org ON sourcing_events(org_id);
CREATE INDEX IF NOT EXISTS idx_usage_org ON token_usage(org_id);
CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications(org_id, read, created_at DESC);
```

**Copy for this phase:** Add the two new `CREATE TABLE IF NOT EXISTS supplier_identities (...)` / `org_supplier_data (...)` blocks (full DDL already drafted in RESEARCH.md's "Schema DDL" section) into this same `ddl` template literal, placed after the existing `suppliers` block (line 254) and before the trailing index block (line 425), then add their `CREATE UNIQUE INDEX`/`CREATE INDEX` lines into that same trailing index block, matching the `idx_<table>_org` naming convention (`idx_supplier_identities_org`, `idx_org_supplier_data_org`).

---

### `lib/supplier-repository.ts` (new file — service, CRUD + matching)

**Analog 1 (org-scoped read helper convention):** `lib/tenant.ts`, `getOwnedEvent()` (lines 120-130) and `orgOwnsSupplier()` (lines 147-157).

**Pattern to copy** — every read takes `orgId` as a mandatory (non-optional) parameter, filters `WHERE ... org_id = ?` directly, and returns `null`/empty rather than throwing on a miss:
```typescript
export async function getOwnedEvent(
  db: ReturnType<typeof getDb>,
  ctx: OrgContext,
  eventId: number | string
): Promise<OwnedEventRow | null> {
  const event = (await db
    .prepare("SELECT * FROM sourcing_events WHERE id = ?")
    .get(Number(eventId))) as OwnedEventRow | undefined;
  if (!event || Number(event.org_id) !== ctx.orgId) return null;
  return event;
}

export async function orgOwnsSupplier(orgId: number, supplierId: number | string): Promise<boolean> {
  const db = getDb();
  const row = (await db
    .prepare(
      `SELECT se.org_id AS org_id
       FROM suppliers s JOIN sourcing_events se ON se.id = s.event_id
       WHERE s.id = ?`
    )
    .get(Number(supplierId))) as { org_id: number } | undefined;
  return !!row && Number(row.org_id) === orgId;
}
```
**Apply as:** `findKnownSuppliers(db, orgId)` — mandatory `orgId` param, `WHERE si.org_id = ?`, `LEFT JOIN org_supplier_data` (per Pitfall 4 in RESEARCH.md — avoid `INNER JOIN` so a partial-write orphaned identity row still surfaces).

**Analog 2 (pure normalization functions to reuse, not reimplement):** `lib/dedup.ts` (full file, 23 lines) — reuse directly, do not duplicate:
```typescript
export const normName = (n: string) =>
  (n || "")
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|company|srl|spa|sa|ag|kg|bv|plc|pvt|pte|group|holding|holdings|industries|manufacturing|mfg)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

export const domainOf = (url: string | null | undefined) => {
  if (!url) return "";
  return url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].trim();
};
```
`lib/supplier-repository.ts` should `import { normName, domainOf } from "@/lib/dedup";` — do not reimplement.

**Core upsert pattern** (design, adapted from RESEARCH.md's "Pattern 1", matching this codebase's `db.prepare(sql).run(...)` convention seen throughout `lib/process-supplier.ts` and `lib/tenant.ts`):
```typescript
const identityResult = await db.prepare(`
  INSERT INTO supplier_identities (org_id, name, norm_name, domain, website, country, last_category)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (org_id, norm_name) DO UPDATE SET
    name = EXCLUDED.name,
    domain = COALESCE(EXCLUDED.domain, supplier_identities.domain),
    website = COALESCE(EXCLUDED.website, supplier_identities.website),
    country = COALESCE(EXCLUDED.country, supplier_identities.country),
    last_category = COALESCE(EXCLUDED.last_category, supplier_identities.last_category),
    updated_at = now()
`).run(orgId, name, normName(name), domainOf(website) || null, website || null, country || null, categoryLabel || null);
const identityId = identityResult.lastInsertRowid;
```

**Error handling pattern (best-effort, non-blocking):** `lib/tenant.ts` lines 76-83 (referral attribution) — the exact "best-effort, never blocks caller" convention this phase's repository writes must follow:
```typescript
if (ins.changes > 0 && org) {
  try {
    const ref = cookies().get("siq_ref")?.value;
    if (ref) await attributeReferral(Number(org.id), ref);
  } catch {
    /* best-effort */
  }
}
```
Apply identically around every repository upsert call inside `process-supplier.ts` — wrap in `try { ... } catch { /* best-effort — repository write failure never blocks the per-event flow */ }`.

---

### `lib/process-supplier.ts` (modify — service, CRUD upsert integration)

**Analog:** same file, existing `INSERT INTO suppliers` block inside `makeProcessSupplier()`.

**Imports pattern** (lines 16-34) — path-alias imports, named exports, grouped by source module:
```typescript
import { getDb } from "@/lib/db";
import type { Supplier } from "@/lib/db";
import {
  runScoutAgent,
  runQualifierAgent,
  runQualifierAgentGrounded,
  runEnricherAgent,
  AGENT_MODELS,
} from "@/lib/agents";
```
Add: `import { normName, domainOf } from "@/lib/dedup";` and `import { upsertSupplierIdentity, upsertOrgSupplierData } from "@/lib/supplier-repository";` (or whatever names the new module exports).

**Core insert-then-upsert placement** — `makeProcessSupplier()` (lines 138-160): critical-path `INSERT INTO suppliers`, followed immediately by `deps.send({ type: "supplier_found", ... })`. The new repository upsert call is inserted right after this block (before or interleaved with the `send`), wrapped in try/catch best-effort per the pattern above:
```typescript
const result = await deps.db.prepare(`
  INSERT INTO suppliers (event_id, name, country, ... )
  VALUES (?,?,?,...)`)
  .run(deps.eventId, s.name, s.country, /* ... */);

const supplierId = result.lastInsertRowid;
const saved = await deps.db.prepare("SELECT * FROM suppliers WHERE id=?").get(supplierId) as Supplier;
deps.send({ type: "supplier_found", supplier: saved, agent_id: agent.id, agent_label: agent.label });

// NEW: best-effort repository upsert (identity, then org-private ai_score)
```

**Async/background upsert placement (second write for enrichment)** — inside the existing `enrichTask` closure (lines 167-177):
```typescript
const enrichTask = schedule(async () => {
  let enrichment;
  try {
    enrichment = await enricherAgent(s, score, deps.categoryLabel, deps.track("enricher", AGENT_MODELS.enricher));
  } catch {
    enrichment = { market_position: "Unknown", key_risks: [], key_strengths: [], recommended_action: "monitor" };
  }
  const enrichmentJson = JSON.stringify(enrichment);
  await deps.db.prepare(`UPDATE suppliers SET enrichment=? WHERE id=?`).run(enrichmentJson, supplierId);
  deps.send({ type: "supplier_updated", id: supplierId, enrichment: enrichmentJson });
  // NEW: mirror into org_supplier_data.enrichment, best-effort, using identityId
  // captured from the earlier synchronous upsert (closure variable).
});
deps.backgroundTasks.push(enrichTask);
```

**`makeProcessSupplierQuick()`** (lines 254-277) — same insert-then-upsert shape, but simpler deps (`ProcessSupplierQuickDeps` has no `categoryLabel`/`ai_score`; only `name`/`country`/`website` known at this point, so identity-only upsert with `ai_score`/`last_category` left null):
```typescript
export function makeProcessSupplierQuick(deps: ProcessSupplierQuickDeps) {
  return async (candidate: QuickScoutCandidate): Promise<Supplier> => {
    const result = await deps.db.prepare(`INSERT INTO suppliers (...) VALUES (...)`)
      .run(deps.eventId, candidate.name, candidate.country || "", ...);
    const supplierId = result.lastInsertRowid;
    const saved = await deps.db.prepare("SELECT * FROM suppliers WHERE id=?").get(supplierId) as Supplier;
    deps.send({ type: "supplier_found", supplier: saved });
    // NEW: best-effort identity-only upsert (no ai_score yet at quick-scan time)
    return saved;
  };
}
```

**`makeProcessSupplierDeepen()`** (lines 289-346, plus its `enrichTask` at 349-360) — per D-02's note and RESEARCH.md's A5 recommendation, this UPDATE path should also call the repository upsert (idempotent — safe even if the quick-scan insert already wrote through), at the same two points (synchronous ai_score-bearing upsert after the `UPDATE suppliers SET ...`, plus a second enrichment-only upsert inside its own `enrichTask` closure at line 349).

---

### `app/api/orchestrate/route.ts` (modify — route, request-response)

**Analog:** same file's existing pattern for building `avoidNames` before scout dispatch (~line 236) and the `runOrchestrator()` call site (~line 192).

**Integration point** — insert the new pre-search step immediately before line 192's `runOrchestrator()` call, where `db`, `ctx.orgId`, `categoryLabel` (defined line 98), and `event.target_countries` are already in scope:
```typescript
const categoryLabel = event.subcategory ? `${event.category} — ${event.subcategory}` : event.category;
// ...
// NEW: repository pre-search check (REPO-05) — before runOrchestrator()
const knownSuppliers = await findKnownSuppliers(db, ctx.orgId);
const relevantKnown = knownSuppliers.filter(s =>
  repositoryEntryMatchesEvent(s, categoryLabel, event.target_countries)
);
// fold relevantKnown into avoidNames / stream as supplier_found, per Open Question 1's recommendation

const plan = isTargeted
  ? /* ... existing targeted branch ... */
  : await runOrchestrator(categoryLabel, event.description, /* ... unchanged signature ... */);
```

**Existing `avoidNames` pattern to extend** (line 236):
```typescript
const avoidNames: string[] = existing.map(s => s.name);
```
Fold `relevantKnown` supplier names into this same array before scouts run.

**Do NOT** thread `db`/`orgId` into `runOrchestrator()` in `lib/agents.ts` — confirmed zero `@/lib/db` imports in that file; keep the db-touching query in the route per RESEARCH.md's explicit anti-pattern warning.

---

### `tests/supplier-repository.test.ts` (new — test, CRUD/isolation)

**Analog:** `tests/process-supplier.test.ts`, `fakeDb()` (lines 16-76).

**Pattern to copy** — minimal in-memory SQL-regex-matched stand-in, no mocking framework:
```typescript
function fakeDb() {
  const rows: Record<string, unknown>[] = [];
  let nextId = 1;
  const insertColumns = (sql: string): string[] => {
    const m = sql.match(/\(([^)]+)\)\s*VALUES/i);
    return m ? m[1].split(",").map(c => c.trim()) : [];
  };
  const db = {
    rows,
    prepare(sql: string) {
      return {
        async run(...params: unknown[]) {
          if (/^\s*insert/i.test(sql)) {
            const cols = insertColumns(sql);
            const row: Record<string, unknown> = { id: nextId++ };
            cols.forEach((c, i) => { row[c] = params[i]; });
            rows.push(row);
            return { changes: 1, lastInsertRowid: row.id as number };
          }
          // ... add matchers for UPDATE org_supplier_data SET ... / ON CONFLICT upserts
          return { changes: 0, lastInsertRowid: undefined };
        },
        async get(...params: unknown[]) { /* ... */ },
        async all() { return rows; },
      };
    },
  };
  return db as unknown as Db;
}
```
This needs a NEW `fakeRepositoryDb()` (or extended `fakeDb()`) that recognizes `INSERT INTO supplier_identities ... ON CONFLICT ...` and `INSERT INTO org_supplier_data ... ON CONFLICT ...` (and their `UPDATE` mirror forms) — the existing regex only matches plain `INSERT`/`UPDATE suppliers SET contact_email|enrichment|verification_badges`, which will silently no-op (not throw) on unrecognized SQL (see Pitfall 3 in RESEARCH.md — this is the single most important thing to get right in this file, since a silent no-op would make new isolation assertions pass without exercising real logic).

**Test structure to copy:** `describe`/`it`/`expect` from `vitest`, matching every other test file's imports (`import { describe, it, expect } from "vitest";`).

---

## Shared Patterns

### Org-scoping / tenancy
**Source:** `lib/tenant.ts` (`getOwnedEvent`, `orgOwnsEvent`, `orgOwnsSupplier`, lines 120-157)
**Apply to:** `lib/supplier-repository.ts`'s `findKnownSuppliers()` and any repository upsert helper — `orgId` is always a mandatory, non-optional first-class parameter, filtered directly via a `WHERE org_id = ?`/`= ?` predicate, never inferred or defaulted.

### Best-effort, non-blocking side writes
**Source:** `lib/tenant.ts` lines 76-83 (referral attribution)
**Apply to:** All repository upsert calls added inside `lib/process-supplier.ts`'s three functions — wrap each in `try { ... } catch { /* best-effort */ }` so a repository-write failure never blocks the per-event `suppliers` critical path (no multi-statement transactions available per `.claude/CLAUDE.md`'s Neon HTTP driver constraint).

### Schema DDL idiom
**Source:** `lib/db.ts` `initSchema()` (lines 147-436)
**Apply to:** `supplier_identities` / `org_supplier_data` table additions — `CREATE TABLE IF NOT EXISTS` + trailing `CREATE INDEX IF NOT EXISTS idx_<table>_<col>` block, following the exact `idx_events_org`/`idx_usage_org` naming convention.

### Dedup normalization
**Source:** `lib/dedup.ts` (`normName`, `domainOf`)
**Apply to:** `lib/supplier-repository.ts`'s upsert conflict-target computation and `app/api/orchestrate/route.ts`'s pre-search matching — import directly, never reimplement (D-03 locked decision).

### `db.prepare(sql).run(...params)` / `.get(...)` / `.all()` convention
**Source:** `lib/process-supplier.ts` (throughout), `lib/tenant.ts` (throughout)
**Apply to:** Every new SQL call in `lib/supplier-repository.ts` — positional `?` placeholders, `result.lastInsertRowid` for the new row id, `SELECT ... WHERE id=?` immediately after an insert to fetch the full row for streaming/returning.

## No Analog Found

None — this phase is additive within an already-established multi-tenant CRUD codebase; every new file/modification has a direct same-file or same-role analog.

## Metadata

**Analog search scope:** `lib/db.ts`, `lib/process-supplier.ts`, `lib/dedup.ts`, `lib/tenant.ts`, `app/api/orchestrate/route.ts`, `tests/process-supplier.test.ts`
**Files scanned:** 6 (all read directly this session, non-overlapping targeted ranges)
**Pattern extraction date:** 2026-08-15
