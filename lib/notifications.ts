// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
// A thin helper around the `notifications` table (see lib/db.ts). Notifications
// are org-scoped: any member of the org sees the org's feed and a single
// read/unread flag is shared per row. This is the in-app surface (bell menu).
//
// Email is an optional best-effort side-channel: when `emailUserId` is supplied
// we look up that Clerk user, honor their per-user `emailNotifications`
// preference (stored in unsafeMetadata, toggled in /settings), and send a plain
// digest line via Resend. Any failure here is swallowed — the in-app
// notification is the source of truth and must never be blocked by email.

import { clerkClient } from "@clerk/nextjs/server";
import { getDb } from "@/lib/db";
import { sendEmail, isMailLive } from "@/lib/mail";

export type NotificationType =
  | "discovery_complete"
  | "supplier_reply"
  | "outreach_failure";

export type Notification = {
  id: number;
  org_id: number;
  event_id: number | null;
  type: NotificationType;
  title: string;
  body: string | null;
  url: string | null;
  read: boolean;
  created_at: string;
};

// Whether a Clerk user wants email notifications. Defaults to true when the
// preference was never set. Best-effort: on any lookup error we assume opt-in
// is safe to skip (return false) so we never spam on a transient failure.
async function wantsEmail(userId: string): Promise<{ send: boolean; email: string | null }> {
  try {
    const user = await clerkClient.users.getUser(userId);
    const pref = (user.unsafeMetadata as { emailNotifications?: boolean } | undefined)
      ?.emailNotifications;
    const email = user.primaryEmailAddress?.emailAddress ?? null;
    // undefined → opted in by default; explicit false → opted out.
    return { send: pref !== false, email };
  } catch {
    return { send: false, email: null };
  }
}

// Create an in-app notification for the org and optionally email a target user.
// Never throws — notification delivery must not break the triggering flow.
export async function notify(opts: {
  orgId: number;
  type: NotificationType;
  title: string;
  body?: string | null;
  url?: string | null;
  eventId?: number | null;
  emailUserId?: string | null;
}): Promise<void> {
  const { orgId, type, title, body = null, url = null, eventId = null, emailUserId = null } = opts;
  try {
    await getDb()
      .prepare(
        `INSERT INTO notifications (org_id, event_id, type, title, body, url)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(orgId, eventId, type, title, body, url);
  } catch {
    /* in-app insert failed — nothing more we can do, swallow */
    return;
  }

  if (emailUserId && isMailLive()) {
    try {
      const { send, email } = await wantsEmail(emailUserId);
      if (send && email) {
        // In-app `url` is stored relative (for next/link); email needs absolute.
        const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
        const link = url && base ? `${base}${url}` : null;
        await sendEmail({
          to: email,
          subject: `SourceGPT — ${title}`,
          body: `${title}${body ? `\n\n${body}` : ""}\n\n${
            link ? `View it in SourceGPT: ${link}` : "View it in SourceGPT."
          }`,
        });
      }
    } catch {
      /* email is best-effort; in-app notification already persisted */
    }
  }
}
