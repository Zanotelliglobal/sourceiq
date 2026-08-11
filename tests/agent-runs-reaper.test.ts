import { describe, it, expect } from "vitest";
import { reapStuckAgentRuns, STUCK_AGENT_RUN_MINUTES } from "@/lib/agent-runs-reaper";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

// ─── Fakes ──────────────────────────────────────────────────────────────────
// Same house convention as tests/outreach-claim.test.ts: no mocking framework
// in this repo, so build a minimal typed stub that understands just the one
// UPDATE shape lib/agent-runs-reaper.ts issues.

type Row = {
  id: number;
  event_id: number;
  status: string;
  created_at: Date;
  message: string | null;
  completed_at: Date | null;
};

function fakeDb(initial: Row[]) {
  const rows: Row[] = initial.map((r) => ({ ...r }));

  const db = {
    prepare(sql: string) {
      return {
        async run(...params: unknown[]) {
          if (/UPDATE agent_runs SET status='error'/.test(sql)) {
            const [eventId, staleMinutes] = params as [number, number];
            let changes = 0;
            for (const row of rows) {
              const stale = Date.now() - row.created_at.getTime() > staleMinutes * 60_000;
              if (row.event_id === eventId && ["queued", "running"].includes(row.status) && stale) {
                row.status = "error";
                row.message = "Interrupted — the run stopped responding and was marked as failed.";
                row.completed_at = new Date();
                changes++;
              }
            }
            return { changes, lastInsertRowid: undefined };
          }
          throw new Error(`fakeDb: unhandled SQL shape: ${sql}`);
        },
        async get() {
          throw new Error("fakeDb: get() not needed by agent-runs-reaper tests");
        },
        async all() {
          throw new Error("fakeDb: all() not needed by agent-runs-reaper tests");
        },
      };
    },
  };
  return { db: db as unknown as Db, rows };
}

describe("reapStuckAgentRuns (#67)", () => {
  it("marks a stuck 'running' row abandoned past STUCK_AGENT_RUN_MINUTES as errored", async () => {
    const staleTimestamp = new Date(Date.now() - (STUCK_AGENT_RUN_MINUTES + 1) * 60_000);
    const { db, rows } = fakeDb([
      { id: 1, event_id: 10, status: "running", created_at: staleTimestamp, message: "Working...", completed_at: null },
    ]);
    await reapStuckAgentRuns(db, 10);
    expect(rows[0].status).toBe("error");
    expect(rows[0].completed_at).not.toBeNull();
  });

  it("marks a stuck 'queued' row as errored too", async () => {
    const staleTimestamp = new Date(Date.now() - (STUCK_AGENT_RUN_MINUTES + 1) * 60_000);
    const { db, rows } = fakeDb([
      { id: 1, event_id: 10, status: "queued", created_at: staleTimestamp, message: "Waiting to deploy...", completed_at: null },
    ]);
    await reapStuckAgentRuns(db, 10);
    expect(rows[0].status).toBe("error");
  });

  it("leaves a fresh 'running' row untouched", async () => {
    const { db, rows } = fakeDb([
      { id: 1, event_id: 10, status: "running", created_at: new Date(), message: "Working...", completed_at: null },
    ]);
    await reapStuckAgentRuns(db, 10);
    expect(rows[0].status).toBe("running");
  });

  it("leaves already-terminal rows untouched regardless of age", () => {
    const staleTimestamp = new Date(Date.now() - (STUCK_AGENT_RUN_MINUTES + 1) * 60_000);
    return (async () => {
      const { db, rows } = fakeDb([
        { id: 1, event_id: 10, status: "complete", created_at: staleTimestamp, message: "Done", completed_at: staleTimestamp },
      ]);
      await reapStuckAgentRuns(db, 10);
      expect(rows[0].status).toBe("complete");
    })();
  });

  it("only reaps rows for the given event_id", async () => {
    const staleTimestamp = new Date(Date.now() - (STUCK_AGENT_RUN_MINUTES + 1) * 60_000);
    const { db, rows } = fakeDb([
      { id: 1, event_id: 10, status: "running", created_at: staleTimestamp, message: null, completed_at: null },
      { id: 2, event_id: 20, status: "running", created_at: staleTimestamp, message: null, completed_at: null },
    ]);
    await reapStuckAgentRuns(db, 10);
    expect(rows[0].status).toBe("error");
    expect(rows[1].status).toBe("running");
  });
});
