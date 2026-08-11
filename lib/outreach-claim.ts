import { getDb } from "@/lib/db";
type Db = ReturnType<typeof getDb>;

// ─── ATOMIC SEND CLAIMS (#62) ──────────────────────────────────────────────
// send_outreach and send_followup (app/api/qualify/route.ts) both used to
// follow a read-then-draft-then-send-then-write pattern with no guard
// against two concurrent requests for the same supplier (a double-click, two
// open tabs, or a retried fetch) both passing the read and both drafting +
// sending a duplicate email before either write landed.
//
// The fix is an atomic UPDATE ... WHERE claim: only the request whose UPDATE
// actually matches a row may proceed to draft/send. The loser gets a 409.
//
// A claim is a *timestamp*, not a boolean, so a request that crashes mid-send
// (network drop, function timeout, uncaught exception before the release
// call runs) self-heals after STALE_CLAIM_MINUTES rather than permanently
// locking that supplier out of outreach — the same "don't trust a lock that
// might have been abandoned" reasoning as #67's agent_runs reaper.

/** Minutes a claim is honored before it's treated as abandoned and reclaimable. */
export const STALE_CLAIM_MINUTES = 2;

export type ClaimResult = { ok: true } | { ok: false; reason: "already_sending" };

/**
 * Atomically claim a supplier for a send_outreach call. Blocks unless the
 * supplier's outreach_status is neither 'sending' nor 'sent', or the claim
 * that set 'sending' is stale.
 */
export async function claimOutreachSend(db: Db, supplierId: number): Promise<ClaimResult> {
  const claim = await db
    .prepare(
      `UPDATE suppliers SET outreach_status='sending', outreach_claimed_at=now()
       WHERE id=? AND (
         outreach_status NOT IN ('sending','sent')
         OR outreach_claimed_at < now() - make_interval(mins => ?)
       )`
    )
    .run(supplierId, STALE_CLAIM_MINUTES);
  return claim.changes > 0 ? { ok: true } : { ok: false, reason: "already_sending" };
}

/** Roll a claimed supplier's outreach_status back so a legitimate retry isn't blocked forever. */
export async function releaseOutreachClaim(db: Db, supplierId: number, restoreStatus: string): Promise<void> {
  await db
    .prepare(`UPDATE suppliers SET outreach_status=? WHERE id=?`)
    .run(restoreStatus, supplierId)
    .catch(() => {});
}

/**
 * Atomically claim a supplier for a send_followup call. Unlike outreach_status,
 * a supplier can legitimately receive more than one follow-up over time, so
 * this only guards the concurrent-request window (via a dedicated lock
 * column), not long-term state.
 */
export async function claimFollowupSend(db: Db, supplierId: number): Promise<ClaimResult> {
  const claim = await db
    .prepare(
      `UPDATE suppliers SET followup_claimed_at=now()
       WHERE id=? AND (followup_claimed_at IS NULL OR followup_claimed_at < now() - make_interval(mins => ?))`
    )
    .run(supplierId, STALE_CLAIM_MINUTES);
  return claim.changes > 0 ? { ok: true } : { ok: false, reason: "already_sending" };
}

/** Release a follow-up claim so a future follow-up (or an immediate retry after failure) isn't blocked. */
export async function releaseFollowupClaim(db: Db, supplierId: number): Promise<void> {
  await db
    .prepare(`UPDATE suppliers SET followup_claimed_at=NULL WHERE id=?`)
    .run(supplierId)
    .catch(() => {});
}
