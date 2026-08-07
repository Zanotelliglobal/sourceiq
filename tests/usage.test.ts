import { describe, it, expect } from "vitest";
import { normalizeUsage, effectiveTier } from "@/lib/usage";
import type { Organization } from "@/lib/db";

// Minimal Organization stub — effectiveTier only reads `plan` and
// `subscription_status`, so we cast a partial for tests.
function org(plan: string, subscription_status = "active"): Organization {
  return { plan, subscription_status } as unknown as Organization;
}

describe("normalizeUsage", () => {
  it("defaults every field to zero for null/empty input", () => {
    const u = normalizeUsage(null);
    expect(u).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      web_searches: 0,
      cost_usd: 0,
    });
    expect(normalizeUsage(undefined).cost_usd).toBe(0);
  });

  it("prices input and output tokens at Opus 4.7 rates", () => {
    const u = normalizeUsage({ input_tokens: 1_000_000, output_tokens: 1_000_000 });
    // $5 input + $25 output per 1M
    expect(u.cost_usd).toBeCloseTo(30, 6);
    expect(u.input_tokens).toBe(1_000_000);
    expect(u.output_tokens).toBe(1_000_000);
  });

  it("prices cache reads at 0.1x input and cache writes at 1.25x input", () => {
    const read = normalizeUsage({ cache_read_input_tokens: 1_000_000 });
    const write = normalizeUsage({ cache_creation_input_tokens: 1_000_000 });
    expect(read.cost_usd).toBeCloseTo(0.5, 6);
    expect(write.cost_usd).toBeCloseTo(6.25, 6);
  });

  it("charges web searches at $10 per 1,000", () => {
    const u = normalizeUsage({ server_tool_use: { web_search_requests: 1000 } });
    expect(u.cost_usd).toBeCloseTo(10, 6);
    expect(u.web_searches).toBe(1000);
  });

  it("prices identical token counts differently across models", () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
    const opus = normalizeUsage(usage, "claude-opus-4-7");
    const sonnet = normalizeUsage(usage, "claude-sonnet-4-6");
    const haiku = normalizeUsage(usage, "claude-haiku-4-5");
    expect(opus.cost_usd).toBeCloseTo(30, 6);   // $5 + $25 per 1M
    expect(sonnet.cost_usd).toBeCloseTo(18, 6); // $3 + $15 per 1M
    expect(haiku.cost_usd).toBeCloseTo(6, 6);   // $1 + $5 per 1M
    expect(haiku.cost_usd).toBeLessThan(sonnet.cost_usd);
    expect(sonnet.cost_usd).toBeLessThan(opus.cost_usd);
  });

  it("falls back to Opus pricing for an unrecognized model", () => {
    const u = normalizeUsage({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, "some-future-model");
    expect(u.cost_usd).toBeCloseTo(30, 6);
  });
});

describe("effectiveTier", () => {
  it("maps a recognized plan directly to its tier", () => {
    expect(effectiveTier(org("basic")).key).toBe("basic");
    expect(effectiveTier(org("growth")).key).toBe("growth");
    expect(effectiveTier(org("pro")).key).toBe("pro");
    expect(effectiveTier(org("free")).key).toBe("free");
  });

  it("grants trialing orgs Premium-level entitlement", () => {
    expect(effectiveTier(org("trial", "trialing")).key).toBe("premium");
    expect(effectiveTier(org("something", "trialing")).key).toBe("premium");
    expect(effectiveTier(org("trial", "active")).key).toBe("premium");
  });

  it("falls back to Free for unrecognized, non-trial plans", () => {
    expect(effectiveTier(org("legacy", "active")).key).toBe("free");
    expect(effectiveTier(org("", "canceled")).key).toBe("free");
  });
});
