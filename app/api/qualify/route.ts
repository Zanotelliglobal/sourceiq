import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runOutreachAgent, runFollowUpAgent } from "@/lib/agents";
import { sendEmail, isMailLive, replyToAddress } from "@/lib/mail";
import { randomBytes } from "crypto";
import { recordUsage } from "@/lib/usage";
import { getOrgContext, orgOwnsEvent, orgOwnsSupplier } from "@/lib/tenant";

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
    return NextResponse.json({ success: true, moved: info.changes, shortlisted_ids: ids });
  }

  if (action === "move_stage") {
    await db.prepare("UPDATE suppliers SET funnel_stage = ? WHERE id = ?").run(stage, supplier_id);
    if (stage === "shortlisted") {
      await db.prepare("UPDATE suppliers SET buyer_approved_at = datetime('now') WHERE id = ?").run(supplier_id);
    }
    return NextResponse.json({ success: true });
  }

  if (action === "send_outreach") {
    const supplier = await db.prepare(`
      SELECT s.*, se.category, se.requirements, se.annual_spend
      FROM suppliers s JOIN sourcing_events se ON se.id = s.event_id
      WHERE s.id = ?
    `).get(supplier_id) as {
      id: number; event_id: number; name: string; country: string; contact_email: string | null;
      category: string; requirements: string; annual_spend: string;
    } | undefined;

    if (!supplier) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const email = await runOutreachAgent(
      supplier.name, supplier.country, supplier.category, supplier.requirements, supplier.annual_spend,
      (u) => { void recordUsage(db, supplier.event_id, "outreach", u as never); }
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
      (u) => { void recordUsage(db, supplier.event_id, "followup", u as never); }
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
    return NextResponse.json({ email, delivery, followup: true });
  }

  if (action === "mark_engaged") {
    await db.prepare("UPDATE suppliers SET outreach_status='responded', supplier_responded_at=datetime('now'), funnel_stage='engaged' WHERE id=?")
      .run(supplier_id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
