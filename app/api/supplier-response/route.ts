import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runReplyClassifierAgent } from "@/lib/agents";
import { recordUsage } from "@/lib/usage";

// ─── SUPPLIER RFI RESPONSE ENDPOINT ───────────────────────────────────────────
// Backs the branded /supplier/rfi web form. Suppliers who received an RFI can
// respond via a structured form instead of email. Authorized purely by the
// unguessable per-supplier reply token (same trust boundary as unsubscribe /
// inbound). No Clerk session is involved.
//
//   • GET  ?t=<token> → return the RFI context so the page can render.
//   • POST ?t=<token> → record the response, classify it, drive the funnel gate.

export const runtime = "nodejs";
export const maxDuration = 120;

type SupplierRow = {
  id: number; event_id: number; name: string; country: string;
  contact_email: string | null; funnel_stage: string; outreach_status: string;
  opted_out: boolean | null; response_detail: string | null;
  category: string; requirements: string; annual_spend: string | null;
  outreach_anonymous: boolean;
  buyer_name: string | null; buyer_role: string | null; buyer_company: string | null;
};

async function loadByToken(token: string | null): Promise<SupplierRow | undefined> {
  if (!token) return undefined;
  const db = getDb();
  return await db.prepare(`
    SELECT s.id, s.event_id, s.name, s.country, s.contact_email, s.funnel_stage,
           s.outreach_status, s.opted_out, s.response_detail,
           se.category, se.requirements, se.annual_spend, se.outreach_anonymous,
           se.buyer_name, se.buyer_role, se.buyer_company
    FROM suppliers s JOIN sourcing_events se ON se.id = s.event_id
    WHERE s.reply_token = ?
  `).get(token) as SupplierRow | undefined;
}

// Public-safe view of the RFI context. Never leaks buyer identity when the
// sourcing event is running in anonymous mode.
function publicContext(s: SupplierRow) {
  const disclosed = s.outreach_anonymous === false;
  return {
    supplier_name: s.name,
    country: s.country,
    contact_email: s.contact_email,
    category: s.category,
    requirements: s.requirements,
    annual_spend: s.annual_spend,
    already_responded: s.outreach_status === "responded" || !!s.response_detail,
    opted_out: s.opted_out === true,
    buyer: disclosed
      ? { name: s.buyer_name, role: s.buyer_role, company: s.buyer_company }
      : null,
  };
}

export async function GET(req: NextRequest) {
  const s = await loadByToken(req.nextUrl.searchParams.get("t"));
  if (!s) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, context: publicContext(s) });
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  const s = await loadByToken(token);
  if (!s || !token) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  if (s.opted_out === true) return NextResponse.json({ ok: false, reason: "opted_out" }, { status: 403 });

  let body: {
    interested?: string; capacity?: string; lead_time?: string;
    message?: string; contact_email?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 }); }

  const interested = String(body.interested || "").toLowerCase(); // "yes" | "no" | "maybe"
  const capacity = (body.capacity || "").trim();
  const leadTime = (body.lead_time || "").trim();
  const message = (body.message || "").trim();
  const contactEmail = (body.contact_email || "").trim();

  if (!message && !interested) {
    return NextResponse.json({ ok: false, reason: "empty" }, { status: 400 });
  }

  const db = getDb();

  // Update the contact email if the supplier corrected/provided one.
  if (contactEmail && contactEmail !== s.contact_email) {
    await db.prepare("UPDATE suppliers SET contact_email=? WHERE id=?").run(contactEmail, s.id);
  }

  // Compose a single reply text from the structured fields so the classifier —
  // the same one that grades real inbound emails — can grade this uniformly.
  const composed = [
    interested === "yes" ? "We are interested in this opportunity."
      : interested === "no" ? "We are not able to pursue this opportunity at this time."
      : interested === "maybe" ? "We may be interested and would like to learn more." : "",
    capacity ? `Capacity: ${capacity}` : "",
    leadTime ? `Indicative lead time: ${leadTime}` : "",
    message,
  ].filter(Boolean).join("\n");

  // Log the structured submission verbatim (before classification).
  await db.prepare("INSERT INTO outreach_logs (supplier_id, direction, subject, body) VALUES (?, 'inbound', ?, ?)")
    .run(s.id, `Web RFI response — ${s.name}`, composed || "(no message)");

  let cls;
  try {
    cls = await runReplyClassifierAgent(
      s.name, s.country, s.category, s.requirements, composed,
      (u) => { void recordUsage(db, s.event_id, "reply_classifier", u as never); }
    );
  } catch (err) {
    // Classification failed — keep the raw submission and fall back to the
    // supplier's own stated interest so their effort is never lost.
    const fallbackPositive = interested === "yes";
    const detail = {
      responded: true, sentiment: fallbackPositive ? "positive" : "negative",
      language: "English", reply: composed, reply_en: composed,
      capacity_confirmed: capacity || "N/A", lead_time: leadTime || "N/A", highlights: [] as string[],
    };
    await db.prepare("UPDATE suppliers SET response_detail=? WHERE id=?").run(JSON.stringify(detail), s.id);
    await db.prepare(
      `UPDATE suppliers SET outreach_status='responded', supplier_responded_at=datetime('now'), funnel_stage=? WHERE id=?`
    ).run(fallbackPositive ? "responded" : "declined", s.id);
    return NextResponse.json({ ok: true, classified: false, error: String(err) });
  }

  // Map the classifier's shape into the SupplierResponse the dashboard renders.
  const detail = {
    responded: true,
    sentiment: cls.sentiment === "positive" ? "positive" : "negative",
    language: cls.language || "English",
    reply: message || composed,
    reply_en: cls.summary_en || composed,
    capacity_confirmed: cls.capacity_confirmed || capacity || "N/A",
    lead_time: cls.lead_time || leadTime || "N/A",
    highlights: cls.highlights || [],
  };
  await db.prepare("UPDATE suppliers SET response_detail=? WHERE id=?").run(JSON.stringify(detail), s.id);

  // A web-form submission is never an auto-reply. Interest + positive sentiment
  // clears the gate; anything else records the response but stays in Declined.
  const qualifies = cls.interested && cls.sentiment === "positive";
  await db.prepare(
    `UPDATE suppliers SET outreach_status='responded', supplier_responded_at=datetime('now'), funnel_stage=? WHERE id=?`
  ).run(qualifies ? "responded" : "declined", s.id);

  return NextResponse.json({ ok: true, classified: true, interested: cls.interested, sentiment: cls.sentiment });
}
