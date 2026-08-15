// ─── I18N CONFIG ──────────────────────────────────────────────────────────────
// Supported UI languages. English is the source language: strings in the code are
// written in English and used directly as translation keys (gettext-style), so
// English never needs a dictionary and there are no "missing key" gaps.

export type Lang = "en" | "it" | "de" | "fr" | "es";

export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: "en", label: "English",  flag: "🇬🇧" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "de", label: "Deutsch",  flag: "🇩🇪" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "es", label: "Español",  flag: "🇪🇸" },
];

export const DEFAULT_LANG: Lang = "en";
export const STORAGE_KEY = "sourcegpt.lang";

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && LANGS.some(l => l.code === v);
}
