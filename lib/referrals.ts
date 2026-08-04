// ─── REFERRALS ────────────────────────────────────────────────────────────────
// A lightweight growth loop. Every org gets a shareable referral code. When a
// new org is created off a referral link, we attribute it to the referrer (one
// attribution per org, self-referral blocked). When that referred org converts
// to a paid subscription, both parties earn bonus event credits.
//
// All functions are best-effort and swallow their own errors — referral
// bookkeeping must never break signup, org creation, or the billing webhook.

import { getDb, type Organization } from "@/lib/db";

// Bonus events granted to BOTH the referrer and the referred org when a referral
// converts (referred org subscribes). Added on top of the plan's monthly limit.
export const REFERRAL_BONUS_EVENTS = 3;

// Human-friendly code: uppercase, no ambiguous chars (0/O, 1/I/L), 7 chars.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randomCode(len = 7): string {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

// Assign a referral code to an org if it doesn't have one yet, returning the
// current (or newly minted) code. Retries on the rare unique-collision.
export async function ensureReferralCode(org: Pick<Organization, "id" | "referral_code">): Promise<string | null> {
  if (org.referral_code) return org.referral_code;
  const db = getDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      const res = await db
        .prepare(
          `UPDATE organizations SET referral_code = ?, updated_at = now()
           WHERE id = ? AND referral_code IS NULL`
        )
        .run(code, org.id);
      if (res.changes > 0) return code;
      // Someone else set it concurrently — read it back.
      const row = (await db
        .prepare("SELECT referral_code FROM organizations WHERE id = ?")
        .get(org.id)) as { referral_code: string | null } | undefined;
      if (row?.referral_code) return row.referral_code;
    } catch {
      // Unique collision on the code — try another.
    }
  }
  return null;
}

// Attribute a freshly-created org to the referrer identified by `code`.
// Enforces: valid code, no self-referral, and one attribution per org (the
// UNIQUE referred_org_id plus the referred_by IS NULL guard).
export async function attributeReferral(newOrgId: number, code: string | null | undefined): Promise<void> {
  const clean = (code || "").trim().toUpperCase();
  if (!clean) return;
  try {
    const db = getDb();
    const referrer = (await db
      .prepare("SELECT id FROM organizations WHERE referral_code = ?")
      .get(clean)) as { id: number } | undefined;
    if (!referrer) return;
    if (Number(referrer.id) === Number(newOrgId)) return; // self-referral blocked

    // One attribution per org: only set referred_by if not already attributed.
    const upd = await db
      .prepare(
        `UPDATE organizations SET referred_by = ?, updated_at = now()
         WHERE id = ? AND referred_by IS NULL`
      )
      .run(referrer.id, newOrgId);
    if (upd.changes === 0) return; // already attributed

    await db
      .prepare(
        `INSERT INTO referrals (referrer_org_id, referred_org_id, code)
         VALUES (?, ?, ?)
         ON CONFLICT (referred_org_id) DO NOTHING`
      )
      .run(referrer.id, newOrgId, clean);
  } catch {
    /* best-effort — never block org creation */
  }
}

// Convert a pending referral for the referred org into a reward: mark it
// rewarded and grant bonus events to both parties. Idempotent — only a single
// pending row transitions, so repeated webhook deliveries won't double-reward.
export async function rewardReferral(referredOrgId: number): Promise<void> {
  try {
    const db = getDb();
    const ref = (await db
      .prepare(
        `UPDATE referrals
            SET status = 'rewarded', rewarded_at = now(), reward_events = ?
          WHERE referred_org_id = ? AND status = 'pending'
          RETURNING referrer_org_id, referred_org_id`
      )
      .get(REFERRAL_BONUS_EVENTS, referredOrgId)) as
      | { referrer_org_id: number; referred_org_id: number }
      | undefined;
    if (!ref) return; // no pending referral, or already rewarded

    await db
      .prepare("UPDATE organizations SET bonus_events = bonus_events + ?, updated_at = now() WHERE id IN (?, ?)")
      .run(REFERRAL_BONUS_EVENTS, ref.referrer_org_id, ref.referred_org_id);
  } catch {
    /* best-effort — never break the billing webhook */
  }
}

export type ReferralStats = {
  code: string | null;
  referred_count: number;
  rewarded_count: number;
  bonus_events: number;
};

// Referral summary for an org (for the /settings referral card).
export async function referralStats(org: Organization): Promise<ReferralStats> {
  const db = getDb();
  const code = await ensureReferralCode(org);
  const row = (await db
    .prepare(
      `SELECT
         COUNT(*)::int                                          AS referred,
         COUNT(*) FILTER (WHERE status = 'rewarded')::int       AS rewarded
       FROM referrals WHERE referrer_org_id = ?`
    )
    .get(org.id)) as { referred: number; rewarded: number } | undefined;
  return {
    code,
    referred_count: Number(row?.referred ?? 0),
    rewarded_count: Number(row?.rewarded ?? 0),
    bonus_events: Number(org.bonus_events ?? 0),
  };
}
