import type { Lang } from "./config";
import { it } from "./it";
import { de } from "./de";
import { fr } from "./fr";
import { es } from "./es";

// Per-language lookup tables keyed by the English source string. English is the
// implicit fallback, so it has no table. A missing key simply falls back to the
// English source text passed to t().
export const DICTIONARIES: Record<Exclude<Lang, "en">, Record<string, string>> = {
  it,
  de,
  fr,
  es,
};
