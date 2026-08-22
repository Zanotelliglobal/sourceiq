# Phase 4: Supplier Star Ratings - Research

**Researched:** 2026-08-21
**Domain:** Internal full-stack feature (Next.js App Router API route + React client component + Postgres schema evolution) — no new external technology
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Add an `identity_id` column to the `suppliers` table (`lib/db.ts`
  ALTER-pattern: `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT
  EXISTS`, matching existing incremental schema-evolution convention). This closes
  the gap discovered during codebase scouting: `identityId` (in
  `makeProcessSupplier()`/`makeProcessSupplierQuick()`) and `identityIdDeepen` (in
  `makeProcessSupplierDeepen()`) are already computed at insert/update time inside
  `lib/process-supplier.ts`, but are currently discarded after the repository
  upsert rather than written onto the per-event row. — **Reversibility:** one-way —
  undoing requires a migration to drop the column; but adding it is itself
  low-risk/additive.
- **D-02:** Populate `identity_id` going-forward only, inside the same three
  `makeProcessSupplier*()` functions where the identity value is already computed
  — no backfill migration for pre-existing `suppliers` rows. This directly reuses
  Phase 3's REPO-V2-04 "going forward only" precedent (repository features apply
  from this phase onward, not retroactively). — **Reversibility:** reversible —
  no data is destroyed by choosing not to backfill later; a backfill migration
  could still be added in a future phase without conflict.
- **D-03:** Supplier rows with `identity_id IS NULL` (all pre-Phase-4 rows, plus the
  rare case of a repository-upsert failure) simply hide the rating control — no
  disabled/tooltip/loading state to build. Confirmed via discussion that this is
  the *only* null-`identity_id` case: because `identity_id` is set at the same
  `INSERT`/`UPDATE` as the row itself (not a later async step), there is no
  meaningful "resolving" window to design a separate loading state for.
- **D-04:** The star control renders in `DetailPanel` only (`app/events/[id]/page.tsx`,
  next to the existing thumbs-up/down `feedback_signal` toggle at ~lines 370-430) —
  not in the compact table row, which stays uncluttered and already has
  hover-revealed action buttons.
- **D-05:** Rendered as 5 discrete star icons, filled up to the current rating,
  always shown with visible "Rating" labeling/context. This is required to avoid
  visual collision with the unrelated `lucide-react` `Star` icon already used for
  the "Add to Short List" action at multiple call sites in the same file (lines
  567, 902, 2496) — a single standalone star icon there means the new 5-star row
  must read as clearly distinct, not a reused icon in a new context.
- **D-06:** Ratings are freely changeable — clicking any star immediately
  overwrites the current rating with no confirmation step. Matches the low-friction
  feel of the existing thumbs-feedback toggle.
- **D-07:** Re-clicking the currently-set star clears the rating back to
  `null`/unrated — mirrors the existing thumbs-up/down toggle-to-clear pattern
  (`#46 — Epic 5.3`) for UI consistency, rather than introducing a separate
  explicit "clear" control.
- **D-08:** The star rating is an entirely separate field/control from the existing
  `feedback_signal` thumbs-up/down — both render side by side in `DetailPanel`,
  neither replaces or is derived from the other.

### Claude's Discretion

- Exact visual layout/spacing of the star row relative to the existing thumbs
  control within `DetailPanel` — left to implementation, informed by D-04/D-05
  above.
- Whether the rating write is a dedicated API route or extends an existing
  suppliers-update endpoint — not discussed; planner/researcher should investigate
  existing PATCH/update patterns for the `suppliers`/`feedback_signal` write path
  and reuse rather than introduce a new pattern if a suitable one exists.
  **Research finding (see Architecture Patterns below): extend
  `app/api/qualify/route.ts` with a new `action: "set_rating"` case, mirroring
  the existing `action: "set_feedback"` case exactly in shape (tenant check,
  input validation, response). Do not create a new route file.**

### Deferred Ideas (OUT OF SCOPE)

None raised this session — all 4 selected gray areas were explored to the user's
satisfaction with no scope creep into other phases. Out of scope per the phase
boundary: backfilling `identity_id` onto pre-Phase-4 supplier rows, showing/using
ratings anywhere outside the event detail view, any cross-org rating aggregation
(matches Phase 3's per-org-only scope).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RATE-01 | A buyer can rate a supplier 1-5 stars from the supplier row/detail view in the event page | `DetailPanel` star control (D-04/D-05), `set_rating` action added to `app/api/qualify/route.ts`, toggle-to-clear behavior (D-06/D-07) — see Code Examples |
| RATE-02 | Ratings attach to the supplier's repository entry (REPO-01), not a per-event column, so ratings accumulate across every event that encounters that supplier within the org | New `suppliers.identity_id` column (D-01/D-02) wired in all three `makeProcessSupplier*()` functions; new `updateOrgSupplierDataRating()` writing `org_supplier_data.rating` scoped by `identity_id` + `org_id`; GET route JOIN to surface `rating` on every event's supplier list — see Architecture Patterns |
| RATE-03 | The new star rating coexists with (does not replace) the existing per-event `feedback_signal` thumbs-up/down field | D-08 — separate DB column (`org_supplier_data.rating` vs `suppliers.feedback_signal`), separate API action (`set_rating` vs `set_feedback`), separate client state/handler (`setRating` vs `setFeedback`), both rendered side by side |
</phase_requirements>

## Summary

This phase closes a gap left deliberately open by Phase 3: `org_supplier_data.rating`
already exists in the schema `[VERIFIED: lib/db.ts:340]` (`rating SMALLINT`), but
nothing writes to it, and the per-event `suppliers` table has no way to resolve
*which* repository identity a given row belongs to at request time. The
`identityId`/`identityIdDeepen` values are computed inside `lib/process-supplier.ts`
during every discovery (`makeProcessSupplier`, `makeProcessSupplierQuick`,
`makeProcessSupplierDeepen`) but are only used transiently to call
`upsertOrgSupplierData`/`updateOrgSupplierDataEnrichment` — they are never
persisted back onto the `suppliers` row `[VERIFIED: lib/process-supplier.ts:177-191,322-334,413-427]`.
Phase 4 is therefore two connected halves: (1) close the identity-linkage gap by
adding `suppliers.identity_id` and writing it in all three factories, and (2) build
the actual rating feature (write path + read path + UI) on top of that link.

The write path should extend the existing `app/api/qualify/route.ts` POST handler
with a new `action: "set_rating"` branch, following the exact shape of the
existing `action: "set_feedback"` branch (tenant ownership check already runs
above both branches via `orgOwnsSupplier` `[VERIFIED: app/api/qualify/route.ts:33]`).
The read path requires modifying `app/api/sourcing-events/[id]/route.ts`'s GET
handler, which currently does a bare `SELECT * FROM suppliers WHERE event_id = ?`
`[VERIFIED: app/api/sourcing-events/[id]/route.ts:21-23]` — this must become a
`LEFT JOIN org_supplier_data` on `identity_id` to surface `rating` in the payload
the client already consumes. The UI half is additive: a new 5-star row rendered
next to the existing thumbs-up/down control inside `DetailPanel`
`[VERIFIED: app/events/[id]/page.tsx:394-423]`, using the same optimistic-update-
then-revert client pattern already implemented for `setFeedback`
`[VERIFIED: app/events/[id]/page.tsx:1855-1871]`.

No new npm packages are required — `lucide-react` (already a dependency, `Star`
icon already imported in this exact file) covers the UI, and all DB access reuses
the existing Neon HTTP wrapper (`lib/db.ts`) and repository helpers
(`lib/supplier-repository.ts`).

**Primary recommendation:** Wire `identity_id` onto `suppliers` inside the three
`makeProcessSupplier*()` functions via a single follow-up `UPDATE` statement
(Neon HTTP driver forbids multi-statement transactions), add a
`updateOrgSupplierDataRating(db, { identityId, orgId, rating })` helper to
`lib/supplier-repository.ts` scoped by BOTH `identity_id` AND `org_id` in the
`WHERE` clause (defense-in-depth beyond the identity_id-alone join), extend
`app/api/qualify/route.ts` with a `set_rating` action, LEFT JOIN
`org_supplier_data` into the event GET route, and add a 5-star control to
`DetailPanel` mirroring the existing thumbs toggle-to-clear interaction.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Star click / toggle-to-clear interaction | Browser / Client | — | Pure UI state + optimistic update, mirrors `setFeedback` in `app/events/[id]/page.tsx` |
| Rating write validation (1-5 or clear) & tenant ownership check | API / Backend | — | `app/api/qualify/route.ts` already gates all supplier mutations through `orgOwnsSupplier`; the same route/gate must own the new action |
| Rating persistence keyed by repository identity | Database / Storage | API / Backend | `org_supplier_data.rating`, written via `identity_id` + `org_id` compound scope — the API route resolves `identity_id` from the owned `supplier_id`, but the DB enforces the actual storage location decoupled from any single event |
| `identity_id` linkage at discovery time | API / Backend | Database / Storage | `lib/process-supplier.ts`'s three factories already compute the identity during discovery; writing it onto the `suppliers` row is a backend concern, not a UI concern |
| Cross-event rating display consistency | Database / Storage | API / Backend | Achieved structurally (one `org_supplier_data` row per identity, `UNIQUE(identity_id)` `[VERIFIED: lib/db.ts:477]`) rather than by any event-side computation — every event's GET route independently joins the same row |

## Standard Stack

No new libraries are introduced by this phase. The project's existing stack
(Next.js 14.2.35 App Router API routes, Neon serverless Postgres HTTP driver,
`lucide-react` for icons) fully covers RATE-01/02/03.

### Core (existing, reused — not newly installed)
| Library | Version | Purpose | Why Standard (for this repo) |
|---------|---------|---------|--------------|
| `lucide-react` | 1.30.0 `[CITED: .claude/CLAUDE.md Key Dependencies]` | `Star` icon for the new rating row | Already imported in `app/events/[id]/page.tsx` line 7 `[VERIFIED: app/events/[id]/page.tsx:6-10]`; the codebase's sole icon library, no alternative needed |
| `@neondatabase/serverless` | 1.1.0 `[CITED: .claude/CLAUDE.md Key Dependencies]` | DB access via `getDb()` wrapper | Existing single data-access layer (`lib/db.ts`) — a new feature never introduces a second DB client |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending `app/api/qualify/route.ts` | New dedicated route (e.g. `app/api/rating/route.ts`) | Rejected: `set_feedback` already establishes the "supplier quality-signal action lives in `/api/qualify`" convention in this exact file; a new route would duplicate the `orgOwnsSupplier` tenant check and the request/response shape for no benefit |
| `lucide-react` `Star` reused with `fill` toggling | A custom SVG rating widget or a new star-rating npm package (e.g. `react-star-ratings`) | Rejected: D-05 already resolves this — five discrete `Star` icons with `fill="currentColor"` applied conditionally is a ~15-line component; pulling in a new dependency for a "fill N of 5 icons" pattern is unjustified hand-rolling in the other direction (over-engineering) |

**Installation:** None required — no `npm install` needed for this phase.

## Package Legitimacy Audit

**Not applicable.** This phase installs zero external packages; it is a pure
schema + API + UI change using dependencies already present in `package.json`.

## Architecture Patterns

### System Architecture Diagram

```
 ┌─────────────────────────── DISCOVERY TIME (existing, extended) ───────────────────────────┐
 │                                                                                              │
 │  Scout/Qualify/Enrich pipeline (lib/agents.ts)                                              │
 │        │                                                                                     │
 │        ▼                                                                                     │
 │  makeProcessSupplier() / makeProcessSupplierQuick() / makeProcessSupplierDeepen()            │
 │  (lib/process-supplier.ts)                                                                  │
 │        │                                                                                     │
 │        ├─► INSERT/UPDATE suppliers row (per-event)                                          │
 │        │                                                                                     │
 │        ├─► upsertSupplierIdentity() ──► supplier_identities (org-scoped, dedup'd)            │
 │        │         │                                                                            │
 │        │         ▼ identityId                                                                │
 │        ├─► upsertOrgSupplierData() ──► org_supplier_data (ai_score, rating stays untouched)  │
 │        │                                                                                     │
 │        └─► [NEW] UPDATE suppliers SET identity_id = ? WHERE id = ?  ◄── D-01/D-02 gap close  │
 │                                                                                                │
 └────────────────────────────────────────────────────────────────────────────────────────────┘

 ┌─────────────────────────── RATING WRITE (new, RATE-01/02) ────────────────────────────────┐
 │                                                                                              │
 │  Buyer clicks star N in DetailPanel (app/events/[id]/page.tsx)                              │
 │        │  optimistic setSuppliers() update (client-side, mirrors setFeedback)                │
 │        ▼                                                                                     │
 │  POST /api/qualify  { action: "set_rating", supplier_id, rating }                            │
 │        │                                                                                     │
 │        ▼                                                                                     │
 │  orgOwnsSupplier(ctx.orgId, supplier_id)  ──► 404 if not owned (existing gate, line 33)      │
 │        │                                                                                     │
 │        ▼                                                                                     │
 │  SELECT identity_id FROM suppliers WHERE id = ?                                              │
 │        │                                                                                     │
 │        ├─ identity_id IS NULL ──► 400 "Rating unavailable for this supplier" (pre-P4 row)    │
 │        │                                                                                     │
 │        ▼                                                                                     │
 │  updateOrgSupplierDataRating(db, { identityId, orgId: ctx.orgId, rating })                    │
 │        │  UPDATE org_supplier_data SET rating=?, updated_at=now()                             │
 │        │  WHERE identity_id=? AND org_id=?   ◄── compound scope, defense-in-depth (REPO-04)  │
 │        ▼                                                                                     │
 │  200 { success: true }                                                                       │
 │                                                                                                │
 └────────────────────────────────────────────────────────────────────────────────────────────┘

 ┌─────────────────────────── RATING READ (new, RATE-02) ────────────────────────────────────┐
 │                                                                                              │
 │  GET /api/sourcing-events/[id]  (app/api/sourcing-events/[id]/route.ts)                     │
 │        │                                                                                     │
 │        ▼                                                                                     │
 │  SELECT s.*, osd.rating AS rating                                                             │
 │  FROM suppliers s                                                                             │
 │  LEFT JOIN org_supplier_data osd                                                              │
 │    ON osd.identity_id = s.identity_id AND osd.org_id = ?  ◄── org_id bound to ctx.orgId       │
 │  WHERE s.event_id = ?                                                                         │
 │        │                                                                                     │
 │        ▼                                                                                     │
 │  Client renders DetailPanel with supplier.rating — same value across EVERY event that        │
 │  has ever discovered this identity within the org (accumulation, RATE-02's core guarantee)   │
 │                                                                                                │
 └────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

No new files/folders. Every change lands inside existing files:

```
lib/
├── db.ts                      # + suppliers.identity_id ALTER; org_supplier_data unchanged (rating column pre-exists)
├── supplier-repository.ts     # + updateOrgSupplierDataRating()
└── process-supplier.ts        # + UPDATE suppliers SET identity_id=? in all 3 factories

app/
├── api/
│   ├── qualify/route.ts               # + action: "set_rating"
│   └── sourcing-events/[id]/route.ts  # GET query: LEFT JOIN org_supplier_data
└── events/[id]/page.tsx       # + Supplier.identity_id, Supplier.rating client types;
                                #   + star control in DetailPanel; + setRating() handler

tests/
├── supplier-repository.test.ts  # + updateOrgSupplierDataRating cases (org-scope isolation)
└── process-supplier.test.ts     # + identity_id UPDATE assertion per factory
```

### Pattern 1: Toggle-to-clear rating control (mirrors existing feedback pattern)

**What:** A control where clicking the currently-active value clears it back to
`null`, rather than requiring a separate "clear" affordance.
**When to use:** Any single-value buyer-quality-signal field where "unset" is a
valid, meaningful state (distinct from every discrete value).
**Example (existing precedent, `[VERIFIED: app/events/[id]/page.tsx:398,411]`):**
```typescript
// Existing feedback_signal toggle-to-clear — the exact interaction Phase 4's
// star control must replicate for the new rating value (D-07).
<button
  onClick={() => onFeedback(supplier.id, supplier.feedback_signal === 1 ? 0 : 1)}
  aria-pressed={supplier.feedback_signal === 1}
>
```
**Star-rating analog (new code, not yet written — recommended shape):**
```typescript
// Re-clicking the currently-set star clears to null (D-07). Unlike the
// binary thumbs toggle (1/0/-1), a star row must compare against the
// SPECIFIC star index clicked, not just "is anything set".
{[1, 2, 3, 4, 5].map((n) => (
  <button
    key={n}
    onClick={() => onRating(supplier.id, supplier.rating === n ? null : n)}
    aria-label={t("Rate {n} stars", { n })}
    aria-pressed={supplier.rating !== null && n <= supplier.rating}
  >
    <Star
      className="w-4 h-4"
      fill={supplier.rating !== null && n <= supplier.rating ? "currentColor" : "none"}
    />
  </button>
))}
```

### Pattern 2: Best-effort repository write, never blocking the critical path

**What:** Every repository write in `lib/process-supplier.ts` is wrapped in a
`try { ... } catch { /* best-effort */ }` so a repository failure never breaks
the per-event supplier insert/update.
**When to use:** Any write to `supplier_identities`/`org_supplier_data` triggered
as a side effect of the main per-event flow — including the new `identity_id`
back-write onto `suppliers`.
**Example (existing precedent, `[VERIFIED: lib/process-supplier.ts:177-191]`):**
```typescript
let identityId: number | null = null;
try {
  identityId = await upsertSupplierIdentity(deps.db, { /* ... */ });
  await upsertOrgSupplierData(deps.db, { identityId, orgId: deps.orgId, aiScore: score.overall_score });
} catch { /* best-effort — repository write failure never blocks per-event flow */ }
```
**Required extension (D-01/D-02 — add inside the same try block, after `identityId` resolves):**
```typescript
if (identityId !== null) {
  try {
    await deps.db.prepare(`UPDATE suppliers SET identity_id=? WHERE id=?`).run(identityId, supplierId);
  } catch { /* best-effort — identity_id linkage failure never blocks the supplier row */ }
}
```
Note: `supplierId` is already in scope at this point in `makeProcessSupplier`
(`[VERIFIED: lib/process-supplier.ts:168]`, assigned from `result.lastInsertRowid`
before the identity-upsert `try` block runs). In `makeProcessSupplierDeepen`,
`supplierId` is the function's own parameter (already known at entry,
`[VERIFIED: lib/process-supplier.ts:358]`). In `makeProcessSupplierQuick`,
`supplierId` is likewise assigned from `result.lastInsertRowid`
(`[VERIFIED: lib/process-supplier.ts:313]`) before its identity-upsert try block.
All three functions already have both values in scope at the exact point the
`identity_id` write needs to happen — no reordering of existing logic required.

### Pattern 3: Compound-scoped write for org-private repository data

**What:** Every write to `org_supplier_data` should filter by `org_id` in
addition to `identity_id`, even though `identity_id` already has a `UNIQUE`
index (`[VERIFIED: lib/db.ts:477]`) that makes it *structurally* 1:1 with an
org. The extra `org_id` predicate is defense-in-depth (REPO-04's stated
threat model: "a single query bug cannot leak one org's private data to
another org" `[CITED: .planning/REQUIREMENTS.md REPO-04]`) — it costs nothing
and stops a future bug (e.g. an `identity_id` sourced from request input
without re-validating org ownership) from writing across tenants.
**Example (new code, following `updateOrgSupplierDataEnrichment`'s shape,
`[VERIFIED: lib/supplier-repository.ts:119-126]`):**
```typescript
export async function updateOrgSupplierDataRating(
  db: Db,
  params: { identityId: number; orgId: number; rating: number | null }
): Promise<void> {
  await db
    .prepare(`UPDATE org_supplier_data SET rating=?, updated_at=now() WHERE identity_id=? AND org_id=?`)
    .run(params.rating, params.identityId, params.orgId);
}
```

### Anti-Patterns to Avoid

- **Writing `rating` onto the per-event `suppliers` table:** Defeats RATE-02's
  entire purpose. `feedback_signal` intentionally stays per-event
  (`suppliers.feedback_signal`); `rating` must go on `org_supplier_data` only.
- **Resolving `identity_id` from client-supplied input:** The `set_rating`
  action must resolve `identity_id` server-side via `SELECT identity_id FROM
  suppliers WHERE id = ?` (a row already tenant-checked by `orgOwnsSupplier`),
  never accept an `identity_id` directly in the request body — that would let
  a caller target any identity, bypassing the per-event ownership check
  entirely.
- **Skipping the `org_supplier_data` row's existence check:** Unlike
  `feedback_signal`'s `UPDATE ... WHERE id = ?` (which is a no-op if the row
  doesn't exist), an `org_supplier_data` row for a given `identity_id` might
  not exist yet if `upsertOrgSupplierData` was never called for it (shouldn't
  happen under D-02 since every fresh discovery calls it, but an explicit
  `UPDATE` with no matching row silently succeeds with `changes: 0` and no
  error) — the API route should treat 0 rows changed as a signal to
  `INSERT ... ON CONFLICT (identity_id) DO UPDATE` instead, OR simply trust
  that every row with a non-null `identity_id` also has an `org_supplier_data`
  row (true under D-02, since `identity_id` is only ever set right after a
  successful `upsertOrgSupplierData` call in the same try block).
- **A separate multi-statement transaction for identity_id + rating:** Neon's
  HTTP driver forbids multi-statement transactions
  (`[CITED: .claude/CLAUDE.md Constraints]`) — every write in this phase must
  remain a single independent statement, exactly like the existing repository
  helpers.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tenant/org isolation on the rating write | A new "does this org own this identity" check | The existing `orgOwnsSupplier(ctx.orgId, supplier_id)` gate (already runs before every `app/api/qualify` action, `[VERIFIED: app/api/qualify/route.ts:33-35]`) plus the compound `identity_id AND org_id` `WHERE` clause in the new `updateOrgSupplierDataRating` | REPO-04's isolation guarantee is already proven (Phase 3's cross-org test) — reuse the exact same tenancy primitive rather than inventing a parallel one |
| 5-star UI widget | A new component library or hand-rolled hover/half-star logic | Five `lucide-react` `Star` icons with conditional `fill`, per D-05 | The scope is deliberately "discrete 1-5, no half-stars, no hover preview" — anything more elaborate is unrequested scope |
| Optimistic update + revert-on-failure | A new state-management pattern (e.g. a reducer, a mutation library) | Copy the exact `setFeedback` shape (`[VERIFIED: app/events/[id]/page.tsx:1855-1871]`): capture `prev`, apply optimistically, `fetch`, revert + toast on failure | The codebase has zero data-fetching libraries (no SWR/React Query) — this hand-written optimistic pattern IS the established convention here, not an anti-pattern to replace |

**Key insight:** Nothing in this phase requires new infrastructure. Every piece —
tenancy, repository write helpers, optimistic UI updates, toggle-to-clear — has
a direct existing precedent in this exact codebase built for a near-identical
purpose (`feedback_signal` for interaction shape, `ai_score`/`enrichment` for
the repository write shape). The engineering risk in this phase is
**wiring correctness** (identity_id must reach every write path; org_id must
scope every read/write of `rating`), not novel design.

## Runtime State Inventory

Not applicable — this is a greenfield additive feature (new column, new function,
new UI control), not a rename/refactor/migration phase. No existing runtime state
needs to change identity.

## Common Pitfalls

### Pitfall 1: GET route doesn't surface `rating` without a JOIN change

**What goes wrong:** The star control silently always renders as "unrated" even
after a successful write, because `app/api/sourcing-events/[id]/route.ts`'s GET
handler does `SELECT * FROM suppliers WHERE event_id = ?`
(`[VERIFIED: app/api/sourcing-events/[id]/route.ts:21-23]`) — `rating` lives on
`org_supplier_data`, a different table, and is never selected.
**Why it happens:** `rating` is deliberately NOT a `suppliers` column (that's
the entire point of RATE-02) — it's easy to forget the read side needs its own
change when the write side (API route) is the more obvious "the feature" surface.
**How to avoid:** Modify the GET query itself to `LEFT JOIN org_supplier_data
osd ON osd.identity_id = s.identity_id AND osd.org_id = ?` and `SELECT s.*,
osd.rating`. This is the single most important line-item to verify at task
planning time.
**Warning signs:** Rating persists (confirmed via direct DB check or a repeat
POST) but the UI never reflects it after a page refresh.

### Pitfall 2: Forgetting to null-guard the `identity_id IS NULL` case in the write path

**What goes wrong:** A rating write attempt on a pre-Phase-4 supplier row (or a
row whose repository upsert failed, per D-03) either throws a confusing SQL
error (passing `null` as `identityId` to `updateOrgSupplierDataRating`, which
then matches `WHERE identity_id = NULL` — always false in SQL, silently
updating zero rows) or, worse, is masked by a generic try/catch that reports
success.
**Why it happens:** The write path assumes every `supplier_id` resolves to a
non-null `identity_id`, but D-03 explicitly documents this is not always true.
**How to avoid:** After `SELECT identity_id FROM suppliers WHERE id = ?`,
explicitly check for `null` and return a 400 (or simply omit the star control
client-side per D-03, so this path is defense-in-depth, not the primary
guard — a client that has already correctly hidden the control per D-03 should
never even send this request, but the server must not trust that).
**Warning signs:** A rating "successfully" saves (200 response) but never
appears on read for a specific supplier — check whether that supplier's row
predates Phase 4.

### Pitfall 3: Cross-org rating leakage if `identity_id` is trusted without `org_id`

**What goes wrong:** If the API route's rating-write query only filters
`WHERE identity_id = ?` (omitting `org_id`), then any bug that lets a caller
influence which `identity_id` gets targeted (e.g. a future refactor that
accepts `identity_id` in the request body instead of resolving it
server-side from `supplier_id`) could write into another org's
`org_supplier_data` row — violating REPO-04's isolation guarantee that this
whole schema split exists to enforce.
**Why it happens:** `identity_id` already has a `UNIQUE` index on
`org_supplier_data`, so it "feels" sufficient on its own — but uniqueness is a
storage-layer invariant, not an authorization check.
**How to avoid:** Always scope the `UPDATE`/`SELECT` on `org_supplier_data`
by both `identity_id` AND `org_id` (`ctx.orgId` from `getOrgContext()`),
exactly as `findKnownSuppliers` already does for reads
(`[VERIFIED: lib/supplier-repository.ts:137-147]`, `WHERE si.org_id = ?`).
**Warning signs:** A plan-checker or code-review pass should flag any new SQL
touching `org_supplier_data` that lacks an `org_id` predicate.

### Pitfall 4: Neon HTTP driver forbids multi-statement transactions

**What goes wrong:** Attempting to wrap "resolve identity_id" + "write rating"
+ "write identity_id back onto suppliers" in a single transaction/multi-
statement query throws or silently executes only the first statement.
**Why it happens:** Neon's HTTP driver (`@neondatabase/serverless`, used via
`neon()` not `Pool`) is stateless per-request and does not support
`BEGIN`/`COMMIT` multi-statement blocks (`[CITED: .claude/CLAUDE.md
Constraints]`, `[VERIFIED: lib/db.ts:3-10]`).
**How to avoid:** Keep every write as its own independent, idempotent
statement — exactly the pattern already used throughout `lib/supplier-
repository.ts` (identity upsert, then a separate org-data upsert, each its
own round trip). The rating write is naturally single-statement already
(`UPDATE org_supplier_data SET rating=... WHERE identity_id=... AND
org_id=...`); the identity_id back-write is a second, independent statement.
**Warning signs:** Any code review surfacing `BEGIN`/`COMMIT`/multiple `;`-
separated statements passed to a single `db.prepare()` call.

### Pitfall 5: SMALLINT column has no application-level CHECK constraint

**What goes wrong:** `org_supplier_data.rating SMALLINT`
(`[VERIFIED: lib/db.ts:340]`) has no DB-level `CHECK (rating BETWEEN 1 AND 5)`
constraint — Postgres will happily accept any smallint value (e.g. `0`, `6`,
`-1`) if the API route doesn't validate it. This mirrors `feedback_signal`
having no CHECK either, which is why `set_feedback`'s route code manually
validates `signal !== -1 && signal !== 0 && signal !== 1`
(`[VERIFIED: app/api/qualify/route.ts:80-82]`).
**Why it happens:** The codebase's established convention (per `.claude/CLAUDE.md`
Error Handling: routes are the sole validation gate for unconstrained columns)
places all bounds-checking in the route handler, not the schema.
**How to avoid:** Mirror the `set_feedback` validation exactly:
`if (rating !== null && (typeof rating !== "number" || rating < 1 || rating > 5 || !Number.isInteger(rating))) return 400`.
**Warning signs:** A plan or implementation that writes `rating` straight from
`body.rating` into the SQL parameter without a range/type check.

## Code Examples

### Schema change (`lib/db.ts`)

```typescript
// Source: existing ALTER-pattern convention, e.g. lib/db.ts:290-291
// Add immediately after the CREATE TABLE IF NOT EXISTS suppliers block
// (lib/db.ts:221-254), alongside the other ALTER TABLE suppliers statements.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS identity_id BIGINT REFERENCES supplier_identities(id);
```
Note: must be placed AFTER `supplier_identities` is created
(`[VERIFIED: lib/db.ts:315-326]`, currently defined at line 315, after
`suppliers` at line 221) — either move the new `ALTER TABLE suppliers ADD
COLUMN identity_id` statement to run after the `supplier_identities` CREATE
TABLE block, or omit the `REFERENCES` clause and rely on application-level
integrity only (matching that `suppliers.event_id` already uses a hard FK but
`org_supplier_data.identity_id` is the only existing FK into
`supplier_identities`). Recommended: add the `ALTER TABLE suppliers ADD
COLUMN IF NOT EXISTS identity_id BIGINT` (no inline FK) directly after the
`supplier_identities`/`org_supplier_data` block (after line 343), then add
`ALTER TABLE suppliers ADD CONSTRAINT ... FOREIGN KEY (identity_id)
REFERENCES supplier_identities(id)` as a separate statement if referential
integrity is desired — this avoids any table-creation-order dependency.

### Repository helper (`lib/supplier-repository.ts`)

```typescript
// Source: mirrors updateOrgSupplierDataEnrichment (lib/supplier-repository.ts:119-126)
/**
 * Upsert the org-private star rating for an identity (Phase 4 RATE-01/02).
 * Scoped by identity_id AND org_id (defense-in-depth beyond the identity_id
 * unique index — see Pitfall 3). `rating` is null to clear (D-07 toggle-off).
 */
export async function updateOrgSupplierDataRating(
  db: Db,
  params: { identityId: number; orgId: number; rating: number | null }
): Promise<void> {
  await db
    .prepare(`UPDATE org_supplier_data SET rating=?, updated_at=now() WHERE identity_id=? AND org_id=?`)
    .run(params.rating, params.identityId, params.orgId);
}
```

### API route (`app/api/qualify/route.ts`)

```typescript
// Source: mirrors the existing set_feedback action (app/api/qualify/route.ts:77-87)
// Insert as a new branch alongside it, after the existing set_feedback block.
if (action === "set_rating") {
  if (!supplier_id) return NextResponse.json({ error: "supplier_id required" }, { status: 400 });
  const rating = body.rating;
  if (rating !== null && (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return NextResponse.json({ error: "rating must be an integer 1-5, or null to clear" }, { status: 400 });
  }
  const row = await db.prepare("SELECT identity_id FROM suppliers WHERE id = ?").get(supplier_id) as
    { identity_id: number | null } | undefined;
  if (!row?.identity_id) {
    return NextResponse.json({ error: "Rating unavailable for this supplier" }, { status: 400 });
  }
  await updateOrgSupplierDataRating(db, { identityId: row.identity_id, orgId: ctx.orgId, rating });
  return NextResponse.json({ success: true });
}
```
Note: `updateOrgSupplierDataRating` must be imported at the top of the route
file from `@/lib/supplier-repository`, alongside any existing imports from
that module (none currently exist in `app/api/qualify/route.ts` — this will
be a new import line).

### GET route JOIN (`app/api/sourcing-events/[id]/route.ts`)

```typescript
// Source: current query at app/api/sourcing-events/[id]/route.ts:21-23
// BEFORE:
const suppliers = await db.prepare(
  "SELECT * FROM suppliers WHERE event_id = ? ORDER BY ai_score DESC, created_at ASC"
).all(id) as Record<string, unknown>[];

// AFTER:
const suppliers = await db.prepare(
  `SELECT s.*, osd.rating AS rating
   FROM suppliers s
   LEFT JOIN org_supplier_data osd ON osd.identity_id = s.identity_id AND osd.org_id = ?
   WHERE s.event_id = ?
   ORDER BY s.ai_score DESC, s.created_at ASC`
).all(ctx.orgId, id) as Record<string, unknown>[];
```
Note: `ctx.orgId` is already available in this handler (bound at line 12,
`[VERIFIED: app/api/sourcing-events/[id]/route.ts:12-13]`) — no new context
resolution needed. Column ordering in `.all(...)` params must match `?`
placeholder order left-to-right (`org_id` param first since it appears first
in the SQL text, per this wrapper's positional-placeholder normalization,
`[VERIFIED: lib/db.ts:20-21]`).

### Client type + handler (`app/events/[id]/page.tsx`)

```typescript
// Source: mirrors setFeedback exactly (app/events/[id]/page.tsx:1855-1871)
// 1. Add to the client Supplier type (app/events/[id]/page.tsx:20-39):
//      identity_id: number | null;
//      rating: number | null;

// 2. New handler, adjacent to setFeedback:
async function setRating(supplierId: number, rating: number | null) {
  const prev = suppliers.find(s => s.id === supplierId)?.rating ?? null;
  setSuppliers(p => p.map(s => s.id === supplierId ? { ...s, rating } : s));
  if (selected?.id === supplierId) setSelected(s => s ? { ...s, rating } : s);
  try {
    const res = await fetch("/api/qualify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_rating", supplier_id: supplierId, rating }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    setSuppliers(p => p.map(s => s.id === supplierId ? { ...s, rating: prev } : s));
    if (selected?.id === supplierId) setSelected(s => s ? { ...s, rating: prev } : s);
    addLog(`ERR could not save rating: ${String(err)}`);
    pushToast("error", t("Could not save rating. Please try again."));
  }
}

// 3. DetailPanel prop wiring (mirrors onFeedback exactly):
//    - DetailPanel signature (line 197): add `onRating: (id: number, rating: number | null) => void;`
//    - DetailPanel invocation (line 2694-2701): add `onRating={setRating}`
```

## State of the Art

Not applicable — this phase does not touch any technology with a meaningful
"old vs. current approach" axis. It is a straight extension of an established
in-repo pattern (per-event supplier field → org-scoped repository field), not
an adoption of new tooling.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Extending `app/api/qualify/route.ts` with a `set_rating` action (rather than a new dedicated route) is the correct choice for Claude's Discretion item on write-path shape | Architecture Patterns, Code Examples | Low — this is a research recommendation backed by direct precedent (`set_feedback` in the same file), not an unverified external fact; if the planner disagrees, moving the logic to a new route file is a mechanical refactor with no schema impact |
| A2 | `suppliers.identity_id` should be added WITHOUT an inline `REFERENCES supplier_identities(id)` FK constraint at the point of `ALTER TABLE`, due to table-creation-order in `lib/db.ts` (`suppliers` at line 221, `supplier_identities` at line 315) | Code Examples ("Schema change") | Medium — if the planner instead reorders the DDL to create `supplier_identities` before `suppliers`, an inline FK becomes safe; either approach works, but the ALTER statement's exact placement/FK-or-not must be a deliberate task decision, not an oversight |
| A3 | An `org_supplier_data` row always exists for any `suppliers` row with a non-null `identity_id` (because `identity_id` is only set right after a successful `upsertOrgSupplierData` call, in the same best-effort try block) — so a plain `UPDATE org_supplier_data SET rating=...` (not an upsert) is safe and will never silently no-op | Anti-Patterns to Avoid, Code Examples (API route) | Medium — if a future code path sets `identity_id` without a preceding `upsertOrgSupplierData` call, ratings on that identity would silently fail to save (0 rows changed, no error surfaced) until noticed; recommend the planner add a `changes === 0` check + fallback log/alert as defensive coding, or use `INSERT ... ON CONFLICT (identity_id) DO UPDATE` instead of a bare `UPDATE` to make this failure mode structurally impossible |
| A4 | The `Star` icon's `fill="currentColor"` / `fill="none"` toggle (rather than a filled/unfilled icon swap or a CSS-only approach) is the correct implementation technique for D-05's "5 discrete star icons, filled up to the current rating" requirement | Code Examples (Pattern 1) | Low — this is a standard `lucide-react` usage pattern (all lucide icons are outline SVGs supporting a `fill` prop); worst case is a minor visual tweak during implementation, no architectural risk |

**If this table is empty:** N/A — see entries above. All four assumptions are
low-to-medium risk implementation-detail choices, not compliance/security/
retention decisions requiring separate user sign-off; CONTEXT.md's "Claude's
Discretion" section explicitly delegates the write-path-shape decision (A1) to
this research.

## Open Questions

1. **Should the "Rating" label/context (D-05's "always shown with visible
   Rating labeling") include a numeric display (e.g. "4/5") alongside the
   stars, or is the filled-star count alone sufficient?**
   - What we know: D-05 requires visible labeling to disambiguate from the
     unrelated shortlist `Star` icon, but doesn't specify exact copy.
   - What's unclear: Whether a text label like "Rating" above/beside the
     stars is sufficient, or whether a numeric fraction adds clarity.
   - Recommendation: A small uppercase label ("Rating") in the same visual
     style as the existing section headers in `DetailPanel` (e.g. "AI
     Assessment", `[VERIFIED: app/events/[id]/page.tsx:393]` uses
     `text-[10px] font-bold uppercase tracking-widest text-slate-500`) is
     sufficient and matches the file's existing visual language — leave to
     implementation per CONTEXT.md's explicit discretion grant on exact
     layout.

2. **Should the rating row live inside the existing "AI Assessment" block
   (next to thumbs) or as its own separate block in `DetailPanel`?**
   - What we know: D-04 says "next to the existing thumbs-up/down toggle" and
     D-08 says the two are "entirely separate fields" rendered "side by side."
   - What's unclear: Whether "side by side" means literally the same header
     row as the thumbs, or a new adjacent block just below/above it — the
     existing thumbs toggle is nested inside the `{supplier.score_rationale &&
     (...)}` conditional block (`[VERIFIED: app/events/[id]/page.tsx:390-431]`),
     meaning it doesn't render at all if there's no AI rationale (e.g. a
     quick-scan, unqualified supplier). A rating control gated the same way
     would be unreachable for exactly the suppliers (quick-scan) that also
     tend to lack `identity_id` in edge cases — though D-02 confirms
     quick-scan DOES get an `identity_id` written via `makeProcessSupplierQuick`.
   - Recommendation: Render the star control as its own block, OUTSIDE the
     `supplier.score_rationale` conditional, gated instead on `supplier.identity_id
     !== null` per D-03 — this keeps rating available for quick-scan suppliers
     (which have no `score_rationale` but DO have `identity_id`) rather than
     accidentally coupling rating visibility to AI-assessment presence.

## Environment Availability

Not applicable — no new external tools, services, or runtimes are introduced.
This phase uses only the already-provisioned Neon Postgres connection and the
existing Next.js/Node runtime.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.9 `[VERIFIED: .claude/CLAUDE.md Frameworks]` |
| Config file | `vitest.config.ts` `[VERIFIED: vitest.config.ts]` — `environment: "node"`, includes `tests/**/*.test.ts` |
| Quick run command | `npx vitest run tests/supplier-repository.test.ts tests/process-supplier.test.ts` |
| Full suite command | `npm run test` (`vitest run`, `[VERIFIED: package.json test script]`) |

Note: this repo's existing test convention (confirmed by
`tests/supplier-repository.test.ts` and `tests/process-supplier.test.ts`) is
**unit tests against `lib/` modules using a hand-written fake DB** (regex-
matching SQL text against an in-memory store, `[VERIFIED:
tests/supplier-repository.test.ts:19-89]`) — there are NO existing tests that
import and directly invoke `app/api/*/route.ts` handlers. New tests for
RATE-01/02/03 should follow this same convention: exercise
`updateOrgSupplierDataRating` and the `identity_id`-write additions to
`lib/process-supplier.ts` directly, extending the existing fake-DB test
fixtures rather than introducing a new route-level test harness (which would
be a departure from established convention, out of scope for this phase).

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RATE-01 | `updateOrgSupplierDataRating` writes 1-5 and null values correctly | unit | `npx vitest run tests/supplier-repository.test.ts` | ✅ (extend) |
| RATE-01 | Toggle-to-clear client interaction (re-clicking active star nulls it) | manual (no route/component test harness exists in this repo — see note above) | N/A — human checkpoint | ❌ Wave 0 (if automated coverage desired, add a pure function extracted from the click handler, e.g. `nextRatingValue(current, clicked)`, and unit test THAT) |
| RATE-02 | `identity_id` is written onto the `suppliers` row in all 3 `makeProcessSupplier*()` factories | unit | `npx vitest run tests/process-supplier.test.ts` | ✅ (extend) |
| RATE-02 | `updateOrgSupplierDataRating` is scoped by BOTH `identity_id` AND `org_id` (cross-org isolation) | unit | `npx vitest run tests/supplier-repository.test.ts` | ✅ (extend — mirror the existing cross-org isolation test pattern already used for `findKnownSuppliers`, `[VERIFIED: tests/supplier-repository.test.ts]` references org isolation via substring-negation per STATE.md 03-04 note) |
| RATE-03 | `set_feedback`/`feedback_signal` behavior is completely unmodified by this phase's changes | regression | `npm run test` (full suite — no route-level `set_feedback` test currently exists, so this is verified by absence of regressions in existing suite, not a new targeted test) | ✅ (existing suite acts as regression guard) |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/supplier-repository.test.ts tests/process-supplier.test.ts`
- **Per wave merge:** `npm run test` (full suite) + `npm run typecheck`
- **Phase gate:** Full suite green (`npm run test`, `npm run typecheck`, `npm run lint`) before `/gsd-verify-work`, matching the exact gate Phase 3 used per STATE.md (`258/258 tests, clean typecheck/lint/build`).

### Wave 0 Gaps
- [ ] No existing test directly covers the `app/api/qualify/route.ts` `set_feedback`
  action (RATE-03's "unchanged" claim can only be regression-tested via the full
  suite, not a targeted assertion) — if stronger confidence is wanted, extracting
  the `set_feedback`/`set_rating` validation logic into small pure functions
  (e.g. `validateRatingInput(body): number | null | { error: string }`) would
  make both independently unit-testable without a route-level harness.
- [ ] No existing fixture in `tests/supplier-repository.test.ts`'s fake DB
  regex-matches an `UPDATE org_supplier_data SET rating=...` statement shape —
  this must be added to the fake DB's `prepare()` matcher alongside the
  existing enrichment/ai_score matchers (`[VERIFIED:
  tests/supplier-repository.test.ts:19-89]`).

*(Framework itself is fully present — no `npm install` needed for testing.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Unchanged — Clerk session already required by `getOrgContext()` before any action in this route |
| V3 Session Management | No | Unchanged |
| V4 Access Control | Yes | `orgOwnsSupplier(ctx.orgId, supplier_id)` (existing, `[VERIFIED: app/api/qualify/route.ts:33-35]`) PLUS the new compound `identity_id AND org_id` predicate on every `org_supplier_data` write (Pitfall 3) |
| V5 Input Validation | Yes | Manual range/type check on `rating` (integer 1-5 or null) mirroring `set_feedback`'s existing `-1/0/1` check, `[VERIFIED: app/api/qualify/route.ts:80-82]` — no schema-level CHECK constraint exists, so this is the only gate |
| V6 Cryptography | No | Not applicable — no new secrets, tokens, or cryptographic material |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR — a caller passes an arbitrary `supplier_id` belonging to another org's event, attempting to write that org's rating | Tampering / Elevation of Privilege | `orgOwnsSupplier()` gate, already present in this route for every action (line 33) — the new `set_rating` action must be added AFTER this check, not bypass it |
| Cross-org write via `identity_id` reuse | Tampering | Server resolves `identity_id` from the already-tenant-checked `supplier_id` row — NEVER accept `identity_id` directly from the request body (see Anti-Patterns to Avoid) |
| Unbounded numeric injection into a schema-unconstrained `SMALLINT` column | Tampering | Application-level range validation (V5 above) — Postgres will silently accept any smallint without it |
| SQL injection via string-interpolated column names | Tampering | Not a risk here — all new SQL uses parameterized `?` placeholders exactly like the surrounding code; no column names are derived from user input (unlike the `sourcing-events/[id]` PATCH route's `ALLOWED` field-name allowlist pattern, which is not needed here since `action`/`rating`/`supplier_id` are the only three fields, none used as column names) |

## Sources

### Primary (HIGH confidence)
- `lib/db.ts` (read directly, lines 200-479) — full schema for `suppliers`, `supplier_identities`, `org_supplier_data`, existing ALTER-pattern convention, indexes
- `lib/process-supplier.ts` (read directly, lines 1-60, 150-495) — all three `makeProcessSupplier*()` factories, existing `identityId`/`identityIdDeepen` computation and discard points
- `lib/supplier-repository.ts` (read directly, full file) — existing repository write/read helpers, isolation conventions, comments documenting REPO-04 design intent
- `app/api/qualify/route.ts` (read directly, lines 1-120) — existing `set_feedback` action, tenant-check gate, `FUNNEL_STAGES` validation-allowlist convention
- `app/api/sourcing-events/[id]/route.ts` (read directly, full file) — GET/PATCH/DELETE handlers, existing supplier-list query, `ctx.orgId` availability
- `app/events/[id]/page.tsx` (read directly, lines 1-65, 195-215, 340-430, 560-575, 895-910, 1845-1875, 2490-2500, 2685-2705) — client `Supplier` type, `DetailPanel` component signature and existing thumbs UI, `setFeedback` optimistic-update handler, all 3 `Star` icon call sites (D-05's collision concern confirmed)
- `lib/tenant.ts` (read directly, lines 1-60) — `getOrgContext()`/`OrgContext` shape, confirming `ctx.orgId` type and availability
- `tests/supplier-repository.test.ts` (read directly, lines 1-90) — existing fake-DB test convention for repository functions
- `.planning/phases/04-supplier-star-ratings/04-CONTEXT.md` — all locked decisions (D-01 through D-08) and discretion grants
- `.planning/REQUIREMENTS.md` — RATE-01/02/03 full text, REPO-04 isolation rationale
- `.planning/STATE.md` — Phase 3 closure confirmation, test-suite size history (258/258), existing precedent for isolation testing via "substring-negation"
- `.claude/CLAUDE.md` — tech stack versions, `lucide-react` dependency confirmation, Neon HTTP driver multi-statement-transaction constraint

### Secondary (MEDIUM confidence)
None — no external documentation lookups were required for this phase; every
finding is grounded directly in the target codebase.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — zero new external dependencies; all libraries and their versions confirmed directly from `.claude/CLAUDE.md` and live imports in the target files
- Architecture: HIGH — every pattern in this document is grounded in code read directly in this session (`[VERIFIED: file:line]`), not inferred or assumed
- Pitfalls: HIGH — all 5 pitfalls derive from specific, cited lines of existing code (Neon driver constraint, existing validation conventions, existing isolation patterns) rather than generic best-practice knowledge

**Research date:** 2026-08-21
**Valid until:** No expiry driver — this research is scoped entirely to the current state of this specific codebase, not to any external library's release cadence. Re-research only if `lib/db.ts`, `lib/process-supplier.ts`, `lib/supplier-repository.ts`, or the two API routes cited above change materially before this phase is planned/executed.
