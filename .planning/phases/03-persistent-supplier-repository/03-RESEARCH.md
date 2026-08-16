# Phase 3: Persistent Supplier Repository - Research

**Researched:** 2026-08-15
**Domain:** Postgres schema design (Neon HTTP driver, no transactions) + write-path integration into an existing multi-agent supplier-discovery pipeline
**Confidence:** MEDIUM — codebase facts are HIGH confidence (read directly this session); the REPO-05 matching heuristic and the exact new-column additions are original design proposals ([ASSUMED]), since no algorithm or extra columns were specified by the user and this domain has no single authoritative external doc to check against.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (Schema split, REPO-04):** Two-table split: a new `supplier_identities` table holds only the shared/public identity fields (name, domain, country, website) and serves as the dedup key — plus an `org_id` column since the repository is per-org (not platform-wide, see D-06). A second new table (e.g. `org_supplier_data`) holds org-private fields (enrichment, AI score, notes, rating — the last of these feeding Phase 4's RATE-01/02) with a foreign key to both the identity row and the org. A leaky query scoped to one table structurally cannot expose the other table's columns — this is the "structural" isolation REPO-04 asks for, not query-discipline-only isolation. Reversibility: the split is a schema decision; merging back into one table later would require a migration, but splitting further (e.g. more private tables) is additive and low-risk.
- **D-02 (Write path, REPO-02):** Extend the existing per-event insertion functions — `makeProcessSupplier()` and `makeProcessSupplierQuick()` in `lib/process-supplier.ts` — to also upsert into the repository tables, immediately after (or alongside) each function's existing `INSERT INTO suppliers` per-event write. Every current and future caller of these two functions automatically writes through to the repository with zero new call sites to remember. Note for planner: `makeProcessSupplierDeepen()` (~line 289) updates an existing per-event row rather than inserting a new one — planner should decide whether deepen also needs a repository upsert (likely yes, since it changes `is_quick_result`/enrichment data the repository's org-private table cares about) or whether the original quick-scan insert already covered it.
- **D-03 (Dedup, REPO-03):** Reuse `lib/dedup.ts`'s existing exported `normName()` and `domainOf()` functions directly for repository-level dedup — the exact same normalization already used for within-event dedup, so there's a single definition of "same supplier" across both layers, no drift.
- **D-04 (Pre-search check, REPO-05):** The check happens as an orchestrator planning step, before scout agents are dispatched — `runOrchestrator()` in `lib/agents.ts` queries the org's repository for suppliers matching the event's category/geography before deciding which scout agents to run, and folds already-known matches directly into the event's supplier list (skipping a fresh scout search for those specific suppliers), reducing redundant `web_search` spend. Claude's discretion (flagged for research): the exact matching heuristic for "relevant to this new event" (category/geography matching against repository entries) is non-trivial and may need dedicated research — no exact algorithm was specified by the user.
- **D-05 (Scope, REPO-06):** Confirmed: per-org only for this milestone. No cross-org sharing, no aggregated cross-org quality score, no platform-wide dedup.
- **D-06 (Verification):** Full verification suite (`npm run typecheck && npm run lint && npm test && npm run build`) gates completion. A new two-org test (per REPO-04's acceptance criterion) is required: confirm a query bug scoped to one org's data path cannot expose another org's private enrichment/AI score/notes/rating data.

### Claude's Discretion

- Exact repository-check matching heuristic for REPO-05 (category/geography matching logic) — flagged for research attention. **Addressed below; see "REPO-05 Matching Heuristic."**
- Exact column list and naming for the new `supplier_identities` / `org_supplier_data`-equivalent tables beyond the fields explicitly named in REPO-01/REPO-04 (name, domain, country, website, enrichment, ai_score, notes, rating). **Addressed below; see "Standard Stack" / schema DDL.**
- Whether `makeProcessSupplierDeepen()` needs its own repository upsert call. **Addressed below — recommendation: yes, at two points.**
- Migration/backfill strategy is explicitly NOT needed — REPO-V2-04 defers retroactive backfill of pre-existing `suppliers` rows to v2; this phase applies going forward only.

### Deferred Ideas (OUT OF SCOPE)

None raised this session — the user explicitly reconfirmed per-org scope rather than expanding it (see D-05). Also out of scope per REQUIREMENTS.md v2 section: platform-wide (cross-org) sharing (REPO-V2-01), aggregated cross-org quality score (REPO-V2-02), advanced fuzzy identity resolution beyond name+domain (REPO-V2-03), retroactive backfill (REPO-V2-04).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REPO-01 | New persistent, org-scoped supplier identity store, separate from per-event `suppliers`, survives across events | Schema DDL for `supplier_identities` below; confirmed no such table exists yet in `lib/db.ts` (read in full this session) |
| REPO-02 | Every supplier discovered via quick scan / full investigation / (future) RFP matching written through a single shared write path extending `lib/process-supplier.ts` | Concrete upsert call placement inside `makeProcessSupplier()` and `makeProcessSupplierQuick()`; deepen-path recommendation |
| REPO-03 | Dedups on `lib/dedup.ts`'s `normName()`/`domainOf()` | Confirmed exact function bodies (read this session); upsert conflict-target design built directly on `normName()`'s output |
| REPO-04 | Shared/public identity fields modeled separately from org-private fields so a query bug can't leak private data | Two-table DDL + FK design + two-org isolation test design below |
| REPO-05 | New investigation can check repository for an already-known supplier before spending AI-search budget | Matching heuristic design + concrete hook point (route-level, not inside `runOrchestrator()` itself — see Architecture Patterns) |
| REPO-06 | Repository scoped per-org, not platform-wide, for this milestone | `org_id` on both new tables; every query takes `orgId` as a mandatory, non-optional parameter |

</phase_requirements>

## Summary

This phase adds two new Postgres tables alongside the existing per-event `suppliers` table: `supplier_identities` (shared/public fields: name, normalized name, domain, website, country, org_id) and `org_supplier_data` (org-private fields: enrichment, ai_score, notes, rating, with foreign keys to both `supplier_identities.id` and `organizations.id`). Both tables follow the exact `CREATE TABLE IF NOT EXISTS` pattern already used for every other table in `lib/db.ts` (read in full this session — no ORM, no migration framework, schema lives entirely in one `initSchema()` function executed statement-by-statement through `splitStatements()`).

The write path is two single-statement `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` upserts (Postgres upsert semantics confirmed via official docs — [CITED: postgresql.org/docs/current/sql-insert.html]), called from inside `makeProcessSupplier()` and `makeProcessSupplierQuick()` in `lib/process-supplier.ts`, immediately after each function's existing per-event `INSERT INTO suppliers`. Because the Neon HTTP driver forbids multi-statement transactions (confirmed project-wide constraint, documented in `.claude/CLAUDE.md` and directly visible in `lib/db.ts`'s comments), the identity upsert and the org-private upsert are two independent round trips; the research below designs the failure-mode handling (best-effort, non-blocking, matching the codebase's existing try/catch-and-continue convention for non-critical side writes) and clarifies that the enrichment column specifically must be written a *second* time, later, from inside the existing background `enrichTask` closures — not just at the initial insert point — since enrichment resolves asynchronously off the critical path in both `makeProcessSupplier()` and `makeProcessSupplierDeepen()`.

The most consequential finding is architectural: `runOrchestrator()` in `lib/agents.ts` (read in full this session, lines 215-271) is a pure LLM-calling function today — it imports nothing from `lib/db.ts`, takes no `db`/`orgId` parameter, and every other function in `lib/agents.ts` follows the same pattern (Anthropic SDK calls only). The repository pre-search check therefore should NOT be implemented by threading a `db` handle into `runOrchestrator()` itself; it should be implemented as a new step in `app/api/orchestrate/route.ts`, immediately before its existing call to `runOrchestrator()` (line 192), where `db`, `ctx.orgId`, `categoryLabel`, and `event.target_countries` are already in scope. This preserves the existing separation of concerns (pure-agent-logic module vs. db-touching route) and the project's existing "no-mocking-framework" unit-test convention for `lib/agents.ts`. A second, non-obvious finding: neither `supplier_identities` nor `org_supplier_data` (as scoped by D-01's named fields) stores a category — so the REPO-05 matching heuristic has no field to match "category" against unless a new, denormalized column is added. This research recommends adding one (`last_category`, populated at write time from data already in scope inside `makeProcessSupplier`/`makeProcessSupplierQuick`) and flags it clearly as an addition beyond D-01's explicit field list, within the "Claude's Discretion" scope the user already granted for exact columns.

**Primary recommendation:** Two new tables (`supplier_identities`, `org_supplier_data`) added via the existing `CREATE TABLE IF NOT EXISTS` block in `lib/db.ts`; two upsert calls added inside `makeProcessSupplier()`/`makeProcessSupplierQuick()` (plus a second org-private upsert inside each function's existing background `enrichTask` closure); `makeProcessSupplierDeepen()` gets the same treatment; the REPO-05 pre-search check is a new step inside `app/api/orchestrate/route.ts` (not inside `runOrchestrator()`), gated on a denormalized `last_category` column plus normalized-country matching against `event.target_countries`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Persistent supplier identity storage (`supplier_identities`) | Database/Storage | — | New table, no application logic beyond CRUD |
| Org-private supplier data (`org_supplier_data`: enrichment/ai_score/notes/rating) | Database/Storage | — | Same; FK-isolated per D-01 |
| Repository upsert write path | API/Backend | — | Lives inside `lib/process-supplier.ts` factory functions, invoked by `app/api/orchestrate/route.ts` and `app/api/investigate-quick/route.ts` |
| Dedup normalization (`normName`/`domainOf` reuse) | API/Backend | — | Pure functions in `lib/dedup.ts`, already shared between two routes |
| REPO-05 pre-search repository check | API/Backend | — | Belongs in `app/api/orchestrate/route.ts` (has `db`+`ctx.orgId` in scope), NOT inside `lib/agents.ts`'s `runOrchestrator()` (pure LLM function, no db access today) |
| Category/geography matching heuristic | API/Backend | — | New pure helper module (e.g. `lib/supplier-repository.ts`), consumed by the route |
| Two-org isolation test | Test Infrastructure | — | `tests/*.test.ts`, extends the existing `fakeDb()` pattern from `tests/process-supplier.test.ts` |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@neondatabase/serverless` | ^1.1.0 (already in `package.json`, confirmed) | Postgres HTTP driver | Already the project's only DB driver; no new dependency needed |

No new external packages are required for this phase — the schema/write-path/matching work uses plain Postgres DDL/DML via the existing `getDb()` wrapper and reuses `lib/dedup.ts`'s existing pure functions. **Package Legitimacy Audit is not applicable** (see below).

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| *(none new)* | — | — | — |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Two-table FK split (D-01, locked) | Postgres Row-Level Security (RLS) with a per-session tenant GUC | RLS gives defense-in-depth even against a missing `WHERE org_id` clause, but requires setting a session-level tenant context (`SET app.current_tenant`) per connection — the Neon HTTP driver is stateless (one `fetch` per statement, confirmed in `lib/db.ts`'s own comments about why the HTTP transport was chosen), so there's no persistent session to attach a GUC to without re-issuing `SET` on every single query. Not adopted for this phase; the two-table structural split already satisfies REPO-04's literal acceptance language without this added complexity. [ASSUMED — my own applicability judgment, informed by `SET app.current_tenant`-based RLS pattern described in multiple web sources, not from a single authoritative doc.] |
| Denormalized `last_category` column on `supplier_identities` (recommended below) | A join back through `suppliers`/`sourcing_events` to compute historical categories per identity at query time | The join approach is more accurate (captures every category an identity has ever appeared under, not just the most recent) but requires reproducing `normName()`/`domainOf()` logic in SQL (they're JS functions today, not SQL-expressible without a generated column) — meaningfully more complex for a v1 that explicitly excludes "advanced fuzzy identity resolution" (REPO-V2-03). Denormalized column is simpler and sufficient for a first pass. |

**Installation:** No `npm install` needed for this phase.

**Version verification:** N/A — no new packages.

## Package Legitimacy Audit

**Not applicable this phase** — no new external packages are installed. The write path, schema, and matching heuristic all use the existing `@neondatabase/serverless` driver and plain Postgres DDL/DML, plus reuse of `lib/dedup.ts`'s already-audited, in-repo pure functions.

## Architecture Patterns

### System Architecture Diagram

```
Quick scan event                Full investigation event            Deepen (re-verify quick-scan row)
      |                                  |                                     |
      v                                  v                                     v
app/api/investigate-quick/route.ts   app/api/orchestrate/route.ts       app/api/orchestrate/route.ts
      |                                  | (1) NEW: repository          (isTargeted branch)
      |                                  |     pre-search check                |
      |                                  |     (org_id, categoryLabel,         |
      |                                  |     target_countries) --------+     |
      |                                  |                                |    |
      |                                  v                                |    v
      |                            runOrchestrator()  <--- unchanged,     |  makeProcessSupplierDeepen()
      |                            pure LLM call, no db access            |    |
      |                                  |                                |    |
      |                                  v                                |    |
      |                            runScoutAgent() x N (existing)         |    |
      |                                  |                                |    |
      v                                  v                                v    v
makeProcessSupplierQuick()          makeProcessSupplier()  <----------- (2) NEW: repository
      |                                  |                                     upsert calls
      | INSERT INTO suppliers            | INSERT INTO suppliers               (both paths)
      | (existing, unchanged)            | (existing, unchanged)
      |                                  |
      +---------------+------------------+
                       |
                       v
        NEW: identity upsert -> supplier_identities
             (ON CONFLICT (org_id, norm_name) DO UPDATE ... RETURNING id)
                       |
                       v
        NEW: org-private upsert -> org_supplier_data
             (ON CONFLICT (identity_id) DO UPDATE ... RETURNING id)
             [ai_score written now; enrichment written a SECOND time later,
              from inside the existing background enrichTask closure]
                       |
                       v
              (best-effort — failure here never blocks the
               per-event suppliers.INSERT critical path)
```

### Recommended Project Structure

```
lib/
├── db.ts                    # ADD: supplier_identities + org_supplier_data DDL (existing file, additive)
├── dedup.ts                 # UNCHANGED — normName()/domainOf() reused as-is
├── process-supplier.ts      # MODIFY: add repository upsert calls inside makeProcessSupplier(),
│                            #   makeProcessSupplierQuick(), makeProcessSupplierDeepen()
├── supplier-repository.ts   # NEW — repository upsert helpers + REPO-05 matching heuristic
│                            #   (keeps lib/process-supplier.ts and app/api/orchestrate/route.ts
│                            #   from re-implementing the same upsert SQL independently)
└── agents.ts                # UNCHANGED — runOrchestrator() stays pure, no db import
app/api/
└── orchestrate/route.ts     # MODIFY: new pre-search-check step before the existing
                              #   runOrchestrator() call (~line 192)
tests/
└── supplier-repository.test.ts  # NEW — two-org isolation test + upsert/dedup unit tests
```

### Pattern 1: Single-statement upsert via `ON CONFLICT ... DO UPDATE ... RETURNING`

**What:** Both new tables use Postgres's native atomic upsert instead of a manual SELECT-then-INSERT/UPDATE, so each write is exactly one HTTP round trip (compatible with the Neon HTTP driver's single-statement-per-request limit) and race-safe under concurrent scouts.
**When to use:** Every write into `supplier_identities` or `org_supplier_data`.
**Example:**
```typescript
// Source: postgresql.org/docs/current/sql-insert.html [CITED] — ON CONFLICT DO UPDATE
// guarantees an atomic INSERT-or-UPDATE outcome even under concurrency; the
// EXCLUDED pseudo-table exposes the values from the attempted INSERT.

// supplier_identities: conflict target is (org_id, norm_name) — the same
// normalization already computed by lib/dedup.ts's normName().
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
const identityId = identityResult.lastInsertRowid; // RETURNING id appended automatically by Statement.run()

// org_supplier_data: conflict target is identity_id (1:1 with an identity
// row within its org). notes/rating are NEVER set here — they're
// buyer-entered fields (Phase 4), and a column absent from SET is never
// touched by DO UPDATE, so a re-discovery can never clobber a buyer's rating.
await db.prepare(`
  INSERT INTO org_supplier_data (identity_id, org_id, ai_score)
  VALUES (?, ?, ?)
  ON CONFLICT (identity_id) DO UPDATE SET
    ai_score = EXCLUDED.ai_score,
    updated_at = now()
`).run(identityId, orgId, score.overall_score);
```

### Pattern 2: Two-phase org-private write (initial ai_score, then async enrichment)

**What:** `makeProcessSupplier()`/`makeProcessSupplierDeepen()` compute `ai_score` synchronously (on the critical path) but `enrichment` asynchronously in a background-scheduled closure (`schedule(async () => { ... })`, confirmed at `lib/process-supplier.ts:167-178` and `:349-360`). The repository's `org_supplier_data.enrichment` column must therefore be upserted from *inside* that same background closure — a single upsert call placed only at the top of the function will permanently miss the enrichment value.
**When to use:** Any repository write that depends on a value computed by a background task in this pipeline.
**Example:**
```typescript
// Inside the EXISTING enrichTask closure in makeProcessSupplier() (~line 167):
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

  // NEW: mirror the per-event enrichment write into the repository's
  // org-private table, best-effort (never throws into the caller).
  try {
    await deps.db.prepare(`
      UPDATE org_supplier_data SET enrichment=?, updated_at=now() WHERE identity_id=?
    `).run(enrichmentJson, identityId);
  } catch { /* best-effort — repository write failure never blocks the per-event flow */ }
});
```

### Anti-Patterns to Avoid

- **Wrapping the identity + org-private upsert pair in application-level "transaction" logic (manual rollback-on-failure code):** The Neon HTTP driver has no multi-statement transactions (confirmed constraint). Writing compensating-rollback code for the second statement's failure adds complexity for a case that's already self-healing: `org_supplier_data` upserts on `identity_id`, so a later successful write (next discovery of the same supplier, or a retry) fills in the gap. Match the codebase's own established pattern instead — best-effort `try/catch` around non-critical side writes (see `lib/tenant.ts` lines 76-83, referral attribution: `try { ... } catch { /* best-effort */ }`).
- **Threading `db`/`orgId` into `lib/agents.ts`'s `runOrchestrator()`:** Every function in `lib/agents.ts` is a pure Anthropic-SDK caller today (confirmed: zero `@/lib/db` imports in the file). Making `runOrchestrator()` a db-touching function breaks the existing separation of concerns and the "no mocking framework, just typed fakes" testing convention used for the rest of this file. Do the pre-search check in the *route*, before the existing `runOrchestrator()` call.
- **Enforcing dedup with two independent UNIQUE constraints (one on `norm_name`, one on `domain`):** Postgres's `ON CONFLICT` targets exactly one conflict inference expression per statement. Two independent unique indexes would require two separate upsert attempts with different fallback logic, and could conflict with each other (a name match on one row, a domain match on a different row). Recommendation: use a single `UNIQUE (org_id, norm_name)` constraint as the primary conflict target (matches D-03's exact-normalization approach) and treat domain as a secondary match-only signal used in the *read-side* query (REPO-05's pre-search check), not as a second write-side constraint.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic check-then-insert-or-update on a race-prone dedup key | A manual `SELECT ... then INSERT/UPDATE` two-statement dance guarded by application-level locking | Postgres native `INSERT ... ON CONFLICT ... DO UPDATE` | Single HTTP round trip (Neon driver constraint), atomic under concurrency by Postgres's own guarantee [CITED: postgresql.org] — no custom locking code needed |
| Cross-org data leak prevention | A new authorization/ACL layer, or Postgres RLS | The existing `WHERE org_id = ?` pattern already used everywhere in this codebase (`getOwnedEvent`, `orgOwnsEvent`, `app/api/search/route.ts`), centralized into one canonical repository-read helper function that takes `orgId` as a mandatory parameter | Matches every existing tenancy check in `lib/tenant.ts`; adding RLS would be a new, unproven pattern for this codebase and doesn't fit the stateless Neon HTTP driver (no persistent session for a tenant GUC) |
| Fuzzy company-name matching (subsidiaries, historical renames) | A fuzzy-matching library (Levenshtein, `string-similarity`, etc.) | `lib/dedup.ts`'s existing `normName()`/`domainOf()` | Explicitly out of scope per REPO-V2-03 ("advanced fuzzy identity resolution... beyond name+domain"); user locked D-03 to reuse exactly this normalization |

**Key insight:** Nearly everything this phase needs already exists in the codebase in some form (the `CREATE TABLE IF NOT EXISTS` DDL pattern, the org-scoping-via-`org_id`-column pattern, the `normName()`/`domainOf()` normalization, the best-effort-side-write `try/catch` convention). The work is almost entirely "apply an existing pattern to two new tables and three call sites," not "introduce a new pattern."

## Common Pitfalls

### Pitfall 1: Adding the repository upsert to `runOrchestrator()` instead of the route

**What goes wrong:** A literal reading of D-04 ("runOrchestrator() in lib/agents.ts queries the org's repository") could lead to threading `db`/`orgId` into `runOrchestrator()`'s signature.
**Why it happens:** The context doc's wording describes the *behavior* (an "orchestrator planning step") using the function name that currently performs LLM-only planning, without accounting for the fact that `lib/agents.ts` has zero db access today.
**How to avoid:** Implement the pre-search check as a new step in `app/api/orchestrate/route.ts`, right before its existing `const plan = isTargeted ? ... : await runOrchestrator(...)` call (confirmed at line 192) — `db`, `ctx.orgId`, `categoryLabel`, and `event.target_countries` are all already in scope there. Optionally pass the matched repository suppliers *into* `runOrchestrator()`'s prompt as additional context (mirroring the existing `avoidList`/`existingNames` pattern already used by `runScoutAgent()` at line 286-288) so the orchestrator's strategy accounts for what's already known — but the *query itself* stays in the route.
**Warning signs:** A PR that adds `import { getDb } from "@/lib/db"` to `lib/agents.ts`.

### Pitfall 2: Missing enrichment in the repository because it resolves after the initial upsert

**What goes wrong:** `org_supplier_data.enrichment` stays `NULL` forever even though the per-event `suppliers.enrichment` gets filled in a few seconds later.
**Why it happens:** `ai_score` is available synchronously (computed before the `INSERT INTO suppliers` at `lib/process-supplier.ts:145-156`), but `enrichment` is computed inside a `schedule(async () => {...})` background closure that runs *after* the row is already inserted and streamed (confirmed at lines 167-178 for `makeProcessSupplier`, lines 349-360 for `makeProcessSupplierDeepen`). A single repository-upsert call placed only at the top of the function captures `ai_score` but not `enrichment`.
**How to avoid:** Add a second, smaller org-private upsert (`UPDATE org_supplier_data SET enrichment=? WHERE identity_id=?`) inside the existing `enrichTask` closure, right after its existing `UPDATE suppliers SET enrichment=?`.
**Warning signs:** A two-org isolation test or manual QA that checks `org_supplier_data.enrichment` immediately after wave completion and finds it `NULL` even though the UI shows enrichment on the supplier card.

### Pitfall 3: `fakeDb()` in existing tests doesn't recognize new SQL statements

**What goes wrong:** Existing tests in `tests/process-supplier.test.ts` silently no-op (return `{ changes: 0, lastInsertRowid: undefined }`) for any SQL statement the test's `fakeDb()` regex matcher doesn't recognize (confirmed: `fakeDb()`'s `prepare().run()` falls through to a default no-op return for unmatched SQL at line 60 of that file) — the new repository upsert calls added inside `makeProcessSupplier()` will silently do nothing in existing tests rather than throwing, which can mask a bug where the repository upsert never actually ran.
**Why it happens:** `fakeDb()` is a minimal, purpose-built stand-in that pattern-matches SQL by regex; it wasn't built anticipating new tables.
**How to avoid:** Extend `fakeDb()` (or write a parallel fake specifically for repository tests) to handle `INSERT INTO supplier_identities` / `INSERT INTO org_supplier_data` / their `UPDATE` variants before writing any new assertions that depend on repository state after calling `makeProcessSupplier()`.
**Warning signs:** A new test asserts on `org_supplier_data` state after calling `makeProcessSupplier()` and the assertion passes even when the actual upsert code has a bug — because the fake silently swallowed the unrecognized SQL.

### Pitfall 4: Partial write leaves an orphaned identity row invisible to the pre-search check

**What goes wrong:** The identity upsert succeeds, the org-private upsert fails (network blip, serverless timeout) — leaving a `supplier_identities` row with no matching `org_supplier_data` row. A naive `INNER JOIN` between the two tables in the REPO-05 pre-search query would silently exclude that supplier from being found on the next investigation, even though its identity is already known.
**Why it happens:** No multi-statement transaction to guarantee both writes succeed together (confirmed Neon HTTP driver constraint).
**How to avoid:** The pre-search check's query should `LEFT JOIN org_supplier_data` (not `INNER JOIN`), coalescing missing `enrichment`/`ai_score`/`notes`/`rating` to `NULL`/defaults, so an orphaned identity-only row still surfaces (with no enrichment data) rather than vanishing.
**Warning signs:** A supplier discovered once, then re-searched-for in a later event, gets re-discovered from scratch (wasting AI-search budget) even though its name/domain should have matched an existing identity row.

## Code Examples

### REPO-05 Matching Heuristic (category/geography)

The repository schema as scoped by D-01 (name, domain, country, website, org_id on the identity table; enrichment, ai_score, notes, rating on the org-private table) has **no field that carries category**. Without one, the pre-search check has nothing to match "relevant to this event's category" against. This research recommends adding a denormalized `last_category` column to `supplier_identities` (see schema below), populated at write time from `deps.categoryLabel`, which is already in scope inside `makeProcessSupplier()`/`makeProcessSupplierQuick()` — no new lookup needed. This is an addition beyond D-01's explicitly named fields, made under the "Claude's Discretion — exact column list" grant; it should be confirmed with the user or at minimum called out explicitly in the plan.

```typescript
// Source: original design (this research) — [ASSUMED], no external algorithm exists
// to check this against; flagged in CONTEXT.md as needing dedicated research.
// New file: lib/supplier-repository.ts

// event.category (bare, e.g. "Precision Machining & CNC") is a FIXED,
// user-chosen 13-item vocabulary defined client-side in
// app/events/new/page.tsx's CATEGORIES const — confirmed this session there is
// no shared/server-side export of this list; app/api/classify/route.ts receives
// "categories" as a plain string array from the client at request time, meaning
// event.category as stored server-side is just whatever string the client sent
// (always one of the 13 values in practice, but not DB-enforced). Exact-string,
// case-insensitive comparison is therefore both sufficient and honest — there is
// no server-side enum to validate against more strictly.
function normCategory(c: string | null | undefined): string {
  return (c || "").trim().toLowerCase();
}

// event.target_countries is stored as a free-text, comma-joined string built
// client-side (confirmed: app/api/sourcing-events/route.ts:115 —
// `Array.isArray(target_countries) ? target_countries.join(", ") : ...`).
// No controlled country vocabulary/alias table exists anywhere in the codebase
// today (confirmed: no country normalization in lib/taxonomy.ts, which defines
// BUSINESS_TYPES/EMPLOYEE_BANDS/CAPABILITY_TAGS but nothing for countries).
function parseTargetCountries(targetCountries: string | null | undefined): string[] {
  return (targetCountries || "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

export type RepositoryEntry = {
  country: string | null;
  last_category: string | null;
};

/**
 * Cheap v1 heuristic: category must match the identity's most-recently-seen
 * category (or the identity has no recorded category yet — treat as an
 * open match rather than excluding it); geography matches if the event has
 * no target countries (Global) OR the identity's country appears in the
 * event's target-country list. Both signals AND together — a same-country,
 * wrong-industry supplier should NOT be folded into an unrelated event.
 * Deliberately excludes anything more sophisticated (subsidiary detection,
 * multi-category history) per REPO-V2-03's explicit "no advanced fuzzy
 * identity resolution" scope boundary.
 */
export function repositoryEntryMatchesEvent(
  entry: RepositoryEntry,
  eventCategory: string,
  eventTargetCountries: string | null | undefined,
): boolean {
  const categoryMatch =
    !entry.last_category || normCategory(entry.last_category) === normCategory(eventCategory);

  const targets = parseTargetCountries(eventTargetCountries);
  const geoMatch =
    targets.length === 0 ||
    (!!entry.country && targets.includes(entry.country.trim().toLowerCase()));

  return categoryMatch && geoMatch;
}
```

### Repository pre-search query (route-level, LEFT JOIN for partial-write safety)

```typescript
// Source: original design (this research) — matches the org-scoping pattern
// already used in app/api/search/route.ts (confirmed this session: that
// route's comment explicitly notes "suppliers carry no org_id of their own" —
// this phase's NEW tables deliberately depart from that pattern and carry
// org_id directly, per D-01, for exactly the "structural" isolation reason).
async function findKnownSuppliers(db: Db, orgId: number) {
  return db.prepare(`
    SELECT si.id, si.name, si.website, si.country, si.last_category,
           osd.enrichment, osd.ai_score, osd.notes, osd.rating
    FROM supplier_identities si
    LEFT JOIN org_supplier_data osd ON osd.identity_id = si.id
    WHERE si.org_id = ?
  `).all(orgId);
  // LEFT JOIN (not INNER) — see Pitfall 4: an identity row can legitimately
  // exist with no org_supplier_data companion if the second upsert of the
  // pair failed after the first succeeded.
}
```

### Schema DDL (additive — follows the exact `CREATE TABLE IF NOT EXISTS` pattern already in `lib/db.ts`)

```sql
-- Source: pattern confirmed by reading lib/db.ts in full this session
-- (e.g. the `suppliers`/`sourcing_events` blocks at lines 175-308, 221-307).

CREATE TABLE IF NOT EXISTS supplier_identities (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  norm_name     TEXT NOT NULL,
  domain        TEXT,
  website       TEXT,
  country       TEXT,
  last_category TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_identities_org_norm
  ON supplier_identities(org_id, norm_name) WHERE norm_name <> '';
CREATE INDEX IF NOT EXISTS idx_supplier_identities_org ON supplier_identities(org_id);
CREATE INDEX IF NOT EXISTS idx_supplier_identities_domain ON supplier_identities(org_id, domain);

CREATE TABLE IF NOT EXISTS org_supplier_data (
  id            BIGSERIAL PRIMARY KEY,
  identity_id   BIGINT NOT NULL REFERENCES supplier_identities(id) ON DELETE CASCADE,
  org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  enrichment    TEXT,
  ai_score      INTEGER,
  notes         TEXT,
  rating        SMALLINT,  -- Phase 4 (RATE-01/02) writes this; column exists now per CONTEXT.md guidance
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_supplier_data_identity ON org_supplier_data(identity_id);
CREATE INDEX IF NOT EXISTS idx_org_supplier_data_org ON org_supplier_data(org_id);
```

Rationale for each column, tied back to codebase facts read this session:

- `org_id` on **both** tables (not just derived through the FK join): matches D-01's explicit language ("a foreign key to both the identity row and the org") and gives the isolation test a direct, joinless column to assert against — the same reasoning the existing `sourcing_events`/`token_usage`/`audit_log`/`notifications` tables already use (each carries its own `org_id` column with an `idx_*_org` index, confirmed at `lib/db.ts` lines 428, 433, 426, 435).
- `norm_name` stored (not recomputed at query time): avoids re-running `normName()` in every read; the value is deterministic given `name`, so storing it is safe and makes the `UNIQUE (org_id, norm_name)` index possible (Postgres unique indexes need an actual column or expression — storing the precomputed value is simpler than a functional index over JS logic that doesn't exist in SQL).
- `last_category`: new column, not named in D-01/REPO-04 — added under "Claude's Discretion — exact column list," specifically to make the REPO-05 matching heuristic possible at all (see above). **Flag this explicitly to the user/planner as a discretionary addition**, not a locked requirement.
- `rating SMALLINT`: mirrors the existing `suppliers.feedback_signal SMALLINT` convention (confirmed at `lib/db.ts` line 290) rather than inventing a new numeric type; Phase 4 owns writing to it, this phase only needs the column to exist (per CONTEXT.md's explicit note that Phase 4 depends on it).

## Runtime State Inventory

Not applicable — this is a greenfield additive-schema phase (two new tables), not a rename/refactor/migration. No existing runtime state carries the strings `supplier_identities` or `org_supplier_data` anywhere (new names, first use). REPO-V2-04 explicitly defers any backfill of pre-existing `suppliers` rows into the new repository to v2 — this phase's write path only affects newly-discovered suppliers going forward, confirmed by CONTEXT.md's decisions section ("Migration/backfill strategy is explicitly NOT needed").

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | REPO-05's matching heuristic (category exact-match + normalized-country substring match, AND'd together, with a new denormalized `last_category` column) | Code Examples / REPO-05 Matching Heuristic | If the user wanted a different signal (e.g., OR semantics, or matching against `subcategory` too), the heuristic under- or over-matches — folding irrelevant suppliers into an event, or missing genuinely relevant known suppliers, either wasting AI-search budget (miss) or diluting result relevance (over-match). Low blast radius: this is an optimization (skip redundant search), not a correctness-critical path — a miss just means the normal scout search runs as it does today. |
| A2 | `last_category` column addition to `supplier_identities`, beyond D-01's named fields (name, domain, country, website) | Code Examples / Schema DDL | If rejected, REPO-05's category-matching signal has no home; the pre-search check would degrade to geography-only matching, or the planner must design an alternative (e.g., a join through `suppliers`/`sourcing_events`, which is more complex — see "Alternatives Considered"). |
| A3 | `UNIQUE (org_id, norm_name)` as the sole write-side dedup conflict target (domain used only as a read-side secondary signal, not a second write-side constraint) | Architecture Patterns / Anti-Patterns to Avoid | If two suppliers with genuinely different normalized names but the same domain are discovered, they'd create two separate identity rows rather than merging — a minor, low-risk under-merge (not a data leak), consistent with the existing within-event dedup's own tolerance for this same edge case (it already dedups on "name OR domain" via application-level Set checks, not a DB constraint). |
| A4 | RLS is not adopted for this phase (structural table-split relied on instead) | Standard Stack / Alternatives Considered | If the team later wants defense-in-depth beyond app-level `WHERE org_id=?` checks, RLS would need a session-context mechanism incompatible with the current stateless Neon HTTP driver setup — would require a driver/connection-pattern change, out of scope for this phase either way. |
| A5 | `makeProcessSupplierDeepen()` needs its own repository upsert calls (both the initial ai_score-bearing upsert AND the later enrichment upsert inside its `enrichTask` closure) | Code Examples / Pattern 2 | If wrong (i.e., the original quick-scan insert's repository upsert already suffices), deepen's repository write is redundant but harmless (upserts are idempotent). If deepen is skipped and this assumption is wrong the other way (deepen output genuinely needs writing through), the repository would keep stale/quick-scan-quality data (lower ai_score, no enrichment) even after a buyer explicitly verified the supplier — a real correctness gap, favoring the "yes, include it" recommendation here. |

## Open Questions

1. **Should the REPO-05 pre-search check block/reduce scout dispatch, or only annotate results?**
   - What we know: D-04 says "folds already-known matches directly into the event's supplier list (skipping a fresh scout search for those specific suppliers)" — implying it actively reduces what scouts search for, not just a passive UI annotation.
   - What's unclear: Whether "skipping a fresh scout search for those specific suppliers" means removing them from the `avoidList`/existing-suppliers logic entirely (so scouts don't waste a search re-finding them) or something coarser (e.g., reducing the number of scout agents dispatched this wave).
   - Recommendation: Simplest correct interpretation — insert the repository matches directly as new `suppliers` rows for this event (mirroring `makeProcessSupplierQuick()`'s insert shape but sourced from repository data instead of a scout call), stream them to the client immediately (no AI cost), and pass their names into the existing `avoidNames`/`existingNames` list so scouts don't waste a `web_search` rediscovering them. This directly satisfies "before spending AI-search budget rediscovering it" (REPO-05's literal acceptance wording).

2. **Does `norm_name`'s uniqueness need to account for the `suppliers` table's own within-event dedup finding the "same" supplier under a name that later diverges from the repository's stored `name`?**
   - What we know: `normName()` strips common company-suffix words and non-alphanumerics — two differently-spelled names can converge to the same `norm_name`.
   - What's unclear: Whether the identity row's *display* `name` should always update to the most-recently-seen spelling (current DDL's `ON CONFLICT DO UPDATE SET name = EXCLUDED.name`) or should be sticky (first-seen wins), which affects UI consistency if a future repository-browsing UI is built.
   - Recommendation: Most-recent-wins (as designed above) is simplest and consistent with `updated_at` semantics elsewhere in the codebase; no UI exists yet to consume `supplier_identities.name` directly this phase, so this is low-stakes and reversible.

## Environment Availability

Skipped — this phase has no new external tool/service/runtime dependencies. It uses the existing Neon Postgres connection (`DATABASE_URL`/`POSTGRES_URL`/`NEON_DATABASE_URL`, already configured and used by every other phase) via the existing `@neondatabase/serverless` driver. No new environment variables, no new services.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.9 (confirmed in `package.json` devDependencies) |
| Config file | `vitest.config.ts` (confirmed: `environment: "node"`, `include: ["tests/**/*.test.ts"]`, `@/` alias mapped to repo root) |
| Quick run command | `npx vitest run tests/supplier-repository.test.ts` |
| Full suite command | `npm test` (runs `vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REPO-01 | A supplier discovered in one event is still retrievable after the event ends | unit | `npx vitest run tests/supplier-repository.test.ts -t "persists across events"` | ❌ Wave 0 |
| REPO-02 | Quick scan and full investigation both write through the same repository upsert path | unit | `npx vitest run tests/process-supplier.test.ts` (extended) and `tests/quick-scan.test.ts` (extended) | Extends existing files |
| REPO-03 | Re-discovering a name/domain-normalized-duplicate does not create a second identity row | unit | `npx vitest run tests/supplier-repository.test.ts -t "dedup"` | ❌ Wave 0 |
| REPO-04 | A query bug scoped to one org cannot expose another org's private fields (two-org test) | unit | `npx vitest run tests/supplier-repository.test.ts -t "two-org isolation"` | ❌ Wave 0 |
| REPO-05 | A new investigation checks the repository before dispatching scouts for already-known suppliers | unit + integration-style (route logic) | `npx vitest run tests/supplier-repository.test.ts -t "matching heuristic"` | ❌ Wave 0 |
| REPO-06 | Repository stays scoped per-org | covered by REPO-04's two-org test | (same as REPO-04) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/supplier-repository.test.ts tests/process-supplier.test.ts`
- **Per wave merge:** `npm test` (full suite — 225+ existing tests must stay green per Phase 1's established baseline)
- **Phase gate:** Full suite green before `/gsd-verify-work`, matching D-06's locked verification requirement (`npm run typecheck && npm run lint && npm test && npm run build`)

### Wave 0 Gaps

- [ ] `tests/supplier-repository.test.ts` — new file; covers REPO-01, REPO-03, REPO-04 (two-org isolation), REPO-05 (matching heuristic), REPO-06
- [ ] Extend `tests/process-supplier.test.ts`'s `fakeDb()` to recognize `INSERT INTO supplier_identities` / `INSERT INTO org_supplier_data` / their `UPDATE` forms (see Pitfall 3) — needed before any assertion on repository state after calling `makeProcessSupplier()`/`makeProcessSupplierDeepen()`
- [ ] Extend `tests/quick-scan.test.ts` similarly for `makeProcessSupplierQuick()`
- Framework install: none — Vitest already configured project-wide.

### Two-Org Isolation Test — concrete design (REPO-04)

```typescript
// tests/supplier-repository.test.ts (new file) — design sketch, not final code.
// Extends the fakeDb() pattern from tests/process-supplier.test.ts (confirmed
// this session: that file's fakeDb() is a minimal in-memory regex-matched
// stand-in — see Pitfall 3 for why it must be extended, not reused as-is).

describe("REPO-04: org isolation", () => {
  it("a query scoped to org A never returns org B's private fields, even when both orgs independently discovered a same-named supplier", async () => {
    const db = fakeRepositoryDb();

    // Org A discovers "Acme Corp" — private data: high score, a note, a rating.
    const idA = await upsertIdentity(db, { orgId: 1, name: "Acme Corp", website: "https://acme.example" });
    await upsertOrgPrivateData(db, { identityId: idA, orgId: 1, aiScore: 90 });
    await db.prepare(`UPDATE org_supplier_data SET notes=?, rating=? WHERE identity_id=?`)
      .run("Org A's confidential note", 5, idA);

    // Org B independently discovers a company with the SAME name/domain — this
    // MUST be a fully separate identity row (per-org dedup, not platform-wide,
    // per REPO-06/D-05), with its own separate private data.
    const idB = await upsertIdentity(db, { orgId: 2, name: "Acme Corp", website: "https://acme.example" });
    await upsertOrgPrivateData(db, { identityId: idB, orgId: 2, aiScore: 40 });
    await db.prepare(`UPDATE org_supplier_data SET notes=?, rating=? WHERE identity_id=?`)
      .run("Org B's confidential note", 2, idB);

    expect(idA).not.toBe(idB); // REPO-06: never merges across orgs

    // The canonical, single repository-read helper (mirrors D-02's "single
    // shared path" philosophy) — org_id is a MANDATORY parameter, not optional.
    const resultsForOrgA = await findKnownSuppliers(db, 1);

    expect(resultsForOrgA).toHaveLength(1);
    expect(resultsForOrgA[0].ai_score).toBe(90);
    expect(resultsForOrgA[0].notes).toBe("Org A's confidential note");
    expect(resultsForOrgA[0].rating).toBe(5);
    // The literal REPO-04 acceptance check: org B's data never appears.
    expect(JSON.stringify(resultsForOrgA)).not.toContain("Org B");
    expect(JSON.stringify(resultsForOrgA)).not.toContain("40");
  });

  it("structural isolation: a query joining ONLY supplier_identities cannot expose private columns at all", () => {
    // supplier_identities has no enrichment/ai_score/notes/rating columns —
    // this is asserted at the SCHEMA level (columns don't exist on that
    // table), not just at the query-discipline level. A test that runs
    // `SELECT * FROM supplier_identities` and asserts the result object has
    // no ai_score/notes/rating/enrichment keys demonstrates REPO-04's
    // "structural, not query-discipline-only" isolation claim directly.
  });
});
```

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | Unchanged — this phase adds no new auth surface; all repository access flows through existing `getOrgContext()`-gated routes |
| V3 Session Management | No | Unchanged |
| V4 Access Control | Yes | Every repository read/write MUST take `orgId` as a mandatory parameter and filter `WHERE org_id = ?` (or, for `org_supplier_data`, `WHERE org_id = ?` directly on that table's own column — no join required to enforce this, per D-01's structural-isolation intent). Centralize into one canonical read helper (`findKnownSuppliers(db, orgId, ...)`) rather than ad hoc queries scattered across routes/tests, mirroring `lib/tenant.ts`'s existing `getOwnedEvent`/`orgOwnsEvent`/`orgOwnsSupplier` pattern. |
| V5 Input Validation | Yes | Supplier `name`/`website`/`country` values already pass through the existing scout-agent JSON parsing and `lib/dedup.ts` normalization before reaching any new insert — no new untrusted-input surface introduced by this phase (no new user-facing form fields). |
| V6 Cryptography | No | Not applicable — no new secrets/crypto in this phase. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Cross-tenant data disclosure via a missing/incorrect `WHERE org_id` filter | Information Disclosure | Structural table split (D-01) means a query that forgets `org_id` filtering on `supplier_identities` alone still cannot leak private fields (they aren't columns on that table); the org-private read path is centralized into a single reviewed helper function that hard-codes the `org_id` predicate, per the "single shared path" philosophy already used for the write path (D-02) |
| Prompt injection via web-search-derived supplier name/description reaching a new storage path | Tampering | Not a new risk introduced by this phase — supplier fields already pass through the existing `INJECTION_DEFENSE` prompt guard (confirmed in `lib/agents.ts` lines 48-60) before this phase's code ever sees them; the repository upsert only stores already-agent-processed structured fields (name/country/website), not raw search results |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| N/A — greenfield table addition | N/A | N/A | N/A |

**Deprecated/outdated:** None — this phase introduces new tables; nothing existing is deprecated by it.

## Sources

### Primary (HIGH confidence — read directly this session)

- `lib/db.ts` (589 lines, read in full) — existing schema DDL pattern, `Statement`/`Db` wrapper, `splitStatements()`, no-multi-statement-transaction constraint
- `lib/process-supplier.ts` (407 lines, read in full) — `makeProcessSupplier()`, `makeProcessSupplierQuick()`, `makeProcessSupplierDeepen()` exact insert/update shapes and background-task timing
- `lib/agents.ts` (lines 1-330 read, `runOrchestrator()` at 215-271 read in full) — confirmed pure-LLM-call architecture, no db import
- `lib/dedup.ts` (23 lines, read in full) — `normName()`/`domainOf()` exact implementations
- `lib/tenant.ts` (157 lines, read in full) — `getOrgContext()`, `getOwnedEvent()`, `orgOwnsEvent()`, `orgOwnsSupplier()`, existing org-isolation conventions and best-effort try/catch pattern (referral attribution)
- `app/api/orchestrate/route.ts` (lines 1-340 read) — exact call site and scope of `db`/`ctx.orgId`/`categoryLabel`/`event.target_countries` around the `runOrchestrator()` call
- `app/api/search/route.ts` (read in full) — confirmed existing cross-event org-scoping pattern (`suppliers` carries no `org_id` of its own; joins through `sourcing_events`) — the explicit contrast that motivates D-01's direct `org_id` columns
- `app/events/new/page.tsx` (lines 1-35 read) — confirmed the fixed 13-item `CATEGORIES` list is client-side only, not server-exported
- `app/api/classify/route.ts` (lines 1-40 read) — confirmed `category` has no server-side enum enforcement
- `app/api/sourcing-events/route.ts` (grep + line 115 read) — confirmed `target_countries` storage format (comma-joined free text)
- `lib/taxonomy.ts` (lines 1-60 read) — confirmed no existing country normalization utility
- `tests/process-supplier.test.ts` (lines 1-100 read) — confirmed `fakeDb()`'s regex-based SQL matching and its silent-no-op fallback behavior
- `.planning/phases/03-persistent-supplier-repository/03-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.claude/CLAUDE.md` — user decisions, requirements, project conventions
- `.planning/config.json` — confirmed `nyquist_validation: true`, `security_enforcement: true`, `security_asvs_level: 1`

### Secondary (MEDIUM confidence — web-verified against official/cross-checked sources)

- [PostgreSQL: Documentation: INSERT](https://www.postgresql.org/docs/current/sql-insert.html) — `ON CONFLICT ... DO UPDATE` syntax, `EXCLUDED` pseudo-table, atomicity guarantee, `RETURNING` semantics [CITED]
- Multiple cross-checked sources on multi-tenant Postgres isolation patterns (shared-schema + tenant-id-column "pool" model vs. RLS) — used to justify why RLS was considered and not adopted this phase [CITED, MEDIUM — cross-referenced across AWS Database Blog, Logto, and independent engineering blogs, no single canonical source]

### Tertiary (LOW confidence)

None — no unverified/single-source claims were left in this document; the REPO-05 heuristic and new-column proposals are marked `[ASSUMED]` (original design, not sourced from any external reference) rather than presented as verified fact.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new packages, existing driver/pattern confirmed by direct file reads
- Architecture (write path, `runOrchestrator()` finding, upsert design): HIGH for the codebase facts, MEDIUM for the Postgres upsert syntax (official docs, single web search), LOW→flagged-ASSUMED for the REPO-05 matching heuristic and new-column recommendations (genuinely novel design, no spec existed)
- Pitfalls: HIGH — each pitfall is grounded in a specific, cited line range of an actually-read file

**Research date:** 2026-08-15
**Valid until:** 30 days (stable domain — Postgres upsert semantics and this codebase's own established patterns are not fast-moving; re-verify if `lib/db.ts`, `lib/process-supplier.ts`, or `lib/agents.ts` change materially before planning executes)
