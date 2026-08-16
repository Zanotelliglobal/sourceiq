import { describe, it, expect } from "vitest";
import {
  TIERS,
  getTier,
  priceEnvVar,
  priceIdFor,
  displayPrice,
  cadenceSuffix,
  UNLIMITED,
  YEARLY_DISCOUNT,
  WEEKLY_PREMIUM,
  type Tier,
} from "@/lib/plans";
import { effectiveTier } from "@/lib/usage";
import type { Organization } from "@/lib/db";

describe("getTier", () => {
  it("resolves each known tier key", () => {
    for (const key of ["free", "basic", "growth", "premium", "pro"] as const) {
      expect(getTier(key)?.key).toBe(key);
    }
  });

  it("returns undefined for unknown keys", () => {
    expect(getTier("enterprise")).toBeUndefined();
    expect(getTier("")).toBeUndefined();
    expect(getTier("trial")).toBeUndefined();
  });
});

describe("tier limits", () => {
  it("free tier forbids export and outreach", () => {
    const free = getTier("free")!;
    expect(free.limits.export).toBe(false);
    expect(free.limits.outreach).toBe(false);
    expect(free.limits.eventsPerMonth).toBe(1);
  });

  it("paid tiers allow export", () => {
    for (const key of ["basic", "growth", "premium", "pro"] as const) {
      expect(getTier(key)!.limits.export).toBe(true);
    }
  });

  it("pro is unlimited across numeric limits", () => {
    const pro = getTier("pro")!;
    expect(pro.limits.eventsPerMonth).toBe(UNLIMITED);
    expect(pro.limits.seats).toBe(UNLIMITED);
    expect(pro.limits.suppliersPerEvent).toBe(UNLIMITED);
  });

  it("every tier carries a finite hard per-event spend ceiling, even Pro (#65)", () => {
    // Deliberately NOT UNLIMITED anywhere — the ceiling is a runaway-cost
    // safety net, not a monetization gate, so no tier is cost-unbounded.
    for (const key of ["free", "basic", "growth", "premium", "pro"] as const) {
      expect(getTier(key)!.limits.maxEventSpendUsd).toBeGreaterThan(0);
      expect(getTier(key)!.limits.maxEventSpendUsd).not.toBe(UNLIMITED);
    }
  });

  it("the spend ceiling rises monotonically with plan price", () => {
    const ceilings = TIERS.map(t => t.limits.maxEventSpendUsd);
    expect(ceilings).toEqual([...ceilings].sort((a, b) => a - b));
  });

  it("outreach is available starting at Basic (D-02/A2: base paid tier is fully-featured)", () => {
    expect(getTier("basic")!.limits.outreach).toBe(true);
    expect(getTier("growth")!.limits.outreach).toBe(true);
    expect(getTier("premium")!.limits.outreach).toBe(true);
    expect(getTier("pro")!.limits.outreach).toBe(true);
  });

  it("growth sits between basic and premium, with a higher-volume limits ladder", () => {
    const growth = getTier("growth")!;
    expect(growth.limits.eventsPerMonth).toBe(30);
    expect(growth.limits.wavesPerEvent).toBe(10);
    expect(growth.limits.suppliersPerEvent).toBe(600);
    expect(growth.limits.seats).toBe(15);
    expect(growth.limits.outreach).toBe(true);
    expect(growth.limits.export).toBe(true);
    expect(growth.featured).toBe(true);
  });
});

describe("priceEnvVar", () => {
  it("builds the STRIPE_PRICE_{TIER}_{CADENCE} name", () => {
    expect(priceEnvVar("basic", "monthly")).toBe("STRIPE_PRICE_BASIC_MONTHLY");
    expect(priceEnvVar("pro", "yearly")).toBe("STRIPE_PRICE_PRO_YEARLY");
    expect(priceEnvVar("premium", "weekly")).toBe("STRIPE_PRICE_PREMIUM_WEEKLY");
    expect(priceEnvVar("growth", "monthly")).toBe("STRIPE_PRICE_GROWTH_MONTHLY");
    // PRICE-04 env-var matrix contract — exact case-sensitive names.
    expect(priceEnvVar("basic", "weekly")).toBe("STRIPE_PRICE_BASIC_WEEKLY");
    expect(priceEnvVar("premium", "yearly")).toBe("STRIPE_PRICE_PREMIUM_YEARLY");
  });
});

describe("priceIdFor", () => {
  it("reads the matching env var, or null when unset", () => {
    const varName = priceEnvVar("basic", "monthly");
    const prev = process.env[varName];
    process.env[varName] = "price_test_123";
    expect(priceIdFor("basic", "monthly")).toBe("price_test_123");
    delete process.env[varName];
    expect(priceIdFor("basic", "monthly")).toBeNull();
    if (prev !== undefined) process.env[varName] = prev;
  });
});

describe("displayPrice", () => {
  const basic = getTier("basic")!;

  it("free is always zero regardless of cadence", () => {
    const free = getTier("free")!;
    expect(displayPrice(free, "weekly")).toBe(0);
    expect(displayPrice(free, "monthly")).toBe(0);
    expect(displayPrice(free, "yearly")).toBe(0);
  });

  it("contactSales tiers are always zero regardless of cadence (Pitfall 2)", () => {
    const pro = getTier("pro")!;
    expect(pro.contactSales).toBe(true);
    expect(displayPrice(pro, "weekly")).toBe(0);
    expect(displayPrice(pro, "monthly")).toBe(0);
    expect(displayPrice(pro, "yearly")).toBe(0);
  });

  it("monthly returns the baseline", () => {
    expect(displayPrice(basic, "monthly")).toBe(basic.monthlyUsd);
  });

  it("yearly applies the 20% discount over 12 months", () => {
    expect(displayPrice(basic, "yearly")).toBe(Math.round(basic.monthlyUsd * 12 * (1 - YEARLY_DISCOUNT)));
  });

  it("weekly carries a premium and is cheaper per-charge than monthly", () => {
    const weekly = displayPrice(basic, "weekly");
    expect(weekly).toBe(Math.round((basic.monthlyUsd / 4.33) * (1 + WEEKLY_PREMIUM)));
    expect(weekly).toBeGreaterThan(0);
    expect(weekly).toBeLessThan(displayPrice(basic, "monthly"));
  });
});

describe("cadenceSuffix", () => {
  it("maps each cadence to its short suffix", () => {
    expect(cadenceSuffix("weekly")).toBe("/wk");
    expect(cadenceSuffix("monthly")).toBe("/mo");
    expect(cadenceSuffix("yearly")).toBe("/yr");
  });
});

describe("TIERS catalog integrity", () => {
  it("exposes exactly one featured tier", () => {
    expect(TIERS.filter((t: Tier) => t.featured)).toHaveLength(1);
  });

  it("exposes exactly one contactSales tier: Enterprise (key 'pro', D-02)", () => {
    const contactSalesTiers = TIERS.filter((t: Tier) => t.contactSales === true);
    expect(contactSalesTiers).toHaveLength(1);
    expect(contactSalesTiers[0]?.key).toBe("pro");
    expect(contactSalesTiers[0]?.name).toBe("Enterprise");
  });

  it("preserves the 'free' key as an internal fallback (Pitfall 1)", () => {
    expect(TIERS.some(t => t.key === "free")).toBe(true);
  });

  it("basic's monthlyUsd lands within the locked [1400,1500] base window (PRICE-02)", () => {
    expect(getTier("basic")!.monthlyUsd).toBeGreaterThanOrEqual(1400);
    expect(getTier("basic")!.monthlyUsd).toBeLessThanOrEqual(1500);
  });

  it("step-ups between basic/growth/premium fall within [1.5, 2.0] (PRICE-02)", () => {
    const basic = getTier("basic")!.monthlyUsd;
    const growth = getTier("growth")!.monthlyUsd;
    const premium = getTier("premium")!.monthlyUsd;
    expect(growth / basic).toBeGreaterThanOrEqual(1.5);
    expect(growth / basic).toBeLessThanOrEqual(2.0);
    expect(premium / growth).toBeGreaterThanOrEqual(1.5);
    expect(premium / growth).toBeLessThanOrEqual(2.0);
  });

  it("the 3 self-serve paid tiers are ordered by strictly ascending price (free/contactSales excluded)", () => {
    // `free` (0) and the contactSales Enterprise entry (monthlyUsd unused,
    // held at 0) are deliberately excluded from this ordering check — see
    // Tier.contactSales doc in lib/plans.ts for why contactSales tiers don't
    // carry a comparable numeric price.
    const paidKeys = ["basic", "growth", "premium"] as const;
    const prices = paidKeys.map(k => getTier(k)!.monthlyUsd);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });
});

describe("effectiveTier defensive regression (PRICE-05)", () => {
  // Lightweight defensive check per D-01 (no real paying customers yet, so
  // this is not a migration project): effectiveTier() must never throw for
  // any plan value it might realistically encounter, including orphaned/
  // unknown plan strings, so a canceled or legacy-tagged org never crashes
  // the billing gate (RESEARCH.md Wave-0 gap; lib/usage.ts:144-152's
  // getTier('free')! non-null assertion is the thing this guards against).
  const planValues = ["free", "basic", "growth", "premium", "pro", "trial", "legacy-unknown-key"];

  it("never throws and always returns a valid Tier for any plan value, canceled subscription", () => {
    for (const plan of planValues) {
      const org = { plan, subscription_status: "canceled" } as unknown as Organization;
      expect(() => effectiveTier(org)).not.toThrow();
      const tier = effectiveTier(org);
      expect(tier).toBeTruthy();
      expect(typeof tier.key).toBe("string");
    }
  });
});
