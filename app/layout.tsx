import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { ClerkProvider, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import MobileMenu from "@/components/MobileMenu";
import AppShell from "@/components/AppShell";

// UI/marketing face — professional but approachable (top-ranked B2B/enterprise pairing).
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
});
// Data face — tabular figures for scores, spend, token costs (prevents column jitter).
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "SourceIQ — AI Supplier Intelligence",
  description: "Multi-agent supplier discovery and procurement intelligence platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
    <html lang="en" className={`${jakarta.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans">
        <div className="min-h-screen flex flex-col">
          {/* Top nav */}
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
                  <span className="font-bold text-slate-900 tracking-tight">SourceIQ</span>
                  <span className="hidden sm:block text-[10px] font-semibold uppercase tracking-widest text-slate-400 border border-slate-200 px-1.5 py-0.5 rounded">
                    BETA
                  </span>
                </Link>
                <nav className="hidden md:flex items-center gap-1">
                  <Link href="/dashboard" className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all">
                    Dashboard
                  </Link>
                  <SignedIn>
                    <Link href="/billing" className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all">
                      Billing
                    </Link>
                  </SignedIn>
                </nav>
              </div>
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
                  Agents ready
                </div>
                <SignedIn>
                  <Link href="/events/new" className="btn-primary py-2 hidden sm:inline-flex">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none">
                      <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    New Sourcing Event
                  </Link>
                  <UserButton afterSignOutUrl="/" />
                </SignedIn>
                <SignedOut>
                  <Link href="/sign-in" className="btn-primary py-2">Sign in</Link>
                </SignedOut>
                <MobileMenu />
              </div>
            </div>
          </header>

          <main className="flex-1"><AppShell>{children}</AppShell></main>

          {/* App-wide footer — keeps legal pages reachable from any screen. */}
          <footer className="border-t border-slate-200/80 mt-auto">
            <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-xs text-slate-400">© {new Date().getFullYear()} SourceIQ. AI-powered supplier intelligence.</p>
              <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
                <Link href="/legal/privacy" className="hover:text-slate-900 transition-colors">Privacy Policy</Link>
                <Link href="/legal/terms" className="hover:text-slate-900 transition-colors">Terms of Service</Link>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
    </ClerkProvider>
  );
}
