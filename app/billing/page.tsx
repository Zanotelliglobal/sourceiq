"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

type BillingStatus = {
  configured: boolean;
  plan: string;
  status: string;
  trial_ends_at: string | null;
  has_customer: boolean;
  active: boolean;
  reason: string | null;
};

const STATUS_LABEL: Record<string, { label: string; badge: string }> = {
  active:     { label: "Active",       badge: "badge-green" },
  trialing:   { label: "Trial",        badge: "badge-blue" },
  past_due:   { label: "Past Due",     badge: "badge-amber" },
  canceled:   { label: "Canceled",     badge: "badge-slate" },
  trial:      { label: "Trial",        badge: "badge-blue" },
};

export default function BillingPage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing/status")
      .then(r => r.json())
      .then(d => { setStatus(d); setLoading(false); })
      .catch(() => { setError("Could not load billing status."); setLoading(false); });
  }, []);

  async function go(path: string, kind: "checkout" | "portal") {
    setBusy(kind); setError(null);
    try {
      const r = await fetch(path, { method: "POST" });
      const d = await r.json();
      if (!r.ok || !d.url) throw new Error(d.error || "Request failed");
      window.location.href = d.url;
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setBusy(null);
    }
  }

  const trialMsg = (() => {
    if (!status?.trial_ends_at) return null;
    const ms = new Date(status.trial_ends_at).getTime() - Date.now();
    if (ms <= 0) return "Your free trial has ended.";
    const days = Math.ceil(ms / 86_400_000);
    return `${days} day${days !== 1 ? "s" : ""} left in your free trial.`;
  })();

  const cfg = status ? (STATUS_LABEL[status.status] || STATUS_LABEL.canceled) : null;

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Billing &amp; Subscription</h1>
        <p className="text-sm text-slate-500 mt-1">Manage your SourceIQ plan and payment details.</p>
      </div>

      {loading ? (
        <div className="card p-10"><div className="shimmer h-6 w-48 rounded" /></div>
      ) : !status ? (
        <div className="card p-10 text-center text-sm text-slate-500">{error || "Unavailable."}</div>
      ) : !status.configured ? (
        <div className="card p-8">
          <h2 className="text-lg font-bold text-slate-800 mb-2">Billing not configured</h2>
          <p className="text-sm text-slate-500">
            Stripe is not set up on this deployment yet. All features are currently unlocked.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Current plan card */}
          <div className="card p-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Current Plan</div>
                <div className="text-xl font-bold text-slate-900 mt-1 capitalize">{status.plan}</div>
              </div>
              {cfg && <span className={`badge ${cfg.badge}`}>{cfg.label}</span>}
            </div>

            {trialMsg && (
              <p className={`text-sm ${status.active ? "text-slate-500" : "text-red-600 font-medium"}`}>{trialMsg}</p>
            )}
            {!status.active && status.reason && (
              <p className="text-sm text-red-600 font-medium mt-1">{status.reason}</p>
            )}
          </div>

          {/* Actions */}
          <div className="card p-8">
            <h2 className="text-base font-bold text-slate-800 mb-1">Pro</h2>
            <p className="text-sm text-slate-500 mb-5">
              Unlimited sourcing events, multi-wave discovery, and live outreach.
            </p>

            {error && (
              <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
            )}

            <div className="flex flex-wrap gap-3">
              {status.status === "active" || status.status === "past_due" ? (
                <button className="btn-primary" disabled={busy !== null} onClick={() => go("/api/stripe/portal", "portal")}>
                  {busy === "portal" ? "Opening…" : "Manage subscription"}
                </button>
              ) : (
                <button className="btn-primary" disabled={busy !== null} onClick={() => go("/api/stripe/checkout", "checkout")}>
                  {busy === "checkout" ? "Redirecting…" : "Subscribe to Pro"}
                </button>
              )}
              {status.has_customer && (
                <button className="btn-secondary" disabled={busy !== null} onClick={() => go("/api/stripe/portal", "portal")}>
                  {busy === "portal" ? "Opening…" : "Billing portal"}
                </button>
              )}
            </div>
          </div>

          <div className="text-center">
            <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700"><ArrowLeft className="w-4 h-4" /> Back to dashboard</Link>
          </div>
        </div>
      )}
    </div>
  );
}
