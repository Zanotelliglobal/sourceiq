import { describe, it, expect } from "vitest";
import {
  BUSINESS_TYPES,
  EMPLOYEE_BANDS,
  CAPABILITY_TAGS,
  normalizeBusinessType,
  parseFoundedYear,
  clampReviewScore,
  normalizeEmployeeBand,
  bandForCount,
  filterCapabilityTags,
} from "@/lib/taxonomy";

describe("normalizeBusinessType", () => {
  it("accepts known types case-insensitively, trimming whitespace", () => {
    expect(normalizeBusinessType("Manufacturer")).toBe("Manufacturer");
    expect(normalizeBusinessType("manufacturer")).toBe("Manufacturer");
    expect(normalizeBusinessType("  DISTRIBUTOR  ")).toBe("Distributor");
  });
  it("rejects unknown or non-string values", () => {
    expect(normalizeBusinessType("Factory")).toBeNull();
    expect(normalizeBusinessType("")).toBeNull();
    expect(normalizeBusinessType(null)).toBeNull();
    expect(normalizeBusinessType(42)).toBeNull();
  });
  it("only ever returns members of the controlled set", () => {
    for (const t of BUSINESS_TYPES) expect(BUSINESS_TYPES).toContain(normalizeBusinessType(t));
  });
});

describe("parseFoundedYear", () => {
  it("extracts a 4-digit year from text or numbers", () => {
    expect(parseFoundedYear("1992")).toBe(1992);
    expect(parseFoundedYear("Founded in 1987.")).toBe(1987);
    expect(parseFoundedYear(2001)).toBe(2001);
  });
  it("rejects out-of-range or missing years", () => {
    expect(parseFoundedYear("1200")).toBeNull();
    expect(parseFoundedYear("est. 3200")).toBeNull();
    expect(parseFoundedYear("no year here")).toBeNull();
    expect(parseFoundedYear("")).toBeNull();
    expect(parseFoundedYear(null)).toBeNull();
  });
  it("does not accept a year beyond next year", () => {
    const future = new Date().getFullYear() + 5;
    expect(parseFoundedYear(String(future))).toBeNull();
  });
});

describe("clampReviewScore", () => {
  it("passes valid scores through, rounded to one decimal", () => {
    expect(clampReviewScore(4.5)).toBe(4.5);
    expect(clampReviewScore("3.27")).toBe(3.3);
    expect(clampReviewScore(0)).toBe(0);
    expect(clampReviewScore(5)).toBe(5);
  });
  it("clamps out-of-range scores into 0-5", () => {
    expect(clampReviewScore(7)).toBe(5);
    expect(clampReviewScore(-2)).toBe(0);
  });
  it("rejects non-numbers and empty strings", () => {
    expect(clampReviewScore("n/a")).toBeNull();
    expect(clampReviewScore("")).toBeNull();
    expect(clampReviewScore(null)).toBeNull();
    expect(clampReviewScore(NaN)).toBeNull();
  });
});

describe("normalizeEmployeeBand / bandForCount", () => {
  it("returns an exact band unchanged", () => {
    expect(normalizeEmployeeBand("51-100")).toBe("51-100");
    expect(normalizeEmployeeBand("50000+")).toBe("50000+");
  });
  it("buckets a raw count into its band", () => {
    expect(normalizeEmployeeBand(250)).toBe("201-500");
    expect(normalizeEmployeeBand("~250 employees")).toBe("201-500");
    expect(normalizeEmployeeBand("1,500")).toBe("1001-2000");
    expect(bandForCount(1)).toBe("1-10");
    expect(bandForCount(75000)).toBe("50000+");
  });
  it("buckets the lower bound of a loose range", () => {
    expect(normalizeEmployeeBand("300-600")).toBe("201-500");
  });
  it("rejects empty or non-numeric input", () => {
    expect(normalizeEmployeeBand("")).toBeNull();
    expect(normalizeEmployeeBand("lots")).toBeNull();
    expect(normalizeEmployeeBand(null)).toBeNull();
    expect(bandForCount(0)).toBeNull();
  });
  it("every band string round-trips through itself", () => {
    for (const b of EMPLOYEE_BANDS) expect(normalizeEmployeeBand(b)).toBe(b);
  });
});

describe("filterCapabilityTags", () => {
  it("keeps recognized tags with canonical casing", () => {
    expect(filterCapabilityTags(["oem", "Low MOQ"])).toEqual(["OEM", "Low MOQ"]);
  });
  it("drops unknown tags and non-strings", () => {
    expect(filterCapabilityTags(["OEM", "Teleportation", 5, null])).toEqual(["OEM"]);
  });
  it("de-duplicates case-insensitively, preserving first order", () => {
    expect(filterCapabilityTags(["ODM", "odm", "OEM"])).toEqual(["ODM", "OEM"]);
  });
  it("returns [] for non-arrays", () => {
    expect(filterCapabilityTags("OEM")).toEqual([]);
    expect(filterCapabilityTags(null)).toEqual([]);
  });
  it("only returns members of the controlled vocab", () => {
    for (const tag of filterCapabilityTags([...CAPABILITY_TAGS])) {
      expect(CAPABILITY_TAGS).toContain(tag);
    }
  });
});
