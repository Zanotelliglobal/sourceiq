// ─── SEATS ──────────────────────────────────────────────────────────────────
// Multi-seat accounting for Clerk-backed organizations. Clerk is the source of
// truth for membership; here we measure that member count against the plan's
// seat limit (lib/plans.ts) and keep Clerk's own membership cap in sync so its
// native invite UI enforces the limit and shows an upsell past it.

import { clerkClient } from "@clerk/nextjs/server";
import type { Organization } from "@/lib/db";
import { effectiveTier } from "@/lib/usage";
import { UNLIMITED } from "@/lib/plans";

export type SeatUsage = {
  used: number;
  limit: number;          // seats allowed by the effective tier (UNLIMITED = -1)
  unlimited: boolean;
  remaining: number | null; // null when unlimited
};

/** Current seat consumption for an org, measured against its effective tier. */
export async function seatUsage(org: Organization, clerkOrgId: string | null): Promise<SeatUsage> {
  const limit = effectiveTier(org).limits.seats;
  const unlimited = limit === UNLIMITED;

  // Personal workspaces (no Clerk org) are always a single seat.
  let used = 1;
  if (clerkOrgId) {
    try {
      const res = await clerkClient.organizations.getOrganizationMembershipList({
        organizationId: clerkOrgId,
        limit: 100,
      });
      used = typeof res.totalCount === "number" && res.totalCount > 0 ? res.totalCount : res.data.length;
    } catch {
      // Clerk unreachable or Organizations disabled — fall back to 1 seat.
      used = 1;
    }
  }

  return { used, limit, unlimited, remaining: unlimited ? null : Math.max(0, limit - used) };
}

/**
 * Reconcile Clerk's membership cap with the plan's seat limit (best-effort).
 * Clerk uses `maxAllowedMemberships: 0` to mean unlimited. No-op for personal
 * workspaces or when Clerk is unreachable.
 */
export async function syncSeatCap(org: Organization, clerkOrgId: string | null): Promise<void> {
  if (!clerkOrgId) return;
  const limit = effectiveTier(org).limits.seats;
  try {
    await clerkClient.organizations.updateOrganization(clerkOrgId, {
      maxAllowedMemberships: limit === UNLIMITED ? 0 : limit,
    });
  } catch {
    /* best-effort — never block a request on Clerk cap sync */
  }
}
