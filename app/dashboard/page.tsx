"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Zap, Factory, Star, ClipboardList, Search, Plus, ArrowRight } from "lucide-react";

type EventRow = {
  id: number; title: string; category: string; status: string;
  annual_spend: string | null; timeline: string | null;
  wave_count: number; created_at: string;
  supplier_count: number; shortlisted_count: number;
};

const STATUS_CONFIG: Record<string, { label: string; dot: string; badge: string }> = {
  idle:       { label: "Draft",        dot: "bg-slate-400",   badge: "badge-slate" },
  scouting:   { label: "Scouting",     dot: "bg-blue-500 animate-pulse", badge: "badge-blue" },
  reviewing:  { label: "In Review",    dot: "bg-amber-500",   badge: "badge-amber" },
  shortlisting:{ label: "Shortlisting",dot: "bg-violet-500",  badge: "badge-purple" },
  outreach:   { label: "Outreach",     dot: "bg-orange-500",  badge: "badge-amber" },
  completed:  { label: "Completed",    dot: "bg-emerald-500", badge: "badge-green" },
};

export default function Dashboard() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sourcing-events")
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d)) setEvents(d);
        else setError(d?.error || "Failed to load events");
        setLoading(false);
      })
      .catch(e => { setError(String(e)); setLoading(false); });
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
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Sourcing Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Monitor active procurement events and AI-driven supplier intelligence
          </p>
        </div>
        <Link href="/events/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          New Sourcing Event
        </Link>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Active Events",      value: stats.active,     sub: `${stats.total} total events`,        Icon: Zap,           color: "text-blue-600",   iconColor: "text-blue-500" },
          { label: "Suppliers Identified",value: stats.suppliers,  sub: "across all events",                  Icon: Factory,       color: "text-slate-900",  iconColor: "text-slate-400" },
          { label: "Short Listed",       value: stats.shortlisted, sub: "approved for RFI",                  Icon: Star,          color: "text-amber-600",  iconColor: "text-amber-500" },
          { label: "Total Events",       value: stats.total,       sub: "all time",                           Icon: ClipboardList, color: "text-slate-600",  iconColor: "text-slate-400" },
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
          <h2 className="text-base font-bold text-red-600 mb-1">Couldn&apos;t load events</h2>
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
          <h2 className="text-lg font-bold text-slate-700 mb-2">No sourcing events yet</h2>
          <p className="text-sm text-slate-400 max-w-sm mx-auto mb-6">
            Create your first sourcing event to deploy AI agents across global supplier networks and build a qualified long list in minutes.
          </p>
          <Link href="/events/new" className="btn-primary">
            Initiate First Sourcing Event
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">Sourcing Events</h2>
            <span className="text-xs text-slate-400">{events.length} event{events.length !== 1 ? "s" : ""}</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">Event</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 hidden md:table-cell">Category</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">Status</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 hidden lg:table-cell">Pipeline</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 hidden xl:table-cell">Spend</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 hidden xl:table-cell">Initiated</th>
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
                        <div className="text-xs text-slate-400 mt-0.5">{event.wave_count} discovery wave{event.wave_count !== 1 ? "s" : ""} completed</div>
                      )}
                    </td>
                    <td className="px-4 py-4 hidden md:table-cell">
                      <span className="text-sm text-slate-600">{event.category}</span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                        <span className={`badge ${cfg.badge}`}>{cfg.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 hidden lg:table-cell">
                      <div className="text-sm text-slate-700 font-medium">{event.supplier_count || 0}
                        <span className="font-normal text-slate-400"> found</span>
                      </div>
                      {(event.shortlisted_count || 0) > 0 && (
                        <div className="text-xs text-amber-600 font-medium">{event.shortlisted_count} shortlisted</div>
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
                        Open <ArrowRight className="w-3 h-3" />
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
