import { describe, it, expect } from "vitest";
import { normalizeEmail, suppressEmail, isSuppressed } from "@/lib/suppression";

// Minimal hand-rolled fakeDb for the org-wide suppression_list table (#98),
// following this repo's no-mocking-framework convention (see
// tests/process-supplier.test.ts). Only understands the two statements
// lib/suppression.ts actually issues.
function fakeDb() {
  const rows: { org_id: number; email: string; reason: string }[] = [];
  return {
    rows,
    prepare(sql: string) {
      return {
        async run(...params: unknown[]) {
          if (/^\s*insert\s+into\s+suppression_list/i.test(sql)) {
            const [orgId, email, reason] = params as [number, string, string];
            const exists = rows.some(r => r.org_id === orgId && r.email === email);
            if (!exists) rows.push({ org_id: orgId, email, reason });
            return { changes: exists ? 0 : 1 };
          }
          throw new Error(`fakeDb: unhandled run() SQL: ${sql}`);
        },
        async get(...params: unknown[]) {
          if (/^\s*select\s+1\s+as\s+found\s+from\s+suppression_list/i.test(sql)) {
            const [orgId, email] = params as [number, string];
            return rows.some(r => r.org_id === orgId && r.email === email) ? { found: 1 } : undefined;
          }
          throw new Error(`fakeDb: unhandled get() SQL: ${sql}`);
        },
      };
    },
  } as unknown as ReturnType<typeof import("@/lib/db").getDb> & { rows: typeof rows };
}

describe("normalizeEmail", () => {
  it("trims whitespace and lowercases", () => {
    expect(normalizeEmail("  Buyer@Example.COM  ")).toBe("buyer@example.com");
  });

  it("treats null/undefined/empty as empty string", () => {
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
    expect(normalizeEmail("")).toBe("");
  });
});

describe("suppressEmail / isSuppressed", () => {
  it("adds an email to the org's suppression list", async () => {
    const db = fakeDb();
    expect(await isSuppressed(db, 1, "supplier@example.com")).toBe(false);
    await suppressEmail(db, 1, "supplier@example.com", "unsubscribed");
    expect(await isSuppressed(db, 1, "supplier@example.com")).toBe(true);
  });

  it("is idempotent — suppressing the same (org, email) twice is a no-op", async () => {
    const db = fakeDb();
    await suppressEmail(db, 1, "supplier@example.com", "unsubscribed");
    await suppressEmail(db, 1, "supplier@example.com", "gdpr_erasure");
    expect(db.rows.length).toBe(1);
  });

  it("normalizes the email before storing/checking", async () => {
    const db = fakeDb();
    await suppressEmail(db, 1, "  Supplier@Example.COM  ", "unsubscribed");
    expect(await isSuppressed(db, 1, "supplier@example.com")).toBe(true);
    expect(await isSuppressed(db, 1, "SUPPLIER@EXAMPLE.COM")).toBe(true);
  });

  it("scopes suppression per-org — one org's suppression doesn't leak to another", async () => {
    const db = fakeDb();
    await suppressEmail(db, 1, "supplier@example.com", "unsubscribed");
    expect(await isSuppressed(db, 2, "supplier@example.com")).toBe(false);
  });

  it("ignores empty/null emails", async () => {
    const db = fakeDb();
    await suppressEmail(db, 1, "", "unsubscribed");
    await suppressEmail(db, 1, null, "unsubscribed");
    expect(db.rows.length).toBe(0);
    expect(await isSuppressed(db, 1, "")).toBe(false);
    expect(await isSuppressed(db, 1, null)).toBe(false);
  });
});
