"use client";

import { useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { Rocket, Search, Star, Send, Plus, X, Check } from "lucide-react";
import { useT } from "@/components/LanguageProvider";

// First-run guided checklist shown on the dashboard until the user creates their
// first sourcing event. Dismissal is persisted per-user in Clerk unsafeMetadata
// (client-writable, cross-device) so it never reappears after completion or
// dismissal. Auto-completes the moment `hasEvents` becomes true.
export default function OnboardingChecklist({ hasEvents }: { hasEvents: boolean }) {
  const t = useT();
  const { isLoaded, user } = useUser();
  const [dismissing, setDismissing] = useState(false);

  // Wait for Clerk to hydrate; never show once the user has any event.
  if (!isLoaded || hasEvents) return null;
  // Persisted dismissal — honored across devices/sessions.
  if (user?.unsafeMetadata?.onboardingDismissed) return null;

  async function dismiss() {
    setDismissing(true);
    try {
      await user?.update({
        unsafeMetadata: { ...(user.unsafeMetadata ?? {}), onboardingDismissed: true },
      });
    } catch {
      /* if the write fails the card simply reappears next load — acceptable */
    }
  }

  const steps = [
    { Icon: Search, title: t("Create your first sourcing event"), desc: t("Describe what you need — our AI drafts the brief in seconds."), active: true },
    { Icon: Star, title: t("AI agents build your supplier long list"), desc: t("Scout agents search global networks and score every match."), active: false },
    { Icon: Send, title: t("Shortlist and launch outreach"), desc: t("Approve the best suppliers and contact them from one place."), active: false },
  ];

  return (
    <div className="card p-6 mb-8 relative overflow-hidden">
      <button
        onClick={dismiss}
        disabled={dismissing}
        aria-label={t("Dismiss")}
        className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-40"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center">
          <Rocket className="w-4 h-4 text-blue-600" />
        </div>
        <h2 className="text-base font-bold text-slate-900">{t("Welcome to SourceIQ")}</h2>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        {t("Three steps to your first qualified supplier long list.")}
      </p>

      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li
            key={i}
            className={`rounded-xl border p-4 ${s.active ? "border-blue-200 bg-blue-50/40" : "border-slate-200 bg-white"}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${s.active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400"}`}>
                {i + 1}
              </span>
              <s.Icon className={`w-4 h-4 ${s.active ? "text-blue-600" : "text-slate-400"}`} />
            </div>
            <div className="text-sm font-semibold text-slate-800">{s.title}</div>
            <div className="text-xs text-slate-500 mt-1">{s.desc}</div>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex items-center gap-3">
        <Link href="/events/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          {t("Create your first event")}
        </Link>
        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
          <Check className="w-3.5 h-3.5" />
          {t("Steps 2 and 3 happen automatically")}
        </span>
      </div>
    </div>
  );
}
