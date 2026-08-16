# Phase 3: Persistent Supplier Repository - Context

**Gathered:** 2026-08-15 (interactive discussion — default mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

A new persistent, org-scoped supplier identity store, separate from the per-event
`suppliers` table, that survives across events. Every supplier discovered via quick
scan, full investigation, or (once built) RFP matching writes into it through a single
shared insertion path. It dedups on the same name/domain normalization already used for
within-event dedup. Shared/public identity fields (name, domain, country) are modeled
separately from org-private fields (enrichment, AI score, notes, rating) so a query bug
can't leak one org's private data to another. A new investigation can check the
repository for an already-known supplier before spending AI-search budget rediscovering
it. Scoped per-org (not platform-wide) for this milestone. Out of scope: cross-org
sharing, aggregated cross-org quality scores, advanced fuzzy identity resolution,
retroactive backfill of existing `suppliers` rows (all v2, per REQUIREMENTS.md).

</domain>

<decisions>
## Implementation Decisions

### Schema split (REPO-04)
- **D-01:** Two-table split: a new `supplier_identities` table holds only the shared/
  public identity fields (name, domain, country, website) and serves as the dedup key
  — plus an `org_id` column since the repository is per-org (not platform-wide, see
  D-06). A second new table (e.g. `org_supplier_data`) holds org-private fields
  (enrichment, AI score, notes, rating — the last of these feeding Phase 4's
  RATE-01/02) with a foreign key to both the identity row and the org. A leaky query
  scoped to one table structurally cannot expose the other table's columns — this is
  the "structural" isolation REPO-04 asks for, not query-discipline-only isolation.
  — **Reversibility:** the split is a schema decision; merging back into one table
  later would require a migration, but splitting further (e.g. more private tables)
  is additive and low-risk.

### Write path (REPO-02)
- **D-02:** Extend the existing per-event insertion functions —
  `makeProcessSupplier()` and `makeProcessSupplierQuick()` in `lib/process-supplier.ts`
  — to also upsert into the repository tables, immediately after (or alongside) each
  function's existing `INSERT INTO suppliers` per-event write. This means every current
  and future caller of these two functions automatically writes through to the
  repository with zero new call sites to remember — the single shared write path
  REPO-02 requires is enforced structurally by living inside the functions callers
  already invoke, not by convention/discipline across routes.
- Note for planner: `makeProcessSupplierDeepen()` (the "deepen a quick-scan row into a
  full investigation" path, confirmed present in `lib/process-supplier.ts` at ~line
  289) updates an existing per-event row rather than inserting a new one — the planner
  should decide whether deepen also needs a repository upsert (likely yes, since it
  changes `is_quick_result`/enrichment data that the repository's org-private table
  cares about) or whether the original quick-scan insert already covered it.

### Dedup (REPO-03)
- **D-03:** Reuse `lib/dedup.ts`'s existing exported `normName()` and `domainOf()`
  functions directly for repository-level dedup — the exact same normalization already
  used for within-event dedup, so there's a single definition of "same supplier" across
  both layers, no drift.

### Pre-search repository check (REPO-05)
- **D-04:** The check happens as an orchestrator planning step, before scout agents are
  dispatched — `runOrchestrator()` in `lib/agents.ts` queries the org's repository for
  suppliers matching the event's category/geography before deciding which scout agents
  to run, and folds already-known matches directly into the event's supplier list
  (skipping a fresh scout search for those specific suppliers), reducing redundant
  `web_search` spend.
- **Claude's discretion (flagged for research):** the exact matching heuristic for
  "relevant to this new event" (category/geography matching against repository
  entries) is non-trivial and may need dedicated research during `/gsd-plan-phase` —
  no exact algorithm was specified by the user.

### Repository scope (REPO-06)
- **D-05:** Confirmed: per-org only for this milestone. No cross-org sharing, no
  aggregated cross-org quality score, no platform-wide dedup. Matches the already-
  documented REPO-06 requirement, PROJECT.md's Out of Scope entry, and REQUIREMENTS.md's
  REPO-V2-01/02 deferred-to-v2 items. User explicitly reconfirmed this rather than
  expanding scope.

### Verification
- **D-06:** Full verification suite (`npm run typecheck && npm run lint && npm test &&
  npm run build`) gates completion, matching the project's established pattern (same as
  Phases 1 and 2). A new two-org test (per REPO-04's acceptance criterion — "verified by
  an explicit two-org test") is required: confirm a query bug scoped to one org's data
  path cannot expose another org's private enrichment/AI score/notes/rating data.

### Claude's Discretion
- Exact repository-check matching heuristic for REPO-05 (category/geography matching
  logic) — flagged above for research attention.
- Exact column list and naming for the new `supplier_identities` /
  `org_supplier_data`-equivalent tables beyond the fields explicitly named in REPO-01/
  REPO-04 (name, domain, country, website, enrichment, ai_score, notes, rating).
- Whether `makeProcessSupplierDeepen()` needs its own repository upsert call (flagged
  above).
- Migration/backfill strategy is explicitly NOT needed — REPO-V2-04 defers retroactive
  backfill of pre-existing `suppliers` rows to v2; this phase applies going forward only.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — REPO-01 through REPO-06 (full acceptance criteria for
  this phase), including the explicit "verified by an explicit two-org test" language
  under REPO-04.

### Roadmap
- `.planning/ROADMAP.md` — Phase 3 goal and success criteria (lines 80-95).

### Project context
- `.planning/PROJECT.md` — Out of Scope section (platform-wide supplier repository
  sharing).

No external specs — requirements fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/dedup.ts` — already-extracted `normName()`/`domainOf()` normalization functions
  (originally pulled out of `app/api/orchestrate/route.ts` so
  `app/api/investigate-quick/route.ts` could share them). Reuse directly per D-03.
- `lib/process-supplier.ts` — `makeProcessSupplier()` (full investigation, ~line 80),
  `makeProcessSupplierQuick()` (quick scan, ~line 254), `makeProcessSupplierDeepen()`
  (deepen flow, ~line 289) — all existing per-event supplier insertion points; D-02
  extends the first two.
- `lib/tenant.ts` — `getOrgContext()` already resolves `orgId` per request; the
  repository tables' `org_id` foreign key should follow the same `organizations.id`
  reference pattern used elsewhere (e.g. `sourcing_events.org_id`, indexed via
  `idx_events_org`).

### Established Patterns
- ALTER-pattern schema changes: `lib/db.ts` uses `CREATE TABLE IF NOT EXISTS` +
  subsequent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for incremental schema
  evolution — new repository tables should follow this same pattern.
- Per-org indexing pattern: existing tables index on `org_id` (e.g.
  `idx_events_org`, `idx_usage_org`, `idx_audit_org`) — new repository tables should
  follow this.
- **No multi-statement DB transactions** (Neon HTTP driver limitation, documented in
  `.claude/CLAUDE.md`) — the identity-upsert + org-private-upsert pair (D-01/D-02) must
  be designed as two separate single-statement operations, not a single transaction,
  since atomicity can't be guaranteed across both writes.

### Integration Points
- `lib/agents.ts` `runOrchestrator()` — D-04's pre-search repository check hooks in
  here, before scout-agent dispatch.
- `lib/process-supplier.ts` — D-02's repository upsert calls land inside
  `makeProcessSupplier()`/`makeProcessSupplierQuick()`.
- `suppliers` table (`lib/db.ts` ~line 221) — the existing per-event table this new
  repository sits alongside (not replaces); no changes to `suppliers` itself are
  implied by this phase.
- Phase 4 (Supplier Star Ratings) depends directly on this phase's `org_supplier_data`-
  equivalent table carrying the `rating` field — the planner should design that column
  now even though Phase 4 will build the UI/API to write it.

</code_context>

<specifics>
## Specific Ideas

No specific table/column names or matching-algorithm specifics were provided beyond
what's captured above — the user confirmed the two recommended architectural
decisions (two-table split, extend-existing-functions write path, reuse-dedup.ts) and
deferred exact implementation details to planning/research.

</specifics>

<deferred>
## Deferred Ideas

None raised this session — the user explicitly reconfirmed per-org scope rather than
expanding it (see D-05).

### Reviewed Todos (not folded)
None — `todo.match-phase 3` returned zero matches.

</deferred>

---

*Phase: 3-Persistent Supplier Repository*
*Context gathered: 2026-08-15*
