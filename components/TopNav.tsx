"use client";

import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import MobileMenu from "@/components/MobileMenu";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import NotificationBell from "@/components/NotificationBell";
import { useT } from "@/components/LanguageProvider";

export default function TopNav() {
  const t = useT();
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shadow-sm shadow-blue-600/30">
              <svg className="w-4 h-4 text-white" viewBox="0 0 16 16" fill="none">
                <path d="M2 12V7l4-4 4 4 4-1v6H2z" fill="currentColor" fillOpacity=".3"/>
                <path d="M2 12V8l4-3 4 3 4-1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="6" cy="5" r="1.5" fill="currentColor"/>
              </svg>
            </div>
            <span className="font-bold text-slate-900 tracking-tight">SourceGPT</span>
            <span className="hidden sm:block text-[10px] font-semibold uppercase tracking-widest text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded">
              BETA
            </span>
          </Link>
          {/* Section links live in the left sidebar on desktop (≥lg); this
              top-nav group only fills the md gap where the sidebar is hidden,
              so we don't duplicate the same links on large screens. */}
          <nav className="hidden md:flex lg:hidden items-center gap-1">
            <Link href="/dashboard" className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all">
              {t("Dashboard")}
            </Link>
            <SignedIn>
              <Link href="/billing" className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all">
                {t("Billing")}
              </Link>
            </SignedIn>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
            {t("Agents ready")}
          </div>
          <LanguageSwitcher />
          <SignedIn>
            <NotificationBell />
            <Link href="/events/new" className="btn-primary py-2 hidden sm:inline-flex">
              <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none">
                <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              {t("New Sourcing Event")}
            </Link>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
          <SignedOut>
            <Link href="/sign-in" className="btn-primary py-2">{t("Sign in")}</Link>
          </SignedOut>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
