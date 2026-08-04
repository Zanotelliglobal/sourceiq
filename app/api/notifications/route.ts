import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getOrgContext } from "@/lib/tenant";
import type { Notification } from "@/lib/notifications";

export const dynamic = "force-dynamic";

// GET /api/notifications
// Returns the org's recent notifications (most recent first) plus the unread
// count for the bell badge. Org-scoped: any authenticated member sees the feed.
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const items = (await db
    .prepare(
      `SELECT id, org_id, event_id, type, title, body, url, read, created_at
       FROM notifications WHERE org_id = ? ORDER BY created_at DESC LIMIT 30`
    )
    .all(ctx.orgId)) as Notification[];

  const unread = Number(
    (
      (await db
        .prepare(
          "SELECT COUNT(*)::int AS c FROM notifications WHERE org_id = ? AND read = false"
        )
        .get(ctx.orgId)) as { c: number } | undefined
    )?.c ?? 0
  );

  return NextResponse.json({ items, unread });
}

// POST /api/notifications  { id?: number, all?: boolean }
// Marks a single notification read (by id) or every unread notification read
// (all: true). Both persist an org-scoped update.
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, all } = (await req.json().catch(() => ({}))) as {
    id?: number;
    all?: boolean;
  };

  const db = getDb();
  if (all) {
    await db
      .prepare("UPDATE notifications SET read = true WHERE org_id = ? AND read = false")
      .run(ctx.orgId);
  } else if (typeof id === "number") {
    await db
      .prepare("UPDATE notifications SET read = true WHERE id = ? AND org_id = ?")
      .run(id, ctx.orgId);
  } else {
    return NextResponse.json({ error: "Provide id or all=true" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
