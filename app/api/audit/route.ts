import { NextRequest, NextResponse } from "next/server";
import { getOrgContext, orgOwnsEvent } from "@/lib/tenant";
import { getAuditForEvent, resolveActorLabels } from "@/lib/audit";

export const runtime = "nodejs";

// Read the audit trail for one sourcing event. Org-scoped: callers can only
// read history for events their organization owns. Actor ids are resolved to
// human-readable labels here (batched) so the client never sees raw Clerk ids.
export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const eventId = Number(req.nextUrl.searchParams.get("event_id"));
  if (!eventId) return NextResponse.json({ error: "event_id required" }, { status: 400 });
  if (!(await orgOwnsEvent(ctx.orgId, eventId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const entries = await getAuditForEvent(ctx.orgId, eventId);
  const labels = await resolveActorLabels(entries.map(e => e.actor_id));

  return NextResponse.json({
    entries: entries.map(e => ({
      id: e.id,
      action: e.action,
      summary: e.summary,
      actor: e.actor_id ? (labels[e.actor_id] ?? "Unknown") : "System",
      created_at: e.created_at,
    })),
  });
}
