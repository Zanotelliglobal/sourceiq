import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { getStripe, isBillingConfigured } from "@/lib/billing";

// Stripe webhook — the single source of truth for subscription state.
// Stripe POSTs signed events here; we verify the signature, then mirror the
// subscription's status/plan onto the owning organizations row.
//
// This route is intentionally PUBLIC (see middleware) — Stripe authenticates
// via the signature header, not the app session.
export const dynamic = "force-dynamic";

// Map a Stripe subscription onto our org, keyed first by metadata.org_id
// (stamped at checkout) and falling back to the stored stripe_customer_id.
async function syncSubscription(sub: Stripe.Subscription) {
  const db = getDb();
  const orgId = sub.metadata?.org_id ? Number(sub.metadata.org_id) : null;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

  const status = sub.status; // active | trialing | past_due | canceled | ...
  // "canceled"/"unpaid"/"incomplete_expired" all revoke access via the gate.
  const plan = status === "canceled" ? "trial" : "pro";

  const set = `subscription_status = ?, plan = ?, stripe_subscription_id = ?, stripe_customer_id = COALESCE(stripe_customer_id, ?), updated_at = now()`;

  if (orgId) {
    await db.prepare(`UPDATE organizations SET ${set} WHERE id = ?`)
      .run(status, plan, sub.id, customerId ?? null, orgId);
  } else if (customerId) {
    await db.prepare(`UPDATE organizations SET ${set} WHERE stripe_customer_id = ?`)
      .run(status, plan, sub.id, customerId, customerId);
  }
}

export async function POST(req: NextRequest) {
  if (!isBillingConfigured()) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  const stripe = getStripe();
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  // Signature verification requires the raw, unparsed body.
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    return NextResponse.json({ error: `Signature verification failed: ${String(err)}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId = session.metadata?.org_id ? Number(session.metadata.org_id) : null;
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        // Fetch the full subscription so we record the authoritative status.
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          if (orgId && !sub.metadata?.org_id) {
            // Ensure future subscription.* events can find the org.
            await stripe.subscriptions.update(subId, { metadata: { org_id: String(orgId) } });
            sub.metadata = { ...sub.metadata, org_id: String(orgId) };
          }
          await syncSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      default:
        // Ignore unrelated event types.
        break;
    }
  } catch (err) {
    return NextResponse.json({ error: `Handler failed: ${String(err)}` }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
