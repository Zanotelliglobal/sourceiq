"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/LanguageProvider";

const STORAGE_KEY = "siq-cookie-consent";

// Lightweight consent banner. We only set essential cookies (auth/session) by
// default; non-essential analytics stay disabled until the user accepts.
export default function CookieConsent() {
  const t = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      /* storage unavailable — don't block the app */
    }
  }, []);

  function decide(choice: "accepted" | "declined") {
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      /* ignore */
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-6 sm:max-w-sm z-50">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5 p-4">
        <p className="text-sm text-slate-600 leading-relaxed">
          {t("We use essential cookies to run SourceIQ and optional analytics to improve it.")}{" "}
          <Link href="/legal/privacy" className="font-medium text-blue-600 hover:text-blue-700">
            {t("Privacy Policy")}
          </Link>
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => decide("accepted")}
            className="btn-primary py-2 px-4 text-sm flex-1"
          >
            {t("Accept")}
          </button>
          <button
            onClick={() => decide("declined")}
            className="py-2 px-4 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
          >
            {t("Decline")}
          </button>
        </div>
      </div>
    </div>
  );
}
