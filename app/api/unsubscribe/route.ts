import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { suppressEmail } from "@/lib/suppression";

// ─── UNSUBSCRIBE ENDPOINT ─────────────────────────────────────────────────────
// Backs the List-Unsubscribe header and the footer link on every outbound RFI.
//   • GET  ?t=<reply_token>  → human clicks the link → opt the supplier out and
//                              show a plain confirmation page.
//   • POST ?t=<reply_token>  → RFC 8058 one-click (mail clients POST here) → 200.
// Opting out sets suppliers.opted_out; the outreach route suppresses opted-out
// suppliers, so they are never emailed again within THIS event. It also adds
// the contact's email to the org-wide suppression_list (#98) so a brand-new
// sourcing event (a fresh suppliers row) can't re-contact them either.

export const runtime = "nodejs";

async function optOut(token: string | null): Promise<boolean> {
  if (!token) return false;
  const db = getDb();
  const res = await db
    .prepare(
      "UPDATE suppliers SET opted_out=true, opted_out_at=datetime('now') WHERE reply_token=? AND opted_out IS NOT TRUE"
    )
    .run(token);
  // Treat an already-opted-out token as success (idempotent), so re-clicks are fine.
  if (res.changes === 0) {
    const existing = await db
      .prepare("SELECT id FROM suppliers WHERE reply_token=?")
      .get(token);
    return !!existing;
  }

  // Record the durable, org-wide suppression entry (best-effort — the opt-out
  // above already succeeded and must not be undone by a failure here).
  try {
    const supplier = (await db
      .prepare(
        `SELECT s.contact_email AS contact_email, se.org_id AS org_id
         FROM suppliers s JOIN sourcing_events se ON se.id = s.event_id
         WHERE s.reply_token = ?`
      )
      .get(token)) as { contact_email: string | null; org_id: number } | undefined;
    if (supplier?.contact_email) {
      await suppressEmail(db, Number(supplier.org_id), supplier.contact_email, "unsubscribed");
    }
  } catch {
    /* best-effort — the per-row opt-out already took effect */
  }

  return true;
}

function page(title: string, message: string, status: number): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f8fafc;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 1px 3px rgba(15,23,42,.06);max-width:440px;padding:32px;text-align:center}
  h1{font-size:18px;margin:0 0 8px}
  p{font-size:14px;line-height:1.5;color:#475569;margin:0}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  const ok = await optOut(token);
  if (!ok) {
    return page(
      "Link not recognized",
      "We couldn't find this contact. It may have already been removed. If you continue to receive messages, reply with “unsubscribe”.",
      404
    );
  }
  return page(
    "You've been unsubscribed",
    "You will not receive further sourcing messages from us regarding this request. Thank you.",
    200
  );
}

export async function POST(req: NextRequest) {
  // RFC 8058 one-click: mail clients POST here with no body. Return 200 on success.
  const token = req.nextUrl.searchParams.get("t");
  const ok = await optOut(token);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
