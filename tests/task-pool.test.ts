import { describe, it, expect } from "vitest";
import { createTaskPool } from "@/lib/task-pool";

/** A task that increments `active` on start, records the running peak, then
 * waits for an external `release` signal before resolving and decrementing.
 * `run` must stay lazy — the pool only gates concurrency if the task's work
 * doesn't begin until `schedule` actually invokes it, so the async body lives
 * inside the returned `run` function rather than an IIFE kicked off eagerly
 * at task-construction time (which would start all tasks before the pool
 * ever gets a chance to bound them). */
function makeTrackedTask(state: { active: number; peak: number }) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const run = async () => {
    state.active++;
    state.peak = Math.max(state.peak, state.active);
    await gate;
    state.active--;
  };
  return { run, release };
}

describe("createTaskPool (#96)", () => {
  it("never runs more than `concurrency` tasks at once", async () => {
    const schedule = createTaskPool(2);
    const state = { active: 0, peak: 0 };
    const tasks = Array.from({ length: 5 }, () => makeTrackedTask(state));

    const scheduled = tasks.map((t) => schedule(t.run));
    // Let the microtask queue settle so the first `concurrency` tasks start.
    await Promise.resolve();
    await Promise.resolve();

    expect(state.peak).toBeLessThanOrEqual(2);

    // Release tasks one at a time, re-checking the peak never exceeds 2 as
    // queued tasks backfill freed slots.
    for (const t of tasks) {
      t.release();
      await Promise.resolve();
      await Promise.resolve();
      expect(state.peak).toBeLessThanOrEqual(2);
    }

    await Promise.all(scheduled);
    expect(state.active).toBe(0);
  });

  it("resolves each scheduled promise with its task's own return value", async () => {
    const schedule = createTaskPool(3);
    const results = await Promise.all([
      schedule(async () => 1),
      schedule(async () => "two"),
      schedule(async () => ({ three: 3 })),
    ]);
    expect(results).toEqual([1, "two", { three: 3 }]);
  });

  it("propagates a rejected task without blocking the pool for later tasks", async () => {
    const schedule = createTaskPool(1);
    const first = schedule(async () => { throw new Error("boom"); });
    const second = schedule(async () => "ok");

    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
  });

  it("clamps concurrency to at least 1", async () => {
    const schedule = createTaskPool(0);
    const state = { active: 0, peak: 0 };
    const tasks = Array.from({ length: 3 }, () => makeTrackedTask(state));
    const scheduled = tasks.map((t) => schedule(t.run));
    await Promise.resolve();
    await Promise.resolve();
    expect(state.peak).toBe(1);
    for (const t of tasks) t.release();
    await Promise.all(scheduled);
  });
});
