import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getOrgContext } from "@/lib/tenant";
import { seatUsage, syncSeatCap } from "@/lib/seats";
import { mapClerkRole } from "@/lib/roles";

// Team roster + seat accounting for the current org. Read-only: invitations and
// member removal are handled by Clerk's <OrganizationProfile> UI in /settings,
// which enforces the seat cap we keep in sync here. Personal workspaces report
// a single member (the owner) and no team.
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Keep Clerk's membership cap aligned with the plan before reporting seats,
  // so the invite UI blocks past-limit invites with a native upsell.
  await syncSeatCap(ctx.org, ctx.clerkOrgId);

  const seats = await seatUsage(ctx.org, ctx.clerkOrgId);

  // `id` (the Clerk organization *membership* id) is kept for back-compat with
  // any existing caller; `user_id` is the actual Clerk *user* id — the same
  // value stored in sourcing_events.created_by — so the dashboard can match a
  // "started by" event against a team member.
  let members: Array<{ id: string; user_id: string | null; name: string | null; email: string | null; role: string }> = [];
  if (ctx.clerkOrgId) {
    try {
      const res = await clerkClient.organizations.getOrganizationMembershipList({
        organizationId: ctx.clerkOrgId,
        limit: 100,
      });
      members = res.data.map((m) => {
        const pud = m.publicUserData;
        const name = pud ? [pud.firstName, pud.lastName].filter(Boolean).join(" ") || null : null;
        return {
          id: m.id,
          user_id: pud?.userId ?? null,
          name,
          email: pud?.identifier ?? null,
          role: mapClerkRole(m.role, true),
        };
      });
    } catch {
      members = [];
    }
  }

  return NextResponse.json({
    role: ctx.role,
    is_personal: !ctx.clerkOrgId,
    seats,
    members,
  });
}
