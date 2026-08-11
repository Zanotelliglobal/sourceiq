import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/tenant";
import { getDb } from "@/lib/db";
import { getTierUsage } from "@/lib/usage";
import { UNLIMITED } from "@/lib/plans";

// Returns the caller's current-month consumption measured against their
// effective tier's limits — powers the dashboard token counter and usage bars.
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const usage = await getTierUsage(db, ctx.org);

  return NextResponse.json({
    tier: usage.tier.key,
    tier_name: usage.tier.name,
    limits: usage.limits,
    unlimited: UNLIMITED,
    credits_used: usage.credits_used,
    credits_remaining: usage.credits_remaining,
    bonus_credits: usage.bonus_credits,
    tokens_used: usage.tokens_used,
    cost_usd: usage.cost_usd,
  });
}
