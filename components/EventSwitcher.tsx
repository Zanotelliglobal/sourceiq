"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Pin, Clock } from "lucide-react";
import { useT } from "@/components/LanguageProvider";
import { sortEventRows, type EventListItem } from "@/lib/event-list";

type EventSummary = EventListItem & { id: number; title: string };

// Compact "switch project" control for the event workspace header (#46 —
// Epic 5.1's "named, saved chats in left rail" analog, adapted to SourceGPT's
// architecture: projects/events are the durable unit here, not chat threads —
// see the strategic framing at the top of the competitive backlog doc). The
// event workspace runs its own full-height layout and deliberately opts out
// of the global sidebar (see AppShell.tsx's comment), so rather than bolting
// on a second persistent rail, this reuses the same event-list data (GET
// /api/sourcing-events, already powering the dashboard) as a lightweight
// dropdown: pinned-first, most-recently-active-next — identical ordering to
// the dashboard list. Clicking an entry navigates straight into that
// project's workspace, "restoring its history" the same way returning to any
// saved project does.
export default function EventSwitcher({ currentEventId }: { currentEventId: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || events) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/sourcing-events");
        if (!res.ok) return;
        const data = (await res.json()) as EventSummary[];
        if (alive) setEvents(data);
      } catch {
        // Non-fatal — the dropdown just stays empty/loading; the primary
        // "Dashboard" link right next to this control still works.
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, events]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Close on Escape — keyboard-only users have no other way to dismiss the
  // panel without tabbing all the way through its contents.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const recent = events
    ? sortEventRows(events, { showArchived: false, sortKey: "activity", sortDir: "desc" }).slice(0, 8)
    : [];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 bg-white px-2.5 py-1 rounded-lg transition-colors"
        title={t("Switch to another project")}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="event-switcher-menu"
      >
        <Clock className="w-3 h-3" />
        {t("Switch project")}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div id="event-switcher-menu" role="menu" aria-label={t("Switch project")} className="absolute left-0 mt-1 w-64 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg z-30 py-1">
          {events === null ? (
            <div className="px-3 py-3 text-xs text-slate-500">{t("Loading…")}</div>
          ) : recent.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-500">{t("No other projects yet.")}</div>
          ) : (
            recent.map(ev => (
              <Link
                key={ev.id}
                href={`/events/${ev.id}`}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs hover:bg-slate-50 transition-colors ${
                  ev.id === currentEventId ? "bg-blue-50 text-blue-700 font-semibold" : "text-slate-600"
                }`}
              >
                {ev.pinned && <Pin className="w-3 h-3 text-amber-500 flex-shrink-0" />}
                <span className="truncate">{ev.title}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
