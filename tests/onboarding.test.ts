import { describe, it, expect } from "vitest";
import {
  parseChecklistProgress,
  buildChecklistState,
  mergeAutoDetected,
  isExplicitlyCompletable,
  CHECKLIST_TASKS,
  CHECKLIST_TASK_BONUS_EVENTS,
  type ChecklistTaskKey,
} from "@/lib/onboarding";

describe("parseChecklistProgress", () => {
  it("returns an empty map for null/undefined/empty input", () => {
    expect(parseChecklistProgress(null)).toEqual({});
    expect(parseChecklistProgress(undefined)).toEqual({});
    expect(parseChecklistProgress("")).toEqual({});
  });

  it("parses a valid JSON object of task -> timestamp", () => {
    const raw = JSON.stringify({ create_event: "2026-01-01T00:00:00.000Z" });
    expect(parseChecklistProgress(raw)).toEqual({ create_event: "2026-01-01T00:00:00.000Z" });
  });

  it("tolerates malformed JSON by treating it as empty", () => {
    expect(parseChecklistProgress("not json")).toEqual({});
    expect(parseChecklistProgress("{broken")).toEqual({});
  });

  it("drops non-object payloads (arrays, primitives) and non-string values", () => {
    expect(parseChecklistProgress(JSON.stringify(["a", "b"]))).toEqual({});
    expect(parseChecklistProgress(JSON.stringify("just a string"))).toEqual({});
    expect(parseChecklistProgress(JSON.stringify({ create_event: 12345 }))).toEqual({});
  });
});

describe("buildChecklistState", () => {
  it("marks every task incomplete for an empty progress map", () => {
    const state = buildChecklistState({});
    expect(state.totalCount).toBe(CHECKLIST_TASKS.length);
    expect(state.completedCount).toBe(0);
    expect(state.bonusEventsEarned).toBe(0);
    expect(state.allComplete).toBe(false);
    expect(state.tasks.every((t) => t.completedAt === null)).toBe(true);
  });

  it("counts completed tasks and the bonus events they earned", () => {
    const state = buildChecklistState({ create_event: "2026-01-01T00:00:00.000Z" });
    expect(state.completedCount).toBe(1);
    expect(state.bonusEventsEarned).toBe(1 * CHECKLIST_TASK_BONUS_EVENTS);
    const task = state.tasks.find((t) => t.key === "create_event");
    expect(task?.completedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("is allComplete only once every defined task has a timestamp", () => {
    const allKeys = CHECKLIST_TASKS.reduce<Record<string, string>>((acc, t) => {
      acc[t.key] = "2026-01-01T00:00:00.000Z";
      return acc;
    }, {});
    const state = buildChecklistState(allKeys);
    expect(state.allComplete).toBe(true);
    expect(state.completedCount).toBe(state.totalCount);
  });
});

describe("mergeAutoDetected", () => {
  it("adds newly-detected keys with the given timestamp", () => {
    const { merged, newlyCompleted } = mergeAutoDetected({}, ["create_event"], "2026-02-02T00:00:00.000Z");
    expect(merged).toEqual({ create_event: "2026-02-02T00:00:00.000Z" });
    expect(newlyCompleted).toEqual(["create_event"]);
  });

  it("never overwrites an already-recorded completion timestamp", () => {
    const existing = { create_event: "2020-01-01T00:00:00.000Z" };
    const { merged, newlyCompleted } = mergeAutoDetected(existing, ["create_event"], "2026-02-02T00:00:00.000Z");
    expect(merged.create_event).toBe("2020-01-01T00:00:00.000Z");
    expect(newlyCompleted).toEqual([]);
  });

  it("only reports the keys that actually transitioned this call", () => {
    const existing = { create_event: "2020-01-01T00:00:00.000Z" };
    const { newlyCompleted } = mergeAutoDetected(
      existing,
      ["create_event", "shortlist_supplier"],
      "2026-02-02T00:00:00.000Z"
    );
    expect(newlyCompleted).toEqual(["shortlist_supplier"]);
  });

  it("is a no-op given an empty detected list", () => {
    const existing = { create_event: "2020-01-01T00:00:00.000Z" };
    const { merged, newlyCompleted } = mergeAutoDetected(existing, []);
    expect(merged).toEqual(existing);
    expect(newlyCompleted).toEqual([]);
  });
});

describe("isExplicitlyCompletable", () => {
  it("accepts client-reported tasks (auto: false)", () => {
    expect(isExplicitlyCompletable("share_referral")).toBe(true);
  });

  it("rejects server auto-detected tasks", () => {
    const autoKeys: ChecklistTaskKey[] = ["create_event", "shortlist_supplier", "launch_outreach"];
    for (const key of autoKeys) {
      expect(isExplicitlyCompletable(key)).toBe(false);
    }
  });

  it("rejects unknown keys", () => {
    expect(isExplicitlyCompletable("not_a_real_task")).toBe(false);
    expect(isExplicitlyCompletable("")).toBe(false);
  });
});
