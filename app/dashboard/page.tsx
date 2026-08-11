"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { Zap, Factory, Star, ClipboardList, Search, Plus, Loader2, ChevronRight, ArrowUpDown, Trash2, Layers, Pin, Archive, ArchiveRestore, Pencil, X } from "lucide-react";
import { useT } from "@/components/LanguageProvider";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useToasts, ToastStack } from "@/components/Toast";
import { sortEventRows } from "@/lib/event-list";

type EventRow = {
  id: number; title: string; category: string; status: string;
  annual_spend: string | null;
  wave_count: number; created_at: string; updated_at: string;
  supplier_count: number; shortlisted_count: number;
  pinned: boolean; archived: boolean;
  // Clerk user id of whoever started the event (nullable for legacy rows).
  // Only meaningful to admins/owners — non-admins only ever receive their own
  // events from the API, so this column is hidden for them.
  created_by?: string | null;
};

// Team roster shape from /api/team, used to resolve `created_by` into a
// display name for the admin-only "Started by" column.
type TeamMember = { user_id: string | null; name: string | null; email: string | null };

// Cross-project search hit shapes returned by /api/search (#40).
type SearchSupplierHit = {
  id: number; name: string; country: string;
  event_id: number; event_title: string; event_archived: boolean;
};

// Clean a legacy raw-sentence title for display (new events already get a
// concise AI-generated title). Strips common Quick-Source lead-ins like
// "I am looking for a new supplier of…" and capitalizes the result.
function cleanTitle(raw: string): string {
  const original = (raw || "").trim();
  let s = original;
  s = s.replace(/^(i\s*['’]?\s*a?m\s+)?(currently\s+)?(looking\s+(?:for|to\s+source)|searching\s+for|in\s+search\s+of|we\s+(?:are\s+)?(?:looking\s+for|need|require|want)|i\s+(?:need|want|require)|need|want|seeking|source|sourcing)\s+/i, "");
  s = s.replace(/^(?:a\s+new\s+|a\s+|an\s+|new\s+|our\s+|the\s+)?(?:supplier|vendor|manufacturer|source|provider)s?\s+(?:of|for)\s+/i, "");
  s = s.replace(/^(?:of|for)\s+/i, "");
  s = s.trim();
  if (!s) s = original;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Compact relative time (e.g. "3h ago", "2d ago") for the last-activity signal.
function relativeTime(iso: string, t: (k: string, v?: Record<string, string | number>) => string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 60) return t("just now");
  const m = Math.floor(s / 60);
  if (m < 60) return t("{n}m ago", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("{n}h ago", { n: h });
  const d = Math.floor(h / 24);
  if (d < 30) return t("{n}d ago", { n: d });
  const mo = Math.floor(d / 30);
  if (mo < 12) return t("{n}mo ago", { n: mo });
  return t("{n}y ago", { n: Math.floor(mo / 12) });
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
  const { user } = useUser();
  const [events, setEvents] = useState<EventRow[]>([]);
  // Team roster (#multi-user visibility): fetched once, not polled, purely to
  // resolve created_by -> display name for the admin-only "Started by" column
  // and to know whether the current viewer is an admin/owner at all.
  const [teamRole, setTeamRole] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("activity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [pinningId, setPinningId] = useState<number | null>(null);
  const [archivingId, setArchivingId] = useState<number | null>(null);
  // In-app confirm/prompt modals (#74) — replace window.confirm()/window.prompt(),
  // which block the tab and can't be styled or unit-tested. Holding the target
  // row (not just a boolean) lets the dialog render its own title/message.
  const [deleteTarget, setDeleteTarget] = useState<EventRow | null>(null);
  const [renameTarget, setRenameTarget] = useState<EventRow | null>(null);
  // Toasts (#74) replace blocking window.alert() for error notifications.
  const { toasts, pushToast, dismissToast } = useToasts();
  // Archive (#40): hidden from the default list; toggled on to review/restore them.
  const [showArchived, setShowArchived] = useState(false);
  // Cross-project search (#40): the existing `query` box already filters the
  // loaded events client-side; this additionally looks up matching suppliers
  // anywhere in the org (suppliers aren't loaded on this page) via /api/search.
  const [searchFocused, setSearchFocused] = useState(false);
  const [supplierResults, setSupplierResults] = useState<SearchSupplierHit[]>([]);
  const [searchingSuppliers, setSearchingSuppliers] = useState(false);
  const [trial, setTrial] = useState<{ status: string; trial_ends_at: string | null; active: boolean } | null>(null);
  const [usage, setUsage] = useState<{
    tier: string; tier_name: string; unlimited: number;
    events_this_month: number; events_remaining: number | null;
    tokens_used: number; cost_usd: number;
    limits: { eventsPerMonth: number };
  } | null>(null);

  useEffect(() => {
    fetch("/api/billing/status")
      .then(r => r.json())
      .then(d => setTrial(d))
      .catch(() => {});
    fetch("/api/usage")
      .then(r => r.json())
      .then(d => { if (!d?.error) setUsage(d); })
      .catch(() => {});
    fetch("/api/team")
      .then(r => r.json())
      .then(d => {
        if (!d?.error) {
          setTeamRole(d.role ?? null);
          setTeamMembers(Array.isArray(d.members) ? d.members : []);
        }
      })
      .catch(() => {});
  }, []);

  // Only admins/owners get the "Started by" column — regular members already
  // only ever receive their own events from the API, so the column would be
  // redundant (and potentially confusing) for them.
  const isAdmin = teamRole === "admin" || teamRole === "owner";

  // Resolve a Clerk user id (sourcing_events.created_by) into a display label.
  // Mirrors the fallback pattern used server-side in lib/audit.ts.
  const starterLabel = (createdBy: string | null | undefined): string => {
    if (!createdBy) return t("Legacy");
    if (user && createdBy === user.id) return t("You");
    if (createdBy === "dev_user") return t("Local dev");
    const member = teamMembers.find(m => m.user_id === createdBy);
    if (member) return member.name || member.email || `User ${createdBy.slice(-6)}`;
    return `User ${createdBy.slice(-6)}`;
  };

  // Human-readable token count (e.g. 12.4K, 3.1M) for the usage meter.
  const fmtTokens = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K`
    : String(n);

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
            // Poll a little faster while agents are running so the supplier
            // count visibly ticks up live rather than in slow 5s jumps.
            if (stillWorking) timer = setTimeout(load, 4000);
          } else {
            setError(d?.error || t("Failed to load events"));
          }
          setLoading(false);
        })
        .catch(e => { if (!cancelled) { setError(String(e)); setLoading(false); } });
    };

    load();
    return () => { cancelled = true; clearTimeout(timer); };
    // `t` is intentionally omitted: this starts a self-rescheduling poll loop
    // that should run once on mount, not restart every time the user switches
    // language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross-project supplier search (#40): debounced so we don't hit the API on
  // every keystroke. Only runs while the search box is focused and non-trivial.
  useEffect(() => {
    const q = query.trim();
    if (!searchFocused || q.length < 2) { setSupplierResults([]); return; }
    let cancelled = false;
    setSearchingSuppliers(true);
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then(r => r.json())
        .then(d => { if (!cancelled) setSupplierResults(Array.isArray(d?.suppliers) ? d.suppliers : []); })
        .catch(() => { if (!cancelled) setSupplierResults([]); })
        .finally(() => { if (!cancelled) setSearchingSuppliers(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, searchFocused]);

  const activeEvents = events.filter(e => !e.archived);
  const archivedCount = events.length - activeEvents.length;

  const stats = {
    total: activeEvents.length,
    // Only genuinely-running events count as active (stale/interrupted ones are
    // downgraded to reviewing/idle by the API, so they no longer inflate this).
    active: activeEvents.filter(e => WORKING.has(e.status)).length,
    suppliers: activeEvents.reduce((a, e) => a + (e.supplier_count || 0), 0),
    shortlisted: activeEvents.reduce((a, e) => a + (e.shortlisted_count || 0), 0),
  };

  // Client-side search + status filter (query/status are UI-specific), then
  // hand off to the pure archived-filter + pinned-first sort (#40, lib/event-list.ts).
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchesStatus = (e: EventRow) =>
      statusFilter === "all" ? true
      : statusFilter === "active" ? WORKING.has(e.status)
      : e.status === statusFilter;
    const candidates = events.filter(e =>
      matchesStatus(e) &&
      (!q || e.title.toLowerCase().includes(q) || (e.category || "").toLowerCase().includes(q))
    );
    return sortEventRows(candidates, { showArchived, sortKey, sortDir });
  }, [events, query, statusFilter, sortKey, sortDir, showArchived]);

  // Toggle sort direction when re-clicking the active column, else switch column.
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  // Delete an event — opens the in-app confirm dialog (#74); the actual
  // request only fires from confirmDelete() once the user confirms there.
  const handleDelete = (event: EventRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget(event);
  };

  // Optimistically drops the event from the list; reloads on failure so the
  // UI never diverges from the server. Invoked by ConfirmDialog's onConfirm.
  const confirmDelete = async () => {
    const event = deleteTarget;
    if (!event) return;
    setDeleteTarget(null);
    setDeletingId(event.id);
    try {
      const res = await fetch(`/api/sourcing-events/${event.id}`, { method: "DELETE" });
      if (res.ok) setEvents(prev => prev.filter(x => x.id !== event.id));
      else pushToast("error", t("Couldn't delete this event. Please try again."));
    } catch {
      pushToast("error", t("Couldn't delete this event. Please try again."));
    } finally {
      setDeletingId(null);
    }
  };

  // Rename an event's display title (#40) — opens the in-app prompt dialog
  // (#74) instead of a native window.prompt(); confirmRename() does the work.
  const handleRename = (event: EventRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameTarget(event);
  };

  const confirmRename = async (value?: string) => {
    const event = renameTarget;
    setRenameTarget(null);
    if (!event) return;
    const title = (value ?? "").trim();
    if (!title || title === event.title) return;
    setRenamingId(event.id);
    try {
      const res = await fetch(`/api/sourcing-events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (res.ok) setEvents(prev => prev.map(x => (x.id === event.id ? { ...x, title } : x)));
      else pushToast("error", t("Couldn't rename this event. Please try again."));
    } catch {
      pushToast("error", t("Couldn't rename this event. Please try again."));
    } finally {
      setRenamingId(null);
    }
  };

  // Pin/unpin: optimistic toggle so the row moves to the top instantly; reverts
  // on failure so the UI never diverges from the server.
  const handleTogglePin = async (event: EventRow, e: React.MouseEvent) => {
    e.stopPropagation();
    const pinned = !event.pinned;
    setPinningId(event.id);
    setEvents(prev => prev.map(x => (x.id === event.id ? { ...x, pinned } : x)));
    try {
      const res = await fetch(`/api/sourcing-events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setEvents(prev => prev.map(x => (x.id === event.id ? { ...x, pinned: !pinned } : x)));
      pushToast("error", t("Couldn't update pin status. Please try again."));
    } finally {
      setPinningId(null);
    }
  };

  // Archive/unarchive: hides (or restores) a project from the default dashboard
  // view without deleting any of its data.
  const handleToggleArchive = async (event: EventRow, e: React.MouseEvent) => {
    e.stopPropagation();
    const archived = !event.archived;
    setArchivingId(event.id);
    setEvents(prev => prev.map(x => (x.id === event.id ? { ...x, archived } : x)));
    try {
      const res = await fetch(`/api/sourcing-events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setEvents(prev => prev.map(x => (x.id === event.id ? { ...x, archived: !archived } : x)));
      pushToast("error", t("Couldn't update archive status. Please try again."));
    } finally {
      setArchivingId(null);
    }
  };

  // Group visible events by category for the clustered view.
  const grouped = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const e of visible) {
      const key = (e.category || t("Uncategorised")).trim() || t("Uncategorised");
      (map.get(key) ?? map.set(key, []).get(key)!).push(e);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible, t]);

  // A single event row — shared by the flat and grouped (clustered) views.
  const renderRow = (event: EventRow) => {
    const cfg = STATUS_CONFIG[event.status] || STATUS_CONFIG.idle;
    return (
      <tr
        key={event.id}
        onClick={() => router.push(`/events/${event.id}`)}
        onKeyDown={e => {
          // Keyboard equivalent of the row click (#86) — Enter/Space open the
          // event, same as clicking anywhere on the row.
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            router.push(`/events/${event.id}`);
          }
        }}
        tabIndex={0}
        aria-label={t("Open {value}", { value: cleanTitle(event.title) })}
        className="hover:bg-slate-50/60 transition-colors group cursor-pointer focus:outline-none focus-visible:bg-slate-50"
      >
        <td className="px-6 py-4">
          <div className="flex items-center gap-1.5">
            {event.pinned && <Pin className="w-3 h-3 text-amber-500 fill-current flex-shrink-0" aria-label={t("Pinned")} />}
            <div className="font-semibold text-slate-900 text-sm truncate max-w-[160px] sm:max-w-[220px] lg:max-w-[300px] xl:max-w-[360px]">{cleanTitle(event.title)}</div>
          </div>
          <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
            {event.wave_count > 0 && (
              <span>{event.wave_count === 1 ? t("{count} wave", { count: event.wave_count }) : t("{count} waves", { count: event.wave_count })}</span>
            )}
            {event.wave_count > 0 && <span className="text-slate-500">·</span>}
            <span>{t("updated {time}", { time: relativeTime(event.updated_at || event.created_at, t) })}</span>
          </div>
        </td>
        <td className="px-4 py-4 hidden md:table-cell">
          <span className="text-sm text-slate-600">{event.category}</span>
        </td>
        <td className="px-4 py-4">
          {/* #92: announce status changes (e.g. idle → scouting → reviewing)
              to screen-reader users, not just sighted ones watching the badge. */}
          <div className="flex items-center gap-2" role="status" aria-live="polite">
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
          <div className="text-sm text-slate-700 font-medium flex items-center gap-1.5">
            {cfg.working && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse flex-shrink-0" title={t("Discovering live")} />}
            <span>{event.supplier_count || 0}<span className="font-normal text-slate-500"> {t("found")}</span></span>
          </div>
          {(event.shortlisted_count || 0) > 0 && (
            <div className="text-xs text-amber-800 font-medium">{t("{count} shortlisted", { count: event.shortlisted_count })}</div>
          )}
        </td>
        <td className="px-4 py-4 hidden xl:table-cell">
          <span className="text-xs text-slate-500">
            {new Date(event.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </span>
        </td>
        {isAdmin && (
          <td className="px-4 py-4 hidden lg:table-cell">
            <span className="text-xs text-slate-600">{starterLabel(event.created_by)}</span>
          </td>
        )}
        <td className="px-4 py-4 text-right whitespace-nowrap">
          <div className="inline-flex items-center gap-0.5">
            <button
              onClick={e => handleRename(event, e)}
              disabled={renamingId === event.id}
              title={t("Rename event")}
              aria-label={t("Rename event")}
              className="inline-flex items-center justify-center p-1.5 rounded-lg text-slate-500 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
            >
              {renamingId === event.id
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Pencil className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={e => handleTogglePin(event, e)}
              disabled={pinningId === event.id}
              title={event.pinned ? t("Unpin event") : t("Pin event")}
              aria-label={event.pinned ? t("Unpin event") : t("Pin event")}
              className={`inline-flex items-center justify-center p-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                event.pinned ? "text-amber-500 hover:bg-amber-50" : "text-slate-500 hover:text-amber-700 hover:bg-amber-50"
              }`}
            >
              {pinningId === event.id
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Pin className={`w-3.5 h-3.5 ${event.pinned ? "fill-current" : ""}`} />}
            </button>
            <button
              onClick={e => handleToggleArchive(event, e)}
              disabled={archivingId === event.id}
              title={event.archived ? t("Unarchive event") : t("Archive event")}
              aria-label={event.archived ? t("Unarchive event") : t("Archive event")}
              className="inline-flex items-center justify-center p-1.5 rounded-lg text-slate-500 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
            >
              {archivingId === event.id
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : event.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={e => handleDelete(event, e)}
              disabled={deletingId === event.id}
              title={t("Delete event")}
              aria-label={t("Delete event")}
              className="inline-flex items-center justify-center p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {deletingId === event.id
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Trash2 className="w-3.5 h-3.5" />}
            </button>
            <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-blue-500 transition-colors ml-1" />
          </div>
        </td>
      </tr>
    );
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

      {/* Quick-start checklist — fetches its own per-org progress; hides once all tasks are done or dismissed */}
      {!loading && !error && <OnboardingChecklist />}

      {/* KPI bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: t("Active Events"),      value: stats.active,     sub: t("{total} total events", { total: stats.total }),        Icon: Zap,           color: "text-blue-600",   iconColor: "text-blue-500" },
          { label: t("Suppliers Identified"),value: stats.suppliers,  sub: t("across all events"),                  Icon: Factory,       color: "text-slate-900",  iconColor: "text-slate-500" },
          { label: t("Short Listed"),       value: stats.shortlisted, sub: t("approved for RFI"),                  Icon: Star,          color: "text-amber-800",  iconColor: "text-amber-500" },
          { label: t("Total Events"),       value: stats.total,       sub: t("all time"),                           Icon: ClipboardList, color: "text-slate-600",  iconColor: "text-slate-500" },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="flex items-center justify-between mb-2">
              <s.Icon className={`w-5 h-5 ${s.iconColor}`} strokeWidth={2} />
            </div>
            <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-sm font-semibold text-slate-700 mt-0.5">{s.label}</div>
            <div className="text-xs text-slate-500">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Usage meter: current-month consumption vs the org's plan limits */}
      {usage && (
        <div className="card px-4 sm:px-6 py-4 mb-8 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
          <div className="flex items-center gap-2">
            <span className="badge badge-blue">{t(usage.tier_name)}</span>
            <span className="text-xs text-slate-500">{t("Usage this month")}</span>
          </div>
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <div className="text-sm font-bold text-slate-900">
                {usage.events_this_month}
                <span className="font-normal text-slate-500"> / {usage.limits.eventsPerMonth === usage.unlimited ? t("Unlimited") : usage.limits.eventsPerMonth}</span>
              </div>
              <div className="text-xs text-slate-500">{t("Sourcing events")}</div>
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">{fmtTokens(usage.tokens_used)}</div>
              <div className="text-xs text-slate-500">{t("Tokens used")}</div>
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">${usage.cost_usd.toFixed(2)}</div>
              <div className="text-xs text-slate-500">{t("Estimated cost")}</div>
            </div>
          </div>
          {usage.events_remaining !== null && usage.events_remaining <= 1 && (
            <Link href="/billing" className="text-xs font-semibold text-blue-700 hover:underline whitespace-nowrap">
              {t("Upgrade plan")}
            </Link>
          )}
        </div>
      )}

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
          <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
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
              <span className="text-xs text-slate-500">{visible.length === 1 ? t("{count} event", { count: visible.length }) : t("{count} events", { count: visible.length })}</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  aria-label={t("Search events and suppliers")}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  // Delay so a click on a dropdown result registers before it unmounts.
                  onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                  placeholder={t("Search events & suppliers…")}
                  // #92: this is a search-typeahead combobox — expose it as one so
                  // AT users get "combobox, expanded/collapsed" + the results
                  // listbox announced, instead of a plain unlabeled text input.
                  role="combobox"
                  aria-autocomplete="list"
                  aria-haspopup="listbox"
                  aria-expanded={searchFocused && query.trim().length >= 2}
                  aria-controls="dashboard-search-results"
                  className="w-full sm:w-64 pl-8 pr-7 py-1.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    title={t("Clear search")}
                    aria-label={t("Clear search")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-500 hover:text-slate-600 hover:bg-slate-100"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                {/* Cross-project search results (#40): suppliers anywhere in the
                    org matching the query, since suppliers themselves aren't
                    loaded on this page. Clicking jumps to their parent event. */}
                {searchFocused && query.trim().length >= 2 && (
                  <div
                    id="dashboard-search-results"
                    role="listbox"
                    aria-label={t("Suppliers across your projects")}
                    className="absolute z-20 top-full left-0 mt-1 w-80 max-h-80 overflow-y-auto bg-white rounded-lg border border-slate-200 shadow-lg"
                  >
                    {searchingSuppliers ? (
                      <div className="px-3 py-3 text-xs text-slate-500">{t("Searching…")}</div>
                    ) : supplierResults.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-slate-500">{t("No matching suppliers found.")}</div>
                    ) : (
                      <>
                        <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                          {t("Suppliers across your projects")}
                        </div>
                        {supplierResults.map(s => (
                          <button
                            key={s.id}
                            role="option"
                            aria-selected="false"
                            onClick={() => router.push(`/events/${s.event_id}`)}
                            className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                          >
                            <div className="text-sm font-semibold text-slate-800 truncate">{s.name}</div>
                            <div className="text-xs text-slate-500 truncate">
                              {s.country ? `${s.country} · ` : ""}{t("in")} {cleanTitle(s.event_title)}
                              {s.event_archived && <span className="ml-1 text-slate-500">({t("archived")})</span>}
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
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
                <button
                  onClick={() => setGroupByCategory(v => !v)}
                  title={t("Group by category")}
                  className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
                    groupByCategory
                      ? "bg-violet-50 text-violet-700 border-violet-200"
                      : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  {t("Group by category")}
                </button>
                <button
                  onClick={() => setShowArchived(v => !v)}
                  title={t("Show archived events")}
                  className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
                    showArchived
                      ? "bg-slate-800 text-white border-slate-800"
                      : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <Archive className="w-3.5 h-3.5" />
                  {t("Archived")}
                  {archivedCount > 0 && (
                    <span className={`ml-0.5 px-1.5 rounded text-[10px] ${showArchived ? "bg-white/20" : "bg-slate-100"}`}>{archivedCount}</span>
                  )}
                </button>
              </div>
            </div>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">{t("Event")}</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 hidden md:table-cell">{t("Category")}</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">{t("Status")}</th>
                <th
                  className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 hidden lg:table-cell"
                  aria-sort={sortKey === "pipeline" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button onClick={() => toggleSort("pipeline")} className="inline-flex items-center gap-1 hover:text-slate-600 uppercase tracking-wider">
                    {t("Pipeline")} <ArrowUpDown className={`w-3 h-3 ${sortKey === "pipeline" ? "text-blue-500" : "text-slate-500"}`} />
                  </button>
                </th>
                <th
                  className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 hidden xl:table-cell"
                  aria-sort={sortKey === "initiated" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button onClick={() => toggleSort("initiated")} className="inline-flex items-center gap-1 hover:text-slate-600 uppercase tracking-wider">
                    {t("Initiated")} <ArrowUpDown className={`w-3 h-3 ${sortKey === "initiated" ? "text-blue-500" : "text-slate-500"}`} />
                  </button>
                </th>
                {isAdmin && (
                  <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 hidden lg:table-cell">{t("Started by")}</th>
                )}
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6} className="px-6 py-16 text-center text-sm text-slate-500">
                    {showArchived ? t("No archived events.") : t("No events match your search.")}
                  </td>
                </tr>
              ) : groupByCategory ? (
                grouped.map(([category, rows]) => (
                  <Fragment key={category}>
                    <tr className="bg-slate-50/70">
                      <td colSpan={isAdmin ? 7 : 6} className="px-6 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        {category} <span className="text-slate-500 font-semibold">· {rows.length}</span>
                      </td>
                    </tr>
                    {rows.map(renderRow)}
                  </Fragment>
                ))
              ) : (
                visible.map(renderRow)
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* In-app confirm/prompt modals (#74) — replace window.confirm()/window.prompt() */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("Delete event")}
        message={
          deleteTarget
            ? t("Delete “{title}”? This permanently removes the event and all its suppliers.", { title: cleanTitle(deleteTarget.title) })
            : ""
        }
        confirmLabel={t("Delete")}
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmDialog
        open={renameTarget !== null}
        title={t("Rename event")}
        message={t("Enter a new name for this event.")}
        confirmLabel={t("Save")}
        inputDefaultValue={renameTarget ? cleanTitle(renameTarget.title) : ""}
        inputPlaceholder={t("Event name")}
        onConfirm={confirmRename}
        onCancel={() => setRenameTarget(null)}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
