import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { usageSummary } from "@/lib/usage";
import { getOrgContext, requireRole } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { reapStuckAgentRuns } from "@/lib/agent-runs-reaper";

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

  // #67: reap any agent_runs rows abandoned by a crashed/timed-out orchestrate
  // request before reading them, so the response reflects reality instead of
  // a permanent "running" spinner.
  await reapStuckAgentRuns(db, id);
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

  // Allowlist (not blocklist) of client-editable columns. A blocklist here is
  // unsafe: field names are interpolated directly into the SQL text below
  // (only values are parameterized), so any key not explicitly rejected could
  // inject arbitrary SQL via a crafted JSON body — and would also let a client
  // silently overwrite system-managed columns (status, wave_count, etc.).
  // Content fields materially affect supplier qualification in later waves
  // (#72) — restrict those to admins/owners, same threat model as DELETE.
  // Preference fields (pinned/archived) are cosmetic bookkeeping and stay
  // open to any member.
  const CONTENT_FIELDS = new Set([
    "title", "category", "description", "requirements", "annual_spend",
    "target_countries", "advanced_filters",
  ]);
  const PREFERENCE_FIELDS = new Set(["pinned", "archived"]);
  // Array.from (not a spread) here: spreading a Set directly requires
  // --downlevelIteration/ES2015+ target, which this repo's tsconfig doesn't
  // set, so `tsc --noEmit` fails with TS2802 on `[...aSet, ...anotherSet]`.
  const ALLOWED = new Set([...Array.from(CONTENT_FIELDS), ...Array.from(PREFERENCE_FIELDS)]);
  const keys = Object.keys(body).filter(k => ALLOWED.has(k));
  if (keys.length === 0) return NextResponse.json({ error: "No updatable fields" }, { status: 400 });
  if (keys.some(k => CONTENT_FIELDS.has(k))) {
    const denied = requireRole(ctx, "admin");
    if (denied) return denied;
  }
  const fields = keys.map(k => `${k} = ?`).join(", ");
  // advanced_filters is a TEXT column storing JSON — serialize object values
  // (or null-out an explicit clear) rather than writing "[object Object]".
  const values = [
    ...keys.map(k => {
      const v = body[k];
      if (k === "advanced_filters") return v && typeof v === "object" ? JSON.stringify(v) : null;
      return v;
    }),
    id,
  ];
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
  const owner = await db.prepare("SELECT org_id, title, status FROM sourcing_events WHERE id = ?").get(id) as { org_id?: number; title?: string; status?: string } | undefined;
  // 404 (not 403) for other tenants' events so we don't leak existence.
  if (!owner || Number(owner.org_id) !== ctx.orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // #71: deleting an event out from under an in-flight scout/qualify wave or a
  // live outreach send orphans whatever background work is mid-flight (it keeps
  // writing to agent_runs/suppliers rows that ON DELETE CASCADE just removed,
  // and any in-progress send_outreach call loses its supplier row mid-send).
  // Block the delete while a run is genuinely active. Mirrors the GET route's
  // >5min-since-updated_at staleness check so a truly abandoned run (crashed
  // serverless function, disconnected client) doesn't block deletion forever —
  // orchestrate's own maxDuration=300s guarantees nothing is really still
  // running past that window.
  const activeRun = await db.prepare(
    `SELECT id FROM agent_runs WHERE event_id = ? AND status IN ('queued','running')
     AND created_at > now() - make_interval(mins => 5) LIMIT 1`
  ).get(id);
  if (activeRun) {
    return NextResponse.json(
      { error: "This event has an active scouting/qualifying run. Wait for it to finish before deleting." },
      { status: 409 }
    );
  }
  if (owner.status === "outreach") {
    return NextResponse.json(
      { error: "This event has outreach in progress. Wait for it to finish before deleting." },
      { status: 409 }
    );
  }

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
