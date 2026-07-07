import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getOrgContext } from "@/lib/tenant";
import { requireActiveSubscription } from "@/lib/billing";

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const events = await db
    .prepare(
      `SELECT se.*,
        COUNT(s.id)::int as supplier_count,
        COALESCE(SUM(CASE WHEN s.funnel_stage = 'shortlisted' THEN 1 ELSE 0 END),0)::int as shortlisted_count
       FROM sourcing_events se
       LEFT JOIN suppliers s ON s.event_id = se.id
       WHERE se.org_id = ?
       GROUP BY se.id
       ORDER BY se.created_at DESC`
    )
    .all(ctx.orgId);
  return NextResponse.json(events);
}

export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Billing gate: block new events unless the org has an active plan or trial.
  const gate = requireActiveSubscription(ctx.org);
  if (!gate.ok) return NextResponse.json({ error: gate.reason, code: "subscription_required" }, { status: 402 });

  const body = await req.json();
  const { title, category, subcategory, description, requirements, annual_spend, timeline, target_countries,
    outreach_anonymous, buyer_name, buyer_role, buyer_company } = body;

  if (!title || !category || !description || !requirements) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  const countries = Array.isArray(target_countries) ? target_countries.join(", ") : (target_countries || null);

  // Outreach identity: default anonymous unless the buyer explicitly opts to disclose.
  const anonymous = !(outreach_anonymous === false || outreach_anonymous === "false");
  const bName = anonymous ? null : (buyer_name || null);
  const bRole = anonymous ? null : (buyer_role || null);
  const bCompany = anonymous ? null : (buyer_company || null);

  // Tenant scoping: the event belongs to the caller's resolved organization.
  const orgId = ctx.orgId;

  const db = getDb();
  try {
    const result = await db
      .prepare(
        `INSERT INTO sourcing_events (org_id, title, category, subcategory, description, requirements, annual_spend, timeline, target_countries, outreach_anonymous, buyer_name, buyer_role, buyer_company)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(orgId, title, category, subcategory || null, description, requirements, annual_spend ?? null, timeline ?? null, countries, anonymous, bName, bRole, bCompany);

    const event = await db
      .prepare("SELECT * FROM sourcing_events WHERE id = ?")
      .get(result.lastInsertRowid);

    return NextResponse.json(event, { status: 201 });
  } catch (err) {
    console.error("[sourcing-events POST] insert failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
