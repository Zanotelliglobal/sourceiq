import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { requireActiveSubscription, requireSpendableSubscription } from "@/lib/billing";
import type { Organization } from "@/lib/db";

// ─── Fixtures ───────────────────────────────────────────────────────────────
// Minimal Organization stub — only subscription_status/trial_ends_at matter to
// the gates under test; other fields are filled with harmless placeholders.
function org(overrides: Partial<Organization>): Organization {
  return {
    id: 1,
    clerk_org_id: "org_test",
    name: "Test Org",
    plan: "pro",
    subscription_status: "active",
    stripe_customer_id: null,
    stripe_subscription_id: null,
    trial_ends_at: null,
    referral_code: null,
    referred_by: null,
    bonus_events: 0,
    checklist_progress: "{}",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const FUTURE = new Date(Date.now() + 3 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 3 * 86_400_000).toISOString();

// ─── Env control ────────────────────────────────────────────────────────────
// isBillingConfigured() re-reads process.env on every call (not memoized), so
// tests can just mutate STRIPE_SECRET_KEY/STRIPE_PRICE_ID per-test rather than
// mocking the module. Save/restore around each test so this file doesn't leak
// state into other suites that share the same process.
const ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_ID"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function billingNotConfigured() {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_ID;
}

function billingConfigured() {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  process.env.STRIPE_PRICE_ID = "price_fake"; // legacy single-price fallback is enough to flip isBillingConfigured() true
}

describe("requireActiveSubscription", () => {
  it("always passes when billing isn't configured (dev/local)", () => {
    billingNotConfigured();
    const result = requireActiveSubscription(org({ subscription_status: "canceled", trial_ends_at: PAST }));
    expect(result.ok).toBe(true);
  });

  it("passes for active/trialing/past_due once billing is configured", () => {
    billingConfigured();
    for (const status of ["active", "trialing", "past_due"]) {
      expect(requireActiveSubscription(org({ subscription_status: status })).ok).toBe(true);
    }
  });

  it("passes a canceled org still inside its free-trial window", () => {
    billingConfigured();
    const result = requireActiveSubscription(org({ subscription_status: "canceled", trial_ends_at: FUTURE }));
    expect(result.ok).toBe(true);
  });

  it("blocks a canceled org whose trial has ended", () => {
    billingConfigured();
    const result = requireActiveSubscription(org({ subscription_status: "canceled", trial_ends_at: PAST }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/trial has ended/i);
  });

  it("blocks a canceled org with no trial_ends_at at all", () => {
    billingConfigured();
    const result = requireActiveSubscription(org({ subscription_status: "canceled", trial_ends_at: null }));
    expect(result.ok).toBe(false);
  });
});

describe("requireSpendableSubscription", () => {
  it("always passes when billing isn't configured (dev/local)", () => {
    billingNotConfigured();
    const result = requireSpendableSubscription(org({ subscription_status: "past_due", trial_ends_at: PAST }));
    expect(result.ok).toBe(true);
  });

  it("passes for active/trialing once billing is configured", () => {
    billingConfigured();
    for (const status of ["active", "trialing"]) {
      expect(requireSpendableSubscription(org({ subscription_status: status })).ok).toBe(true);
    }
  });

  it("passes a past_due org still inside its free-trial window", () => {
    // Trial window takes precedence over the status check, same as requireActiveSubscription.
    billingConfigured();
    const result = requireSpendableSubscription(org({ subscription_status: "past_due", trial_ends_at: FUTURE }));
    expect(result.ok).toBe(true);
  });

  it("blocks past_due once the trial window (if any) has elapsed, with a billing-specific reason", () => {
    // This is the key behavioral difference from requireActiveSubscription:
    // past_due grants general read/edit access but NOT new spend.
    billingConfigured();
    const result = requireSpendableSubscription(org({ subscription_status: "past_due", trial_ends_at: PAST }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/payment failed/i);
  });

  it("blocks past_due with no trial_ends_at at all, with a billing-specific reason", () => {
    billingConfigured();
    const result = requireSpendableSubscription(org({ subscription_status: "past_due", trial_ends_at: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/payment failed/i);
  });

  it("blocks a canceled org whose trial has ended, with the generic trial-ended reason", () => {
    billingConfigured();
    const result = requireSpendableSubscription(org({ subscription_status: "canceled", trial_ends_at: PAST }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/trial has ended/i);
  });

  it("passes a canceled org still inside its free-trial window", () => {
    billingConfigured();
    const result = requireSpendableSubscription(org({ subscription_status: "canceled", trial_ends_at: FUTURE }));
    expect(result.ok).toBe(true);
  });
});
