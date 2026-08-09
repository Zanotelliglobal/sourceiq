"use client";

import { useEffect, useState } from "react";
import { Gift, Copy, Check } from "lucide-react";
import { useT } from "@/components/LanguageProvider";

type Stats = {
  code: string | null;
  link: string | null;
  referred_count: number;
  rewarded_count: number;
  bonus_events: number;
  bonus_per_conversion: number;
};

// Referral card for /settings: shows the org's shareable link, a copy button,
// and referral stats (invited / converted / bonus events earned).
export default function ReferralCard() {
  const t = useT();
  const [stats, setStats] = useState<Stats | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/referrals")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setStats(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  async function copy() {
    if (!stats?.link) return;
    try {
      await navigator.clipboard.writeText(stats.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      // Report the quick-start checklist's "share your referral link" task —
      // best-effort; the checklist card just won't reflect it until next load
      // if this fails.
      fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "share_referral" }),
      }).catch(() => {});
    } catch {
      /* clipboard unavailable */
    }
  }

  if (!stats) return null;

  return (
    <div className="card px-5 py-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center flex-shrink-0">
          <Gift className="w-4.5 h-4.5 text-violet-600" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900">{t("Refer & earn")}</div>
          <div className="text-xs text-slate-500">
            {t("Share your link. When someone you refer subscribes, you both get bonus events.")}
          </div>
        </div>
      </div>

      {stats.link && (
        <div className="flex items-stretch gap-2 mb-4">
          <input
            readOnly
            value={stats.link}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-600"
          />
          <button
            onClick={copy}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors flex-shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? t("Copied") : t("Copy")}
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label={t("Invited")} value={stats.referred_count} />
        <Stat label={t("Converted")} value={stats.rewarded_count} />
        <Stat label={t("Bonus events")} value={stats.bonus_events} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-100 py-2">
      <div className="text-lg font-bold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}
