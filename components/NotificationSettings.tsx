"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { BellRing } from "lucide-react";
import { useT } from "@/components/LanguageProvider";

// Per-user email-notification preference. Stored in Clerk unsafeMetadata
// (client-writable, cross-device) and read server-side by lib/notifications.ts
// when deciding whether to email a user. Opt-in by default (undefined → on).
export default function NotificationSettings() {
  const t = useT();
  const { isLoaded, user } = useUser();
  const [saving, setSaving] = useState(false);

  if (!isLoaded) return null;

  const enabled = user?.unsafeMetadata?.emailNotifications !== false;

  async function toggle() {
    if (!user) return;
    setSaving(true);
    try {
      await user.update({
        unsafeMetadata: { ...(user.unsafeMetadata ?? {}), emailNotifications: !enabled },
      });
    } catch {
      /* transient — the toggle reflects server state on next load */
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card px-5 py-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center flex-shrink-0">
          <BellRing className="w-4.5 h-4.5 text-amber-600" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900">{t("Email notifications")}</div>
          <div className="text-xs text-slate-400 truncate">
            {t("Get an email when discovery finishes, a supplier replies, or outreach fails.")}
          </div>
        </div>
      </div>
      <button
        role="switch"
        aria-checked={enabled}
        aria-label={t("Email notifications")}
        onClick={toggle}
        disabled={saving}
        className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${enabled ? "bg-blue-600" : "bg-slate-300"}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-4" : ""}`} />
      </button>
    </div>
  );
}
