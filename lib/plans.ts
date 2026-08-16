// ─── PLAN CATALOG ─────────────────────────────────────────────────────────────
// Single source of truth for pricing tiers, billing cadences, and per-tier
// limits. The billing UI, the checkout route, and the access-gate/usage-metering
// logic all read from here so tiers stay consistent across the app.
//
// Stripe prices are NOT hard-coded — each (tier × cadence) resolves to an env var
// holding the Stripe price id, e.g. STRIPE_PRICE_BASIC_MONTHLY. Create the 12 paid
// prices in your Stripe dashboard and set the matching env vars. Missing env vars
// simply hide that option (the tier can't be checked out until its price exists).

export type TierKey = "free" | "basic" | "growth" | "premium" | "pro";
export type Cadence = "weekly" | "monthly" | "yearly";

// Numeric limits use -1 to mean "unlimited".
export const UNLIMITED = -1;

export type TierLimits = {
  eventsPerMonth: number;
  wavesPerEvent: number;
  suppliersPerEvent: number;
  seats: number;
  outreach: boolean;
  export: boolean;
  /**
   * Hard per-event ceiling (USD) on cumulative AI/agent spend (see
   * token_usage.cost_usd in lib/usage.ts). Unlike the other limits above,
   * this caps a dollar amount rather than a count, so a single event can
   * never run away on cost even on an otherwise-unlimited tier. UNLIMITED =
   * no cap.
   */
  maxEventSpendUsd: number;
};

export type Tier = {
  key: TierKey;
  name: string;
  blurb: string;
  /** Baseline monthly price in USD (used to derive weekly/yearly display prices). */
  monthlyUsd: number;
  /**
   * True only for the "Contact us" Enterprise tier. `monthlyUsd` is a distinct
   * discriminator from a numeric zero price because `displayPrice()` and both
   * UI render sites already special-case `price === 0` to mean "Free" — reusing
   * that branch for Enterprise would render it as "Free" instead of "Contact
   * us" in production (see the Enterprise TIERS entry below).
   */
  contactSales?: boolean;
  limits: TierLimits;
  /** Highlighted as the recommended tier in the UI. */
  featured?: boolean;
};

export const TIERS: Tier[] = [
  {
    key: "free",
    name: "Free",
    blurb: "Try SourceGPT with a single sourcing event.",
    monthlyUsd: 0,
    limits: { eventsPerMonth: 1, wavesPerEvent: 1, suppliersPerEvent: 25, seats: 1, outreach: false, export: false, maxEventSpendUsd: 5 },
  },
  {
    key: "basic",
    name: "Basic",
    blurb: "For sourcing teams ready to run live supplier outreach.",
    monthlyUsd: 1450,
    // Outreach is granted starting at Basic rather than gated behind Growth:
    // at a $1,450/month price point, gating a core capability behind a second
    // $2,500/month tier is inconsistent with typical enterprise-SaaS
    // packaging at this price band, where the base tier is already
    // fully-featured and differentiation is volume/seat-based, not
    // capability-based (RESEARCH.md Assumption A2).
    limits: { eventsPerMonth: 15, wavesPerEvent: 5, suppliersPerEvent: 300, seats: 5, outreach: true, export: true, maxEventSpendUsd: 100 },
  },
  {
    key: "growth",
    name: "Growth",
    blurb: "Higher-volume sourcing and outreach for growing teams.",
    monthlyUsd: 2500, // 2500 / 1450 ≈ 1.72x step-up from Basic (PRICE-02)
    featured: true,
    limits: { eventsPerMonth: 30, wavesPerEvent: 10, suppliersPerEvent: 600, seats: 15, outreach: true, export: true, maxEventSpendUsd: 250 },
  },
  {
    key: "premium",
    name: "Premium",
    blurb: "Unlimited discovery depth plus live supplier outreach.",
    monthlyUsd: 4500, // 4500 / 2500 = 1.8x step-up from Growth (PRICE-02)
    limits: { eventsPerMonth: UNLIMITED, wavesPerEvent: UNLIMITED, suppliersPerEvent: UNLIMITED, seats: UNLIMITED, outreach: true, export: true, maxEventSpendUsd: 750 },
  },
  {
    key: "pro",
    name: "Enterprise",
    blurb: "Custom volume, seats, and terms for high-volume procurement teams.",
    contactSales: true,
    monthlyUsd: 0, // unused when contactSales is true — see Tier.contactSales doc above
    // Even "unlimited everything" keeps a (generous) hard cost ceiling per
    // event — this is a runaway-cost safety net, not a monetization gate, so
    // no tier is truly cost-unbounded on a single event.
    limits: { eventsPerMonth: UNLIMITED, wavesPerEvent: UNLIMITED, suppliersPerEvent: UNLIMITED, seats: UNLIMITED, outreach: true, export: true, maxEventSpendUsd: 1000 },
  },
];

// Cadence multipliers applied to the baseline monthly price for display.
// Yearly bills 12 months at a 20% discount; weekly carries a 25% convenience premium.
export const CADENCES: { key: Cadence; label: string; note: string }[] = [
  { key: "weekly", label: "Weekly", note: "+25%" },
  { key: "monthly", label: "Monthly", note: "" },
  { key: "yearly", label: "Yearly", note: "Save 20%" },
];

export const YEARLY_DISCOUNT = 0.2;
export const WEEKLY_PREMIUM = 0.25;

export function getTier(key: string): Tier | undefined {
  return TIERS.find(t => t.key === key);
}

/** Env var holding the Stripe price id for a (tier × cadence). */
export function priceEnvVar(tier: TierKey, cadence: Cadence): string {
  return `STRIPE_PRICE_${tier.toUpperCase()}_${cadence.toUpperCase()}`;
}

/** Resolve the configured Stripe price id, or null if not set (server-only). */
export function priceIdFor(tier: TierKey, cadence: Cadence): string | null {
  return process.env[priceEnvVar(tier, cadence)] || null;
}

/**
 * Display price (USD) for a tier at a cadence. Weekly and yearly are the amount
 * billed *per charge*; monthly is the baseline. Free is always 0, and so is
 * any "Contact us" (contactSales) tier — neither has a numeric price to show.
 */
export function displayPrice(tier: Tier, cadence: Cadence): number {
  if (tier.contactSales === true) return 0;
  if (tier.monthlyUsd === 0) return 0;
  switch (cadence) {
    case "weekly":
      // monthly ÷ ~4.33 weeks, plus the convenience premium.
      return Math.round((tier.monthlyUsd / 4.33) * (1 + WEEKLY_PREMIUM));
    case "yearly":
      return Math.round(tier.monthlyUsd * 12 * (1 - YEARLY_DISCOUNT));
    case "monthly":
    default:
      return tier.monthlyUsd;
  }
}

export function cadenceSuffix(cadence: Cadence): string {
  return cadence === "weekly" ? "/wk" : cadence === "yearly" ? "/yr" : "/mo";
}
