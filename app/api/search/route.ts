import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getOrgContext } from "@/lib/tenant";
import { likeContains } from "@/lib/search";

// Cross-project search (#40): lets a buyer find a supplier or event anywhere in
// their org from the dashboard, not just within whichever sourcing event they
// currently have open. Read-only, org-scoped via a join through sourcing_events
// (suppliers carry no org_id of their own).

export type SearchEventHit = { id: number; title: string; category: string; archived: boolean };
export type SearchSupplierHit = {
  id: number; name: string; country: string;
  event_id: number; event_title: string; event_archived: boolean;
};

export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ events: [], suppliers: [] });

  const pattern = likeContains(q);
  const db = getDb();

  const [events, suppliers] = await Promise.all([
    db
      .prepare(
        `SELECT id, title, category, archived FROM sourcing_events
         WHERE org_id = ? AND (title ILIKE ? OR category ILIKE ?)
         ORDER BY created_at DESC LIMIT 10`
      )
      .all<SearchEventHit>(ctx.orgId, pattern, pattern),
    db
      .prepare(
        `SELECT s.id, s.name, s.country, s.event_id, se.title AS event_title, se.archived AS event_archived
         FROM suppliers s JOIN sourcing_events se ON se.id = s.event_id
         WHERE se.org_id = ? AND (s.name ILIKE ? OR s.country ILIKE ?)
         ORDER BY s.created_at DESC LIMIT 15`
      )
      .all<SearchSupplierHit>(ctx.orgId, pattern, pattern),
  ]);

  return NextResponse.json({ events, suppliers });
}
