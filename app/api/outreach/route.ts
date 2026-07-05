import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runOutreachAgent, runSupplierResponseAgent } from "@/lib/agents";
import { sendEmail, isMailLive, mailStatus, replyToAddress } from "@/lib/mail";
import { randomBytes } from "crypto";
import { recordUsage, usageSummary } from "@/lib/usage";
import { getOrgContext } from "@/lib/tenant";
import { requireActiveSubscription } from "@/lib/billing";

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

  const { event_id, supplier_ids } = await req.json();
  const db = getDb();

  const event = await db.prepare("SELECT * FROM sourcing_events WHERE id = ?").get(event_id) as {
    id: number; org_id: number; category: string; requirements: string; annual_spend: string;
  } | undefined;
  if (!event || Number(event.org_id) !== ctx.orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Target: explicit list, else everyone sitting in the long list.
  const targets = (Array.isArray(supplier_ids) && supplier_ids.length > 0
    ? await db.prepare(
        `SELECT * FROM suppliers WHERE event_id=? AND id IN (${supplier_ids.map(() => "?").join(",")})`
      ).all(event.id, ...supplier_ids)
    : await db.prepare("SELECT * FROM suppliers WHERE event_id=? AND funnel_stage='long_list' ORDER BY ai_score DESC")
        .all(event.id)) as {
    id: number; name: string; country: string; ai_score: number | null; contact_email: string | null;
  }[];

  const live = isMailLive();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
      };
      const track = (stage: string) => (u: unknown) => {
        void (async () => {
          await recordUsage(db, event.id, stage, u as never);
          const s = await usageSummary(db, event.id);
          send({ type: "usage", cost_usd: s.cost_usd, total_tokens: s.total_tokens, web_searches: s.web_searches });
        })();
      };

      try {
        await db.prepare(`UPDATE sourcing_events SET status='outreach', updated_at=datetime('now') WHERE id=?`).run(event.id);
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

        let sent = 0, positive = 0, declined = 0, awaiting = 0, skipped = 0;

        for (const s of targets) {
          // 1 ── Draft + send RFI
          send({ type: "contacting", supplier_id: s.id, supplier_name: s.name });
          let email;
          try {
            email = await runOutreachAgent(s.name, s.country, event.category, event.requirements, event.annual_spend, track("outreach"));
          } catch (err) {
            send({ type: "supplier_error", supplier_id: s.id, message: String(err) });
            continue;
          }

          // ── Mint a per-supplier reply token so inbound replies thread back here ──
          const replyToken = randomBytes(9).toString("base64url");
          await db.prepare("UPDATE suppliers SET reply_token=? WHERE id=?").run(replyToken, s.id);

          // ── Deliver the RFI (real send when live, no-op draft otherwise) ──
          let delivery;
          try {
            delivery = await sendEmail({
              to: s.contact_email,
              subject: email.subject,
              body: `${email.body}\n\n---\n[EN] ${email.body_en}`,
              replyTo: replyToAddress(replyToken) ?? undefined,
            });
          } catch (err) {
            send({ type: "supplier_error", supplier_id: s.id, message: `Send failed: ${String(err)}` });
            continue;
          }

          if (live && !delivery.sent) {
            // Live mode but this supplier couldn't be emailed (usually no address).
            await db.prepare(`UPDATE suppliers SET outreach_status='skipped' WHERE id=?`).run(s.id);
            skipped++;
            send({ type: "skipped", supplier_id: s.id, supplier_name: s.name, reason: delivery.reason });
            continue;
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
            continue;
          }

          // ── DRAFT/DEMO mode only: simulate the supplier's reply ──
          let resp;
          try {
            resp = await runSupplierResponseAgent(
              s.name, s.country, s.ai_score ?? 60,
              event.category, event.requirements, email.body,
              track("supplier_response")
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
        }

        await db.prepare(`UPDATE sourcing_events SET status='reviewing', updated_at=datetime('now') WHERE id=?`).run(event.id);
        send({ type: "campaign_complete", live, sent, positive, declined, awaiting, skipped });
      } catch (err) {
        send({ type: "error", message: String(err) });
      } finally {
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
