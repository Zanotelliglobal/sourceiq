// ─── SUPPLIER TAXONOMY ────────────────────────────────────────────────────────
// Controlled vocabularies for the structured supplier record (Epic 1 of the
// SourceReady competitive backlog). Centralized here so the scout/enrichment
// agent prompt, the persistence layer, and any future filter UI all speak the
// same language. The scout emits these fields during discovery; the persistence
// layer defensively normalizes the model's output to the controlled sets below,
// so a hallucinated or malformed value never reaches the database.

/** Coarse classification of what a supplier fundamentally *is*. */
export const BUSINESS_TYPES = [
  "Manufacturer",
  "Distributor",
  "Trading",
  "Wholesaler",
  "Service",
  "Other",
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** Banded headcount ranges — avoids false precision on an inherently fuzzy
 *  figure and makes the field cleanly filterable. */
export const EMPLOYEE_BANDS = [
  "1-10",
  "11-50",
  "51-100",
  "101-200",
  "201-500",
  "501-1000",
  "1001-2000",
  "2001-5000",
  "5001-10000",
  "10001-50000",
  "50000+",
] as const;
export type EmployeeBand = (typeof EMPLOYEE_BANDS)[number];

/** Controlled capability-tag vocabulary that powers match cards (and, later,
 *  structured filtering). Deliberately small and orthogonal. */
export const CAPABILITY_TAGS = [
  "OEM",
  "ODM",
  "Private Label",
  "Low MOQ",
  "High-Capacity",
  "Small-Batch",
  "Custom Packaging",
  "Custom Design",
  "Eco-Friendly",
  "Patented",
  "In-House R&D",
  "Rapid Prototyping",
  "Quality Certified",
  "Export Experienced",
  "Vertically Integrated",
] as const;
export type CapabilityTag = (typeof CAPABILITY_TAGS)[number];

// Case-insensitive lookup maps, built once at module load.
const BUSINESS_TYPE_BY_LOWER = new Map(BUSINESS_TYPES.map((t) => [t.toLowerCase(), t]));
const CAPABILITY_TAG_BY_LOWER = new Map(CAPABILITY_TAGS.map((t) => [t.toLowerCase(), t]));
const EMPLOYEE_BAND_SET = new Set<string>(EMPLOYEE_BANDS);

/** Coerce free-form model output to a known business type, or null. */
export function normalizeBusinessType(raw: unknown): BusinessType | null {
  if (typeof raw !== "string") return null;
  return BUSINESS_TYPE_BY_LOWER.get(raw.trim().toLowerCase()) ?? null;
}

/** Extract a plausible 4-digit founding year (1600 .. next year), or null. */
export function parseFoundedYear(raw: unknown): number | null {
  const s =
    typeof raw === "number" && Number.isFinite(raw)
      ? String(Math.trunc(raw))
      : typeof raw === "string"
        ? raw
        : null;
  if (s === null) return null;
  const m = s.match(/\b(1[6-9]\d{2}|20\d{2})\b/); // 1600-2099
  if (!m) return null;
  const year = Number(m[1]);
  const maxYear = new Date().getFullYear() + 1;
  if (year < 1600 || year > maxYear) return null;
  return year;
}

/** Clamp a review score into the 0-5 range (one decimal place), or null. */
export function clampReviewScore(raw: unknown): number | null {
  if (typeof raw === "string" && raw.trim() === "") return null;
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(Math.max(0, Math.min(5, n)) * 10) / 10;
}

/** Map an absolute headcount to its band. */
export function bandForCount(n: number): EmployeeBand | null {
  if (!Number.isFinite(n) || n < 1) return null;
  if (n <= 10) return "1-10";
  if (n <= 50) return "11-50";
  if (n <= 100) return "51-100";
  if (n <= 200) return "101-200";
  if (n <= 500) return "201-500";
  if (n <= 1000) return "501-1000";
  if (n <= 2000) return "1001-2000";
  if (n <= 5000) return "2001-5000";
  if (n <= 10000) return "5001-10000";
  if (n <= 50000) return "10001-50000";
  return "50000+";
}

/** Normalize a headcount hint to one of the controlled bands, or null. Accepts
 *  an exact band ("51-100"), a raw number/number-string (250 → "201-500"), or a
 *  loose range/annotation whose first integer we bucket ("~300-600" → "201-500"). */
export function normalizeEmployeeBand(raw: unknown): EmployeeBand | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (EMPLOYEE_BAND_SET.has(s)) return s as EmployeeBand;
  const digits = s.replace(/,/g, "").match(/\d+/);
  if (!digits) return null;
  return bandForCount(Number(digits[0]));
}

/** Keep only recognized capability tags (case-insensitive), de-duplicated,
 *  preserving canonical casing and first-seen order. Unknown tags are dropped so
 *  the stored list is always a subset of the controlled vocabulary. */
export function filterCapabilityTags(raw: unknown): CapabilityTag[] {
  if (!Array.isArray(raw)) return [];
  const out: CapabilityTag[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const canonical = CAPABILITY_TAG_BY_LOWER.get(item.trim().toLowerCase());
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  }
  return out;
}
