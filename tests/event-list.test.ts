import { describe, it, expect } from "vitest";
import { sortEventRows, type EventListItem } from "@/lib/event-list";

type Stub = EventListItem & { id: number };

function ev(overrides: Partial<Stub> = {}): Stub {
  return {
    id: 1, pinned: false, archived: false, supplier_count: 0,
    created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("sortEventRows", () => {
  it("excludes archived events by default", () => {
    const rows = [ev({ id: 1 }), ev({ id: 2, archived: true })];
    const out = sortEventRows(rows, { showArchived: false, sortKey: "activity", sortDir: "desc" });
    expect(out.map(e => e.id)).toEqual([1]);
  });

  it("shows only archived events when showArchived is true", () => {
    const rows = [ev({ id: 1 }), ev({ id: 2, archived: true }), ev({ id: 3, archived: true })];
    const out = sortEventRows(rows, { showArchived: true, sortKey: "activity", sortDir: "desc" });
    expect(out.map(e => e.id).sort()).toEqual([2, 3]);
  });

  it("surfaces pinned events at the top regardless of the sort column", () => {
    const rows = [
      ev({ id: 1, pinned: false, updated_at: "2024-06-01T00:00:00Z" }),
      ev({ id: 2, pinned: true, updated_at: "2024-01-01T00:00:00Z" }),
      ev({ id: 3, pinned: false, updated_at: "2024-05-01T00:00:00Z" }),
    ];
    const out = sortEventRows(rows, { showArchived: false, sortKey: "activity", sortDir: "desc" });
    expect(out[0].id).toBe(2);
  });

  it("does not apply pin priority within the archived view", () => {
    const rows = [
      ev({ id: 1, archived: true, pinned: false, updated_at: "2024-06-01T00:00:00Z" }),
      ev({ id: 2, archived: true, pinned: true, updated_at: "2024-01-01T00:00:00Z" }),
    ];
    const out = sortEventRows(rows, { showArchived: true, sortKey: "activity", sortDir: "desc" });
    // Newest-updated-first (no pin override), so the unpinned, more recently
    // updated event should lead.
    expect(out[0].id).toBe(1);
  });

  it("sorts by pipeline (supplier_count)", () => {
    const rows = [ev({ id: 1, supplier_count: 3 }), ev({ id: 2, supplier_count: 10 })];
    const asc = sortEventRows(rows, { showArchived: false, sortKey: "pipeline", sortDir: "asc" });
    expect(asc.map(e => e.id)).toEqual([1, 2]);
    const desc = sortEventRows(rows, { showArchived: false, sortKey: "pipeline", sortDir: "desc" });
    expect(desc.map(e => e.id)).toEqual([2, 1]);
  });

  it("sorts by initiated (created_at)", () => {
    const rows = [
      ev({ id: 1, created_at: "2024-03-01T00:00:00Z" }),
      ev({ id: 2, created_at: "2024-01-01T00:00:00Z" }),
    ];
    const out = sortEventRows(rows, { showArchived: false, sortKey: "initiated", sortDir: "asc" });
    expect(out.map(e => e.id)).toEqual([2, 1]);
  });

  it("sorts by activity (updated_at, falling back to created_at)", () => {
    const rows = [
      ev({ id: 1, updated_at: "", created_at: "2024-02-01T00:00:00Z" }),
      ev({ id: 2, updated_at: "2024-05-01T00:00:00Z", created_at: "2024-01-01T00:00:00Z" }),
    ];
    const out = sortEventRows(rows, { showArchived: false, sortKey: "activity", sortDir: "desc" });
    expect(out.map(e => e.id)).toEqual([2, 1]);
  });

  it("does not mutate the input array", () => {
    const rows = [ev({ id: 1, updated_at: "2024-01-01T00:00:00Z" }), ev({ id: 2, updated_at: "2024-06-01T00:00:00Z" })];
    const copy = [...rows];
    sortEventRows(rows, { showArchived: false, sortKey: "activity", sortDir: "desc" });
    expect(rows).toEqual(copy);
  });
});
