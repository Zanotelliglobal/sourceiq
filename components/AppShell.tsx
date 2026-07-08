"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, PlusCircle, CreditCard, LifeBuoy } from "lucide-react";
import type { ComponentType } from "react";

// Persistent left sidebar for the dashboard/app surface (MASTER.md: Layout).
// Shown ≥1024px on app routes only; marketing + auth pages render children bare
// and the top nav / MobileMenu handle navigation on smaller screens.
const NAV: { href: string; label: string; Icon: ComponentType<{ className?: string }>; match: (p: string) => boolean }[] = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard, match: p => p === "/dashboard" },
  { href: "/events/new", label: "New Event", Icon: PlusCircle, match: p => p === "/events/new" },
  { href: "/billing", label: "Billing", Icon: CreditCard, match: p => p.startsWith("/billing") },
];

// The /events/[id] workspace runs its own full-height control panel, so it opts
// out of the global sidebar. Only the "flat" app pages get the shell.
function useIsAppRoute(pathname: string): boolean {
  if (pathname === "/dashboard") return true;
  if (pathname === "/events/new") return true;
  if (pathname === "/billing" || pathname.startsWith("/billing/")) return true;
  return false;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const isApp = useIsAppRoute(pathname);

  if (!isApp) return <>{children}</>;

  return (
    <div className="lg:pl-56">
      {/* Fixed sidebar — desktop only. Sits below the 56px (h-14) top nav. */}
      <aside className="hidden lg:flex fixed top-14 bottom-0 left-0 w-56 flex-col border-r border-slate-200 bg-white">
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ href, label, Icon, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <Icon className="w-[18px] h-[18px]" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-slate-100">
          <a
            href="mailto:support@sourceiq.app"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            <LifeBuoy className="w-[18px] h-[18px]" />
            Support
          </a>
        </div>
      </aside>

      {children}
    </div>
  );
}
