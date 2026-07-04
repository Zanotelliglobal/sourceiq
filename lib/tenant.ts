import { auth } from "@clerk/nextjs/server";
import { getDb, type Organization } from "@/lib/db";

// ─── TENANCY / ORG RESOLUTION ─────────────────────────────────────────────────
// Every authenticated request maps to exactly one SourceIQ organization row,
// which carries the billing state. We derive the org from the Clerk session:
//   • If the user is acting inside a Clerk Organization → use that org.
//   • Otherwise → a per-user "personal" org keyed by the Clerk user id.
// The org row is provisioned lazily on first request (with a 14-day trial).

export type OrgContext = {
  orgId: number;          // internal organizations.id
  clerkOrgKey: string;    // clerk org id, or user_<id> for personal orgs
  userId: string;
  org: Organization;
};

/**
 * Resolve (and lazily create) the org for the current Clerk principal.
 * Returns null when there is no authenticated user — callers should 401.
 */
// DEV-ONLY escape hatch. When DEV_AUTH_BYPASS=1 (and NOT in production), we
// skip Clerk entirely and act as a fixed local dev user/org. This lets you
// build and test the rest of the app on networks where the Clerk dev handshake
// is blocked (e.g. behind a corporate proxy). It is inert in production.
const DEV_BYPASS =
  process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "1";

export async function getOrgContext(): Promise<OrgContext | null> {
  const { userId, orgId: clerkOrgId } = DEV_BYPASS
    ? { userId: "dev_user", orgId: null as string | null }
    : auth();
  if (!userId) return null;

  const clerkOrgKey = clerkOrgId ?? `user_${userId}`;
  const db = getDb();

  let org = (await db
    .prepare("SELECT * FROM organizations WHERE clerk_org_id = ?")
    .get(clerkOrgKey)) as Organization | undefined;

  if (!org) {
    const name = clerkOrgKey.startsWith("user_") ? "Personal Workspace" : "Organization";
    await db
      .prepare(
        `INSERT INTO organizations (clerk_org_id, name, plan, subscription_status, trial_ends_at)
         VALUES (?, ?, 'trial', 'trialing', now() + interval '14 days')
         ON CONFLICT (clerk_org_id) DO NOTHING`
      )
      .run(clerkOrgKey, name);
    org = (await db
      .prepare("SELECT * FROM organizations WHERE clerk_org_id = ?")
      .get(clerkOrgKey)) as Organization;
  }

  // Postgres returns BIGINT/BIGSERIAL columns as strings (JS numbers can't
  // safely hold 64-bit ints). Coerce to a number so downstream tenancy checks
  // like `Number(event.org_id) === ctx.orgId` compare number-to-number.
  return { orgId: Number(org.id), clerkOrgKey, userId, org };
}

/**
 * Assert that a sourcing event belongs to the caller's org.
 * Returns true if owned; false otherwise (caller should 404/403).
 */
export async function orgOwnsEvent(orgId: number, eventId: number | string): Promise<boolean> {
  const db = getDb();
  const row = (await db
    .prepare("SELECT org_id FROM sourcing_events WHERE id = ?")
    .get(Number(eventId))) as { org_id: number } | undefined;
  return !!row && Number(row.org_id) === orgId;
}

/**
 * Assert that a supplier belongs to an event owned by the caller's org.
 */
export async function orgOwnsSupplier(orgId: number, supplierId: number | string): Promise<boolean> {
  const db = getDb();
  const row = (await db
    .prepare(
      `SELECT se.org_id AS org_id
       FROM suppliers s JOIN sourcing_events se ON se.id = s.event_id
       WHERE s.id = ?`
    )
    .get(Number(supplierId))) as { org_id: number } | undefined;
  return !!row && Number(row.org_id) === orgId;
}
