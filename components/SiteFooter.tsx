"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useT } from "@/components/LanguageProvider";
import { FacebookIcon, InstagramIcon, LinkedinIcon } from "@/components/icons/SocialIcons";
import { COMPANY } from "@/lib/legal";

// Global site footer, rendered once by app/layout.tsx for every route.
// Extended in place (MKT-02) — was previously 19 lines with only the
// logo-less copyright + Privacy/Terms links. Social hrefs below are
// placeholder destinations (no live social accounts exist yet); the
// requirement is that the icons render and are labeled, not that the
// destinations resolve in the wild (02-03-PLAN.md Task 2 discretion).
export default function SiteFooter() {
  const t = useT();
  return (
    <footer className="border-t border-slate-200/80 mt-auto">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <div className="w-6 h-6 rounded-lg bg-blue-600 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>
              SourceGPT
            </div>
            <a
              href={`mailto:${COMPANY.contactEmail}`}
              className="text-xs text-slate-500 hover:text-slate-900 transition-colors"
            >
              {COMPANY.contactEmail}
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3">
              <a
                href="https://facebook.com/sourcegpt"
                aria-label="Follow SourceGPT on Facebook"
                className="text-slate-400 hover:text-slate-700 transition-colors"
              >
                <FacebookIcon className="w-4 h-4" />
              </a>
              <a
                href="https://instagram.com/sourcegpt"
                aria-label="Follow SourceGPT on Instagram"
                className="text-slate-400 hover:text-slate-700 transition-colors"
              >
                <InstagramIcon className="w-4 h-4" />
              </a>
              <a
                href="https://linkedin.com/company/sourcegpt"
                aria-label="Follow SourceGPT on LinkedIn"
                className="text-slate-400 hover:text-slate-700 transition-colors"
              >
                <LinkedinIcon className="w-4 h-4" />
              </a>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
              <Link href="/legal/privacy" className="hover:text-slate-900 transition-colors">{t("Privacy Policy")}</Link>
              <Link href="/legal/terms" className="hover:text-slate-900 transition-colors">{t("Terms of Service")}</Link>
              <Link href="/legal/ccpa" className="hover:text-slate-900 transition-colors">{t("CCPA Policy")}</Link>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">{t("AI-powered supplier intelligence.")}</p>
          <p className="text-xs text-slate-500">© {new Date().getFullYear()} SourceGPT.</p>
        </div>
      </div>
    </footer>
  );
}
