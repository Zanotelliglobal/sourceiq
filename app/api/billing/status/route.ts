import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/tenant";
import { isBillingConfigured, requireActiveSubscription } from "@/lib/billing";

// Returns the caller's billing snapshot for the /billing page.
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = requireActiveSubscription(ctx.org);
  return NextResponse.json({
    configured: isBillingConfigured(),
    plan: ctx.org.plan,
    status: ctx.org.subscription_status,
    trial_ends_at: ctx.org.trial_ends_at,
    has_customer: !!ctx.org.stripe_customer_id,
    active: gate.ok,
    reason: gate.ok ? null : gate.reason,
  });
}
