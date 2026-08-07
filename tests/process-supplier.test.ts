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
          if (/^\s*update\s+suppliers\s+set\s+enrichment/i.test(sql)) {
            const [enrichment, id] = params;
            const row = rows.find(r => r.id === id);
            if (row) row.enrichment = enrichment;
            return { changes: row ? 1 : 0, lastInsertRowid: undefined };
          }
          if (/^\s*update\s+suppliers\s+set\s+verification_badges/i.test(sql)) {
            const [verification_badges, id] = params;
            const row = rows.find(r => r.id === id);
            if (row) row.verification_badges = verification_badges;
            return { changes: row ? 1 : 0, lastInsertRowid: undefined };
          }
          return { changes: 0, lastInsertRowid: undefined };
        },
        async get(...params: unknown[]) {
          // Return a snapshot copy, mirroring a real SELECT — later UPDATEs to
          // the underlying row must not retroactively mutate an already-read result.
          if (/^\s*select/i.test(sql)) {
            const row = rows.find(r => r.id === params[0]);
            return row ? { ...row } : undefined;
          }
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
    partnered_customers: [],
    key_export_markets: [],
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

const fakeCheckWebsiteLive = async () => false;

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
    checkWebsiteLive: fakeCheckWebsiteLive,
    ...overrides,
  };
  return { deps, events };
}

const expectedEnrichmentJson = JSON.stringify({
  market_position: "Established mid-tier player.",
  key_risks: [] as string[],
  key_strengths: [] as string[],
  recommended_action: "pursue",
});

describe("makeProcessSupplier", () => {
  it("inserts the supplier with enrichment=null and sends supplier_found BEFORE enrichment or the contact scrape resolves", async () => {
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

    // The supplier is already inserted and streamed — enrichment and the
    // scrape have not resolved yet, proving both are off the critical path.
    const found = events.find(e => e.type === "supplier_found") as { supplier: { enrichment: string | null } };
    expect(found.supplier.enrichment).toBeNull();
    expect(scrapeResolved).toBe(false);
    // enrich + contact scrape + website-live verification check.
    expect(deps.backgroundTasks.length).toBe(3);

    // Now let both background tasks finish and confirm each patches the row
    // and streams its own follow-up event.
    releaseScrape();
    await Promise.allSettled(deps.backgroundTasks);

    expect(scrapeResolved).toBe(true);
    const contactUpdate = events.find(e => e.type === "supplier_updated" && "contact_email" in e);
    expect(contactUpdate).toMatchObject({
      contact_email: "info@acme.example",
      contact_url: "https://acme.example/contact",
      contact_phone: "+1 555 0100",
      contact_linkedin: "",
    });
    const enrichUpdate = events.find(e => e.type === "supplier_updated" && "enrichment" in e);
    expect(enrichUpdate).toMatchObject({ enrichment: expectedEnrichmentJson });
  });

  it("falls back to a neutral placeholder when enrichment fails, without crashing", async () => {
    const failingEnricher = async () => { throw new Error("llm down"); };
    const { deps, events } = baseDeps({
      runEnricherAgent: failingEnricher,
      scrapeSupplierContact: async (): Promise<ContactChannels> => ({ contact_email: "", contact_url: "", phone: "", linkedin: "", source: "" }),
    });
    const process = makeProcessSupplier(deps, AGENT);

    await expect(process(scoutSupplier())).resolves.toBeUndefined();
    const settled = await Promise.allSettled(deps.backgroundTasks);
    expect(settled.every(r => r.status === "fulfilled")).toBe(true);

    const enrichUpdate = events.find(e => e.type === "supplier_updated" && "enrichment" in e) as { enrichment: string };
    expect(JSON.parse(enrichUpdate.enrichment)).toMatchObject({
      market_position: "Unknown",
      key_risks: [],
      key_strengths: [],
      recommended_action: "monitor",
    });
  });

  it("does not scrape when the scout already surfaced a contact email, but still enriches in the background", async () => {
    let scrapeCalled = false;
    const scrape = async (): Promise<ContactChannels> => {
      scrapeCalled = true;
      return { contact_email: "", contact_url: "", phone: "", linkedin: "", source: "" };
    };
    const { deps, events } = baseDeps({ scrapeSupplierContact: scrape });
    const process = makeProcessSupplier(deps, AGENT);

    await process(scoutSupplier({ contact_email: "sales@acme.example" }));

    expect(scrapeCalled).toBe(false);
    // enrich + website-live check (no scrape task — the scout already had an email).
    expect(deps.backgroundTasks.length).toBe(2);
    const found = events.find(e => e.type === "supplier_found") as { supplier: { contact_email: string } };
    expect(found.supplier.contact_email).toBe("sales@acme.example");

    await Promise.allSettled(deps.backgroundTasks);
    expect(events.some(e => e.type === "supplier_updated" && "enrichment" in e)).toBe(true);
  });

  it("does not crash and emits no contact supplier_updated when the scrape fails", async () => {
    const failingScrape = async (): Promise<ContactChannels> => {
      throw new Error("timeout");
    };
    const { deps, events } = baseDeps({ scrapeSupplierContact: failingScrape });
    const process = makeProcessSupplier(deps, AGENT);

    await expect(process(scoutSupplier())).resolves.toBeUndefined();
    // enrich + contact scrape + website-live verification check.
    expect(deps.backgroundTasks.length).toBe(3);

    const settled = await Promise.allSettled(deps.backgroundTasks);
    expect(settled.every(r => r.status === "fulfilled")).toBe(true);
    expect(events.some(e => e.type === "supplier_updated" && "contact_email" in e)).toBe(false);
  });

  it("does not emit a contact supplier_updated when the scrape resolves with nothing found", async () => {
    const emptyScrape = async (): Promise<ContactChannels> => ({ contact_email: "", contact_url: "", phone: "", linkedin: "", source: "" });
    const { deps, events } = baseDeps({ scrapeSupplierContact: emptyScrape });
    const process = makeProcessSupplier(deps, AGENT);

    await process(scoutSupplier());
    await Promise.allSettled(deps.backgroundTasks);

    expect(events.some(e => e.type === "supplier_updated" && "contact_email" in e)).toBe(false);
  });

  it("normalizes partnered_customers/key_export_markets at insert and derives partnered_customer_count", async () => {
    const { deps, events } = baseDeps({
      scrapeSupplierContact: async (): Promise<ContactChannels> => ({ contact_email: "", contact_url: "", phone: "", linkedin: "", source: "" }),
    });
    const process = makeProcessSupplier(deps, AGENT);

    await process(scoutSupplier({
      contact_email: "sales@acme.example",
      partnered_customers: ["Nike", " Nike ", "Adidas", 42 as unknown as string],
      key_export_markets: ["USA", "EU"],
    }));

    const found = events.find(e => e.type === "supplier_found") as {
      supplier: { partnered_customers: string; partnered_customer_count: number | null; key_export_markets: string };
    };
    expect(JSON.parse(found.supplier.partnered_customers)).toEqual(["Nike", "Adidas"]);
    expect(found.supplier.partnered_customer_count).toBe(2);
    expect(JSON.parse(found.supplier.key_export_markets)).toEqual(["USA", "EU"]);
  });

  it("leaves partnered_customer_count null when no customers were named", async () => {
    const { deps, events } = baseDeps({
      scrapeSupplierContact: async (): Promise<ContactChannels> => ({ contact_email: "", contact_url: "", phone: "", linkedin: "", source: "" }),
    });
    const process = makeProcessSupplier(deps, AGENT);

    await process(scoutSupplier({ contact_email: "sales@acme.example" }));

    const found = events.find(e => e.type === "supplier_found") as { supplier: { partnered_customer_count: number | null } };
    expect(found.supplier.partnered_customer_count).toBeNull();
  });

  it("patches verification_badges and streams supplier_updated when the website-live check passes", async () => {
    const { deps, events } = baseDeps({
      scrapeSupplierContact: async (): Promise<ContactChannels> => ({ contact_email: "", contact_url: "", phone: "", linkedin: "", source: "" }),
      checkWebsiteLive: async () => true,
    });
    const process = makeProcessSupplier(deps, AGENT);

    await process(scoutSupplier({ contact_email: "sales@acme.example" }));
    const found = events.find(e => e.type === "supplier_found") as { supplier: { verification_badges: string | null } };
    expect(found.supplier.verification_badges).toBeNull();

    await Promise.allSettled(deps.backgroundTasks);
    const badgeUpdate = events.find(e => e.type === "supplier_updated" && "verification_badges" in e) as { verification_badges: string };
    expect(JSON.parse(badgeUpdate.verification_badges)).toEqual(["website-live"]);
  });

  it("does not patch verification_badges when the website-live check fails or the site is unreachable", async () => {
    const { deps, events } = baseDeps({
      scrapeSupplierContact: async (): Promise<ContactChannels> => ({ contact_email: "", contact_url: "", phone: "", linkedin: "", source: "" }),
      checkWebsiteLive: async () => { throw new Error("timeout"); },
    });
    const process = makeProcessSupplier(deps, AGENT);

    await expect(process(scoutSupplier({ contact_email: "sales@acme.example" }))).resolves.toBeUndefined();
    const settled = await Promise.allSettled(deps.backgroundTasks);
    expect(settled.every(r => r.status === "fulfilled")).toBe(true);
    expect(events.some(e => e.type === "supplier_updated" && "verification_badges" in e)).toBe(false);
  });

  it("does not run the website-live check when the scout found no website", async () => {
    const { deps } = baseDeps({
      scrapeSupplierContact: async (): Promise<ContactChannels> => ({ contact_email: "", contact_url: "", phone: "", linkedin: "", source: "" }),
    });
    const process = makeProcessSupplier(deps, AGENT);

    await process(scoutSupplier({ contact_email: "sales@acme.example", website: "" }));
    // enrich only — no scrape task condition differs (website falsy skips the
    // `!s.contact_email && s.website` scrape branch too, since website is ""),
    // and the badge task is also skipped without a website.
    expect(deps.backgroundTasks.length).toBe(1);
  });
});
