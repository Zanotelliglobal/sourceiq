"use client";

// ─── IN-APP CONFIRM / PROMPT MODAL (#74) ───────────────────────────────────
// Replaces native window.confirm()/window.prompt() calls, which: block the
// whole tab (can't be styled, ignored by some browsers' popup blockers, and
// look untrustworthy embedded in a SaaS product), aren't announced usefully
// to screen readers, and can't be evaluated in our own component/E2E tests.
//
// A single component covers both call shapes:
//   - confirm-only: omit `inputDefaultValue` → message + Cancel/Confirm.
//   - prompt (confirm + text field): pass `inputDefaultValue` (may be "") →
//     adds a focused, pre-filled input; Enter submits, empty value disables
//     the confirm button when `inputRequired` is set.

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/LanguageProvider";

export type ConfirmDialogProps = {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in red — use for destructive actions (delete). */
  destructive?: boolean;
  /** Presence (even "") switches the dialog into prompt mode with this seed value. */
  inputDefaultValue?: string;
  inputPlaceholder?: string;
  /** Prompt mode only: disable confirm while the trimmed input is empty. Default true. */
  inputRequired?: boolean;
  /** Prompt mode passes the current input value; confirm mode passes undefined. */
  onConfirm: (value?: string) => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive,
  inputDefaultValue,
  inputPlaceholder,
  inputRequired = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useT();
  const isPrompt = inputDefaultValue !== undefined;
  const [value, setValue] = useState(inputDefaultValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reseed the input every time the dialog re-opens for a (possibly different) row.
  useEffect(() => {
    if (open) setValue(inputDefaultValue ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inputDefaultValue]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  useEffect(() => {
    if (open && isPrompt) inputRef.current?.focus();
  }, [open, isPrompt]);

  if (!open) return null;

  const confirmDisabled = isPrompt && inputRequired && !value.trim();

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onCancel} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "confirm-dialog-title" : undefined}
        aria-describedby="confirm-dialog-message"
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-slide-in"
      >
        {title && (
          <h2 id="confirm-dialog-title" className="text-base font-bold text-slate-900 mb-2">
            {title}
          </h2>
        )}
        <p id="confirm-dialog-message" className="text-sm text-slate-600 leading-snug">
          {message}
        </p>
        {isPrompt && (
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !confirmDisabled) onConfirm(value);
            }}
            placeholder={inputPlaceholder}
            className="mt-3 w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
          />
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm font-semibold rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
          >
            {cancelLabel ?? t("Cancel")}
          </button>
          <button
            onClick={() => onConfirm(isPrompt ? value : undefined)}
            disabled={confirmDisabled}
            className={`px-3 py-1.5 text-sm font-semibold rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              destructive ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {confirmLabel ?? t("Confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
