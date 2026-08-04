"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { X, ArrowRight } from "lucide-react";
import { useT } from "@/components/LanguageProvider";

// Brief inline explainer of the discovery funnel, shown on the event workspace
// for first-time users. Dismissal is persisted per-user in Clerk unsafeMetadata
// so it never reappears once understood/dismissed.
const STAGES = [
  { label: "Long List", hint: "Suppliers discovered by the AI scouts", dot: "bg-slate-400" },
  { label: "Contacted", hint: "An RFI was sent on your behalf", dot: "bg-blue-500" },
  { label: "Responded", hint: "The supplier replied positively", dot: "bg-emerald-500" },
  { label: "Short List", hint: "You approved them for next steps", dot: "bg-amber-500" },
];

export default function FunnelExplainer() {
  const t = useT();
  const { isLoaded, user } = useUser();
  const [dismissing, setDismissing] = useState(false);

  if (!isLoaded) return null;
  if (user?.unsafeMetadata?.funnelExplainerDismissed) return null;

  async function dismiss() {
    setDismissing(true);
    try {
      await user?.update({
        unsafeMetadata: { ...(user.unsafeMetadata ?? {}), funnelExplainerDismissed: true },
      });
    } catch {
      /* if the write fails it simply reappears next load — acceptable */
    }
  }

  return (
    <div className="relative rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3 mt-4">
      <button
        onClick={dismiss}
        disabled={dismissing}
        aria-label={t("Dismiss")}
        className="absolute top-2.5 right-2.5 text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-40"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <p className="text-xs font-semibold text-slate-700 mb-2">
        {t("How the funnel works")}
      </p>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        {STAGES.map((s, i) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-2 py-1">
              <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
              <span className="text-[11px] font-bold text-slate-700">{t(s.label)}</span>
              <span className="text-[11px] text-slate-400">— {t(s.hint)}</span>
            </span>
            {i < STAGES.length - 1 && <ArrowRight className="w-3 h-3 text-slate-300" />}
          </span>
        ))}
      </div>
    </div>
  );
}
