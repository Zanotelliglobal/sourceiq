// ─── STRUCTURED SUPPLIER FILTERS ──────────────────────────────────────────────
// Pure filter logic for Epic 3 (SourceReady teardown, issue #38): a filter
// panel over the structured fields Epic 1 (#20) already populates, plus an
// "AI filter" free-text box that maps to the same filter shape. Kept pure and
// framework-free so it's unit-testable without React or a live DB — mirrors
// lib/supplier-updates.ts.

import { BUSINESS_TYPES, EMPLOYEE_BANDS, CAPABILITY_TAGS } from "@/lib/taxonomy";

export type SupplierFilters = {
  business_type?: string[];
  employee_count?: string[];
  founded_year_min?: number;
  founded_year_max?: number;
  review_score_min?: number;
  certifications?: string[];
  capability_tags?: string[];
};

export function isFiltersEmpty(f: SupplierFilters): boolean {
  return (
    (f.business_type?.length ?? 0) === 0 &&
    (f.employee_count?.length ?? 0) === 0 &&
    f.founded_year_min == null &&
    f.founded_year_max == null &&
    f.review_score_min == null &&
    (f.certifications?.length ?? 0) === 0 &&
    (f.capability_tags?.length ?? 0) === 0
  );
}

function parseJsonStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function matchesAny(selected: string[] | undefined, actual: string[]): boolean {
  if (!selected || selected.length === 0) return true;
  return selected.some(s => actual.includes(s));
}

type FilterableSupplier = {
  business_type: string | null;
  employee_count: string | null;
  founded_year: number | null;
  review_score: number | null;
  certifications: string | null;
  capability_tags: string | null;
};

/** Does a single supplier satisfy every populated filter field? Multi-select
 *  fields match on ANY of the selected values (match-all toggle is #3.4, out
 *  of scope here); every other field is an AND across the whole filter set. */
export function supplierMatchesFilters(s: FilterableSupplier, f: SupplierFilters): boolean {
  if (f.business_type && f.business_type.length > 0) {
    if (!s.business_type || !f.business_type.includes(s.business_type)) return false;
  }
  if (f.employee_count && f.employee_count.length > 0) {
    if (!s.employee_count || !f.employee_count.includes(s.employee_count)) return false;
  }
  if (f.founded_year_min != null && (s.founded_year == null || s.founded_year < f.founded_year_min)) return false;
  if (f.founded_year_max != null && (s.founded_year == null || s.founded_year > f.founded_year_max)) return false;
  if (f.review_score_min != null && (s.review_score == null || s.review_score < f.review_score_min)) return false;
  if (!matchesAny(f.certifications, parseJsonStringArray(s.certifications))) return false;
  if (!matchesAny(f.capability_tags, parseJsonStringArray(s.capability_tags))) return false;
  return true;
}

/** Filter a supplier list against the panel's structured filter state.
 *  Returns the same array reference when there's nothing to filter, so callers
 *  can skip a pointless re-render/re-sort. */
export function filterSuppliers<T extends FilterableSupplier>(suppliers: T[], f: SupplierFilters): T[] {
  if (isFiltersEmpty(f)) return suppliers;
  return suppliers.filter(s => supplierMatchesFilters(s, f));
}

/** Validate the AI filter-mapper agent's raw JSON output against the same
 *  controlled vocabularies the filter panel offers, so a hallucinated or
 *  off-taxonomy value never silently zeroes out the result set. Unknown enum
 *  values are dropped; certifications are free text (no fixed vocabulary) but
 *  must be non-empty strings; numeric fields are clamped to sane ranges. */
export function sanitizeFilterQuery(raw: unknown): SupplierFilters {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: SupplierFilters = {};

  const businessType = Array.isArray(r.business_type)
    ? r.business_type.filter((v): v is string => typeof v === "string" && (BUSINESS_TYPES as readonly string[]).includes(v))
    : [];
  if (businessType.length > 0) out.business_type = businessType;

  const employeeCount = Array.isArray(r.employee_count)
    ? r.employee_count.filter((v): v is string => typeof v === "string" && (EMPLOYEE_BANDS as readonly string[]).includes(v))
    : [];
  if (employeeCount.length > 0) out.employee_count = employeeCount;

  const capabilityTags = Array.isArray(r.capability_tags)
    ? r.capability_tags.filter((v): v is string => typeof v === "string" && (CAPABILITY_TAGS as readonly string[]).includes(v))
    : [];
  if (capabilityTags.length > 0) out.capability_tags = capabilityTags;

  const certifications = Array.isArray(r.certifications)
    ? r.certifications.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  if (certifications.length > 0) out.certifications = certifications;

  if (typeof r.founded_year_min === "number" && Number.isFinite(r.founded_year_min)) {
    out.founded_year_min = Math.round(r.founded_year_min);
  }
  if (typeof r.founded_year_max === "number" && Number.isFinite(r.founded_year_max)) {
    out.founded_year_max = Math.round(r.founded_year_max);
  }
  if (typeof r.review_score_min === "number" && Number.isFinite(r.review_score_min)) {
    out.review_score_min = Math.max(0, Math.min(5, r.review_score_min));
  }

  return out;
}
