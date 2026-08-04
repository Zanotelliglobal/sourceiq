import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/tenant";
import { referralStats, REFERRAL_BONUS_EVENTS } from "@/lib/referrals";

// Referral summary for the current org's /settings card: the shareable code +
// link, how many orgs it referred, how many converted, and bonus events earned.
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const stats = await referralStats(ctx.org);
  const base = process.env.NEXT_PUBLIC_APP_URL || "";
  const link = stats.code && base ? `${base.replace(/\/$/, "")}/?ref=${stats.code}` : null;

  return NextResponse.json({
    ...stats,
    link,
    bonus_per_conversion: REFERRAL_BONUS_EVENTS,
  });
}
