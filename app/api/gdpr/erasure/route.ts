import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getOrgContext, requireRole, orgOwnsSupplier } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { suppressEmail } from "@/lib/suppression";

// ─── GDPR / CCPA ERASURE (#99) ────────────────────────────────────────────────
// Scope: this endpoint erases the PERSONAL data of a single supplier CONTACT
// (the actual data subject making the request) — not the supplier company
// record, and not the buyer's account/org. The supplier company (name,
// capabilities, scoring, funnel history) is our own business record of a
// sourcing decision and stays intact; only the identifying contact details
// and message bodies that could contain personal data are removed.
//
// This is deliberately narrower than "delete this account" (which would also
// tear down Stripe subscriptions, Clerk memberships, etc.) — that is a
// separate, much more destructive action and is out of scope here without
// explicit product/legal sign-off.
//
// The erasure is also durable: we record the contact's email in the org-wide
// suppression_list (#98) and mark the row opted_out, so a future sourcing
// event can't accidentally re-discover and re-contact the same person.

export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Erasure is a destructive, hard-to-reverse action — restrict to admins/owners.
  const denied = requireRole(ctx, "admin");
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const supplierId = body?.supplier_id;
  if (!supplierId) return NextResponse.json({ error: "supplier_id required" }, { status: 400 });

  if (!(await orgOwnsSupplier(ctx.orgId, supplierId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const db = getDb();
  const supplier = await db
    .prepare("SELECT id, name, contact_email FROM suppliers WHERE id = ?")
    .get(supplierId) as { id: number; name: string; contact_email: string | null } | undefined;
  if (!supplier) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Redact anything on the supplier row that identifies or reaches the
  // contact. `opted_out` is also set so any in-flight campaign logic that
  // checks it (rather than the erased, now-null contact_email) still skips
  // this row.
  await db
    .prepare(
      `UPDATE suppliers
       SET contact_email = NULL,
           contact_phone = NULL,
           contact_linkedin = NULL,
           contact_url = NULL,
           reply_token = NULL,
           response_detail = NULL,
           opted_out = true,
           opted_out_at = datetime('now')
       WHERE id = ?`
    )
    .run(supplierId);

  // Message bodies may quote or reference the contact's personal details
  // (signatures, phone numbers, names) — redact them too, but keep the log
  // rows themselves (direction/timestamps) for our own outreach-cadence
  // records.
  await db
    .prepare(
      `UPDATE outreach_logs SET subject = '[redacted]', body = '[redacted — contact requested erasure]' WHERE supplier_id = ?`
    )
    .run(supplierId);

  // Durable, org-wide: this contact must never be re-contacted, even from a
  // brand-new sourcing event created after this row's data is gone.
  try {
    if (supplier.contact_email) {
      await suppressEmail(db, ctx.orgId, supplier.contact_email, "gdpr_erasure");
    }
  } catch {
    /* best-effort — the row-level erasure above already took effect */
  }

  await logAudit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    action: "gdpr.erasure",
    summary: `Erased contact data for ${supplier.name}`,
    metadata: { supplier_id: supplier.id },
  });

  return NextResponse.json({ success: true });
}
