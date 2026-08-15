"use client";

import Link from "next/link";
import { useT } from "@/components/LanguageProvider";

export default function SiteFooter() {
  const t = useT();
  return (
    <footer className="border-t border-slate-200/80 mt-auto">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-xs text-slate-500">© {new Date().getFullYear()} SourceGPT. {t("AI-powered supplier intelligence.")}</p>
        <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
          <Link href="/legal/privacy" className="hover:text-slate-900 transition-colors">{t("Privacy Policy")}</Link>
          <Link href="/legal/terms" className="hover:text-slate-900 transition-colors">{t("Terms of Service")}</Link>
        </div>
      </div>
    </footer>
  );
}
