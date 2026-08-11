import { describe, it, expect } from "vitest";
import {
  TIERS,
  getTier,
  priceEnvVar,
  priceIdFor,
  displayPrice,
  cadenceSuffix,
  UNLIMITED,
  type Tier,
} from "@/lib/plans";

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
    expect(free.limits.monthlyCredits).toBe(1);
  });

  it("paid tiers allow export", () => {
    for (const key of ["basic", "growth", "premium", "pro"] as const) {
      expect(getTier(key)!.limits.export).toBe(true);
    }
  });

  it("pro is unlimited across numeric limits", () => {
    const pro = getTier("pro")!;
    expect(pro.limits.monthlyCredits).toBe(UNLIMITED);
    expect(pro.limits.seats).toBe(UNLIMITED);
    expect(pro.limits.suppliersPerEvent).toBe(UNLIMITED);
  });

  it("outreach is a growth+ capability", () => {
    expect(getTier("basic")!.limits.outreach).toBe(false);
    expect(getTier("growth")!.limits.outreach).toBe(true);
    expect(getTier("premium")!.limits.outreach).toBe(true);
    expect(getTier("pro")!.limits.outreach).toBe(true);
  });

  it("growth sits between basic and premium, unlocking outreach", () => {
    const growth = getTier("growth")!;
    expect(growth.limits.monthlyCredits).toBe(30);
    expect(growth.limits.suppliersPerEvent).toBe(400);
    expect(growth.limits.seats).toBe(5);
    expect(growth.limits.outreach).toBe(true);
    expect(growth.limits.export).toBe(true);
    expect(growth.featured).toBeFalsy();
  });

  it("#45: monthlyCredits (or UNLIMITED) is non-decreasing across ascending-price tiers", () => {
    const values = TIERS.map(t => t.limits.monthlyCredits === UNLIMITED ? Infinity : t.limits.monthlyCredits);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });
});

describe("priceEnvVar", () => {
  it("builds the STRIPE_PRICE_{TIER}_{CADENCE} name", () => {
    expect(priceEnvVar("basic", "monthly")).toBe("STRIPE_PRICE_BASIC_MONTHLY");
    expect(priceEnvVar("pro", "yearly")).toBe("STRIPE_PRICE_PRO_YEARLY");
    expect(priceEnvVar("premium", "weekly")).toBe("STRIPE_PRICE_PREMIUM_WEEKLY");
    expect(priceEnvVar("growth", "monthly")).toBe("STRIPE_PRICE_GROWTH_MONTHLY");
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

  it("monthly returns the baseline", () => {
    expect(displayPrice(basic, "monthly")).toBe(basic.monthlyEur);
  });

  it("yearly applies the 20% discount over 12 months", () => {
    // 49 * 12 * 0.8 = 470.4 → 470
    expect(displayPrice(basic, "yearly")).toBe(Math.round(basic.monthlyEur * 12 * 0.8));
  });

  it("weekly carries a premium and is cheaper per-charge than monthly", () => {
    const weekly = displayPrice(basic, "weekly");
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

  it("is ordered by ascending price", () => {
    const prices = TIERS.map(t => t.monthlyEur);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });
});
