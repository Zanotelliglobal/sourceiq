import { describe, it, expect } from "vitest";
import {
  claimOutreachSend,
  releaseOutreachClaim,
  claimFollowupSend,
  releaseFollowupClaim,
  STALE_CLAIM_MINUTES,
} from "@/lib/outreach-claim";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

// ─── Fakes ──────────────────────────────────────────────────────────────────
// No mocking framework in this repo (see tests/usage.test.ts, tests/process-supplier.test.ts)
// — build a minimal typed stub directly instead. Understands just the handful
// of UPDATE shapes lib/outreach-claim.ts issues, simulating the same
// claim/staleness semantics Postgres would apply.

type Row = {
  id: number;
  outreach_status: string;
  outreach_claimed_at: Date | null;
  followup_claimed_at: Date | null;
};

function fakeDb(initial: Row[]) {
  const rows: Row[] = initial.map((r) => ({ ...r }));
  const find = (id: number) => rows.find((r) => r.id === id);
  const isStale = (claimedAt: Date | null, staleMinutes: number) =>
    claimedAt !== null && Date.now() - claimedAt.getTime() > staleMinutes * 60_000;

  const db = {
    prepare(sql: string) {
      return {
        async run(...params: unknown[]) {
          if (/UPDATE suppliers SET outreach_status='sending'/.test(sql)) {
            const [id, staleMinutes] = params as [number, number];
            const row = find(id);
            if (!row) return { changes: 0, lastInsertRowid: undefined };
            const claimable =
              !["sending", "sent"].includes(row.outreach_status) ||
              isStale(row.outreach_claimed_at, staleMinutes);
            if (!claimable) return { changes: 0, lastInsertRowid: undefined };
            row.outreach_status = "sending";
            row.outreach_claimed_at = new Date();
            return { changes: 1, lastInsertRowid: undefined };
          }
          if (/UPDATE suppliers SET outreach_status=\? WHERE id=\?/.test(sql)) {
            const [status, id] = params as [string, number];
            const row = find(id);
            if (row) row.outreach_status = status;
            return { changes: row ? 1 : 0, lastInsertRowid: undefined };
          }
          if (/UPDATE suppliers SET followup_claimed_at=now\(\)/.test(sql)) {
            const [id, staleMinutes] = params as [number, number];
            const row = find(id);
            if (!row) return { changes: 0, lastInsertRowid: undefined };
            const claimable = row.followup_claimed_at === null || isStale(row.followup_claimed_at, staleMinutes);
            if (!claimable) return { changes: 0, lastInsertRowid: undefined };
            row.followup_claimed_at = new Date();
            return { changes: 1, lastInsertRowid: undefined };
          }
          if (/UPDATE suppliers SET followup_claimed_at=NULL WHERE id=\?/.test(sql)) {
            const [id] = params as [number];
            const row = find(id);
            if (row) row.followup_claimed_at = null;
            return { changes: row ? 1 : 0, lastInsertRowid: undefined };
          }
          throw new Error(`fakeDb: unhandled SQL shape: ${sql}`);
        },
        async get() {
          throw new Error("fakeDb: get() not needed by outreach-claim tests");
        },
        async all() {
          throw new Error("fakeDb: all() not needed by outreach-claim tests");
        },
      };
    },
  };
  return { db: db as unknown as Db, rows };
}

describe("claimOutreachSend / releaseOutreachClaim (#62)", () => {
  it("claims a pending supplier and blocks a concurrent second claim", async () => {
    const { db } = fakeDb([{ id: 1, outreach_status: "pending", outreach_claimed_at: null, followup_claimed_at: null }]);
    const first = await claimOutreachSend(db, 1);
    expect(first.ok).toBe(true);
    const second = await claimOutreachSend(db, 1);
    expect(second.ok).toBe(false);
  });

  it("blocks claiming an already-sent supplier", async () => {
    const { db } = fakeDb([{ id: 1, outreach_status: "sent", outreach_claimed_at: null, followup_claimed_at: null }]);
    const claim = await claimOutreachSend(db, 1);
    expect(claim.ok).toBe(false);
  });

  it("releaseOutreachClaim restores the pre-claim status so a retry can re-claim", async () => {
    const { db, rows } = fakeDb([{ id: 1, outreach_status: "declined", outreach_claimed_at: null, followup_claimed_at: null }]);
    await claimOutreachSend(db, 1);
    expect(rows[0].outreach_status).toBe("sending");
    await releaseOutreachClaim(db, 1, "declined");
    expect(rows[0].outreach_status).toBe("declined");
    const retry = await claimOutreachSend(db, 1);
    expect(retry.ok).toBe(true);
  });

  it("allows reclaiming a stale 'sending' claim left by a crashed request", async () => {
    const staleTimestamp = new Date(Date.now() - (STALE_CLAIM_MINUTES + 1) * 60_000);
    const { db } = fakeDb([{ id: 1, outreach_status: "sending", outreach_claimed_at: staleTimestamp, followup_claimed_at: null }]);
    const claim = await claimOutreachSend(db, 1);
    expect(claim.ok).toBe(true);
  });

  it("blocks reclaiming a fresh 'sending' claim", async () => {
    const { db } = fakeDb([{ id: 1, outreach_status: "sending", outreach_claimed_at: new Date(), followup_claimed_at: null }]);
    const claim = await claimOutreachSend(db, 1);
    expect(claim.ok).toBe(false);
  });
});

describe("claimFollowupSend / releaseFollowupClaim (#62)", () => {
  it("claims an unlocked supplier and blocks a concurrent second claim", async () => {
    const { db } = fakeDb([{ id: 1, outreach_status: "sent", outreach_claimed_at: null, followup_claimed_at: null }]);
    const first = await claimFollowupSend(db, 1);
    expect(first.ok).toBe(true);
    const second = await claimFollowupSend(db, 1);
    expect(second.ok).toBe(false);
  });

  it("releaseFollowupClaim frees the lock so a later follow-up can be claimed again", async () => {
    const { db, rows } = fakeDb([{ id: 1, outreach_status: "sent", outreach_claimed_at: null, followup_claimed_at: null }]);
    await claimFollowupSend(db, 1);
    await releaseFollowupClaim(db, 1);
    expect(rows[0].followup_claimed_at).toBeNull();
    const retry = await claimFollowupSend(db, 1);
    expect(retry.ok).toBe(true);
  });

  it("allows reclaiming a stale follow-up lock left by a crashed request", async () => {
    const staleTimestamp = new Date(Date.now() - (STALE_CLAIM_MINUTES + 1) * 60_000);
    const { db } = fakeDb([{ id: 1, outreach_status: "sent", outreach_claimed_at: null, followup_claimed_at: staleTimestamp }]);
    const claim = await claimFollowupSend(db, 1);
    expect(claim.ok).toBe(true);
  });
});
