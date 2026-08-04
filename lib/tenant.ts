import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb, type Organization } from "@/lib/db";
import { atLeast, mapClerkRole, type OrgRole } from "@/lib/roles";
import { attributeReferral } from "@/lib/referrals";

// ─── TENANCY / ORG RESOLUTION ─────────────────────────────────────────────────
// Every authenticated request maps to exactly one SourceIQ organization row,
// which carries the billing state. We derive the org from the Clerk session:
//   • If the user is acting inside a Clerk Organization → use that org.
//   • Otherwise → a per-user "personal" org keyed by the Clerk user id.
// The org row is provisioned lazily on first request (with a 14-day trial).

export type OrgContext = {
  orgId: number;          // internal organizations.id
  clerkOrgKey: string;    // clerk org id, or user_<id> for personal orgs
  clerkOrgId: string | null; // the real Clerk org id, or null for personal workspaces
  userId: string;
  role: OrgRole;          // caller's role within the org (owner/admin/member)
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
  const { userId, orgId: clerkOrgId, orgRole } = DEV_BYPASS
    ? { userId: "dev_user", orgId: null as string | null, orgRole: null as string | null }
    : auth();
  if (!userId) return null;

  // Resolve the caller's role: personal workspaces have a sole owner; inside a
  // Clerk org the role comes from the session's org role claim.
  const role = mapClerkRole(orgRole, Boolean(clerkOrgId));

  const clerkOrgKey = clerkOrgId ?? `user_${userId}`;
  const db = getDb();

  let org = (await db
    .prepare("SELECT * FROM organizations WHERE clerk_org_id = ?")
    .get(clerkOrgKey)) as Organization | undefined;

  if (!org) {
    const name = clerkOrgKey.startsWith("user_") ? "Personal Workspace" : "Organization";
    const ins = await db
      .prepare(
        `INSERT INTO organizations (clerk_org_id, name, plan, subscription_status, trial_ends_at)
         VALUES (?, ?, 'trial', 'trialing', now() + interval '14 days')
         ON CONFLICT (clerk_org_id) DO NOTHING`
      )
      .run(clerkOrgKey, name);
    org = (await db
      .prepare("SELECT * FROM organizations WHERE clerk_org_id = ?")
      .get(clerkOrgKey)) as Organization;

    // Referral attribution: only for orgs we actually just created (not a
    // concurrent insert we lost the race on). Best-effort — never blocks.
    if (ins.changes > 0 && org) {
      try {
        const ref = cookies().get("siq_ref")?.value;
        if (ref) await attributeReferral(Number(org.id), ref);
      } catch {
        /* best-effort */
      }
    }
  }

  // Postgres returns BIGINT/BIGSERIAL columns as strings (JS numbers can't
  // safely hold 64-bit ints). Coerce to a number so downstream tenancy checks
  // like `Number(event.org_id) === ctx.orgId` compare number-to-number.
  return { orgId: Number(org.id), clerkOrgKey, clerkOrgId: clerkOrgId ?? null, userId, role, org };
}

/**
 * Route guard: returns a 403 NextResponse when the caller's role is below `min`,
 * or null when the caller is authorized. Usage:
 *   const denied = requireRole(ctx, "admin"); if (denied) return denied;
 */
export function requireRole(ctx: OrgContext, min: OrgRole): NextResponse | null {
  if (atLeast(ctx.role, min)) return null;
  return NextResponse.json(
    { error: "You don't have permission to do this.", code: "forbidden", requiredRole: min },
    { status: 403 },
  );
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
