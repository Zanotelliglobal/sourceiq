"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Minus } from "lucide-react";
import { useT } from "@/components/LanguageProvider";
import { useModalA11y } from "@/hooks/useModalA11y";
import {
  TIERS,
  CADENCES,
  displayPrice,
  cadenceSuffix,
  UNLIMITED,
  type Cadence,
  type Tier,
} from "@/lib/plans";

type CancelImpact = { active_projects: number; supplier_count: number; outreach_count: number };

type BillingStatus = {
  configured: boolean;
  plan: string;
  status: string;
  trial_ends_at: string | null;
  has_customer: boolean;
  active: boolean;
  reason: string | null;
  available: Record<string, boolean>;
};

const STATUS_LABEL: Record<string, { label: string; badge: string }> = {
  active:   { label: "Active",   badge: "badge-green" },
  trialing: { label: "Trial",    badge: "badge-blue" },
  past_due: { label: "Past Due", badge: "badge-amber" },
  canceled: { label: "Canceled", badge: "badge-slate" },
  trial:    { label: "Trial",    badge: "badge-blue" },
};

function limitLabel(n: number, t: (k: string, v?: Record<string, string | number>) => string): string {
  return n === UNLIMITED ? t("Unlimited") : String(n);
}

export default function BillingPage() {
  const t = useT();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seats, setSeats] = useState<{ used: number; limit: number; unlimited: boolean } | null>(null);
  // "What you'd lose" cancel/downgrade messaging (#40) — shown before we ever
  // send the user to Stripe's portal, where the actual cancellation happens.
  const [cancelImpactOpen, setCancelImpactOpen] = useState(false);
  const [impact, setImpact] = useState<CancelImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);

  useEffect(() => {
    fetch("/api/billing/status")
      .then(r => r.json())
      .then(d => { setStatus(d); setLoading(false); })
      .catch(() => { setError(t("Could not load billing status.")); setLoading(false); });
    fetch("/api/team")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.seats) setSeats(d.seats); })
      .catch(() => {});
    // `t` is intentionally omitted: this fetch should run once on mount, not
    // re-run (and re-hit the API) every time the user switches language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkout(tierKey: string) {
    setBusy(tierKey); setError(null);
    try {
      const r = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: tierKey, cadence }),
      });
      const d = await r.json();
      if (!r.ok || !d.url) throw new Error(d.error || t("Request failed"));
      window.location.href = d.url;
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setBusy(null);
    }
  }

  async function portal() {
    setBusy("portal"); setError(null);
    try {
      const r = await fetch("/api/stripe/portal", { method: "POST" });
      const d = await r.json();
      if (!r.ok || !d.url) throw new Error(d.error || t("Request failed"));
      window.location.href = d.url;
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setBusy(null);
    }
  }

  // "Manage subscription" is also the only path to cancellation (Stripe's own
  // portal handles the actual cancel/downgrade). Interstitial first, so buyers
  // see what's at stake before they leave SourceIQ.
  async function openCancelImpact() {
    setCancelImpactOpen(true);
    setImpactLoading(true);
    setImpact(null);
    try {
      const r = await fetch("/api/billing/cancel-impact");
      if (r.ok) setImpact(await r.json());
    } catch {
      /* modal shows a fallback message when impact stays null */
    } finally {
      setImpactLoading(false);
    }
  }

  function confirmContinueToPortal() {
    setCancelImpactOpen(false);
    portal();
  }

  const trialMsg = (() => {
    if (!status?.trial_ends_at) return null;
    const ms = new Date(status.trial_ends_at).getTime() - Date.now();
    if (ms <= 0) return t("Your free trial has ended.");
    const days = Math.ceil(ms / 86_400_000);
    return days === 1
      ? t("{days} day left in your free trial.", { days })
      : t("{days} days left in your free trial.", { days });
  })();

  const cfg = status ? (STATUS_LABEL[status.status] || STATUS_LABEL.canceled) : null;
  const isActivePaid = status?.status === "active" || status?.status === "past_due";

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t("Billing & Subscription")}</h1>
        <p className="text-sm text-slate-500 mt-1">{t("Manage your SourceIQ plan and payment details.")}</p>
      </div>

      {loading ? (
        <div className="card p-10"><div className="shimmer h-6 w-48 rounded" /></div>
      ) : !status ? (
        <div className="card p-10 text-center">
          <h2 className="text-base font-bold text-red-600 mb-1">{t("Couldn't load billing")}</h2>
          <p className="text-sm text-slate-500">{error || t("Unavailable.")}</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Current plan */}
          <div className="card p-6 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("Current Plan")}</div>
              <div className="text-xl font-bold text-slate-900 mt-1 capitalize">{status.plan || t("Free")}</div>
              {seats && (
                <p className="text-sm text-slate-500 mt-1">
                  {seats.unlimited
                    ? t("Unlimited seats")
                    : `${seats.used} / ${seats.limit} ${t("seats")}`}
                </p>
              )}
              {trialMsg && (
                <p className={`text-sm mt-1 ${status.active ? "text-slate-500" : "text-red-600 font-medium"}`}>{trialMsg}</p>
              )}
              {!status.active && status.reason && (
                <p className="text-sm text-red-600 font-medium mt-1">{status.reason}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {cfg && <span className={`badge ${cfg.badge}`}>{t(cfg.label)}</span>}
              {status.has_customer && (
                <button className="btn-secondary" disabled={busy !== null} onClick={openCancelImpact}>
                  {busy === "portal" ? t("Opening…") : t("Manage subscription")}
                </button>
              )}
            </div>
          </div>

          {!status.configured && (
            <div className="card p-5 text-sm text-slate-500 bg-slate-50">
              {t("Stripe is not set up on this deployment yet. All features are currently unlocked.")}
            </div>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* Cadence toggle */}
          <div className="flex items-center justify-center">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              {CADENCES.map(c => (
                <button
                  key={c.key}
                  onClick={() => setCadence(c.key)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    cadence === c.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {t(c.label)}
                  {c.note && <span className="ml-1.5 text-[11px] font-bold text-emerald-600">{t(c.note)}</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Tier comparison grid — column count tracks TIERS.length, not hardcoded */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {TIERS.map(tier => (
              <TierCard
                key={tier.key}
                tier={tier}
                cadence={cadence}
                current={status.plan === tier.key}
                available={tier.key === "free" ? true : !!status.available?.[`${tier.key}_${cadence}`]}
                busy={busy === tier.key}
                disabled={busy !== null}
                isActivePaid={!!isActivePaid}
                onSubscribe={() => checkout(tier.key)}
                onManage={openCancelImpact}
                t={t}
              />
            ))}
          </div>

          <div className="text-center">
            <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700"><ArrowLeft className="w-4 h-4" /> {t("Back to dashboard")}</Link>
          </div>
        </div>
      )}

      {cancelImpactOpen && (
        <CancelImpactModal
          loading={impactLoading}
          impact={impact}
          onClose={() => setCancelImpactOpen(false)}
          onContinue={confirmContinueToPortal}
        />
      )}
    </div>
  );
}

// "What you'd lose" summary (#40) shown before the user is handed off to
// Stripe's portal to manage/cancel their subscription. Cancellation itself
// still happens entirely in Stripe's UI — this only adds messaging.
function CancelImpactModal({ loading, impact, onClose, onContinue }: {
  loading: boolean;
  impact: CancelImpact | null;
  onClose: () => void;
  onContinue: () => void;
}) {
  const t = useT();
  const dialogRef = useModalA11y(onClose);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70] p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("Before you manage your subscription")}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 animate-slide-in outline-none p-6"
      >
        <h2 className="text-lg font-bold text-slate-900 mb-1">{t("Before you go…")}</h2>
        <p className="text-sm text-slate-500 mb-4">
          {t("If you cancel or downgrade, here's what's tied to your account today:")}
        </p>

        {loading ? (
          <div className="space-y-2 mb-5">
            <div className="shimmer h-5 w-full rounded" />
            <div className="shimmer h-5 w-full rounded" />
            <div className="shimmer h-5 w-3/4 rounded" />
          </div>
        ) : impact ? (
          <ul className="space-y-2 mb-5 text-sm">
            <li className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50">
              <span className="text-slate-600">{t("Active sourcing projects")}</span>
              <span className="font-bold text-slate-900">{impact.active_projects}</span>
            </li>
            <li className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50">
              <span className="text-slate-600">{t("Suppliers discovered")}</span>
              <span className="font-bold text-slate-900">{impact.supplier_count}</span>
            </li>
            <li className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50">
              <span className="text-slate-600">{t("Outreach messages sent")}</span>
              <span className="font-bold text-slate-900">{impact.outreach_count}</span>
            </li>
          </ul>
        ) : (
          <p className="text-sm text-red-600 mb-5">{t("Couldn't load your usage summary — you can still continue.")}</p>
        )}

        <p className="text-xs text-slate-400 mb-5">
          {t("Your data isn't deleted, but a lower plan may limit what you can access or run going forward.")}
        </p>

        <div className="flex items-center justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>{t("Keep my plan")}</button>
          <button className="btn-primary" onClick={onContinue}>{t("Continue to Stripe")}</button>
        </div>
      </div>
    </div>
  );
}

function TierCard({
  tier, cadence, current, available, busy, disabled, isActivePaid, onSubscribe, onManage, t,
}: {
  tier: Tier;
  cadence: Cadence;
  current: boolean;
  available: boolean;
  busy: boolean;
  disabled: boolean;
  isActivePaid: boolean;
  onSubscribe: () => void;
  onManage: () => void;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const price = displayPrice(tier, cadence);
  const rows: [string, string][] = [
    [t("Discovery credits / mo"), limitLabel(tier.limits.monthlyCredits, t)],
    [t("Suppliers per event"), limitLabel(tier.limits.suppliersPerEvent, t)],
    [t("Team seats"), limitLabel(tier.limits.seats, t)],
  ];
  const flags: [string, boolean][] = [
    [t("Live outreach"), tier.limits.outreach],
    [t("Export (CSV/Excel/PDF)"), tier.limits.export],
  ];

  return (
    <div className={`card p-5 flex flex-col ${tier.featured ? "ring-2 ring-blue-500 relative" : ""}`}>
      {tier.featured && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 badge badge-blue text-[10px]">{t("Recommended")}</span>
      )}
      <div className="mb-3">
        <div className="text-lg font-bold text-slate-900">{t(tier.name)}</div>
        <p className="text-xs text-slate-500 mt-1 min-h-[32px]">{t(tier.blurb)}</p>
      </div>
      <div className="mb-4">
        {price === 0 ? (
          <div className="text-2xl font-extrabold text-slate-900">{t("Free")}</div>
        ) : (
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-extrabold text-slate-900">€{price.toLocaleString()}</span>
            <span className="text-sm text-slate-400 font-medium">{cadenceSuffix(cadence)}</span>
          </div>
        )}
      </div>

      <div className="space-y-2 mb-4 flex-1">
        {rows.map(([label, val]) => (
          <div key={label} className="flex items-center justify-between text-xs">
            <span className="text-slate-500">{label}</span>
            <span className="font-semibold text-slate-900">{val}</span>
          </div>
        ))}
        {flags.map(([label, on]) => (
          <div key={label} className="flex items-center justify-between text-xs">
            <span className="text-slate-500">{label}</span>
            {on ? <Check className="w-4 h-4 text-emerald-600" /> : <Minus className="w-4 h-4 text-slate-300" />}
          </div>
        ))}
      </div>

      {current ? (
        isActivePaid ? (
          <button className="btn-secondary w-full" disabled={disabled} onClick={onManage}>
            {t("Manage subscription")}
          </button>
        ) : (
          <div className="text-center text-xs font-semibold text-slate-400 py-2">{t("Current plan")}</div>
        )
      ) : tier.key === "free" ? (
        <div className="text-center text-xs text-slate-400 py-2">{t("No card required")}</div>
      ) : (
        <button
          className="btn-primary w-full"
          disabled={disabled || !available}
          onClick={onSubscribe}
          title={available ? undefined : t("Not available yet")}
        >
          {busy ? t("Redirecting…") : available ? t("Choose {plan}", { plan: t(tier.name) }) : t("Coming soon")}
        </button>
      )}
    </div>
  );
}
