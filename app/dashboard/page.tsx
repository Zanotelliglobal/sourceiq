"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Zap, Factory, Star, ClipboardList, Search, Plus, ArrowRight, Loader2 } from "lucide-react";
import { useT } from "@/components/LanguageProvider";

type EventRow = {
  id: number; title: string; category: string; status: string;
  annual_spend: string | null;
  wave_count: number; created_at: string;
  supplier_count: number; shortlisted_count: number;
};

// `working: true` marks statuses where an AI agent is actively running — these
// render a spinning loader instead of a static dot so users see live progress.
const STATUS_CONFIG: Record<string, { label: string; dot: string; badge: string; working?: boolean }> = {
  idle:       { label: "Draft",        dot: "bg-slate-400",   badge: "badge-slate" },
  scouting:   { label: "Scouting",     dot: "bg-blue-500 animate-pulse", badge: "badge-blue", working: true },
  reviewing:  { label: "In Review",    dot: "bg-amber-500",   badge: "badge-amber" },
  shortlisting:{ label: "Shortlisting",dot: "bg-violet-500",  badge: "badge-purple" },
  outreach:   { label: "Outreach",     dot: "bg-orange-500",  badge: "badge-amber", working: true },
  completed:  { label: "Completed",    dot: "bg-emerald-500", badge: "badge-green" },
};

export default function Dashboard() {
  const t = useT();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trial, setTrial] = useState<{ status: string; trial_ends_at: string | null; active: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/billing/status")
      .then(r => r.json())
      .then(d => setTrial(d))
      .catch(() => {});
  }, []);

  // Compact trial signal for the header: days remaining, or an ended prompt.
  const trialBadge = (() => {
    if (!trial || !trial.trial_ends_at || (trial.status !== "trial" && trial.status !== "trialing")) return null;
    const ms = new Date(trial.trial_ends_at).getTime() - Date.now();
    if (ms <= 0) return { ended: true, days: 0 };
    return { ended: false, days: Math.ceil(ms / 86_400_000) };
  })();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const load = () => {
      fetch("/api/sourcing-events")
        .then(r => r.json())
        .then(d => {
          if (cancelled) return;
          if (Array.isArray(d)) {
            setEvents(d);
            // Keep refreshing while any agent is actively working, so the
            // spinner clears (and pipeline counts update) once discovery ends.
            const stillWorking = d.some((e: EventRow) => STATUS_CONFIG[e.status]?.working);
            if (stillWorking) timer = setTimeout(load, 5000);
          } else {
            setError(d?.error || t("Failed to load events"));
          }
          setLoading(false);
        })
        .catch(e => { if (!cancelled) { setError(String(e)); setLoading(false); } });
    };

    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  const stats = {
    total: events.length,
    active: events.filter(e => !["completed", "idle"].includes(e.status)).length,
    suppliers: events.reduce((a, e) => a + (e.supplier_count || 0), 0),
    shortlisted: events.reduce((a, e) => a + (e.shortlisted_count || 0), 0),
  };

  return (
    <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-10">

      {/* Page header */}
      <div className="flex flex-col sm:flex-row items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t("Sourcing Dashboard")}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {t("Monitor active procurement events and AI-driven supplier intelligence")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {trialBadge && (
            <Link
              href="/billing"
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                trialBadge.ended
                  ? "text-red-700 bg-red-50 border-red-100 hover:bg-red-100"
                  : trialBadge.days <= 3
                    ? "text-amber-700 bg-amber-50 border-amber-100 hover:bg-amber-100"
                    : "text-blue-700 bg-blue-50 border-blue-100 hover:bg-blue-100"
              }`}
            >
              {trialBadge.ended
                ? t("Your free trial has ended.")
                : trialBadge.days === 1
                  ? t("{days} day left in your free trial.", { days: trialBadge.days })
                  : t("{days} days left in your free trial.", { days: trialBadge.days })}
            </Link>
          )}
          <Link href="/events/new" className="btn-primary">
            <Plus className="w-4 h-4" />
            {t("New Sourcing Event")}
          </Link>
        </div>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: t("Active Events"),      value: stats.active,     sub: t("{total} total events", { total: stats.total }),        Icon: Zap,           color: "text-blue-600",   iconColor: "text-blue-500" },
          { label: t("Suppliers Identified"),value: stats.suppliers,  sub: t("across all events"),                  Icon: Factory,       color: "text-slate-900",  iconColor: "text-slate-400" },
          { label: t("Short Listed"),       value: stats.shortlisted, sub: t("approved for RFI"),                  Icon: Star,          color: "text-amber-600",  iconColor: "text-amber-500" },
          { label: t("Total Events"),       value: stats.total,       sub: t("all time"),                           Icon: ClipboardList, color: "text-slate-600",  iconColor: "text-slate-400" },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="flex items-center justify-between mb-2">
              <s.Icon className={`w-5 h-5 ${s.iconColor}`} strokeWidth={2} />
            </div>
            <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-sm font-semibold text-slate-700 mt-0.5">{s.label}</div>
            <div className="text-xs text-slate-400">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Events */}
      {error ? (
        <div className="card p-10 text-center">
          <h2 className="text-base font-bold text-red-600 mb-1">{t("Couldn't load events")}</h2>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      ) : loading ? (
        <div className="card">
          {[1,2,3].map(i => (
            <div key={i} className="flex items-center gap-4 px-6 py-4 border-b border-slate-100 last:border-0">
              <div className="shimmer h-4 w-64 rounded" />
              <div className="shimmer h-4 w-24 rounded ml-auto" />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="card p-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto mb-4">
            <Search className="w-7 h-7 text-blue-600" />
          </div>
          <h2 className="text-lg font-bold text-slate-700 mb-2">{t("No sourcing events yet")}</h2>
          <p className="text-sm text-slate-400 max-w-sm mx-auto mb-6">
            {t("Create your first sourcing event to deploy AI agents across global supplier networks and build a qualified long list in minutes.")}
          </p>
          <Link href="/events/new" className="btn-primary">
            {t("Initiate First Sourcing Event")}
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">{t("Sourcing Events")}</h2>
            <span className="text-xs text-slate-400">{events.length === 1 ? t("{count} event", { count: events.length }) : t("{count} events", { count: events.length })}</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("Event")}</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 hidden md:table-cell">{t("Category")}</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("Status")}</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 hidden lg:table-cell">{t("Pipeline")}</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 hidden xl:table-cell">{t("Spend")}</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 hidden xl:table-cell">{t("Initiated")}</th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.map(event => {
                const cfg = STATUS_CONFIG[event.status] || STATUS_CONFIG.idle;
                return (
                  <tr key={event.id} className="hover:bg-slate-50/60 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900 text-sm">{event.title}</div>
                      {event.wave_count > 0 && (
                        <div className="text-xs text-slate-400 mt-0.5">{event.wave_count === 1 ? t("{count} discovery wave completed", { count: event.wave_count }) : t("{count} discovery waves completed", { count: event.wave_count })}</div>
                      )}
                    </td>
                    <td className="px-4 py-4 hidden md:table-cell">
                      <span className="text-sm text-slate-600">{event.category}</span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        {cfg.working ? (
                          <Loader2 className="w-3.5 h-3.5 flex-shrink-0 text-blue-500 animate-spin" strokeWidth={2.5} />
                        ) : (
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                        )}
                        <span className={`badge ${cfg.badge}`}>{t(cfg.label)}</span>
                        {cfg.working && (
                          <span className="text-[11px] font-medium text-blue-600 hidden sm:inline">{t("AI working…")}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 hidden lg:table-cell">
                      <div className="text-sm text-slate-700 font-medium">{event.supplier_count || 0}
                        <span className="font-normal text-slate-400"> {t("found")}</span>
                      </div>
                      {(event.shortlisted_count || 0) > 0 && (
                        <div className="text-xs text-amber-600 font-medium">{t("{count} shortlisted", { count: event.shortlisted_count })}</div>
                      )}
                    </td>
                    <td className="px-4 py-4 hidden xl:table-cell">
                      <span className="text-sm text-slate-500">{event.annual_spend || "—"}</span>
                    </td>
                    <td className="px-4 py-4 hidden xl:table-cell">
                      <span className="text-xs text-slate-400">
                        {new Date(event.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <Link
                        href={`/events/${event.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        {t("Open")} <ArrowRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
