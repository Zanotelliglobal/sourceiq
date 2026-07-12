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

  // Create a fresh Stripe customer for this org and persist its id.
  async function newCustomer(): Promise<string> {
    const customer = await stripe.customers.create({
      name: ctx!.org.name,
      metadata: { org_id: String(ctx!.orgId), clerk_org_key: ctx!.clerkOrgKey },
    });
    await db.prepare("UPDATE organizations SET stripe_customer_id=? WHERE id=?").run(customer.id, ctx!.orgId);
    return customer.id;
  }

  // Reuse an existing Stripe customer for this org, or create one.
  let customerId = ctx.org.stripe_customer_id || (await newCustomer());

  async function createSession(customer: string) {
    return stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price: priceId, quantity: 1 }],
      // The webhook is the source of truth; metadata lets it find our org row.
      subscription_data: { metadata: { org_id: String(ctx!.orgId) } },
      metadata: { org_id: String(ctx!.orgId) },
      success_url: `${appUrl}/dashboard?checkout=success`,
      cancel_url: `${appUrl}/billing?checkout=cancelled`,
      allow_promotion_codes: true,
    });
  }

  try {
    let session;
    try {
      session = await createSession(customerId);
    } catch (err) {
      // A stored customer id can be stale — e.g. created under a different Stripe
      // mode (test↔live) or deleted. Recover once by minting a fresh customer.
      const type = (err as { type?: string })?.type;
      if (type === "StripeInvalidRequestError") {
        customerId = await newCustomer();
        session = await createSession(customerId);
      } else {
        throw err;
      }
    }
    return NextResponse.json({ url: session.url });
  } catch (err) {
    // Surface a clean Stripe message to the client instead of a raw 500.
    const message = err instanceof Error ? err.message : "Checkout could not be started";
    console.error("[stripe/checkout] failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
