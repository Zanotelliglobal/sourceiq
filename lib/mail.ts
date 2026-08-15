// ─── EMAIL DELIVERY ───────────────────────────────────────────────────────────
// Provider-agnostic, SAFE-BY-DEFAULT mailer.
//
// Real emails are only sent to real suppliers when ALL of these hold:
//   • OUTREACH_LIVE === "true"        (explicit opt-in — the master safety switch)
//   • MAIL_PROVIDER is configured     (currently "resend")
//   • the provider API key is present (RESEND_API_KEY)
//   • MAIL_FROM is set                (verified sending address)
//   • the recipient has a real email  (supplier.contact_email)
//
// If any condition is missing, sendEmail() returns { sent:false, mode:"draft" }
// and NOTHING leaves the building. This makes the demo path the default and
// makes going live a deliberate, configured action.

export type SendResult = {
  sent: boolean;
  mode: "draft" | "live";
  provider?: string;
  id?: string;          // provider message id when sent
  reason?: string;      // why it stayed a draft (when sent=false)
};

export function isMailLive(): boolean {
  return (
    process.env.OUTREACH_LIVE === "true" &&
    !!process.env.MAIL_PROVIDER &&
    !!process.env.MAIL_FROM &&
    (process.env.MAIL_PROVIDER !== "resend" || !!process.env.RESEND_API_KEY)
  );
}

/** Human-readable status of the mail config, for surfacing in the UI/logs. */
export function mailStatus(): { live: boolean; provider: string | null; from: string | null; reason?: string } {
  const provider = process.env.MAIL_PROVIDER || null;
  const from = process.env.MAIL_FROM || null;
  if (process.env.OUTREACH_LIVE !== "true")
    return { live: false, provider, from, reason: "OUTREACH_LIVE is not 'true' (safety switch off)" };
  if (!provider) return { live: false, provider, from, reason: "MAIL_PROVIDER not set" };
  if (!from) return { live: false, provider, from, reason: "MAIL_FROM not set" };
  if (provider === "resend" && !process.env.RESEND_API_KEY)
    return { live: false, provider, from, reason: "RESEND_API_KEY not set" };
  return { live: true, provider, from };
}

// ─── INBOUND REPLY THREADING ──────────────────────────────────────────────────
// Outbound RFIs set a Reply-To of reply+<token>@<MAIL_INBOUND_DOMAIN>. The inbound
// webhook extracts <token> from the recipient address to match the supplier.

/** The domain configured to receive inbound replies (MX + webhook wired at provider). */
export function inboundDomain(): string | null {
  return process.env.MAIL_INBOUND_DOMAIN || null;
}

/** Build the per-supplier Reply-To alias. Returns null if inbound isn't configured. */
export function replyToAddress(token: string): string | null {
  const domain = inboundDomain();
  if (!domain) return null;
  return `reply+${token}@${domain}`;
}

/** Extract the reply token from an inbound recipient address (reply+<token>@domain). */
export function parseReplyToken(to: string | null | undefined): string | null {
  if (!to) return null;
  const m = to.match(/reply\+([A-Za-z0-9_-]+)@/i);
  return m ? m[1] : null;
}

// ─── ANTI-SPAM COMPLIANCE ─────────────────────────────────────────────────────
// Commercial email must carry a working opt-out and the sender's physical postal
// address (CAN-SPAM in the US, CASL in Canada, PECR/GDPR in the EU/UK). We add a
// per-supplier unsubscribe link, a List-Unsubscribe header (with RFC 8058
// one-click support), and a postal-address footer to every RFI.

/** Sender's registered postal address, shown in the footer. */
export function postalAddress(): string | null {
  return process.env.MAIL_POSTAL_ADDRESS || null;
}

/** Public unsubscribe URL for a supplier's reply token. */
export function unsubscribeUrl(token: string): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base || !token) return null;
  return `${base.replace(/\/$/, "")}/api/unsubscribe?t=${encodeURIComponent(token)}`;
}

/** Public branded RFI response-form URL for a supplier's reply token. */
export function rfiUrl(token: string): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base || !token) return null;
  return `${base.replace(/\/$/, "")}/supplier/rfi?t=${encodeURIComponent(token)}`;
}

/** Append the legally-required unsubscribe + postal-address footer to a body. */
export function withComplianceFooter(body: string, token: string): string {
  const url = unsubscribeUrl(token);
  const addr = postalAddress();
  const lines: string[] = [body, "", "—"];
  // AI-authorship disclosure (#100): every outbound RFI/follow-up is drafted
  // by an AI agent on the buyer's behalf. This is disclosure/transparency,
  // distinct from the CAN-SPAM/GDPR opt-out text below — recipients are
  // entitled to know a message was AI-generated, separately from being able
  // to stop receiving it.
  lines.push(
    "This message was drafted by an AI assistant on behalf of the buyer named above; a human reviews supplier responses."
  );
  lines.push(
    "You received this message because SourceGPT is conducting a supplier sourcing search on behalf of a buyer. If this is not relevant to your business, you can opt out and we will not contact you again" +
      (url ? `: ${url}` : ".")
  );
  if (addr) lines.push(addr);
  return lines.join("\n");
}

/** List-Unsubscribe headers (RFC 2369 + RFC 8058 one-click) for a token. */
export function unsubscribeHeaders(token: string): Record<string, string> {
  const url = unsubscribeUrl(token);
  if (!url) return {};
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export async function sendEmail(opts: {
  to: string | null | undefined;
  subject: string;
  body: string;           // plain text
  replyTo?: string;
  headers?: Record<string, string>;   // extra headers, e.g. List-Unsubscribe
}): Promise<SendResult> {
  const provider = process.env.MAIL_PROVIDER || "";

  if (!isMailLive()) {
    return { sent: false, mode: "draft", reason: mailStatus().reason || "mail not live" };
  }
  if (!opts.to) {
    return { sent: false, mode: "draft", reason: "no recipient email on supplier" };
  }

  if (provider === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [opts.to],
        subject: opts.subject,
        text: opts.body,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
        ...(opts.headers && Object.keys(opts.headers).length ? { headers: opts.headers } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Resend send failed (${res.status}): ${detail}`);
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, mode: "live", provider: "resend", id: json.id };
  }

  throw new Error(`Unsupported MAIL_PROVIDER: ${provider}`);
}
