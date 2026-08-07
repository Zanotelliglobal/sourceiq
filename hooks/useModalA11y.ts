import { useEffect, useRef } from "react";

// Shared modal accessibility: Esc-to-close, initial focus into the dialog, a
// lightweight focus trap so keyboard users can't tab out, and focus restoration
// to the previously focused element on close. Returns a ref for the dialog node.
//
// Originally a private helper inside app/events/[id]/page.tsx; extracted so
// other modals (dashboard rename/archive confirmations, billing cancel-impact
// dialog, #40) can reuse the same behaviour without duplicating it.
export function useModalA11y(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key === "Tab" && node) {
        const f = node.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
        );
        if (f.length === 0) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previouslyFocused?.focus?.(); };
  }, [onClose]);
  return ref;
}
