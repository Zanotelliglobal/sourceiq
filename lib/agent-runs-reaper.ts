import { getDb } from "@/lib/db";
type Db = ReturnType<typeof getDb>;

// ─── STUCK agent_runs REAPER (#67) ─────────────────────────────────────────
// app/api/orchestrate/route.ts registers an agent_runs row as 'queued', then
// 'running', then a terminal status ('complete'/'error') as each planned
// agent finishes. If the request crashes (uncaught exception, network drop,
// or the Vercel function simply hitting its maxDuration=300s cap) before that
// terminal write happens, the row is left stuck in 'queued'/'running'
// forever — the UI keeps showing a spinner for an agent that will never
// finish, with no way for the user to tell the difference from a genuinely
// slow run.
//
// Because orchestrate's `export const maxDuration = 300` hard-caps how long
// that request can run, any row still 'queued'/'running' more than 5 minutes
// after it was created is *provably* dead, not just probably — the same
// "don't trust a lock that might have been abandoned" reasoning used for
// #62's send claims. Reaping is therefore safe to do unconditionally: it can
// never clobber a still-running wave.

/** Minutes after which a queued/running agent_runs row is provably abandoned. */
export const STUCK_AGENT_RUN_MINUTES = 5;

/**
 * Mark any agent_runs rows for this event that have been queued/running past
 * STUCK_AGENT_RUN_MINUTES as errored, so reads reflect reality instead of a
 * permanent spinner. Safe to call on every read — it only ever touches rows
 * that are provably abandoned, never a live run.
 */
export async function reapStuckAgentRuns(db: Db, eventId: number): Promise<void> {
  await db
    .prepare(
      `UPDATE agent_runs SET status='error', message='Interrupted — the run stopped responding and was marked as failed.', completed_at=now()
       WHERE event_id=? AND status IN ('queued','running')
       AND created_at < now() - make_interval(mins => ?)`
    )
    .run(eventId, STUCK_AGENT_RUN_MINUTES)
    .catch(() => {});
}
