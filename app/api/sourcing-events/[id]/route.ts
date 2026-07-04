import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { usageSummary } from "@/lib/usage";
import { getOrgContext } from "@/lib/tenant";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const id = Number(params.id);
  const event = await db.prepare("SELECT * FROM sourcing_events WHERE id = ?").get(id) as { org_id?: number } | undefined;
  // Return 404 (not 403) for other tenants' events so we don't leak existence.
  if (!event || Number(event.org_id) !== ctx.orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const suppliers = await db.prepare(
    "SELECT * FROM suppliers WHERE event_id = ? ORDER BY ai_score DESC, created_at ASC"
  ).all(id);

  const agents = await db.prepare(
    "SELECT * FROM agent_runs WHERE event_id = ? ORDER BY wave ASC, created_at ASC"
  ).all(id);

  const usage = await usageSummary(db, id);

  return NextResponse.json({ event, suppliers, agents, usage });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const db = getDb();
  const id = Number(params.id);
  const owner = await db.prepare("SELECT org_id FROM sourcing_events WHERE id = ?").get(id) as { org_id?: number } | undefined;
  if (!owner || Number(owner.org_id) !== ctx.orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Never let a client rewrite tenancy/identity columns via the generic PATCH.
  const FORBIDDEN = new Set(["id", "org_id", "created_at"]);
  const keys = Object.keys(body).filter(k => !FORBIDDEN.has(k));
  if (keys.length === 0) return NextResponse.json({ error: "No updatable fields" }, { status: 400 });
  const fields = keys.map(k => `${k} = ?`).join(", ");
  const values = [...keys.map(k => body[k]), id];
  await db.prepare(`UPDATE sourcing_events SET ${fields}, updated_at = datetime('now') WHERE id = ?`).run(...values);
  const event = await db.prepare("SELECT * FROM sourcing_events WHERE id = ?").get(id);
  return NextResponse.json(event);
}
