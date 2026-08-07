import { describe, it, expect } from "vitest";
import { filterSuppliers, isFiltersEmpty, supplierMatchesFilters, sanitizeFilterQuery, type SupplierFilters } from "@/lib/supplier-filters";

type Stub = {
  id: number; name: string;
  business_type: string | null; employee_count: string | null;
  founded_year: number | null; review_score: number | null;
  certifications: string | null; capability_tags: string | null;
};

function supplier(overrides: Partial<Stub> = {}): Stub {
  return {
    id: 1, name: "Acme",
    business_type: "Manufacturer", employee_count: "201-500",
    founded_year: 1995, review_score: 4.2,
    certifications: JSON.stringify(["ISO 9001:2015"]),
    capability_tags: JSON.stringify(["OEM", "Low MOQ"]),
    ...overrides,
  };
}

describe("isFiltersEmpty", () => {
  it("is true for an empty object", () => {
    expect(isFiltersEmpty({})).toBe(true);
  });

  it("is false once any field is populated", () => {
    expect(isFiltersEmpty({ business_type: ["Manufacturer"] })).toBe(false);
    expect(isFiltersEmpty({ founded_year_min: 2000 })).toBe(false);
    expect(isFiltersEmpty({ review_score_min: 3 })).toBe(false);
  });

  it("treats empty arrays as empty", () => {
    expect(isFiltersEmpty({ business_type: [], capability_tags: [] })).toBe(true);
  });
});

describe("supplierMatchesFilters", () => {
  it("matches when no filters are set", () => {
    expect(supplierMatchesFilters(supplier(), {})).toBe(true);
  });

  it("filters by business_type (AND across fields)", () => {
    const s = supplier({ business_type: "Distributor" });
    expect(supplierMatchesFilters(s, { business_type: ["Manufacturer"] })).toBe(false);
    expect(supplierMatchesFilters(s, { business_type: ["Distributor", "Manufacturer"] })).toBe(true);
  });

  it("treats a null business_type as non-matching once the filter is set", () => {
    const s = supplier({ business_type: null });
    expect(supplierMatchesFilters(s, { business_type: ["Manufacturer"] })).toBe(false);
  });

  it("filters by employee_count band membership", () => {
    const s = supplier({ employee_count: "51-100" });
    expect(supplierMatchesFilters(s, { employee_count: ["201-500"] })).toBe(false);
    expect(supplierMatchesFilters(s, { employee_count: ["51-100", "101-200"] })).toBe(true);
  });

  it("filters by founded_year range (inclusive, both bounds independently)", () => {
    const s = supplier({ founded_year: 1995 });
    expect(supplierMatchesFilters(s, { founded_year_min: 2000 })).toBe(false);
    expect(supplierMatchesFilters(s, { founded_year_max: 1990 })).toBe(false);
    expect(supplierMatchesFilters(s, { founded_year_min: 1990, founded_year_max: 2000 })).toBe(true);
  });

  it("excludes a supplier with an unknown founded_year once a year filter is set", () => {
    const s = supplier({ founded_year: null });
    expect(supplierMatchesFilters(s, { founded_year_min: 1990 })).toBe(false);
  });

  it("filters by review_score_min", () => {
    const s = supplier({ review_score: 3.5 });
    expect(supplierMatchesFilters(s, { review_score_min: 4 })).toBe(false);
    expect(supplierMatchesFilters(s, { review_score_min: 3 })).toBe(true);
  });

  it("matches certifications on ANY overlap, not all-selected", () => {
    const s = supplier({ certifications: JSON.stringify(["ISO 9001:2015", "BSCI"]) });
    expect(supplierMatchesFilters(s, { certifications: ["BSCI"] })).toBe(true);
    expect(supplierMatchesFilters(s, { certifications: ["FSC"] })).toBe(false);
  });

  it("matches capability_tags on ANY overlap", () => {
    const s = supplier({ capability_tags: JSON.stringify(["OEM"]) });
    expect(supplierMatchesFilters(s, { capability_tags: ["OEM", "ODM"] })).toBe(true);
    expect(supplierMatchesFilters(s, { capability_tags: ["ODM"] })).toBe(false);
  });

  it("treats malformed JSON in certifications/capability_tags as an empty list rather than throwing", () => {
    const s = supplier({ certifications: "not json", capability_tags: null });
    expect(() => supplierMatchesFilters(s, { certifications: ["ISO 9001:2015"] })).not.toThrow();
    expect(supplierMatchesFilters(s, { certifications: ["ISO 9001:2015"] })).toBe(false);
  });

  it("ANDs every populated field together", () => {
    const s = supplier({ business_type: "Manufacturer", review_score: 4.8 });
    expect(supplierMatchesFilters(s, { business_type: ["Manufacturer"], review_score_min: 4 })).toBe(true);
    expect(supplierMatchesFilters(s, { business_type: ["Manufacturer"], review_score_min: 4.9 })).toBe(false);
  });
});

describe("filterSuppliers", () => {
  it("returns the same array reference when filters are empty", () => {
    const suppliers = [supplier({ id: 1 }), supplier({ id: 2 })];
    expect(filterSuppliers(suppliers, {})).toBe(suppliers);
  });

  it("narrows the list to matching suppliers only", () => {
    const suppliers = [
      supplier({ id: 1, business_type: "Manufacturer" }),
      supplier({ id: 2, business_type: "Distributor" }),
      supplier({ id: 3, business_type: "Manufacturer" }),
    ];
    const result = filterSuppliers(suppliers, { business_type: ["Manufacturer"] });
    expect(result.map(s => s.id)).toEqual([1, 3]);
  });
});

describe("sanitizeFilterQuery", () => {
  it("keeps only recognized enum values for business_type/employee_count/capability_tags", () => {
    const out = sanitizeFilterQuery({
      business_type: ["Manufacturer", "Not A Real Type"],
      employee_count: ["201-500", "bogus-band"],
      capability_tags: ["OEM", "Made Up Tag"],
    });
    expect(out).toEqual({
      business_type: ["Manufacturer"],
      employee_count: ["201-500"],
      capability_tags: ["OEM"],
    });
  });

  it("passes through free-text certifications as long as they're non-empty strings", () => {
    const out = sanitizeFilterQuery({ certifications: ["ISO 9001:2015", "", "  ", 42] });
    expect(out).toEqual({ certifications: ["ISO 9001:2015"] });
  });

  it("clamps review_score_min into 0..5 and rounds numeric year fields", () => {
    const out = sanitizeFilterQuery({ review_score_min: 7.2, founded_year_min: 1999.6, founded_year_max: 2010.2 });
    expect(out).toEqual({ review_score_min: 5, founded_year_min: 2000, founded_year_max: 2010 });
  });

  it("omits fields entirely absent from the input, and drops arrays that end up empty after sanitizing", () => {
    const out = sanitizeFilterQuery({ business_type: ["Not Real"], review_score_min: 4 });
    expect(out).toEqual({ review_score_min: 4 });
  });

  it("returns an empty object for non-object input", () => {
    expect(sanitizeFilterQuery(null)).toEqual({});
    expect(sanitizeFilterQuery("garbage")).toEqual({});
    expect(sanitizeFilterQuery(undefined)).toEqual({});
  });
});
