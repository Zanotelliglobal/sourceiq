import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/tenant";
import { isBillingConfigured, requireActiveSubscription, resolvePriceId } from "@/lib/billing";
import { TIERS, CADENCES } from "@/lib/plans";

// Returns the caller's billing snapshot for the /billing page, including which
// (tier × cadence) slots actually have a Stripe price configured so the UI can
// disable options that aren't purchasable yet.
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = requireActiveSubscription(ctx.org);

  const available: Record<string, boolean> = {};
  for (const tier of TIERS) {
    if (tier.key === "free") continue;
    for (const { key: cadence } of CADENCES) {
      available[`${tier.key}_${cadence}`] = !!resolvePriceId(tier.key, cadence);
    }
  }

  return NextResponse.json({
    configured: isBillingConfigured(),
    plan: ctx.org.plan,
    status: ctx.org.subscription_status,
    trial_ends_at: ctx.org.trial_ends_at,
    has_customer: !!ctx.org.stripe_customer_id,
    active: gate.ok,
    reason: gate.ok ? null : gate.reason,
    available,
  });
}
