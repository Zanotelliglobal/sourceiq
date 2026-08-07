import { getDb, type OutreachLog } from "@/lib/db";

// ─── OUTREACH THREAD ──────────────────────────────────────────────────────────
// outreach_logs is append-only: every outbound RFI/follow-up sent by an agent
// or buyer, and every inbound reply from a supplier, is written here by
// app/api/{qualify,outreach,supplier-response,inbound}/route.ts. This module
// reads that history back as one chronological, per-supplier thread — the
// piece those write paths never surfaced to the UI.

/** Full outreach correspondence for one supplier, oldest first (thread order). */
export async function getOutreachLogForSupplier(
  supplierId: number,
  limit = 200
): Promise<OutreachLog[]> {
  const db = getDb();
  return (await db
    .prepare(
      `SELECT * FROM outreach_logs WHERE supplier_id = ?
       ORDER BY sent_at ASC, id ASC LIMIT ?`
    )
    .all(supplierId, limit)) as OutreachLog[];
}

export type OutreachThreadSummary = {
  messageCount: number;
  lastDirection: "inbound" | "outbound" | null;
  lastSentAt: string | null;
  awaitingReply: boolean;
};

/**
 * Pure summary of a thread, given its entries in ascending (oldest-first)
 * order. `awaitingReply` is true when the most recent message is outbound —
 * i.e. the supplier has not yet replied to the latest RFI or follow-up.
 */
export function summarizeOutreachThread(
  entries: Pick<OutreachLog, "direction" | "sent_at">[]
): OutreachThreadSummary {
  if (entries.length === 0) {
    return { messageCount: 0, lastDirection: null, lastSentAt: null, awaitingReply: false };
  }
  const last = entries[entries.length - 1];
  const lastDirection: "inbound" | "outbound" = last.direction === "inbound" ? "inbound" : "outbound";
  return {
    messageCount: entries.length,
    lastDirection,
    lastSentAt: last.sent_at,
    awaitingReply: lastDirection === "outbound",
  };
}
