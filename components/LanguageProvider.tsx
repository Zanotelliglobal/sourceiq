"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { DEFAULT_LANG, STORAGE_KEY, isLang, type Lang } from "@/lib/i18n/config";

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Translate an English source string into the active language. */
  t: (en: string, vars?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<Ctx | null>(null);

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  // Hydrate from localStorage (and honour the browser language on first visit).
  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (isLang(stored)) {
      setLangState(stored);
      document.documentElement.lang = stored;
      return;
    }
    const nav = typeof navigator !== "undefined" ? navigator.language.slice(0, 2) : "";
    if (isLang(nav)) {
      setLangState(nav);
      document.documentElement.lang = nav;
    }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, l);
    if (typeof document !== "undefined") document.documentElement.lang = l;
  }, []);

  const t = useCallback(
    (en: string, vars?: Record<string, string | number>) => {
      if (lang === "en") return interpolate(en, vars);
      const table = DICTIONARIES[lang];
      return interpolate(table?.[en] ?? en, vars);
    },
    [lang],
  );

  return <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useI18n must be used within a LanguageProvider");
  return ctx;
}

/** Convenience hook returning just the translate function. */
export function useT() {
  return useI18n().t;
}
