import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getOrgContext, requireRole } from "@/lib/tenant";
import { getStripe, isBillingConfigured, resolvePriceId } from "@/lib/billing";
import { getTier, type Cadence, type TierKey } from "@/lib/plans";
import { rateLimit } from "@/lib/ratelimit";

const CADENCES = new Set<Cadence>(["weekly", "monthly", "yearly"]);

// Starts a Stripe Checkout session for the caller's org and returns the URL.
// The client redirects the browser to `url`. On success/cancel Stripe sends the
// user back to the app; the subscription state is confirmed by the webhook.
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Billing is an admin/owner action — members can't start a subscription.
  const denied = requireRole(ctx, "admin");
  if (denied) return denied;
  if (!isBillingConfigured()) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });
  }

  // Throttle checkout starts per org to blunt abuse / accidental loops.
  const rl = await rateLimit("checkout", String(ctx.orgId), 10, 60);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // Resolve the selected tier × cadence from the request body. Default to the
  // Pro/monthly slot (which also covers the legacy single-price deployment).
  const body = (await req.json().catch(() => ({}))) as { tier?: string; cadence?: string };
  const tierKey = (body.tier || "pro") as TierKey;
  const cadence = (body.cadence || "monthly") as Cadence;

  const tier = getTier(tierKey);
  // "Contact us" (Enterprise) has no listed price and must never be
  // self-serve-checkoutable — a crafted { tier: "pro" } request would
  // otherwise try to purchase Enterprise via Stripe (threat T-02-01).
  if (!tier || tierKey === "free" || tier.contactSales === true) {
    return NextResponse.json({ error: "Invalid plan selected" }, { status: 400 });
  }
  if (!CADENCES.has(cadence)) {
    return NextResponse.json({ error: "Invalid billing cadence" }, { status: 400 });
  }

  const priceId = resolvePriceId(tierKey, cadence);
  if (!priceId) {
    return NextResponse.json(
      { error: `This plan is not available yet (missing price for ${tierKey}/${cadence}).` },
      { status: 503 },
    );
  }
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
    // Free trial is granted ONLY on the Basic tier's Stripe checkout (PRICE-03,
    // D-05) — the discriminator is tierKey === "basic" specifically, not any
    // broader "not contactSales"/"not featured" condition, so Growth/Premium
    // never pick up a trial by accident. This is a second, independently-timed
    // trial layered on top of the existing app-level trial_ends_at mechanism
    // (lib/tenant.ts) — that mechanism is intentionally left untouched; see
    // 02-RESEARCH.md Open Question 1.
    const isBasicTrial = tierKey === "basic";
    return stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price: priceId!, quantity: 1 }],
      // The webhook is the source of truth; metadata lets it find our org row
      // and record which tier/cadence was purchased.
      subscription_data: {
        metadata: { org_id: String(ctx!.orgId), tier: tierKey, cadence },
        ...(isBasicTrial
          ? {
              trial_period_days: 14,
              // Cardless trial (matches the existing "14-day free trial, no
              // credit card required" hero copy in app/page.tsx's jsonLd):
              // if the trial ends with no payment method on file, cancel
              // rather than silently attempt to invoice.
              trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
            }
          : {}),
      },
      // payment_method_collection is a top-level Session field, NOT nested
      // under subscription_data (verified against Stripe.Checkout.
      // SessionCreateParams in node_modules/stripe's TS types per Assumption
      // A3). "if_required" lets Checkout skip card collection when the
      // session total is $0 due to the trial above.
      ...(isBasicTrial ? { payment_method_collection: "if_required" as const } : {}),
      metadata: { org_id: String(ctx!.orgId), tier: tierKey, cadence },
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
