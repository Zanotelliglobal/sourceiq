import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runOutreachAgent, runSupplierResponseAgent, resolveSupplierContact, AGENT_MODELS } from "@/lib/agents";
import { sendEmail, isMailLive, mailStatus, replyToAddress, withComplianceFooter, unsubscribeHeaders, rfiUrl } from "@/lib/mail";
import { randomBytes } from "crypto";
import { recordUsage, usageSummary, effectiveTier, checkOutreachAllowed, checkSpendCeiling } from "@/lib/usage";
import { getOrgContext } from "@/lib/tenant";
import { requireActiveSubscription } from "@/lib/billing";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { rateLimit } from "@/lib/ratelimit";

export const maxDuration = 300;

// Agentic outreach campaign.
// For every supplier still in the Long List (or explicitly targeted), the agent:
//   1. drafts + sends an anonymous RFI  → stage becomes "contacted"
//   2. simulates the supplier's reply
//        · positive info  → stage becomes "responded" (gate passed)
//        · negative / silent → stage becomes "declined"
// Results stream back over SSE so the UI can animate the funnel in real time.
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  // A campaign is a live-email-sending, multi-supplier agent run — not a cheap
  // CRUD call. Cap launches per org, with a distinct `code` from the 402
  // plan-limit responses above so the client can tell "you're out of plan"
  // apart from "you're launching too fast."
  const orgRl = await rateLimit("outreach-launch", String(ctx.orgId), 10, 60);
  if (!orgRl.ok) {
    return NextResponse.json(
      { error: "Too many outreach campaigns launched. Please slow down.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(orgRl.retryAfter) } },
    );
  }

  const { event_id, supplier_ids } = await req.json();
  const db = getDb();

  const event = await db.prepare("SELECT * FROM sourcing_events WHERE id = ?").get(event_id) as {
    id: number; org_id: number; category: string; requirements: string; annual_spend: string;
    status: string | null; updated_at: string | null;
    outreach_anonymous: boolean; buyer_name: string | null; buyer_role: string | null; buyer_company: string | null;
  } | undefined;
  if (!event || Number(event.org_id) !== ctx.orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Concurrency guard: stop a double-click/replayed request/second tab from
  // starting an overlapping campaign against the same event, which would
  // race writes to suppliers/outreach_logs/status. Mirror the GET endpoints'
  // interruption staleness window (>5 min since the last write) so a
  // crashed/timed-out campaign doesn't lock the event out of new runs
  // forever — the DB row's status is never written back on that path, only
  // downgraded in-memory for the read response.
  if (event.status === "scouting" || event.status === "outreach") {
    const updatedMs = event.updated_at ? new Date(event.updated_at).getTime() : 0;
    const stale = !updatedMs || Date.now() - updatedMs > 5 * 60_000;
    if (!stale) {
      return NextResponse.json(
        { error: "A run is already in progress for this event.", code: "run_in_progress" },
        { status: 409 },
      );
    }
  }

  // Hard per-event cost ceiling (#65) — a batch campaign can fan out to many
  // suppliers at once, so gate the whole run before any contact-discovery /
  // drafting spend happens.
  const spendCheck = await checkSpendCeiling(db, tier, event.id);
  if (!spendCheck.ok) {
    return NextResponse.json({
      error: `This event has reached its $${spendCheck.limit} AI-spend ceiling (used $${spendCheck.used.toFixed(2)}). Contact support to raise the limit before sending more outreach.`,
      code: spendCheck.reason,
    }, { status: 402 });
  }

  const buyer = event.outreach_anonymous
    ? null
    : { name: event.buyer_name, role: event.buyer_role, company: event.buyer_company };

  // Target: explicit list, else everyone sitting in the long list.
  // Opted-out suppliers are suppressed — never re-contacted, even if selected.
  // Also exclude anyone on the org's durable suppression list (#98): an email
  // that opted out (or requested erasure, #99) in a PAST sourcing event must
  // stay suppressed even though this event's supplier row is brand new.
  const suppressionClause = `AND (contact_email IS NULL OR LOWER(contact_email) NOT IN (SELECT email FROM suppression_list WHERE org_id=?))`;
  const targets = (Array.isArray(supplier_ids) && supplier_ids.length > 0
    ? await db.prepare(
        `SELECT * FROM suppliers WHERE event_id=? AND opted_out IS NOT TRUE ${suppressionClause} AND id IN (${supplier_ids.map(() => "?").join(",")})`
      ).all(event.id, ctx.orgId, ...supplier_ids)
    : await db.prepare(
        `SELECT * FROM suppliers WHERE event_id=? AND opted_out IS NOT TRUE ${suppressionClause} AND funnel_stage='long_list' ORDER BY ai_score DESC`
      ).all(event.id, ctx.orgId)) as {
    id: number; name: string; country: string; ai_score: number | null; contact_email: string | null; website: string | null; contact_url: string | null;
  }[];

  const live = isMailLive();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
      };
      const track = (stage: string, model: string) => (u: unknown) => {
        void (async () => {
          await recordUsage(db, event.id, stage, u as never, model);
          const s = await usageSummary(db, event.id);
          send({ type: "usage", cost_usd: s.cost_usd, total_tokens: s.total_tokens, web_searches: s.web_searches });
        })();
      };

      // Campaigns can run long (many suppliers, each with a contact-discovery +
      // draft + simulated-reply round trip). Touch updated_at periodically so
      // the GET list/detail endpoints' "interrupted run" staleness heuristic
      // (>5 min since updated_at while status='outreach') doesn't false-positive
      // on a healthy long-running campaign — updated_at was previously only
      // written at campaign start/end.
      const heartbeat = setInterval(() => {
        void db.prepare(`UPDATE sourcing_events SET updated_at=datetime('now') WHERE id=?`).run(event.id).catch(() => {});
      }, 20000);

      try {
        await db.prepare(`UPDATE sourcing_events SET status='outreach', updated_at=datetime('now') WHERE id=?`).run(event.id);
        await logAudit({
          orgId: ctx.orgId, eventId: event.id, actorId: ctx.userId,
          action: "outreach.launch",
          summary: `Launched ${live ? "LIVE" : "draft"} outreach to ${targets.length} suppliers`,
          metadata: { count: targets.length, live, anonymous: event.outreach_anonymous },
        });
        const status = mailStatus();
        send({
          type: "campaign_start",
          total: targets.length,
          live,
          mail: status,
          message: live
            ? `📤 LIVE outreach — sending real emails via ${status.provider} from ${status.from} to ${targets.length} suppliers...`
            : `📨 DRAFT outreach (simulation) — no real emails sent (${status.reason}). Engaging ${targets.length} suppliers...`,
        });

        let sent = 0, positive = 0, declined = 0, awaiting = 0, skipped = 0, failed = 0, awaitingManual = 0;

        // Each target's chain (contact discovery → draft/send → simulated reply)
        // is ~15-40s of agent + network latency. Processing targets one at a time
        // guarantees the serverless maxDuration (300s) is blown past ~15-20
        // suppliers, and any real campaign (up to the plan's supplier cap) will
        // exceed it by a wide margin (#93). Targets are independent — no shared
        // per-iteration state besides the campaign-level counters below, which
        // are simple synchronous increments (safe under Node's single-threaded
        // event loop, same pattern as orchestrate's newSuppliers += ... ) — so we
        // fan them out through a bounded worker pool, mirroring the qualifier
        // pool in app/api/orchestrate/route.ts. Concurrency is env-overridable
        // in case a mail/agent provider's rate limits need a lower cap.
        const processTarget = async (s: (typeof targets)[number]) => {
          // 0 ── Contact discovery: resolve the best reachable channel if we have no email.
          if (!s.contact_email) {
            try {
              const found = await resolveSupplierContact(s.name, s.country, s.website || "", track("contact_finder", AGENT_MODELS.contactFinder));
              if (found.contact_email || found.contact_url || found.phone || found.linkedin) {
                s.contact_email = found.contact_email || s.contact_email;
                await db.prepare(
                  "UPDATE suppliers SET contact_email=COALESCE(NULLIF(?,''), contact_email), contact_url=COALESCE(NULLIF(?,''), contact_url), contact_phone=COALESCE(NULLIF(?,''), contact_phone), contact_linkedin=COALESCE(NULLIF(?,''), contact_linkedin) WHERE id=?"
                ).run(found.contact_email, found.contact_url, found.phone, found.linkedin, s.id);
                send({ type: "contact_found", supplier_id: s.id, supplier_name: s.name,
                  contact_email: found.contact_email, contact_url: found.contact_url, phone: found.phone });
              }
            } catch { /* non-fatal — continue with draft */ }
          }

          // 1 ── Draft + send RFI
          send({ type: "contacting", supplier_id: s.id, supplier_name: s.name });
          let email;
          try {
            email = await runOutreachAgent(s.name, s.country, event.category, event.requirements, event.annual_spend, track("outreach", AGENT_MODELS.outreach), buyer);
          } catch (err) {
            send({ type: "supplier_error", supplier_id: s.id, message: String(err) });
            return;
          }

          // ── Website-contact channel ──
          // No email address, but we do have a contact page: we can't reliably
          // auto-submit an arbitrary third-party form (every site has a
          // different schema, and there's no server-side browser automation
          // here), so log the drafted RFI for the buyer to paste in manually
          // instead of silently marking the supplier "skipped". This is a
          // distinct terminal-for-now state (outreach_status='awaiting_manual_send')
          // that the event detail page surfaces with a "Contact via website"
          // action (open contact_url + copy draft + mark sent).
          if (!s.contact_email && s.contact_url) {
            await db.prepare(
              "INSERT INTO outreach_logs (supplier_id, direction, subject, body, channel) VALUES (?, 'outbound', ?, ?, 'website_form')"
            ).run(s.id, email.subject, `${email.body}\n\n---\n[EN] ${email.body_en}`);
            await db.prepare(`UPDATE suppliers SET outreach_status='awaiting_manual_send' WHERE id=?`).run(s.id);
            awaitingManual++;
            send({
              type: "awaiting_manual_contact", supplier_id: s.id, supplier_name: s.name,
              contact_url: s.contact_url, subject: email.subject, body: email.body,
            });
            return;
          }

          // ── Mint a per-supplier reply token so inbound replies thread back here ──
          const replyToken = randomBytes(9).toString("base64url");
          await db.prepare("UPDATE suppliers SET reply_token=? WHERE id=?").run(replyToken, s.id);

          // ── Deliver the RFI (real send when live, no-op draft otherwise) ──
          // Every outbound RFI carries a compliant unsubscribe footer + headers.
          // Send ONLY the localized body — a dual-language email with an "[EN]"
          // separator block is a classic spam signal. The English translation is
          // still logged below for the dashboard, just not sent to the supplier.
          // Offer a one-click branded web form as an alternative to replying by
          // email. Suppliers who prefer a structured response land on /supplier/rfi.
          const formUrl = rfiUrl(replyToken);
          const bodyWithCta = formUrl
            ? `${email.body}\n\nPrefer a quick web form? You can respond in one minute here:\n${formUrl}`
            : email.body;
          const rfiBody = withComplianceFooter(bodyWithCta, replyToken);
          let delivery;
          try {
            delivery = await sendEmail({
              to: s.contact_email,
              subject: email.subject,
              body: rfiBody,
              replyTo: replyToAddress(replyToken) ?? undefined,
              headers: unsubscribeHeaders(replyToken),
            });
          } catch (err) {
            failed++;
            send({ type: "supplier_error", supplier_id: s.id, message: `Send failed: ${String(err)}` });
            return;
          }

          if (live && !delivery.sent) {
            // Live mode but this supplier couldn't be emailed (usually no address).
            await db.prepare(`UPDATE suppliers SET outreach_status='skipped' WHERE id=?`).run(s.id);
            skipped++;
            send({ type: "skipped", supplier_id: s.id, supplier_name: s.name, reason: delivery.reason });
            return;
          }

          await db.prepare("INSERT INTO outreach_logs (supplier_id, direction, subject, body) VALUES (?, 'outbound', ?, ?)")
            .run(s.id, email.subject, `${email.body}\n\n---\n[EN] ${email.body_en}`);
          await db.prepare(`UPDATE suppliers SET outreach_status='sent', outreach_sent_at=datetime('now'), funnel_stage='contacted' WHERE id=?`)
            .run(s.id);
          sent++;
          send({ type: "contacted", supplier_id: s.id, supplier_name: s.name, mode: delivery.mode });

          if (live) {
            // Real email is out. We must wait for a genuine inbound reply — the
            // response gate is driven by the inbound webhook, NOT simulated here.
            awaiting++;
            send({ type: "awaiting_reply", supplier_id: s.id, supplier_name: s.name });
            return;
          }

          // ── DRAFT/DEMO mode only: simulate the supplier's reply ──
          let resp;
          try {
            resp = await runSupplierResponseAgent(
              s.name, s.country, s.ai_score ?? 60,
              event.category, event.requirements, email.body,
              track("supplier_response", AGENT_MODELS.supplierResponse)
            );
          } catch {
            resp = { responded: false, sentiment: "negative" as const, language: "English", reply: "", reply_en: "", capacity_confirmed: "N/A", lead_time: "N/A", highlights: [] };
          }

          if (resp.responded) {
            await db.prepare("INSERT INTO outreach_logs (supplier_id, direction, subject, body) VALUES (?, 'inbound', ?, ?)")
              .run(s.id, `Re: RFI — ${s.name}`, resp.reply || "(no message)");
          }
          await db.prepare("UPDATE suppliers SET response_detail=? WHERE id=?").run(JSON.stringify(resp), s.id);

          if (resp.responded && resp.sentiment === "positive") {
            // Gate passed — advance to Responded.
            await db.prepare(`UPDATE suppliers SET outreach_status='responded', supplier_responded_at=datetime('now'), funnel_stage='responded' WHERE id=?`)
              .run(s.id);
            positive++;
            send({ type: "responded", supplier_id: s.id, supplier_name: s.name, sentiment: "positive", detail: resp });
          } else {
            // No reply or a decline — moves to Declined.
            if (resp.responded) {
              await db.prepare(`UPDATE suppliers SET outreach_status='responded', supplier_responded_at=datetime('now'), funnel_stage='declined' WHERE id=?`)
                .run(s.id);
            } else {
              await db.prepare(`UPDATE suppliers SET funnel_stage='declined' WHERE id=?`).run(s.id);
            }
            declined++;
            send({ type: "declined", supplier_id: s.id, supplier_name: s.name, responded: resp.responded, detail: resp });
          }
        };

        // Bounded worker pool — the big wall-clock win over sequential (#93).
        // Default of 5 concurrent targets keeps a 20-supplier campaign inside a
        // ~60-90s wall clock instead of guaranteeing the 300s timeout; tune down
        // per-deployment if a mail/agent provider's rate limits need a lower cap.
        const outreachConcurrency = Math.max(1, Number(process.env.OUTREACH_CONCURRENCY) || 5);
        let tCursor = 0;
        const tWorker = async () => {
          while (tCursor < targets.length) {
            const idx = tCursor++;
            await processTarget(targets[idx]);
          }
        };
        await Promise.all(Array.from({ length: Math.min(outreachConcurrency, targets.length) }, tWorker));

        await db.prepare(`UPDATE sourcing_events SET status='reviewing', updated_at=datetime('now') WHERE id=?`).run(event.id);
        send({ type: "campaign_complete", live, sent, positive, declined, awaiting, skipped, awaiting_manual: awaitingManual });

        // Notify the org if any outreach couldn't be delivered (hard send errors
        // or, in live mode, suppliers skipped for a missing/invalid address).
        const undelivered = failed + (live ? skipped : 0);
        if (undelivered > 0) {
          await notify({
            orgId: ctx.orgId, type: "outreach_failure", eventId: event.id,
            title: `Outreach delivery issue`,
            body: `${undelivered} supplier${undelivered === 1 ? "" : "s"} could not be contacted. Check their email addresses and retry.`,
            url: `/events/${event.id}`,
            emailUserId: ctx.userId,
          });
        }
      } catch (err) {
        send({ type: "error", message: String(err) });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    }
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (Vercel/nginx) so events flush to the client
      // as they are produced rather than being held until the stream closes.
      "X-Accel-Buffering": "no",
    }
  });
}
