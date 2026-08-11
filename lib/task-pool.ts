// ─── BOUNDED BACKGROUND-TASK POOL (#96) ────────────────────────────────────
// lib/process-supplier.ts fires 3 background tasks per supplier (enrichment,
// contact scrape, website-live check) as fire-and-forget work tracked in a
// `backgroundTasks` array so the route can drain them before closing the SSE
// stream. Draining at the end was the only concurrency control — every task
// itself starts immediately, so a wave that qualifies 100 suppliers launches
// up to 300 concurrent LLM calls / outbound fetches at once, independent of
// (and far exceeding) the SCOUT_CONCURRENCY/QUAL_CONCURRENCY pools that were
// specifically sized to keep simultaneous model calls within provider limits.
//
// createTaskPool caps how many *scheduled* functions actually run
// concurrently without changing the fire-and-forget contract: `schedule`
// still returns a promise immediately, queues the work, and resolves once
// its turn comes and the task completes — callers keep pushing the returned
// promise into backgroundTasks and awaiting the array at the end exactly as
// before. Only the middle (execution) is now bounded, matching the manual
// cursor-pool pattern already used for scouts/qualifiers in
// app/api/orchestrate/route.ts, just applied to fire-and-forget work instead
// of awaited-inline work.

export type Schedule = <T>(fn: () => Promise<T>) => Promise<T>;

export function createTaskPool(concurrency: number): Schedule {
  const limit = Math.max(1, concurrency);
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active >= limit) return;
    const run = queue.shift();
    if (!run) return;
    active++;
    run();
  };

  return function schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      });
      next();
    });
  };
}
