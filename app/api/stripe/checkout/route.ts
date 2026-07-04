import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getOrgContext } from "@/lib/tenant";
import { getStripe, isBillingConfigured } from "@/lib/billing";

// Starts a Stripe Checkout session for the caller's org and returns the URL.
// The client redirects the browser to `url`. On success/cancel Stripe sends the
// user back to the app; the subscription state is confirmed by the webhook.
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isBillingConfigured()) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });
  }

  const priceId = process.env.STRIPE_PRICE_ID!;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const stripe = getStripe();
  const db = getDb();

  // Reuse an existing Stripe customer for this org, or create one.
  let customerId = ctx.org.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: ctx.org.name,
      metadata: { org_id: String(ctx.orgId), clerk_org_key: ctx.clerkOrgKey },
    });
    customerId = customer.id;
    await db.prepare("UPDATE organizations SET stripe_customer_id=? WHERE id=?").run(customerId, ctx.orgId);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    // The webhook is the source of truth; metadata lets it find our org row.
    subscription_data: { metadata: { org_id: String(ctx.orgId) } },
    metadata: { org_id: String(ctx.orgId) },
    success_url: `${appUrl}/dashboard?checkout=success`,
    cancel_url: `${appUrl}/billing?checkout=cancelled`,
    allow_promotion_codes: true,
  });

  return NextResponse.json({ url: session.url });
}
