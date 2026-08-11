import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getOrgContext, orgOwnsSupplier } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

// Website-contact outreach (manual channel): a supplier with no email but a
// reachable contact page gets its RFI drafted and logged (see
// app/api/outreach/route.ts, outreach_status='awaiting_manual_send'), but the
// buyer has to actually paste it into that site's form themselves — there's
// no general server-side browser automation here to submit an arbitrary
// third-party form. This endpoint lets the buyer confirm they did so, moving
// the supplier out of the "needs manual action" state and into the normal
// funnel, same as a real send would.
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { supplier_id } = await req.json();
  const supplierId = Number(supplier_id);
  if (!supplierId) return NextResponse.json({ error: "supplier_id required" }, { status: 400 });
  if (!(await orgOwnsSupplier(ctx.orgId, supplierId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const db = getDb();
  // Guard the transition: only a supplier actually sitting in
  // 'awaiting_manual_send' can be confirmed this way, so a stray/replayed
  // call can't fast-forward a supplier that was never routed to this channel.
  const result = await db
    .prepare(
      `UPDATE suppliers SET outreach_status='sent', outreach_sent_at=datetime('now'), funnel_stage='contacted'
       WHERE id=? AND outreach_status='awaiting_manual_send'`
    )
    .run(supplierId);
  if (result.changes === 0) {
    return NextResponse.json({ error: "Supplier is not awaiting a manual send" }, { status: 409 });
  }

  const supplier = await db.prepare("SELECT event_id, name FROM suppliers WHERE id = ?").get(supplierId) as
    { event_id: number; name: string } | undefined;

  await logAudit({
    orgId: ctx.orgId, eventId: supplier?.event_id ?? null, actorId: ctx.userId,
    action: "outreach.manual_send_confirmed",
    summary: `Confirmed manual website-form outreach sent to "${supplier?.name ?? supplierId}"`,
    metadata: { supplier_id: supplierId },
  });

  return NextResponse.json({ ok: true });
}
