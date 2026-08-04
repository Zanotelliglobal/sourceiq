import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { usageSummary } from "@/lib/usage";
import { getOrgContext, requireRole } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const id = Number(params.id);
  const event = await db.prepare("SELECT * FROM sourcing_events WHERE id = ?").get(id) as (Record<string, unknown> & { org_id?: number; status?: string; updated_at?: string }) | undefined;
  // Return 404 (not 403) for other tenants' events so we don't leak existence.
  if (!event || Number(event.org_id) !== ctx.orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const suppliers = await db.prepare(
    "SELECT * FROM suppliers WHERE event_id = ? ORDER BY ai_score DESC, created_at ASC"
  ).all(id) as Record<string, unknown>[];

  // Effective status: a working run ('scouting'/'outreach') whose row hasn't been
  // written to in > 5 min was interrupted (serverless timeout, disconnect on
  // refresh) and will never reach its terminal state. Downgrade it so the client
  // stops polling — 'reviewing' if any suppliers were found, else 'idle'. This
  // mirrors the list endpoint's interruption-aware logic.
  if (event.status === "scouting" || event.status === "outreach") {
    const updatedMs = event.updated_at ? new Date(event.updated_at as string).getTime() : 0;
    if (updatedMs && Date.now() - updatedMs > 5 * 60_000) {
      event.status = suppliers.length > 0 ? "reviewing" : "idle";
    }
  }

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

  await logAudit({
    orgId: ctx.orgId, eventId: id, actorId: ctx.userId,
    action: "event.update", summary: `Edited sourcing brief (${keys.join(", ")})`,
    metadata: { fields: keys },
  });

  return NextResponse.json(event);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Deleting an event is destructive — restrict to admins/owners.
  const denied = requireRole(ctx, "admin");
  if (denied) return denied;

  const db = getDb();
  const id = Number(params.id);
  const owner = await db.prepare("SELECT org_id, title FROM sourcing_events WHERE id = ?").get(id) as { org_id?: number; title?: string } | undefined;
  // 404 (not 403) for other tenants' events so we don't leak existence.
  if (!owner || Number(owner.org_id) !== ctx.orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Child rows (suppliers, agent_runs, token_usage, audit_log) all have
  // ON DELETE CASCADE, so deleting the event removes them atomically.
  await db.prepare("DELETE FROM sourcing_events WHERE id = ?").run(id);

  // Log with eventId: null — the event row (and its cascaded audit rows) is gone,
  // so referencing its id would violate the audit_log → sourcing_events FK.
  await logAudit({
    orgId: ctx.orgId, eventId: null, actorId: ctx.userId,
    action: "event.delete", summary: `Deleted sourcing event "${owner.title ?? id}"`,
    metadata: { deleted_event_id: id },
  });

  return NextResponse.json({ ok: true });
}
