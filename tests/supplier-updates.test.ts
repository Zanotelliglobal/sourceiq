import { describe, it, expect } from "vitest";
import { applySupplierUpdated } from "@/lib/supplier-updates";

type Stub = {
  id: number; name: string;
  contact_email: string | null; contact_url: string | null;
  contact_phone: string | null; contact_linkedin: string | null;
  enrichment: string | null;
};

function supplier(overrides: Partial<Stub> = {}): Stub {
  return {
    id: 1, name: "Acme",
    contact_email: null, contact_url: null, contact_phone: null, contact_linkedin: null,
    enrichment: null,
    ...overrides,
  };
}

describe("applySupplierUpdated", () => {
  it("merges contact fields into the matching supplier by id", () => {
    const suppliers = [supplier({ id: 1 }), supplier({ id: 2, name: "Acme 2" })];
    const result = applySupplierUpdated(suppliers, {
      type: "supplier_updated", id: 2,
      contact_email: "info@acme.com", contact_url: "https://acme.com/contact",
      contact_phone: "+1 555 0100", contact_linkedin: "https://linkedin.com/company/acme",
    });

    expect(result.find(s => s.id === 2)).toMatchObject({
      contact_email: "info@acme.com", contact_url: "https://acme.com/contact",
      contact_phone: "+1 555 0100", contact_linkedin: "https://linkedin.com/company/acme",
    });
    // The non-matching supplier is untouched.
    expect(result.find(s => s.id === 1)).toEqual(suppliers[0]);
  });

  it("only patches fields present in the event, leaving the rest untouched", () => {
    const suppliers = [supplier({ id: 1, contact_phone: "+1 555 0000" })];
    const result = applySupplierUpdated(suppliers, { type: "supplier_updated", id: 1, contact_email: "sales@acme.com" });

    expect(result[0].contact_email).toBe("sales@acme.com");
    expect(result[0].contact_phone).toBe("+1 555 0000");
  });

  it("merges the enrichment field into the matching supplier by id", () => {
    const suppliers = [supplier({ id: 1 })];
    const enrichment = JSON.stringify({ market_position: "Established mid-tier player.", recommended_action: "pursue" });
    const result = applySupplierUpdated(suppliers, { type: "supplier_updated", id: 1, enrichment });

    expect(result[0].enrichment).toBe(enrichment);
  });

  it("returns the same array reference when there is nothing to patch", () => {
    const suppliers = [supplier({ id: 1 })];
    const result = applySupplierUpdated(suppliers, {
      type: "supplier_updated", id: 1,
      contact_email: "", contact_url: "", contact_phone: "", contact_linkedin: "", enrichment: "",
    });

    expect(result).toBe(suppliers);
  });

  it("leaves every supplier unchanged when the id does not match any", () => {
    const suppliers = [supplier({ id: 1 })];
    const result = applySupplierUpdated(suppliers, { type: "supplier_updated", id: 999, contact_email: "x@y.com" });

    expect(result).toEqual(suppliers);
  });
});
