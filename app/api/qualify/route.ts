import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runOutreachAgent, runFollowUpAgent, resolveSupplierContact, AGENT_MODELS } from "@/lib/agents";
import { sendEmail, isMailLive, replyToAddress, withComplianceFooter, unsubscribeHeaders, rfiUrl } from "@/lib/mail";
import { randomBytes } from "crypto";
import { recordUsage, effectiveTier, checkOutreachAllowed, checkSpendCeiling } from "@/lib/usage";
import { getOrgContext, orgOwnsEvent, orgOwnsSupplier } from "@/lib/tenant";
import { requireActiveSubscription } from "@/lib/billing";
import { logAudit } from "@/lib/audit";
import { claimOutreachSend, releaseOutreachClaim, claimFollowupSend, releaseFollowupClaim } from "@/lib/outreach-claim";
import { isSuppressed } from "@/lib/suppression";

// Every funnel_stage value the app actually understands (see STAGES/FUNNEL in
// app/events/[id]/page.tsx and the "disqualified" dimmed-row treatment there).
// The suppliers.funnel_stage column has no DB-level CHECK constraint, so this
// endpoint is the only gate against writing an arbitrary string into it.
const FUNNEL_STAGES = new Set([
  "long_list", "contacted", "responded", "shortlisted", "declined", "engaged", "disqualified",
]);

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
    if (typeof stage !== "string" || !FUNNEL_STAGES.has(stage)) {
      return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
    }
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

  // Per-supplier send actions are the same live-outreach capability as the
  // batch /api/outreach campaign endpoint, just invoked one supplier at a
  // time — they need the identical subscription + plan-tier gate, which this
  // route previously lacked entirely (only tenant ownership was checked
  // above), letting a free/basic-tier org send live outreach with zero plan
  // enforcement.
  if (action === "send_outreach" || action === "send_followup") {
    const gate = requireActiveSubscription(ctx.org);
    if (!gate.ok) return NextResponse.json({ error: gate.reason, code: "subscription_required" }, { status: 402 });
    const tier = effectiveTier(ctx.org);
    const outreachCheck = checkOutreachAllowed(tier);
    if (!outreachCheck.ok) {
      return NextResponse.json({
        error: `Live supplier outreach isn't included in your ${tier.name} plan. Upgrade to Growth or higher to contact suppliers.`,
        code: outreachCheck.reason,
      }, { status: 402 });
    }
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
      website: string | null; outreach_status: string; opted_out: boolean | null;
    } | undefined;

    if (!supplier) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Hard per-event cost ceiling (#65) — same cap the batch /api/outreach
    // campaign endpoint enforces, applied here since this route sends the
    // identical live outreach one supplier at a time.
    const spendCheck = await checkSpendCeiling(db, effectiveTier(ctx.org), supplier.event_id);
    if (!spendCheck.ok) {
      return NextResponse.json({
        error: `This event has reached its $${spendCheck.limit} AI-spend ceiling (used $${spendCheck.used.toFixed(2)}). Contact support to raise the limit before contacting more suppliers.`,
        code: spendCheck.reason,
      }, { status: 402 });
    }

    // This single-supplier send path shares the same suppression obligations
    // as the batch /api/outreach campaign endpoint (#98): a supplier who
    // opted out — on this row, or via the org-wide durable suppression list
    // from a past event — must never be re-contacted here either. Checked
    // before claiming so an opted-out supplier never flips into "sending".
    if (supplier.opted_out) {
      return NextResponse.json({ error: "This supplier has opted out and cannot be contacted." }, { status: 409 });
    }
    if (await isSuppressed(db, ctx.orgId, supplier.contact_email)) {
      return NextResponse.json({ error: "This contact is on the do-not-contact list and cannot be emailed." }, { status: 409 });
    }

    // Atomic claim (#62): two concurrent requests for the same supplier
    // (double-click, two open tabs) must not both draft+send. Only the
    // request whose UPDATE actually matches a row proceeds; the loser gets a
    // 409 instead of sending a duplicate email. originalStatus is what we
    // roll back to if drafting/sending fails below, so a genuine retry isn't
    // permanently blocked.
    const originalStatus = supplier.outreach_status;
    const claim = await claimOutreachSend(db, supplier_id);
    if (!claim.ok) {
      return NextResponse.json({ error: "Outreach already sent or already in progress for this supplier." }, { status: 409 });
    }

    try {
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

      let email;
      try {
        email = await runOutreachAgent(
          supplier.name, supplier.country, supplier.category, supplier.requirements, supplier.annual_spend,
          (u) => { void recordUsage(db, supplier.event_id, "outreach", u as never, AGENT_MODELS.outreach); },
          buyer
        );
      } catch (err) {
        await releaseOutreachClaim(db, supplier_id, originalStatus);
        return NextResponse.json({ error: `Draft failed: ${String(err)}` }, { status: 502 });
      }

      const replyToken = randomBytes(9).toString("base64url");
      await db.prepare("UPDATE suppliers SET reply_token=? WHERE id=?").run(replyToken, supplier_id);

      // Every outbound RFI carries a compliant unsubscribe footer + headers
      // (CAN-SPAM/GDPR), same as the batch campaign path. Send only the
      // localized body — the dual-language block is logged, not sent.
      const formUrl = rfiUrl(replyToken);
      const bodyWithCta = formUrl
        ? `${email.body}\n\nPrefer a quick web form? You can respond in one minute here:\n${formUrl}`
        : email.body;
      const rfiBody = withComplianceFooter(bodyWithCta, replyToken);

      const live = isMailLive();
      let delivery;
      try {
        delivery = await sendEmail({
          to: supplier.contact_email,
          subject: email.subject,
          body: rfiBody,
          replyTo: replyToAddress(replyToken) ?? undefined,
          headers: unsubscribeHeaders(replyToken),
        });
      } catch (err) {
        await releaseOutreachClaim(db, supplier_id, originalStatus);
        return NextResponse.json({ error: `Send failed: ${String(err)}` }, { status: 502 });
      }

      if (live && !delivery.sent) {
        // Live mode but couldn't deliver (typically no contact email on file).
        // Release the claim so a corrected retry (e.g. after adding an email) isn't blocked.
        await releaseOutreachClaim(db, supplier_id, originalStatus);
        return NextResponse.json({ email, delivery, warning: delivery.reason }, { status: 200 });
      }

      await db.prepare("INSERT INTO outreach_logs (supplier_id, direction, subject, body) VALUES (?, 'outbound', ?, ?)")
        .run(supplier_id, email.subject, `${email.body}\n\n---\n[EN] ${email.body_en}`);
      await db.prepare("UPDATE suppliers SET outreach_status='sent', outreach_sent_at=datetime('now'), funnel_stage='contacted' WHERE id=?")
        .run(supplier_id);

      return NextResponse.json({ email, delivery });
    } catch (err) {
      // Belt-and-suspenders: any unexpected throw releases the claim too,
      // rather than leaving the supplier stuck at outreach_status='sending'.
      await releaseOutreachClaim(db, supplier_id, originalStatus);
      return NextResponse.json({ error: `Send outreach failed: ${String(err)}` }, { status: 500 });
    }
  }

  if (action === "send_followup") {
    const supplier = await db.prepare(`
      SELECT s.*, se.category
      FROM suppliers s JOIN sourcing_events se ON se.id = s.event_id
      WHERE s.id = ?
    `).get(supplier_id) as {
      id: number; event_id: number; name: string; country: string;
      contact_email: string | null; reply_token: string | null; category: string;
      opted_out: boolean | null;
    } | undefined;
    if (!supplier) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Hard per-event cost ceiling (#65).
    const spendCheck = await checkSpendCeiling(db, effectiveTier(ctx.org), supplier.event_id);
    if (!spendCheck.ok) {
      return NextResponse.json({
        error: `This event has reached its $${spendCheck.limit} AI-spend ceiling (used $${spendCheck.used.toFixed(2)}). Contact support to raise the limit before sending more follow-ups.`,
        code: spendCheck.reason,
      }, { status: 402 });
    }

    // Same suppression obligations as send_outreach above (#98) — a follow-up
    // nudge is still an unsolicited contact and must honor an opt-out.
    if (supplier.opted_out) {
      return NextResponse.json({ error: "This supplier has opted out and cannot be contacted." }, { status: 409 });
    }
    if (await isSuppressed(db, ctx.orgId, supplier.contact_email)) {
      return NextResponse.json({ error: "This contact is on the do-not-contact list and cannot be emailed." }, { status: 409 });
    }

    // Atomic claim (#62): guards against two concurrent send_followup
    // requests for the same supplier both drafting + sending. Unlike
    // send_outreach there's no persistent "already followed up" state (a
    // supplier can legitimately get more than one follow-up over time), so
    // this only locks the concurrent-request window, not the supplier long-term.
    const followupClaim = await claimFollowupSend(db, supplier_id);
    if (!followupClaim.ok) {
      return NextResponse.json({ error: "A follow-up is already being sent for this supplier." }, { status: 409 });
    }

    try {
      // Find the subject of the last outbound RFI to reference in the nudge.
      const lastOut = await db.prepare(
        "SELECT subject FROM outreach_logs WHERE supplier_id=? AND direction='outbound' ORDER BY sent_at DESC LIMIT 1"
      ).get(supplier_id) as { subject: string | null } | undefined;

      let email;
      try {
        email = await runFollowUpAgent(
          supplier.name, supplier.country, supplier.category, lastOut?.subject || "our recent inquiry",
          (u) => { void recordUsage(db, supplier.event_id, "followup", u as never, AGENT_MODELS.followUp); }
        );
      } catch (err) {
        await releaseFollowupClaim(db, supplier_id);
        return NextResponse.json({ error: `Draft failed: ${String(err)}` }, { status: 502 });
      }

      // Same compliance footer + List-Unsubscribe headers as the initial RFI
      // (#98/CAN-SPAM) — a follow-up is still commercial email and needs a
      // working opt-out. Fall back to a fresh reply token if one was never
      // minted (e.g. the original RFI predates reply-token support).
      const followupToken = supplier.reply_token || randomBytes(9).toString("base64url");
      if (!supplier.reply_token) {
        await db.prepare("UPDATE suppliers SET reply_token=? WHERE id=?").run(followupToken, supplier_id);
      }
      const followupBody = withComplianceFooter(`${email.body}`, followupToken);

      let delivery;
      try {
        delivery = await sendEmail({
          to: supplier.contact_email,
          subject: email.subject,
          body: followupBody,
          replyTo: replyToAddress(followupToken) ?? undefined,
          headers: unsubscribeHeaders(followupToken),
        });
      } catch (err) {
        await releaseFollowupClaim(db, supplier_id);
        return NextResponse.json({ error: `Send failed: ${String(err)}` }, { status: 502 });
      }

      if (isMailLive() && !delivery.sent) {
        await releaseFollowupClaim(db, supplier_id);
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
      await releaseFollowupClaim(db, supplier_id);
      return NextResponse.json({ email, delivery, followup: true });
    } catch (err) {
      await releaseFollowupClaim(db, supplier_id);
      return NextResponse.json({ error: `Send follow-up failed: ${String(err)}` }, { status: 500 });
    }
  }

  if (action === "mark_engaged") {
    await db.prepare("UPDATE suppliers SET outreach_status='responded', supplier_responded_at=datetime('now'), funnel_stage='engaged' WHERE id=?")
      .run(supplier_id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
