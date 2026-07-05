"use client";

import { useState } from "react";
import Link from "next/link";
import { SignedIn } from "@clerk/nextjs";

// Compact hamburger menu shown only on small screens (the full nav links and the
// "New Sourcing Event" button are hidden below the `md`/`sm` breakpoints).
export default function MobileMenu() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {open ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 top-14 bg-black/20 z-40" onClick={close} />
          <div className="absolute left-0 right-0 top-14 bg-white border-b border-slate-200 shadow-lg z-50 p-3 flex flex-col gap-1">
            <Link href="/dashboard" onClick={close} className="px-3 py-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors">
              Dashboard
            </Link>
            <SignedIn>
              <Link href="/billing" onClick={close} className="px-3 py-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors">
                Billing
              </Link>
              <Link href="/events/new" onClick={close} className="px-3 py-2.5 rounded-lg text-sm font-semibold text-blue-600 hover:bg-blue-50 transition-colors">
                + New Sourcing Event
              </Link>
            </SignedIn>
          </div>
        </>
      )}
    </div>
  );
}
