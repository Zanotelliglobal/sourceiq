import { getDb } from "@/lib/db";

// ─── ORG-WIDE SUPPRESSION LIST (#98) ────────────────────────────────────────
// suppliers.opted_out (added for the unsubscribe flow) suppresses a single
// supplier ROW within the event it belongs to. That's enough to stop a
// duplicate send mid-campaign, but it does NOT survive across sourcing
// events: the same company's contact email re-appears as a brand-new
// `suppliers` row (opted_out defaults false) the next time this org scouts a
// similar category, silently re-contacting someone who already said stop.
//
// This table is the durable fix: keyed by (org_id, normalized email), it is
// checked whenever a new outreach batch is assembled — REGARDLESS of which
// supplier row/event the email is attached to — so an opt-out or an erasure
// request (#99) is honored for the lifetime of the org's relationship with
// that contact, not just the campaign where it was recorded.

type Db = ReturnType<typeof getDb>;

export function normalizeEmail(email: string | null | undefined): string {
  return (email || "").trim().toLowerCase();
}

/** Add an email to the org's durable do-not-contact list. Idempotent — a
 *  second suppression of the same (org, email) pair is a no-op. */
export async function suppressEmail(db: Db, orgId: number, email: string | null | undefined, reason: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  await db
    .prepare(
      `INSERT INTO suppression_list (org_id, email, reason) VALUES (?, ?, ?)
       ON CONFLICT (org_id, email) DO NOTHING`
    )
    .run(orgId, normalized, reason);
}

/** Whether this org has already been asked not to contact this address. */
export async function isSuppressed(db: Db, orgId: number, email: string | null | undefined): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const row = await db
    .prepare(`SELECT 1 AS found FROM suppression_list WHERE org_id=? AND email=?`)
    .get(orgId, normalized);
  return !!row;
}
