# Phase 4: Supplier Star Ratings - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-17
**Phase:** 04-supplier-star-ratings
**Areas discussed:** Identity linkage, UI placement & interaction, Set/change/clear behavior, Unresolved-identity edge case

---

## Identity linkage

| Option | Description | Selected |
|--------|-------------|----------|
| Add identity_id column | Add an `identity_id` column to `suppliers`, populated going-forward inside the three `makeProcessSupplier*()` functions where `identityId`/`identityIdDeepen` are already computed but currently discarded | ✓ |

**User's choice:** Add identity_id column (Recommended)
**Notes:** Confirmed as the fix for a gap discovered during codebase scouting — `suppliers` has no FK back to `supplier_identities`/`org_supplier_data` even though the identity value is already computed at write time.

| Option | Description | Selected |
|--------|-------------|----------|
| Hide rating control | For existing supplier rows created before this phase (no `identity_id`, backfill out of scope), the rating control simply doesn't render | ✓ |

**User's choice:** Hide rating control (Recommended)
**Notes:** Reuses Phase 3's "going forward only" precedent (REPO-V2-04) rather than triggering a backfill migration.

**Continuation check:** User chose "Next area" (no further identity-linkage questions).

---

## UI placement & interaction

| Option | Description | Selected |
|--------|-------------|----------|
| DetailPanel only | Star control renders next to the existing thumbs feedback in DetailPanel; compact table row stays uncluttered | ✓ |
| Compact row + DetailPanel | Small read-only star indicator in the compact row plus full control in DetailPanel | |
| You decide | Defer to planner/UI researcher | |

**User's choice:** DetailPanel only (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| 5 filled/outline stars, no icon reuse | 5 small Star icons in a row, filled up to the rating, always paired with visible "Rating" label/context so it reads distinctly from the standalone Shortlist star | ✓ |
| Different icon entirely | Use a different glyph to avoid any visual ambiguity with Shortlist | |
| You decide | Defer to UI researcher/planner | |

**User's choice:** 5 filled/outline stars, no icon reuse (Recommended)
**Notes:** Addresses the collision risk surfaced during codebase scouting — `lucide-react`'s `Star` icon is already used for the unrelated "Add to Short List" action at 3 call sites in `app/events/[id]/page.tsx`.

**Continuation check:** User chose "Next area" (no further UI-placement questions).

---

## Set/change/clear behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Freely changeable | Clicking any star immediately overwrites the current rating, no confirmation | ✓ |
| Require confirm to change | Changing an already-set rating needs a confirm step | |

**User's choice:** Freely changeable (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Click same star to clear | Mirrors the existing thumbs-up/down toggle-to-clear pattern (#46 — Epic 5.3); re-clicking star N when rating is already N sets it back to null | ✓ |
| Separate clear action | Explicit small "clear" control (e.g. an x) next to the stars | |

**User's choice:** Click same star to clear (Recommended)

**Continuation check:** User chose "Next area" (no further set/change/clear questions).

---

## Unresolved-identity edge case

| Option | Description | Selected |
|--------|-------------|----------|
| Hide until identity_id resolves | Same treatment as pre-Phase-4 rows with no identity_id — rating control doesn't render until the row has a resolved identity_id | ✓ |
| Show disabled/loading state | Greyed-out stars with a "resolving..." tooltip until identity_id resolves | |

**User's choice:** Hide until identity_id resolves (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| No — treat as same case as legacy rows | identity_id is set at the same INSERT as the row itself, so the only null-identity_id cases are legacy rows and rare upsert failures — already covered by "hide the control" | ✓ |
| Yes — needs distinct handling | There's a real timing gap worth designing for separately | |

**User's choice:** No — treat as same case as legacy rows (Recommended)
**Notes:** Confirms there is no meaningful async "resolving" window to design for, since `identity_id` is computed and written at insert time inside the three `makeProcessSupplier*()` functions.

---

## Claude's Discretion

- Exact visual layout/spacing of the star row relative to the existing thumbs control within `DetailPanel`.
- Whether the rating write is a dedicated API route or extends an existing suppliers-update endpoint.

## Deferred Ideas

None — all 4 selected gray areas were explored to the user's satisfaction with no scope creep into other phases.
