// ─── DASHBOARD EVENT LIST ORDERING ────────────────────────────────────────────
// Pure logic for issue #40's pin/archive dashboard ergonomics: which events show
// up in the default (non-archived) view, and how pinned projects surface at the
// top regardless of the active sort column. Kept framework-free so it's
// unit-testable without React — mirrors lib/supplier-filters.ts.

export type EventListItem = {
  pinned: boolean;
  archived: boolean;
  supplier_count: number;
  created_at: string;
  updated_at: string;
};

export type EventSortKey = "activity" | "pipeline" | "initiated";
export type SortDir = "asc" | "desc";

/**
 * Filter events down to the requested view (archived-only or active-only), then
 * sort them. Pinned projects always surface first within the active view,
 * regardless of the chosen sort column — pinning is a manual override of
 * whatever automatic ordering the user picked. The archived view has no such
 * override: pin state is irrelevant once a project is out of the default list.
 */
export function sortEventRows<T extends EventListItem>(
  events: T[],
  opts: { showArchived: boolean; sortKey: EventSortKey; sortDir: SortDir }
): T[] {
  const filtered = events.filter(e => (opts.showArchived ? e.archived : !e.archived));
  const dir = opts.sortDir === "asc" ? 1 : -1;

  return [...filtered].sort((a, b) => {
    if (!opts.showArchived && a.pinned !== b.pinned) return a.pinned ? -1 : 1;

    let cmp = 0;
    if (opts.sortKey === "pipeline") {
      cmp = (a.supplier_count || 0) - (b.supplier_count || 0);
    } else if (opts.sortKey === "initiated") {
      cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    } else {
      cmp = new Date(a.updated_at || a.created_at).getTime() - new Date(b.updated_at || b.created_at).getTime();
    }
    return cmp * dir;
  });
}
