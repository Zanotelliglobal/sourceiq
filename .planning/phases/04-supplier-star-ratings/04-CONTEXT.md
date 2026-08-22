# Phase 4: Supplier Star Ratings - Context

**Gathered:** 2026-08-17 (interactive discussion — default mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

A buyer can assign a 1-5 star rating to a supplier from the event page's supplier
detail view. The rating attaches to the supplier's persistent repository identity
(`org_supplier_data.rating`, an org-private column already created in Phase 3 for
this exact purpose) rather than to the per-event `suppliers` row, so ratings
accumulate across every event that encounters that supplier within the org. The
rating coexists with — does not replace — the existing per-event `feedback_signal`
thumbs-up/down field. Out of scope: backfilling `identity_id` onto pre-Phase-4
supplier rows, showing/using ratings anywhere outside the event detail view, any
cross-org rating aggregation (matches Phase 3's per-org-only scope).

</domain>

<decisions>
## Implementation Decisions

### Identity linkage (closes the suppliers → repository gap)
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

### UI placement & interaction (RATE-01)
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

### Set/change/clear behavior (RATE-01)
- **D-06:** Ratings are freely changeable — clicking any star immediately
  overwrites the current rating with no confirmation step. Matches the low-friction
  feel of the existing thumbs-feedback toggle.
- **D-07:** Re-clicking the currently-set star clears the rating back to
  `null`/unrated — mirrors the existing thumbs-up/down toggle-to-clear pattern
  (`#46 — Epic 5.3`) for UI consistency, rather than introducing a separate
  explicit "clear" control.

### Coexistence with feedback_signal (RATE-03)
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — RATE-01, RATE-02, RATE-03 (full acceptance criteria
  for this phase).

### Roadmap
- `.planning/ROADMAP.md` — Phase 4 section: `Mode: mvp`, `UI hint: yes`, depends on
  Phase 3, Success Criteria.

### Prior phase context
- `.planning/phases/03-persistent-supplier-repository/03-CONTEXT.md` — the
  forward-looking note that Phase 4 depends directly on `org_supplier_data`
  carrying the `rating` column, which Phase 3 already built in anticipation of
  this phase.
- `.planning/PROJECT.md` — backlog items #9 (supplier star-rating feedback) and
  #10 (persistent repository), confirming #9's schema/scope dependency on #10 is
  now resolved.

No external specs — requirements fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/process-supplier.ts` — `makeProcessSupplier()` (~line 177-187),
  `makeProcessSupplierQuick()` (~line 322-330), `makeProcessSupplierDeepen()`
  (~line 413-423) — all three already compute `identityId`/`identityIdDeepen`
  locally; D-01/D-02 wire this existing value onto the new `suppliers.identity_id`
  column instead of discarding it.
- `lib/db.ts` — `org_supplier_data` table (~lines 333-343) already has a
  `rating SMALLINT` column, pre-built by Phase 3 specifically for this phase.
- `app/events/[id]/page.tsx` — existing thumbs-up/down `feedback_signal` toggle in
  `DetailPanel` (~lines 370-430, with the `#46 — Epic 5.3` toggle-to-clear
  precedent) is the direct UI/interaction analog for the new star control.

### Established Patterns
- ALTER-pattern schema changes: `lib/db.ts` uses `CREATE TABLE IF NOT EXISTS` +
  subsequent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for incremental schema
  evolution — the new `identity_id` column should follow this same pattern.
- Toggle-to-clear UI pattern: re-clicking an already-active feedback control clears
  it, established by the existing thumbs feedback signal — reused for D-07.
- No multi-statement DB transactions (Neon HTTP driver limitation) — writing
  `identity_id` alongside the row's own insert is a single-statement concern
  already satisfied by including it in the same `INSERT`, not a separate
  transaction.

### Integration Points
- `lib/process-supplier.ts` — D-01/D-02's `identity_id` write lands inside the
  three `makeProcessSupplier*()` functions, at the same point `identityId`/
  `identityIdDeepen` are already computed.
- `app/events/[id]/page.tsx` `DetailPanel` — D-04/D-05's star control renders here.
- The rating write path (new/extended API route, per Claude's Discretion above)
  needs to update `org_supplier_data.rating` scoped by `org_id` + the resolved
  `identity_id`, following the existing per-org isolation pattern from
  `lib/supplier-repository.ts`.

</code_context>

<specifics>
## Specific Ideas

No specific visual mockups or component names were provided beyond what's
captured above — the user confirmed the recommended options at each decision
point (identity-linkage approach, UI placement, icon distinctness, set/clear
behavior, edge-case handling) rather than proposing alternatives.

</specifics>

<deferred>
## Deferred Ideas

None raised this session — all 4 selected gray areas were explored to the user's
satisfaction with no scope creep into other phases.

### Reviewed Todos (not folded)
None — no todos matched Phase 4 during discussion.

</deferred>

---

*Phase: 4-Supplier Star Ratings*
*Context gathered: 2026-08-17*
