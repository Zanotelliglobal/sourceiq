import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getDb } from "@/lib/db";
import { parseReplyToken } from "@/lib/mail";
import { runReplyClassifierAgent } from "@/lib/agents";
import { recordUsage } from "@/lib/usage";

export const maxDuration = 120;

// ─── INBOUND SUPPLIER REPLY WEBHOOK ───────────────────────────────────────────
// Providers (Resend) POST here when a supplier replies to an RFI. Flow:
//   1. Verify the Svix signature (RESEND_WEBHOOK_SECRET) — reject spoofed calls.
//   2. Extract the reply token from the recipient (reply+<token>@domain).
//   3. Match the supplier, classify the real reply, and drive the funnel gate:
//        · genuine interest → stage "responded" (gate passed)
//        · decline / neutral / auto-reply → stage "declined" (no advance)
// This is the LIVE counterpart to the demo-mode simulated response.

// Svix signature verification (Resend uses Svix under the hood).
function verifySvix(secret: string, id: string, timestamp: string, body: string, header: string): boolean {
  try {
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const signedContent = `${id}.${timestamp}.${body}`;
    const expected = createHmac("sha256", key).update(signedContent).digest("base64");
    // Header is a space-separated list of "v1,<signature>" entries.
    for (const part of header.split(" ")) {
      const sig = part.split(",")[1];
      if (!sig) continue;
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    }
  } catch {
    // fall through to false
  }
  return false;
}

// Recipient can arrive as a string, an array, or {address} objects depending on provider shape.
function extractRecipient(to: unknown): string | null {
  if (!to) return null;
  if (typeof to === "string") return to;
  if (Array.isArray(to)) {
    for (const item of to) {
      const r = extractRecipient(item);
      if (r) return r;
    }
    return null;
  }
  if (typeof to === "object") {
    const o = to as { address?: string; email?: string };
    return o.address || o.email || null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  // ── 1. Signature verification (unless explicitly disabled for local testing) ──
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const id = req.headers.get("svix-id") || "";
    const timestamp = req.headers.get("svix-timestamp") || "";
    const signature = req.headers.get("svix-signature") || "";
    if (!id || !timestamp || !signature || !verifySvix(secret, id, timestamp, raw, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else if (process.env.INBOUND_ALLOW_UNSIGNED !== "true") {
    // Fail closed: no secret configured and unsigned not explicitly allowed.
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  let payload: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── 2. Pull the fields we need out of the provider payload ──
  const data = payload?.data ?? payload;
  const recipient = extractRecipient(data?.to);
  const token = parseReplyToken(recipient);
  const fromAddress = extractRecipient(data?.from) || "";

  // Resend's `email.received` webhook carries METADATA ONLY — no body, headers,
  // or attachments (keeps the payload small for serverless). We must fetch the
  // full message from the Received Emails API using the email id. Older/other
  // provider shapes may inline the body, so prefer inline when present.
  let replyBody: string =
    (typeof data?.text === "string" && data.text) ||
    (typeof data?.stripped_text === "string" && data.stripped_text) ||
    (typeof data?.html === "string" && data.html.replace(/<[^>]+>/g, " ")) ||
    "";
  const emailId: string | null =
    (typeof data?.email_id === "string" && data.email_id) ||
    (typeof data?.id === "string" && data.id) ||
    null;
  if (!replyBody && emailId && process.env.RESEND_API_KEY) {
    try {
      const r = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      });
      if (r.ok) {
        const full = (await r.json()) as { text?: string; html?: string };
        replyBody =
          (typeof full.text === "string" && full.text) ||
          (typeof full.html === "string" && full.html.replace(/<[^>]+>/g, " ")) ||
          "";
      }
    } catch {
      // Non-fatal: fall through with an empty body; the raw event is still logged.
    }
  }

  if (!token) {
    // No routable token — acknowledge so the provider doesn't retry, but do nothing.
    return NextResponse.json({ ok: true, matched: false, reason: "no reply token in recipient" });
  }

  const db = getDb();
  const supplier = await db.prepare(`
    SELECT s.*, se.category, se.requirements
    FROM suppliers s JOIN sourcing_events se ON se.id = s.event_id
    WHERE s.reply_token = ?
  `).get(token) as {
    id: number; event_id: number; name: string; country: string;
    category: string; requirements: string;
  } | undefined;

  if (!supplier) {
    return NextResponse.json({ ok: true, matched: false, reason: "no supplier for token" });
  }

  // Log the raw inbound message immediately (even if classification fails later).
  await db.prepare("INSERT INTO outreach_logs (supplier_id, direction, subject, body) VALUES (?, 'inbound', ?, ?)")
    .run(supplier.id, `Re: RFI — ${supplier.name}`, replyBody || "(empty message)");

  // ── 3. Classify the real reply and drive the funnel gate ──
  let cls;
  try {
    cls = await runReplyClassifierAgent(
      supplier.name, supplier.country, supplier.category, supplier.requirements, replyBody,
      (u) => { void recordUsage(db, supplier.event_id, "reply_classifier", u as never); }
    );
  } catch (err) {
    return NextResponse.json({ ok: true, matched: true, classified: false, error: String(err) });
  }

  await db.prepare("UPDATE suppliers SET response_detail=? WHERE id=?").run(JSON.stringify(cls), supplier.id);

  if (cls.interested && cls.sentiment === "positive" && !cls.is_auto_reply) {
    await db.prepare(`UPDATE suppliers SET outreach_status='responded', supplier_responded_at=datetime('now'), funnel_stage='responded' WHERE id=?`)
      .run(supplier.id);
  } else if (!cls.is_auto_reply) {
    // A genuine but non-qualifying reply (decline / neutral) — record it, mark declined.
    await db.prepare(`UPDATE suppliers SET outreach_status='responded', supplier_responded_at=datetime('now'), funnel_stage='declined' WHERE id=?`)
      .run(supplier.id);
  }
  // Auto-replies (OOO/bounces) leave the funnel stage untouched — still awaiting a real reply.

  return NextResponse.json({
    ok: true,
    matched: true,
    supplier_id: supplier.id,
    from: fromAddress,
    sentiment: cls.sentiment,
    interested: cls.interested,
    is_auto_reply: cls.is_auto_reply,
  });
}
