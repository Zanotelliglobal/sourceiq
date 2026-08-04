import { NextRequest, NextResponse } from "next/server";
import { getOrgContext, requireRole } from "@/lib/tenant";
import { getStripe, isBillingConfigured } from "@/lib/billing";

// Opens the Stripe Billing Portal so a customer can manage/cancel their
// subscription or update payment details. Returns the portal URL for the
// client to redirect to.
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = requireRole(ctx, "admin");
  if (denied) return denied;
  if (!isBillingConfigured()) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });
  }
  if (!ctx.org.stripe_customer_id) {
    return NextResponse.json({ error: "No Stripe customer on file. Subscribe first." }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: ctx.org.stripe_customer_id,
    return_url: `${appUrl}/billing`,
  });

  return NextResponse.json({ url: session.url });
}
