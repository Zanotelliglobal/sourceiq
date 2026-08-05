import { describe, it, expect } from "vitest";
import { makeProcessSupplier, type ScoutSupplier, type ProcessSupplierDeps } from "@/lib/process-supplier";
import type { getDb } from "@/lib/db";
import type { ContactChannels } from "@/lib/contact";

type Db = ReturnType<typeof getDb>;

// ─── Fakes ──────────────────────────────────────────────────────────────────
// No mocking framework in this repo (see tests/usage.test.ts) — build minimal
// typed stubs directly instead.

// A tiny in-memory stand-in for the Postgres-backed Db wrapper. Understands
// just enough SQL shape (INSERT/SELECT/UPDATE against `suppliers`) to support
// the process-supplier pipeline; column names are read off the INSERT's own
// column list so it doesn't hard-code positional offsets.
function fakeDb() {
  const rows: Record<string, unknown>[] = [];
  let nextId = 1;

  const insertColumns = (sql: string): string[] => {
    const m = sql.match(/\(([^)]+)\)\s*VALUES/i);
    return m ? m[1].split(",").map(c => c.trim()) : [];
  };

  const db = {
    rows,
    prepare(sql: string) {
      return {
        async run(...params: unknown[]) {
          if (/^\s*insert/i.test(sql)) {
            const cols = insertColumns(sql);
            const row: Record<string, unknown> = { id: nextId++ };
            cols.forEach((c, i) => { row[c] = params[i]; });
            rows.push(row);
            return { changes: 1, lastInsertRowid: row.id as number };
          }
          if (/^\s*update\s+suppliers\s+set\s+contact_email/i.test(sql)) {
            const [contact_email, contact_url, contact_phone, contact_linkedin, id] = params;
            const row = rows.find(r => r.id === id);
            if (row) {
              row.contact_email = contact_email;
              row.contact_url = contact_url;
              row.contact_phone = contact_phone;
              row.contact_linkedin = contact_linkedin;
            }
            return { changes: row ? 1 : 0, lastInsertRowid: undefined };
          }
          return { changes: 0, lastInsertRowid: undefined };
        },
        async get(...params: unknown[]) {
          if (/^\s*select/i.test(sql)) return rows.find(r => r.id === params[0]);
          return undefined;
        },
        async all() { return rows; },
      };
    },
  };
  return db as unknown as Db;
}

function scoutSupplier(overrides: Partial<ScoutSupplier> = {}): ScoutSupplier {
  return {
    name: "Acme Manufacturing",
    country: "Italy",
    city: "Milan",
    description: "A contract manufacturer.",
    capabilities: ["CNC machining"],
    certifications: ["ISO 9001:2015"],
    employees: "200-500",
    annual_revenue: "$20M-$50M",
    founded: "1992",
    website: "https://acme.example",
    contact_email: "",
    data_sources: ["https://acme.example/about"],
    business_type: "Manufacturer",
    employee_count: "201-500",
    founded_year: 1992,
    review_score: 4.5,
    capability_tags: [],
    ...overrides,
  };
}

const fakeQualifier = async () => ({
  overall_score: 92,
  rationale: "Strong fit.",
  breakdown: { capability_fit: 92, quality_signals: 92, geographic_risk: 92, financial_stability: 92, compliance_readiness: 92 },
});

const fakeEnricher = async () => ({
  market_position: "Established mid-tier player.",
  key_risks: [] as string[],
  key_strengths: [] as string[],
  recommended_action: "pursue",
});

const AGENT = { id: "scout-1", type: "broad-scout", label: "Market Scout Alpha", focus: "general" };

function baseDeps(overrides: Partial<ProcessSupplierDeps> = {}): { deps: ProcessSupplierDeps; events: Record<string, unknown>[] } {
  const events: Record<string, unknown>[] = [];
  const deps: ProcessSupplierDeps = {
    db: fakeDb(),
    eventId: 1,
    waveNumber: 1,
    categoryLabel: "Industrial Components",
    effectiveRequirements: "Needs ISO 9001.",
    annualSpend: "$1M-$5M",
    groundingOn: false,
    send: (e) => { events.push(e); },
    track: () => () => {},
    backgroundTasks: [],
    runQualifierAgent: fakeQualifier,
    runQualifierAgentGrounded: fakeQualifier,
    runEnricherAgent: fakeEnricher,
    ...overrides,
  };
  return { deps, events };
}

describe("makeProcessSupplier", () => {
  it("inserts the supplier and sends supplier_found BEFORE the contact scrape resolves", async () => {
    let releaseScrape!: () => void;
    const gate = new Promise<void>(resolve => { releaseScrape = resolve; });
    let scrapeResolved = false;
    const deferredScrape = async (): Promise<ContactChannels> => {
      await gate;
      scrapeResolved = true;
      return { contact_email: "info@acme.example", contact_url: "https://acme.example/contact", phone: "+1 555 0100", linkedin: "", source: "https://acme.example" };
    };

    const { deps, events } = baseDeps({ scrapeSupplierContact: deferredScrape });
    const process = makeProcessSupplier(deps, AGENT);

    await process(scoutSupplier());

    // The supplier is already inserted and streamed — the scrape has not
    // resolved yet, proving it is off the critical path.
    expect(events.some(e => e.type === "supplier_found")).toBe(true);
    expect(scrapeResolved).toBe(false);
    expect(deps.backgroundTasks.length).toBe(1);

    // Now let the background scrape finish and confirm it patches the row
    // and streams a follow-up event.
    releaseScrape();
    await Promise.allSettled(deps.backgroundTasks);

    expect(scrapeResolved).toBe(true);
    const updated = events.find(e => e.type === "supplier_updated");
    expect(updated).toMatchObject({
      contact_email: "info@acme.example",
      contact_url: "https://acme.example/contact",
      contact_phone: "+1 555 0100",
      contact_linkedin: "",
    });
  });

  it("does not scrape when the scout already surfaced a contact email", async () => {
    let scrapeCalled = false;
    const scrape = async (): Promise<ContactChannels> => {
      scrapeCalled = true;
      return { contact_email: "", contact_url: "", phone: "", linkedin: "", source: "" };
    };
    const { deps, events } = baseDeps({ scrapeSupplierContact: scrape });
    const process = makeProcessSupplier(deps, AGENT);

    await process(scoutSupplier({ contact_email: "sales@acme.example" }));

    expect(scrapeCalled).toBe(false);
    expect(deps.backgroundTasks.length).toBe(0);
    const found = events.find(e => e.type === "supplier_found") as { supplier: { contact_email: string } };
    expect(found.supplier.contact_email).toBe("sales@acme.example");
  });

  it("does not crash and emits no supplier_updated when the scrape fails", async () => {
    const failingScrape = async (): Promise<ContactChannels> => {
      throw new Error("timeout");
    };
    const { deps, events } = baseDeps({ scrapeSupplierContact: failingScrape });
    const process = makeProcessSupplier(deps, AGENT);

    await expect(process(scoutSupplier())).resolves.toBeUndefined();
    expect(deps.backgroundTasks.length).toBe(1);

    const settled = await Promise.allSettled(deps.backgroundTasks);
    expect(settled.every(r => r.status === "fulfilled")).toBe(true);
    expect(events.some(e => e.type === "supplier_updated")).toBe(false);
  });

  it("does not emit supplier_updated when the scrape resolves with nothing found", async () => {
    const emptyScrape = async (): Promise<ContactChannels> => ({ contact_email: "", contact_url: "", phone: "", linkedin: "", source: "" });
    const { deps, events } = baseDeps({ scrapeSupplierContact: emptyScrape });
    const process = makeProcessSupplier(deps, AGENT);

    await process(scoutSupplier());
    await Promise.allSettled(deps.backgroundTasks);

    expect(events.some(e => e.type === "supplier_updated")).toBe(false);
  });
});
