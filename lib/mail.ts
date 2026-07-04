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

export async function sendEmail(opts: {
  to: string | null | undefined;
  subject: string;
  body: string;           // plain text
  replyTo?: string;
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
