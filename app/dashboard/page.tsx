"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Zap, Factory, Star, ClipboardList, Search, Plus, Loader2, ChevronRight, ArrowUpDown } from "lucide-react";
import { useT } from "@/components/LanguageProvider";

type EventRow = {
  id: number; title: string; category: string; status: string;
  annual_spend: string | null;
  wave_count: number; created_at: string; updated_at: string;
  supplier_count: number; shortlisted_count: number;
};

// Compact relative time (e.g. "3h ago", "2d ago") for the last-activity signal.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

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

// Working statuses drive a live spinner and count toward "Active Events".
const WORKING = new Set(["scouting", "outreach"]);

type SortKey = "activity" | "pipeline" | "initiated";
type StatusFilter = "all" | "active" | "reviewing" | "outreach" | "completed";

export default function Dashboard() {
  const t = useT();
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("activity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
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
    // Only genuinely-running events count as active (stale/interrupted ones are
    // downgraded to reviewing/idle by the API, so they no longer inflate this).
    active: events.filter(e => WORKING.has(e.status)).length,
    suppliers: events.reduce((a, e) => a + (e.supplier_count || 0), 0),
    shortlisted: events.reduce((a, e) => a + (e.shortlisted_count || 0), 0),
  };

  // Client-side search + filter + sort (all events are already loaded).
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchesStatus = (e: EventRow) =>
      statusFilter === "all" ? true
      : statusFilter === "active" ? WORKING.has(e.status)
      : e.status === statusFilter;
    const filtered = events.filter(e =>
      matchesStatus(e) &&
      (!q || e.title.toLowerCase().includes(q) || (e.category || "").toLowerCase().includes(q))
    );
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "pipeline") cmp = (a.supplier_count || 0) - (b.supplier_count || 0);
      else if (sortKey === "initiated") cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      else cmp = new Date(a.updated_at || a.created_at).getTime() - new Date(b.updated_at || b.created_at).getTime();
      return cmp * dir;
    });
  }, [events, query, statusFilter, sortKey, sortDir]);

  // Toggle sort direction when re-clicking the active column, else switch column.
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const FILTERS: { key: StatusFilter; label: string }[] = [
    { key: "all", label: t("All") },
    { key: "active", label: t("Active") },
    { key: "reviewing", label: t("In Review") },
    { key: "outreach", label: t("Outreach") },
    { key: "completed", label: t("Completed") },
  ];

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
          {/* Toolbar: title, search, status filter pills */}
          <div className="px-4 sm:px-6 py-3 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center gap-3 lg:justify-between">
            <div className="flex items-center gap-3 flex-shrink-0">
              <h2 className="text-sm font-bold text-slate-700">{t("Sourcing Events")}</h2>
              <span className="text-xs text-slate-400">{visible.length === 1 ? t("{count} event", { count: visible.length }) : t("{count} events", { count: visible.length })}</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={t("Search events…")}
                  className="w-full sm:w-56 pl-8 pr-3 py-1.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                />
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {FILTERS.map(f => (
                  <button
                    key={f.key}
                    onClick={() => setStatusFilter(f.key)}
                    className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
                      statusFilter === f.key
                        ? "bg-blue-50 text-blue-700 border-blue-200"
                        : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("Event")}</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 hidden md:table-cell">{t("Category")}</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("Status")}</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 hidden lg:table-cell">
                  <button onClick={() => toggleSort("pipeline")} className="inline-flex items-center gap-1 hover:text-slate-600 uppercase tracking-wider">
                    {t("Pipeline")} <ArrowUpDown className={`w-3 h-3 ${sortKey === "pipeline" ? "text-blue-500" : "text-slate-300"}`} />
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 hidden xl:table-cell">{t("Spend")}</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 hidden xl:table-cell">
                  <button onClick={() => toggleSort("initiated")} className="inline-flex items-center gap-1 hover:text-slate-600 uppercase tracking-wider">
                    {t("Initiated")} <ArrowUpDown className={`w-3 h-3 ${sortKey === "initiated" ? "text-blue-500" : "text-slate-300"}`} />
                  </button>
                </th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center text-sm text-slate-400">
                    {t("No events match your search.")}
                  </td>
                </tr>
              ) : visible.map(event => {
                const cfg = STATUS_CONFIG[event.status] || STATUS_CONFIG.idle;
                return (
                  <tr
                    key={event.id}
                    onClick={() => router.push(`/events/${event.id}`)}
                    className="hover:bg-slate-50/60 transition-colors group cursor-pointer"
                  >
                    <td className="px-6 py-4 max-w-0">
                      <div className="font-semibold text-slate-900 text-sm truncate">{event.title}</div>
                      <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
                        {event.wave_count > 0 && (
                          <span>{event.wave_count === 1 ? t("{count} wave", { count: event.wave_count }) : t("{count} waves", { count: event.wave_count })}</span>
                        )}
                        {event.wave_count > 0 && <span className="text-slate-300">·</span>}
                        <span>{t("updated {time}", { time: relativeTime(event.updated_at || event.created_at) })}</span>
                      </div>
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
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors inline-block" />
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
