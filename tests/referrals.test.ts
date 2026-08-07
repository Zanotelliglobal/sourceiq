import { describe, it, expect } from "vitest";
import { referrerRewardDecision, REFERRAL_REWARD_CAP_PER_ORG, REFERRAL_BONUS_EVENTS } from "@/lib/referrals";

describe("referrerRewardDecision", () => {
  it("rewards the referrer while under the cap", () => {
    expect(referrerRewardDecision(0)).toBe(true);
    expect(referrerRewardDecision(REFERRAL_REWARD_CAP_PER_ORG - 1)).toBe(true);
  });

  it("stops rewarding the referrer once they've hit the cap", () => {
    expect(referrerRewardDecision(REFERRAL_REWARD_CAP_PER_ORG)).toBe(false);
    expect(referrerRewardDecision(REFERRAL_REWARD_CAP_PER_ORG + 5)).toBe(false);
  });

  it("honors an explicit cap override instead of the module default", () => {
    expect(referrerRewardDecision(2, 3)).toBe(true);
    expect(referrerRewardDecision(3, 3)).toBe(false);
    expect(referrerRewardDecision(0, 0)).toBe(false);
  });
});

describe("reward constants", () => {
  it("are positive, sane values", () => {
    expect(REFERRAL_BONUS_EVENTS).toBeGreaterThan(0);
    expect(REFERRAL_REWARD_CAP_PER_ORG).toBeGreaterThan(0);
  });
});
