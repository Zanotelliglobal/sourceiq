import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { scrubPii, captureException } from "@/lib/observability";

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

// ─── Sentry-egress allowlist + tenant tagging (review follow-up on #84) ────
// A reviewer pointed out that regex scrubbing alone is a denylist: it only
// catches email/phone shapes and says nothing about arbitrary free text
// (names, addresses, prices, raw model output) landing in `context` or an
// error message via some future call site. These tests assert the fix is
// structural — verifying what actually leaves the process via
// forwardToSentry, not just that scrubPii redacts known shapes.
describe("captureException Sentry egress (#84 follow-up: allowlist + tenant tag)", () => {
  const originalDsn = process.env.SENTRY_DSN;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.SENTRY_DSN = "https://testkey@o0.ingest.sentry.io/123";
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = originalDsn;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function capturedBody(): Promise<Record<string, unknown>> {
    // forwardToSentry is fire-and-forget (`void`); flush microtasks so the
    // fetch call has actually happened before we inspect it.
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    return JSON.parse(init.body as string);
  }

  it("drops context keys that are not on the allowlist", async () => {
    captureException(new Error("boom"), {
      source: "outreach.send",
      orgId: "org_123",
      supplierNotes: "Jane Doe, jane@supplier.example, +1 555 000 1111, wants 12% off", // not allowlisted
      rawModelOutput: "supplier said their warehouse is at 42 Main St, Springfield", // not allowlisted
    });
    const body = await capturedBody();
    expect(body.extra).toEqual({ source: "outreach.send", orgId: "org_123" });
    expect(JSON.stringify(body)).not.toContain("Jane Doe");
    expect(JSON.stringify(body)).not.toContain("Springfield");
  });

  it("still scrubs known PII shapes inside allowlisted keys, as defense-in-depth", async () => {
    captureException(new Error("boom"), { source: "contact@supplier.example" });
    const body = await capturedBody();
    expect((body.extra as Record<string, unknown>).source).toBe("[redacted-email]");
  });

  it("tags the event with org_id for per-tenant scoping of the shared DSN", async () => {
    captureException(new Error("boom"), { orgId: "org_456" });
    const body = await capturedBody();
    expect(body.tags).toEqual({ org_id: "org_456" });
  });

  it("omits the tag entirely when no orgId is present", async () => {
    captureException(new Error("boom"), { source: "no-org-context" });
    const body = await capturedBody();
    expect(body.tags).toBeUndefined();
  });

  it("caps and scrubs an oversized error message", async () => {
    const huge = "a".repeat(3000) + " contact@supplier.example";
    captureException(new Error(huge));
    const body = await capturedBody();
    const forwardedMessage = body.message as string;
    expect(forwardedMessage.length).toBeLessThan(huge.length);
    expect(forwardedMessage).toContain("[truncated]");
    expect(forwardedMessage).not.toContain("contact@supplier.example");
  });
});
