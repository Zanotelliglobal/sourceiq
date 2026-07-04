import Stripe from "stripe";
import type { Organization } from "@/lib/db";

// ─── BILLING (Stripe) ─────────────────────────────────────────────────────────
// Flat subscription tiers. An org may create/run sourcing work only while it is
// on an active paid subscription OR inside its free trial window. The Stripe
// webhook keeps organizations.subscription_status / plan in sync.

let stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    // Use the SDK's pinned API version (do not override).
    stripe = new Stripe(key);
  }
  return stripe;
}

export function isBillingConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_PRICE_ID;
}

// Plans exposed to customers. Extend as you add tiers.
export type Plan = {
  key: string;
  name: string;
  priceEnv: string;      // env var holding the Stripe price id
  blurb: string;
};

export const PLANS: Plan[] = [
  {
    key: "pro",
    name: "Pro",
    priceEnv: "STRIPE_PRICE_ID",
    blurb: "Unlimited sourcing events, multi-wave discovery, and live outreach.",
  },
];

// Subscription statuses that grant access.
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export type GateResult = { ok: true } | { ok: false; reason: string };

/**
 * Whether an org may perform paid actions (create events, run agents).
 * Access is granted when:
 *   • billing is not configured yet (local/dev — don't block ourselves), OR
 *   • the Stripe subscription is active/trialing/past_due, OR
 *   • the org is still inside its free-trial window.
 */
export function requireActiveSubscription(org: Organization): GateResult {
  if (!isBillingConfigured()) return { ok: true }; // dev / not-yet-monetized

  if (ACTIVE_STATUSES.has(org.subscription_status)) return { ok: true };

  if (org.trial_ends_at && new Date(org.trial_ends_at).getTime() > Date.now()) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: "Your trial has ended. Subscribe to continue running sourcing events.",
  };
}
