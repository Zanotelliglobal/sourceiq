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
  /** Baseline monthly price in EUR (used to derive weekly/yearly display prices). */
  monthlyEur: number;
  limits: TierLimits;
  /** Highlighted as the recommended tier in the UI. */
  featured?: boolean;
};

export const TIERS: Tier[] = [
  {
    key: "free",
    name: "Free",
    blurb: "Try SourceGPT with a single sourcing event.",
    monthlyEur: 0,
    limits: { eventsPerMonth: 1, wavesPerEvent: 1, suppliersPerEvent: 25, seats: 1, outreach: false, export: false, maxEventSpendUsd: 5 },
  },
  {
    key: "basic",
    name: "Basic",
    blurb: "For occasional sourcing with exports and a small team.",
    monthlyEur: 49,
    limits: { eventsPerMonth: 5, wavesPerEvent: 3, suppliersPerEvent: 150, seats: 3, outreach: false, export: true, maxEventSpendUsd: 20 },
  },
  {
    key: "growth",
    name: "Growth",
    blurb: "Live supplier outreach for growing sourcing teams.",
    monthlyEur: 89,
    limits: { eventsPerMonth: 12, wavesPerEvent: 6, suppliersPerEvent: 400, seats: 5, outreach: true, export: true, maxEventSpendUsd: 60 },
  },
  {
    key: "premium",
    name: "Premium",
    blurb: "Unlimited discovery depth plus live supplier outreach.",
    monthlyEur: 149,
    featured: true,
    limits: { eventsPerMonth: 20, wavesPerEvent: UNLIMITED, suppliersPerEvent: UNLIMITED, seats: 10, outreach: true, export: true, maxEventSpendUsd: 150 },
  },
  {
    key: "pro",
    name: "Pro",
    blurb: "Unlimited everything for high-volume procurement teams.",
    monthlyEur: 399,
    // Even "unlimited everything" keeps a (generous) hard cost ceiling per
    // event — this is a runaway-cost safety net, not a monetization gate, so
    // no tier is truly cost-unbounded on a single event.
    limits: { eventsPerMonth: UNLIMITED, wavesPerEvent: UNLIMITED, suppliersPerEvent: UNLIMITED, seats: UNLIMITED, outreach: true, export: true, maxEventSpendUsd: 400 },
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
 * Display price (EUR) for a tier at a cadence. Weekly and yearly are the amount
 * billed *per charge*; monthly is the baseline. Free is always 0.
 */
export function displayPrice(tier: Tier, cadence: Cadence): number {
  if (tier.monthlyEur === 0) return 0;
  switch (cadence) {
    case "weekly":
      // monthly ÷ ~4.33 weeks, plus the convenience premium.
      return Math.round((tier.monthlyEur / 4.33) * (1 + WEEKLY_PREMIUM));
    case "yearly":
      return Math.round(tier.monthlyEur * 12 * (1 - YEARLY_DISCOUNT));
    case "monthly":
    default:
      return tier.monthlyEur;
  }
}

export function cadenceSuffix(cadence: Cadence): string {
  return cadence === "weekly" ? "/wk" : cadence === "yearly" ? "/yr" : "/mo";
}
