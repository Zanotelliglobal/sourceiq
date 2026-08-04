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
    events_this_month: usage.events_this_month,
    events_remaining: usage.events_remaining,
    tokens_used: usage.tokens_used,
    cost_usd: usage.cost_usd,
  });
}
