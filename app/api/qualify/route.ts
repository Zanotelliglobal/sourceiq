import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runOutreachAgent, runFollowUpAgent, resolveSupplierContact, AGENT_MODELS } from "@/lib/agents";
import { sendEmail, isMailLive, replyToAddress } from "@/lib/mail";
import { randomBytes } from "crypto";
import { recordUsage } from "@/lib/usage";
import { getOrgContext, orgOwnsEvent, orgOwnsSupplier } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { action, supplier_id, stage, event_id } = body;
  const db = getDb();

  // Tenant isolation: whatever this action targets must belong to the caller.
  if (event_id && !(await orgOwnsEvent(ctx.orgId, event_id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (supplier_id && !(await orgOwnsSupplier(ctx.orgId, supplier_id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Bulk: promote every positively-responded supplier straight to the Short List.
  if (action === "shortlist_responders") {
    if (!event_id) return NextResponse.json({ error: "event_id required" }, { status: 400 });
    const info = await db.prepare(
      `UPDATE suppliers SET funnel_stage='shortlisted', buyer_approved_at=datetime('now')
       WHERE event_id=? AND funnel_stage='responded'`
    ).run(event_id);
    const ids = (await db.prepare("SELECT id FROM suppliers WHERE event_id=? AND funnel_stage='shortlisted'").all(event_id) as { id: number }[]).map(r => r.id);
    await logAudit({
      orgId: ctx.orgId, eventId: Number(event_id), actorId: ctx.userId,
      action: "responders.shortlist",
      summary: `Shortlisted ${info.changes} responder${info.changes === 1 ? "" : "s"}`,
      metadata: { moved: info.changes },
    });
    return NextResponse.json({ success: true, moved: info.changes, shortlisted_ids: ids });
  }

  if (action === "move_stage") {
    const before = await db.prepare("SELECT name, event_id, funnel_stage FROM suppliers WHERE id = ?").get(supplier_id) as
      { name: string; event_id: number; funnel_stage: string | null } | undefined;
    await db.prepare("UPDATE suppliers SET funnel_stage = ? WHERE id = ?").run(stage, supplier_id);
    if (stage === "shortlisted") {
      await db.prepare("UPDATE suppliers SET buyer_approved_at = datetime('now') WHERE id = ?").run(supplier_id);
    }
    if (before) {
      await logAudit({
        orgId: ctx.orgId, eventId: Number(before.event_id), actorId: ctx.userId,
        action: "supplier.stage_change",
        summary: `Moved ${before.name} → ${stage}`,
        metadata: { supplier_id, from: before.funnel_stage, to: stage },
      });
    }
    return NextResponse.json({ success: true });
  }

  // Lightweight quality signal on a supplier's AI assessment (#46). -1/0/1;
  // 0 means "cleared" (re-clicking an active thumb toggles it off client-side).
  if (action === "set_feedback") {
    if (!supplier_id) return NextResponse.json({ error: "supplier_id required" }, { status: 400 });
    const signal = body.signal;
    if (signal !== -1 && signal !== 0 && signal !== 1) {
      return NextResponse.json({ error: "signal must be -1, 0, or 1" }, { status: 400 });
    }
    await db.prepare(
      "UPDATE suppliers SET feedback_signal = ?, feedback_updated_at = datetime('now') WHERE id = ?"
    ).run(signal, supplier_id);
    return NextResponse.json({ success: true });
  }

  if (action === "send_outreach") {
    const supplier = await db.prepare(`
      SELECT s.*, se.category, se.requirements, se.annual_spend,
             se.outreach_anonymous, se.buyer_name, se.buyer_role, se.buyer_company
      FROM suppliers s JOIN sourcing_events se ON se.id = s.event_id
      WHERE s.id = ?
    `).get(supplier_id) as {
      id: number; event_id: number; name: string; country: string; contact_email: string | null;
      category: string; requirements: string; annual_spend: string;
      outreach_anonymous: boolean; buyer_name: string | null; buyer_role: string | null; buyer_company: string | null;
      website: string | null;
    } | undefined;

    if (!supplier) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Contact discovery: if we don't yet have an email, resolve the best available
    // channel (scrape the site, then web-search fallback) before drafting.
    if (!supplier.contact_email) {
      try {
        const found = await resolveSupplierContact(
          supplier.name, supplier.country, supplier.website || "",
          (u) => { void recordUsage(db, supplier.event_id, "contact_finder", u as never, AGENT_MODELS.contactFinder); }
        );
        if (found.contact_email || found.contact_url || found.phone || found.linkedin) {
          supplier.contact_email = found.contact_email || supplier.contact_email;
          await db.prepare(
            "UPDATE suppliers SET contact_email=COALESCE(NULLIF(?,''), contact_email), contact_url=COALESCE(NULLIF(?,''), contact_url), contact_phone=COALESCE(NULLIF(?,''), contact_phone), contact_linkedin=COALESCE(NULLIF(?,''), contact_linkedin) WHERE id=?"
          ).run(found.contact_email, found.contact_url, found.phone, found.linkedin, supplier.id);
        }
      } catch { /* non-fatal — proceed without an address (draft/copy still works) */ }
    }

    const buyer = supplier.outreach_anonymous
      ? null
      : { name: supplier.buyer_name, role: supplier.buyer_role, company: supplier.buyer_company };

    const email = await runOutreachAgent(
      supplier.name, supplier.country, supplier.category, supplier.requirements, supplier.annual_spend,
      (u) => { void recordUsage(db, supplier.event_id, "outreach", u as never, AGENT_MODELS.outreach); },
      buyer
    );

    const replyToken = randomBytes(9).toString("base64url");
    await db.prepare("UPDATE suppliers SET reply_token=? WHERE id=?").run(replyToken, supplier_id);

    const live = isMailLive();
    let delivery;
    try {
      delivery = await sendEmail({
        to: supplier.contact_email,
        subject: email.subject,
        body: `${email.body}\n\n---\n[EN] ${email.body_en}`,
        replyTo: replyToAddress(replyToken) ?? undefined,
      });
    } catch (err) {
      return NextResponse.json({ error: `Send failed: ${String(err)}` }, { status: 502 });
    }

    if (live && !delivery.sent) {
      // Live mode but couldn't deliver (typically no contact email on file).
      return NextResponse.json({ email, delivery, warning: delivery.reason }, { status: 200 });
    }

    await db.prepare("INSERT INTO outreach_logs (supplier_id, direction, subject, body) VALUES (?, 'outbound', ?, ?)")
      .run(supplier_id, email.subject, `${email.body}\n\n---\n[EN] ${email.body_en}`);
    await db.prepare("UPDATE suppliers SET outreach_status='sent', outreach_sent_at=datetime('now'), funnel_stage='contacted' WHERE id=?")
      .run(supplier_id);

    return NextResponse.json({ email, delivery });
  }

  if (action === "send_followup") {
    const supplier = await db.prepare(`
      SELECT s.*, se.category
      FROM suppliers s JOIN sourcing_events se ON se.id = s.event_id
      WHERE s.id = ?
    `).get(supplier_id) as {
      id: number; event_id: number; name: string; country: string;
      contact_email: string | null; reply_token: string | null; category: string;
    } | undefined;
    if (!supplier) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Find the subject of the last outbound RFI to reference in the nudge.
    const lastOut = await db.prepare(
      "SELECT subject FROM outreach_logs WHERE supplier_id=? AND direction='outbound' ORDER BY sent_at DESC LIMIT 1"
    ).get(supplier_id) as { subject: string | null } | undefined;

    const email = await runFollowUpAgent(
      supplier.name, supplier.country, supplier.category, lastOut?.subject || "our recent inquiry",
      (u) => { void recordUsage(db, supplier.event_id, "followup", u as never, AGENT_MODELS.followUp); }
    );

    let delivery;
    try {
      delivery = await sendEmail({
        to: supplier.contact_email,
        subject: email.subject,
        body: `${email.body}\n\n---\n[EN] ${email.body_en}`,
        replyTo: supplier.reply_token ? (replyToAddress(supplier.reply_token) ?? undefined) : undefined,
      });
    } catch (err) {
      return NextResponse.json({ error: `Send failed: ${String(err)}` }, { status: 502 });
    }

    if (isMailLive() && !delivery.sent) {
      return NextResponse.json({ email, delivery, warning: delivery.reason }, { status: 200 });
    }

    await db.prepare("INSERT INTO outreach_logs (supplier_id, direction, subject, body) VALUES (?, 'outbound', ?, ?)")
      .run(supplier_id, email.subject, `${email.body}\n\n---\n[EN] ${email.body_en}`);
    await logAudit({
      orgId: ctx.orgId, eventId: Number(supplier.event_id), actorId: ctx.userId,
      action: "followup.send",
      summary: `Sent follow-up to ${supplier.name}`,
      metadata: { supplier_id, live: isMailLive() },
    });
    return NextResponse.json({ email, delivery, followup: true });
  }

  if (action === "mark_engaged") {
    await db.prepare("UPDATE suppliers SET outreach_status='responded', supplier_responded_at=datetime('now'), funnel_stage='engaged' WHERE id=?")
      .run(supplier_id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
