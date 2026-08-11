"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Bell, CheckCheck, Search, MessageSquare, AlertTriangle } from "lucide-react";
import { useT } from "@/components/LanguageProvider";

// Bell menu in the top nav. Polls /api/notifications (no websockets — polling is
// fine per the spec), shows an unread badge, and lists recent org notifications.
// Clicking an item marks it read and navigates; "Mark all read" clears the badge.
type Item = {
  id: number;
  event_id: number | null;
  type: "discovery_complete" | "supplier_reply" | "outreach_failure" | string;
  title: string;
  body: string | null;
  url: string | null;
  read: boolean;
  created_at: string;
};

const ICONS: Record<string, typeof Bell> = {
  discovery_complete: Search,
  supplier_reply: MessageSquare,
  outreach_failure: AlertTriangle,
};

function timeAgo(iso: string, t: (s: string) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return t("just now");
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function NotificationBell() {
  const t = useT();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = (await res.json()) as { items: Item[]; unread: number };
      setItems(data.items ?? []);
      setUnread(data.unread ?? 0);
    } catch {
      /* transient — next poll retries */
    }
  }, []);

  // Initial load + poll every 60s.
  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Close on Escape — keyboard-only users have no other way to dismiss the
  // panel without tabbing all the way through its contents.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function markRead(id: number) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      /* optimistic — reconciled on next poll */
    }
  }

  async function markAll() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      /* optimistic */
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("Notifications")}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="notification-panel"
        className="relative w-9 h-9 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
      >
        <Bell className="w-4.5 h-4.5" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          id="notification-panel"
          aria-label={t("Notifications")}
          className="absolute right-0 mt-2 w-80 max-h-[26rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg z-50 flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="text-sm font-bold text-slate-900">{t("Notifications")}</span>
            {unread > 0 && (
              <button
                onClick={markAll}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                {t("Mark all read")}
              </button>
            )}
          </div>

          <div className="overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-400">
                {t("No notifications yet")}
              </div>
            ) : (
              items.map((n) => {
                const Icon = ICONS[n.type] ?? Bell;
                const inner = (
                  <div className="flex gap-3 px-4 py-3">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${n.read ? "bg-slate-100 text-slate-400" : "bg-blue-50 text-blue-600"}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <span className={`text-xs ${n.read ? "font-medium text-slate-600" : "font-bold text-slate-900"} truncate`}>
                          {n.title}
                        </span>
                        {!n.read && <span className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-600 flex-shrink-0" />}
                      </div>
                      {n.body && <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{n.body}</p>}
                      <span className="text-[10px] text-slate-400">{timeAgo(n.created_at, t)}</span>
                    </div>
                  </div>
                );
                return n.url ? (
                  <Link
                    key={n.id}
                    href={n.url}
                    onClick={() => { markRead(n.id); setOpen(false); }}
                    className="block hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                  >
                    {inner}
                  </Link>
                ) : (
                  <button
                    key={n.id}
                    onClick={() => markRead(n.id)}
                    className="block w-full text-left hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                  >
                    {inner}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
