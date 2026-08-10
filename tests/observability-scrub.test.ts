import { describe, it, expect } from "vitest";
import { scrubPii } from "@/lib/observability";

describe("scrubPii (#84)", () => {
  it("redacts an email address in a plain string", () => {
    expect(scrubPii("contact buyer@example.com for details")).toBe(
      "contact [redacted-email] for details"
    );
  });

  it("redacts a phone number in a plain string", () => {
    expect(scrubPii("call +1 (555) 123-4567 now")).toBe("call [redacted-phone] now");
  });

  it("redacts PII nested inside object values", () => {
    const input = {
      source: "send-outreach",
      supplier: { email: "info@acme.example", phone: "555-000-1234" },
    };
    const out = scrubPii(input) as typeof input;
    expect(out.supplier.email).toBe("[redacted-email]");
    expect(out.supplier.phone).toBe("[redacted-phone]");
    expect(out.source).toBe("send-outreach"); // untouched, no PII shape
  });

  it("redacts PII inside array values", () => {
    const out = scrubPii(["reach jane@example.com", "no pii here"]);
    expect(out).toEqual(["reach [redacted-email]", "no pii here"]);
  });

  it("leaves non-string primitives and short numbers untouched", () => {
    const input = { orgId: 42, active: true, ratio: 0.5, nothing: null };
    expect(scrubPii(input)).toEqual(input);
  });

  it("does not mangle ordinary short numeric-looking text (e.g. a score or year)", () => {
    expect(scrubPii("score 87, founded 1998")).toBe("score 87, founded 1998");
  });
});
