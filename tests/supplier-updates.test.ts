import { describe, it, expect } from "vitest";
import { applySupplierUpdated } from "@/lib/supplier-updates";

type Stub = {
  id: number; name: string;
  contact_email: string | null; contact_url: string | null;
  contact_phone: string | null; contact_linkedin: string | null;
  enrichment: string | null; verification_badges: string | null;
};

function supplier(overrides: Partial<Stub> = {}): Stub {
  return {
    id: 1, name: "Acme",
    contact_email: null, contact_url: null, contact_phone: null, contact_linkedin: null,
    enrichment: null, verification_badges: null,
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
      contact_email: "", contact_url: "", contact_phone: "", contact_linkedin: "", enrichment: "", verification_badges: "",
    });

    expect(result).toBe(suppliers);
  });

  it("merges the verification_badges field into the matching supplier by id", () => {
    const suppliers = [supplier({ id: 1 })];
    const verification_badges = JSON.stringify(["website-live"]);
    const result = applySupplierUpdated(suppliers, { type: "supplier_updated", id: 1, verification_badges });

    expect(result[0].verification_badges).toBe(verification_badges);
  });

  it("leaves every supplier unchanged when the id does not match any", () => {
    const suppliers = [supplier({ id: 1 })];
    const result = applySupplierUpdated(suppliers, { type: "supplier_updated", id: 999, contact_email: "x@y.com" });

    expect(result).toEqual(suppliers);
  });

  // Quick Investigation "Deepen into full investigation" (makeProcessSupplierDeepen)
  // re-processes a quick-scan row through the real pipeline and sends
  // `supplier_updated` with a full `supplier` object rather than granular
  // field patches, since nearly every column changes at once.
  it("replaces the matching row wholesale when the event carries a full supplier object", () => {
    const suppliers = [supplier({ id: 1, name: "Acme (unverified)" }), supplier({ id: 2, name: "Other Co" })];
    const full = { id: 1, name: "Acme Manufacturing", contact_email: "sales@acme.com", contact_url: null, contact_phone: null, contact_linkedin: null, enrichment: JSON.stringify({ market_position: "Established." }), verification_badges: null };
    const result = applySupplierUpdated(suppliers, { type: "supplier_updated", id: 1, supplier: full });

    expect(result.find(s => s.id === 1)).toEqual(full);
    // The non-matching supplier is untouched.
    expect(result.find(s => s.id === 2)).toEqual(suppliers[1]);
  });

  it("does not treat a full supplier object replace as a no-op even if id has no granular patch fields set", () => {
    const suppliers = [supplier({ id: 1 })];
    const full = { id: 1, name: "Acme Manufacturing", contact_email: null, contact_url: null, contact_phone: null, contact_linkedin: null, enrichment: null, verification_badges: null };
    const result = applySupplierUpdated(suppliers, { type: "supplier_updated", id: 1, supplier: full });

    // A wholesale replace always returns a fresh array (new reference),
    // even though every individual field is falsy — this must not fall
    // into the "nothing to patch, return same reference" early-out that
    // the granular-patch path uses.
    expect(result).not.toBe(suppliers);
    expect(result[0]).toEqual(full);
  });
});
