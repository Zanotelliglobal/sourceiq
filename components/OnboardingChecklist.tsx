"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { Rocket, Search, Star, Send, Gift, ArrowRight, X, Check } from "lucide-react";
import { useT } from "@/components/LanguageProvider";

type TaskState = {
  key: string;
  title: string;
  description: string;
  auto: boolean;
  completedAt: string | null;
};

type ChecklistState = {
  tasks: TaskState[];
  completedCount: number;
  totalCount: number;
  bonusEventsEarned: number;
  allComplete: boolean;
};

const ICONS: Record<string, typeof Search> = {
  create_event: Search,
  shortlist_supplier: Star,
  launch_outreach: Send,
  share_referral: Gift,
};

const CTA: Record<string, { label: string; href: string }> = {
  create_event: { label: "Create your first event", href: "/events/new" },
  shortlist_supplier: { label: "Shortlist a supplier", href: "/dashboard" },
  launch_outreach: { label: "Launch outreach", href: "/dashboard" },
  share_referral: { label: "Share your referral link", href: "/settings" },
};

// Quick-start checklist shown on the dashboard: fetches live, per-org progress
// from /api/onboarding. Three tasks are auto-detected server-side (event
// created, supplier shortlisted, outreach launched); the fourth (sharing the
// referral link) is reported by components/ReferralCard.tsx when the user
// copies their link. Completing every task earns bonus events. The card hides
// once every task is complete, or once dismissed.
//
// Dismissal is a per-user UI preference (Clerk unsafeMetadata, cross-device)
// — it only hides the card and never affects the underlying per-org reward
// progress, which keeps accruing via the API regardless.
export default function OnboardingChecklist() {
  const t = useT();
  const { isLoaded, user } = useUser();
  const [state, setState] = useState<ChecklistState | null>(null);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/onboarding")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setState(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Wait for Clerk + the checklist to load; never show once every task is done.
  if (!isLoaded || !state || state.allComplete) return null;
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

  const nextTask = state.tasks.find((tk) => !tk.completedAt);
  const cta = nextTask ? CTA[nextTask.key] : null;

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
        {t("Complete these steps to earn bonus events — {done} of {total} done.", {
          done: state.completedCount,
          total: state.totalCount,
        })}
      </p>

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {state.tasks.map((task, i) => {
          const Icon = ICONS[task.key] ?? Star;
          const done = !!task.completedAt;
          return (
            <li
              key={task.key}
              className={`rounded-xl border p-4 ${done ? "border-emerald-200 bg-emerald-50/40" : "border-blue-200 bg-blue-50/40"}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${done ? "bg-emerald-600 text-white" : "bg-blue-600 text-white"}`}
                >
                  {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </span>
                <Icon className={`w-4 h-4 ${done ? "text-emerald-600" : "text-blue-600"}`} />
              </div>
              <div className="text-sm font-semibold text-slate-800">{t(task.title)}</div>
              <div className="text-xs text-slate-500 mt-1">{t(task.description)}</div>
            </li>
          );
        })}
      </ol>

      <div className="mt-5 flex items-center gap-3">
        {cta && (
          <Link href={cta.href} className="btn-primary">
            {t(cta.label)}
            <ArrowRight className="w-4 h-4" />
          </Link>
        )}
        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
          <Gift className="w-3.5 h-3.5" />
          {t("{count} bonus events earned so far", { count: state.bonusEventsEarned })}
        </span>
      </div>
    </div>
  );
}
