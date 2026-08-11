"use client";

// ─── SHARED TOAST STACK (#74) ──────────────────────────────────────────────
// Extracted from app/events/[id]/page.tsx's original inline toast implementation
// so other pages (starting with app/dashboard/page.tsx) can swap blocking
// window.alert() calls for the same non-blocking, dismissible notification
// pattern instead of reinventing it. Behavior/styling is unchanged from the
// original — this is a lift-and-share, not a redesign.

import { useCallback, useRef, useState } from "react";
import { X } from "lucide-react";
import { useT } from "@/components/LanguageProvider";

export type ToastKind = "error" | "success" | "info";
export type ToastAction = { label: string; run: () => void };
export type ToastItem = { id: number; kind: ToastKind; msg: string; action?: ToastAction };

/** Transient user-facing notifications (errors, confirmations, undo). */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(x => x.id !== id));
  }, []);

  const pushToast = useCallback((kind: ToastKind, msg: string, action?: ToastAction) => {
    const id = ++seq.current;
    setToasts(prev => [...prev, { id, kind, msg, action }]);
    // Errors and undo prompts linger longer; plain info fades quickly.
    const ttl = action ? 8000 : kind === "error" ? 6000 : 3500;
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), ttl);
    return id;
  }, []);

  return { toasts, pushToast, dismissToast };
}

export function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  const t = useT();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[80] flex flex-col gap-2 w-full max-w-sm pointer-events-none" aria-live="assertive" aria-atomic="false">
      {toasts.map(toast => (
        <div
          key={toast.id}
          role={toast.kind === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg animate-slide-in ${
            toast.kind === "error"   ? "bg-red-50 border-red-200 text-red-800" :
            toast.kind === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" :
                                       "bg-slate-800 border-slate-700 text-white"
          }`}
        >
          <span className="text-sm leading-snug flex-1">{toast.msg}</span>
          {toast.action && (
            <button
              onClick={() => { toast.action!.run(); onDismiss(toast.id); }}
              className="text-xs font-bold underline underline-offset-2 hover:opacity-80 flex-shrink-0"
            >
              {toast.action.label}
            </button>
          )}
          <button
            onClick={() => onDismiss(toast.id)}
            aria-label={t("Dismiss")}
            className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
