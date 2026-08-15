import Stripe from "stripe";
import type { Organization } from "@/lib/db";
import { TIERS, CADENCES, priceIdFor, type TierKey, type Cadence } from "@/lib/plans";

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

// Any configured Stripe price (per-tier env var, or the legacy single-price
// STRIPE_PRICE_ID) means billing is live.
export function isBillingConfigured(): boolean {
  if (!process.env.STRIPE_SECRET_KEY) return false;
  if (process.env.STRIPE_PRICE_ID) return true; // legacy single-tier fallback
  for (const tier of TIERS) {
    for (const { key: cadence } of CADENCES) {
      if (priceIdFor(tier.key, cadence)) return true;
    }
  }
  return false;
}

/**
 * Resolve the Stripe price id for a (tier × cadence). Falls back to the legacy
 * STRIPE_PRICE_ID for the Pro/monthly slot so existing deployments keep working
 * until the new per-tier prices are set.
 */
export function resolvePriceId(tier: TierKey, cadence: Cadence): string | null {
  const configured = priceIdFor(tier, cadence);
  if (configured) return configured;
  if (tier === "pro" && cadence === "monthly" && process.env.STRIPE_PRICE_ID) {
    return process.env.STRIPE_PRICE_ID;
  }
  return null;
}

// Subscription statuses that grant access to the app in general (viewing,
// editing, creating events). Deliberately includes `past_due` — a grace
// period while Stripe retries a failed card, so the org isn't locked out of
// its own data.
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

// Subscription statuses that grant access to actions that trigger NEW paid
// LLM spend (discovery waves, outreach sends, follow-ups, Quick Scan).
// Deliberately excludes `past_due` — unlike general access, we should not let
// an org whose card has already failed keep running up real Anthropic-API
// cost indefinitely while Stripe retries. `past_due` orgs can still view/edit
// everything (see ACTIVE_STATUSES above); they just can't start new paid work
// until the card is fixed and the subscription returns to `active`.
const SPEND_GATED_STATUSES = new Set(["active", "trialing"]);

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

/**
 * Stricter gate for anything that triggers NEW LLM spend (discovery waves,
 * Quick Scan, outreach sends, follow-ups). Unlike `requireActiveSubscription`,
 * a `past_due` subscription does NOT pass this gate — a customer whose card
 * has failed should not be able to keep spending indefinitely while Stripe
 * retries billing. They can still read/browse existing data via the general
 * gate above; this only blocks *new* cost-incurring actions.
 */
export function requireSpendableSubscription(org: Organization): GateResult {
  if (!isBillingConfigured()) return { ok: true }; // dev / not-yet-monetized

  if (SPEND_GATED_STATUSES.has(org.subscription_status)) return { ok: true };

  if (org.trial_ends_at && new Date(org.trial_ends_at).getTime() > Date.now()) {
    return { ok: true };
  }

  if (org.subscription_status === "past_due") {
    return {
      ok: false,
      reason: "Your last payment failed. Update your billing details to resume running sourcing events.",
    };
  }

  return {
    ok: false,
    reason: "Your trial has ended. Subscribe to continue running sourcing events.",
  };
}
