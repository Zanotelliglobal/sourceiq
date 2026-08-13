import { getDb, type AuditLog } from "@/lib/db";

// ─── AUDIT TRAIL ──────────────────────────────────────────────────────────────
// An append-only record of governance-relevant actions in an org: who did what,
// when, to which sourcing event. Logging is BEST-EFFORT — it must never break the
// action it is recording, so logAudit swallows its own errors. Reads are scoped
// by org (and optionally by event) so one tenant can never see another's history.

export type AuditAction =
  | "event.create"
  | "event.update"
  | "event.delete"
  | "discovery.run"
  | "discovery.quick_scan"
  | "outreach.launch"
  | "outreach.manual_send_confirmed"
  | "supplier.stage_change"
  | "responders.shortlist"
  | "followup.send"
  | "suppliers.export"
  | "gdpr.erasure";

export async function logAudit(input: {
  orgId: number;
  eventId?: number | null;
  actorId?: string | null;
  action: AuditAction;
  summary: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = getDb();
    await db
      .prepare(
        `INSERT INTO audit_log (org_id, event_id, actor_id, action, summary, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.orgId,
        input.eventId ?? null,
        input.actorId ?? null,
        input.action,
        input.summary,
        input.metadata ? JSON.stringify(input.metadata) : null
      );
  } catch {
    // Audit logging is non-critical; never surface its failures to the caller.
  }
}

/** Recent audit entries for one event, newest first. Org-scoped for safety. */
export async function getAuditForEvent(
  orgId: number,
  eventId: number,
  limit = 100
): Promise<AuditLog[]> {
  const db = getDb();
  return (await db
    .prepare(
      `SELECT * FROM audit_log WHERE org_id = ? AND event_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(orgId, eventId, limit)) as AuditLog[];
}

// ─── ACTOR LABELS ─────────────────────────────────────────────────────────────
// Audit rows store the Clerk user id only. We resolve human-readable labels at
// read time via the Clerk backend API, batched over the distinct ids in a page
// of results. Resolution is best-effort: unknown ids fall back to a short label.

export async function resolveActorLabels(
  actorIds: (string | null)[]
): Promise<Record<string, string>> {
  const ids = Array.from(new Set(actorIds.filter((x): x is string => !!x && x !== "dev_user")));
  const out: Record<string, string> = {};
  if (actorIds.includes("dev_user")) out["dev_user"] = "Local dev";
  if (ids.length === 0) return out;
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    // clerkClient is a function in recent SDKs, an object in older ones.
    const client = typeof clerkClient === "function" ? await clerkClient() : clerkClient;
    const res = await client.users.getUserList({ userId: ids, limit: ids.length });
    const users = Array.isArray(res) ? res : res.data;
    for (const u of users) {
      const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
      const email = u.emailAddresses?.[0]?.emailAddress;
      out[u.id] = name || email || `User ${u.id.slice(-6)}`;
    }
  } catch {
    // Clerk unavailable (e.g. dev bypass) — fall back to short ids below.
  }
  for (const id of ids) if (!out[id]) out[id] = `User ${id.slice(-6)}`;
  return out;
}
