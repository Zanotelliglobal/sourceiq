import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getOrgContext } from "@/lib/tenant";

// Powers the "what you'd lose" summary (#40) shown before a user is sent to the
// Stripe billing portal to cancel/downgrade — this only adds messaging, the
// actual cancellation still happens in Stripe's own UI. Read-only, org-scoped.
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const row = await db
    .prepare(
      `SELECT
         COUNT(DISTINCT se.id) FILTER (WHERE NOT se.archived)::int AS active_projects,
         COUNT(DISTINCT s.id)::int AS supplier_count,
         COUNT(DISTINCT ol.id)::int AS outreach_count
       FROM sourcing_events se
       LEFT JOIN suppliers s ON s.event_id = se.id
       LEFT JOIN outreach_logs ol ON ol.supplier_id = s.id
       WHERE se.org_id = ?`
    )
    .get<{ active_projects: number; supplier_count: number; outreach_count: number }>(ctx.orgId);

  return NextResponse.json(row ?? { active_projects: 0, supplier_count: 0, outreach_count: 0 });
}
