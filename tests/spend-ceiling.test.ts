import { describe, it, expect } from "vitest";
import { checkSpendCeiling } from "@/lib/usage";
import { getTier, UNLIMITED, type Tier } from "@/lib/plans";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

// ─── Fakes ──────────────────────────────────────────────────────────────────
// No mocking framework in this repo (see tests/process-supplier.test.ts) —
// a minimal stub that only understands the one SUM(cost_usd) query
// checkSpendCeiling issues against token_usage.

function fakeDb(totalCostByEvent: Record<number, number>) {
  const db = {
    prepare(sql: string) {
      return {
        async get(...params: unknown[]) {
          if (/select\s+coalesce\(sum\(cost_usd\)/i.test(sql)) {
            const eventId = params[0] as number;
            return { c: totalCostByEvent[eventId] ?? 0 };
          }
          return undefined;
        },
      };
    },
  };
  return db as unknown as Db;
}

// A tier whose only fixture-relevant field is maxEventSpendUsd — cloned from
// a real tier so the other required TierLimits fields stay valid.
function tierWithCeiling(ceiling: number): Tier {
  const base = getTier("growth")!;
  return { ...base, limits: { ...base.limits, maxEventSpendUsd: ceiling } };
}

describe("checkSpendCeiling", () => {
  it("allows spend strictly under the ceiling", async () => {
    const db = fakeDb({ 1: 10 });
    const result = await checkSpendCeiling(db, tierWithCeiling(20), 1);
    expect(result.ok).toBe(true);
  });

  it("blocks once cumulative cost reaches the ceiling", async () => {
    const db = fakeDb({ 1: 20 });
    const result = await checkSpendCeiling(db, tierWithCeiling(20), 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("spend_ceiling_reached");
      expect(result.limit).toBe(20);
      expect(result.used).toBe(20);
    }
  });

  it("blocks when cumulative cost has exceeded the ceiling", async () => {
    const db = fakeDb({ 1: 35.5 });
    const result = await checkSpendCeiling(db, tierWithCeiling(20), 1);
    expect(result.ok).toBe(false);
  });

  it("never blocks an UNLIMITED tier ceiling, regardless of spend", async () => {
    const db = fakeDb({ 1: 1_000_000 });
    const result = await checkSpendCeiling(db, tierWithCeiling(UNLIMITED), 1);
    expect(result.ok).toBe(true);
  });

  it("treats an event with no usage rows as zero spend", async () => {
    const db = fakeDb({});
    const result = await checkSpendCeiling(db, tierWithCeiling(5), 42);
    expect(result.ok).toBe(true);
  });

  it("scopes the check to the given event id only", async () => {
    const db = fakeDb({ 1: 100, 2: 1 });
    const overCap = await checkSpendCeiling(db, tierWithCeiling(20), 1);
    const underCap = await checkSpendCeiling(db, tierWithCeiling(20), 2);
    expect(overCap.ok).toBe(false);
    expect(underCap.ok).toBe(true);
  });
});
