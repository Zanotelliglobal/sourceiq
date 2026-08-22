import { describe, it, expect } from "vitest";
import {
  makeProcessSupplier,
  makeProcessSupplierQuick,
  makeProcessSupplierDeepen,
  type ScoutSupplier,
  type ProcessSupplierDeps,
  type ProcessSupplierQuickDeps,
  type QuickScoutCandidate,
} from "@/lib/process-supplier";
import { findKnownSuppliers, upsertSupplierIdentity, upsertOrgSupplierData } from "@/lib/supplier-repository";
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

  // Repository tables (Phase 3 REPO-01/02/03/04) get their own row stores
  // with real `ON CONFLICT` upsert semantics — dedup on (org_id, norm_name)
  // for supplier_identities, on identity_id for org_supplier_data — mirroring
  // lib/supplier-repository.ts's actual SQL exactly (Pitfall 3: a naive
  // blind-INSERT fake here would let a dedup regression pass silently, which
  // matters now that Plan 03-02's deepen-path idempotency tests (D1) assert
  // on exact row counts across two independent write paths).
  const identities: Record<string, unknown>[] = [];
  const orgData: Record<string, unknown>[] = [];
  let nextIdentityId = 1;
  let nextOrgDataId = 1;

  const db = {
    rows,
    identities,
    orgData,
    prepare(sql: string) {
      return {
        async run(...params: unknown[]) {
          if (/insert\s+into\s+supplier_identities/i.test(sql)) {
            const [orgId, name, normNameVal, domain, website, country, lastCategory] = params;
            const existing =
              normNameVal === ""
                ? undefined
                : identities.find(r => r.org_id === orgId && r.norm_name === normNameVal);
            if (existing) {
              existing.name = name;
              existing.domain = domain ?? existing.domain;
              existing.website = website ?? existing.website;
              existing.country = country ?? existing.country;
              existing.last_category = lastCategory ?? existing.last_category;
              return { changes: 1, lastInsertRowid: existing.id as number };
            }
            const row: Record<string, unknown> = {
              id: nextIdentityId++, org_id: orgId, name, norm_name: normNameVal,
              domain, website, country, last_category: lastCategory,
            };
            identities.push(row);
            return { changes: 1, lastInsertRowid: row.id as number };
          }
          if (/insert\s+into\s+org_supplier_data/i.test(sql)) {
            const [identityId, orgId, aiScore] = params;
            const existing = orgData.find(r => r.identity_id === identityId);
            if (existing) {
              existing.ai_score = aiScore;
              return { changes: 1, lastInsertRowid: existing.id as number };
            }
            const row: Record<string, unknown> = {
              id: nextOrgDataId++, identity_id: identityId, org_id: orgId,
              enrichment: null, ai_score: aiScore, notes: null, rating: null,
            };
            orgData.push(row);
            return { changes: 1, lastInsertRowid: row.id as number };
          }
          if (/^\s*update\s+org_supplier_data\s+set\s+enrichment/i.test(sql)) {
            const [enrichment, identityId] = params;
            const row = orgData.find(r => r.identity_id === identityId);
            if (row) row.enrichment = enrichment;
            return { changes: row ? 1 : 0, lastInsertRowid: undefined };
          }
          if (/^\s*insert/i.test(sql)) {
            const cols = insertColumns(sql);
            const row: Record<string, unknown> = { id: nextId++ };
            cols.forEach((c, i) => { row[c] = params[i]; });
            rows.push(row);
            return { changes: 1, lastInsertRowid: row.id as number };
          }
          if (/^\s*update\s+suppliers\s+set\s+identity_id/i.test(sql)) {
            const [identityId, id] = params;
            const row = rows.find(r => r.id === id);
            if (row) row.identity_id = identityId;
            return { changes: row ? 1 : 0, lastInsertRowid: undefined };
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
        async all(...params: unknown[]) {
          if (/from\s+supplier_identities\s+si/i.test(sql)) {
            const orgId = params[0];
            return identities
              .filter(si => si.org_id === orgId)
              .map(si => {
                const osd = orgData.find(r => r.identity_id === si.id);
                return {
                  identity_id: si.id, org_id: si.org_id, name: si.name, norm_name: si.norm_name,
                  domain: si.domain, website: si.website, country: si.country,
                  last_category: si.last_category, enrichment: osd?.enrichment ?? null,
                  ai_score: osd?.ai_score ?? null, notes: osd?.notes ?? null, rating: osd?.rating ?? null,
                };
              });
          }
          return rows;
        },
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
    orgId: 1,
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

function baseQuickDeps(overrides: Partial<ProcessSupplierQuickDeps> = {}): { deps: ProcessSupplierQuickDeps; events: Record<string, unknown>[]; db: Db } {
  const events: Record<string, unknown>[] = [];
  const db = fakeDb();
  const deps: ProcessSupplierQuickDeps = {
    db,
    eventId: 1,
    orgId: 1,
    send: (e) => { events.push(e); },
    ...overrides,
  };
  return { deps, events, db };
}

function quickCandidate(overrides: Partial<QuickScoutCandidate> = {}): QuickScoutCandidate {
  return {
    name: "Acme Manufacturing",
    country: "Italy",
    website: "https://acme.example",
    ...overrides,
  };
}

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

  it("Phase 4 D-02: back-links the freshly-inserted suppliers row to its repository identity_id", async () => {
    const { deps, events } = baseDeps({
      scrapeSupplierContact: async (): Promise<ContactChannels> => ({ contact_email: "", contact_url: "", phone: "", linkedin: "", source: "" }),
    });
    const process = makeProcessSupplier(deps, AGENT);

    await process(scoutSupplier());

    const found = events.find(e => e.type === "supplier_found") as { supplier: { id: number } };
    const row = (deps.db as unknown as { rows: Record<string, unknown>[] }).rows.find(r => r.id === found.supplier.id);
    expect(row?.identity_id).not.toBeNull();
    expect(row?.identity_id).not.toBeUndefined();

    const known = await findKnownSuppliers(deps.db, deps.orgId);
    expect(known).toHaveLength(1);
    expect(row?.identity_id).toBe(known[0].identity_id);
  });

  it("Phase 4 D-02: a repository write failure never blocks the per-event flow, and identity_id stays unset", async () => {
    const realDb = fakeDb();
    const throwingDb = {
      ...realDb,
      prepare(sql: string) {
        if (/insert\s+into\s+supplier_identities/i.test(sql)) {
          return { run: async () => { throw new Error("repository down"); }, get: async () => undefined, all: async () => [] };
        }
        return realDb.prepare(sql);
      },
    } as typeof realDb;
    const { deps, events } = baseDeps({
      db: throwingDb,
      scrapeSupplierContact: async (): Promise<ContactChannels> => ({ contact_email: "", contact_url: "", phone: "", linkedin: "", source: "" }),
    });
    const process = makeProcessSupplier(deps, AGENT);

    await expect(process(scoutSupplier())).resolves.toBeUndefined();

    const found = events.find(e => e.type === "supplier_found") as { supplier: { id: number } };
    const row = (realDb as unknown as { rows: Record<string, unknown>[] }).rows.find(r => r.id === found.supplier.id);
    expect(row?.identity_id).toBeUndefined();
  });
});

describe("makeProcessSupplierQuick repository upsert + identity_id back-link (Phase 3 REPO-02, Phase 4 D-02)", () => {
  it("back-links the freshly-inserted suppliers row to its repository identity_id", async () => {
    const { deps, events, db } = baseQuickDeps();
    const quick = makeProcessSupplierQuick(deps);

    const saved = await quick(quickCandidate());

    expect(events.some(e => e.type === "supplier_found")).toBe(true);
    const row = (db as unknown as { rows: Record<string, unknown>[] }).rows.find(r => r.id === saved.id);
    expect(row?.identity_id).not.toBeNull();
    expect(row?.identity_id).not.toBeUndefined();

    const known = await findKnownSuppliers(db, deps.orgId);
    expect(known).toHaveLength(1);
    expect(row?.identity_id).toBe(known[0].identity_id);
  });

  it("a repository write failure never blocks the quick-scan insert, and identity_id stays unset", async () => {
    const realDb = fakeDb();
    const throwingDb = {
      ...realDb,
      prepare(sql: string) {
        if (/insert\s+into\s+supplier_identities/i.test(sql)) {
          return { run: async () => { throw new Error("repository down"); }, get: async () => undefined, all: async () => [] };
        }
        return realDb.prepare(sql);
      },
    } as typeof realDb;
    const { deps } = baseQuickDeps({ db: throwingDb });
    const quick = makeProcessSupplierQuick(deps);

    const saved = await quick(quickCandidate());

    const row = (realDb as unknown as { rows: Record<string, unknown>[] }).rows.find(r => r.id === saved.id);
    expect(row?.identity_id).toBeUndefined();
  });
});

// ─── Repository upsert (Phase 3 REPO-02) — makeProcessSupplierDeepen must
// also write through to the shared supplier_identities/org_supplier_data
// repository, both synchronously (identity + real ai_score) and from its
// enrichTask closure (enrichment second-write), idempotent with any prior
// quick-scan write for the same supplier. ──────────────────────────────────
describe("makeProcessSupplierDeepen repository upsert (REPO-02)", () => {
  it("D1: idempotent with a prior quick-scan repository write — exactly one identity row, ai_score and last_category now reflect the deepen write", async () => {
    const { deps } = baseDeps({
      scrapeSupplierContact: async (): Promise<ContactChannels> => ({ contact_email: "", contact_url: "", phone: "", linkedin: "", source: "" }),
    });

    // Simulate a prior quick-scan repository write for the same supplier:
    // aiScore=null, no categoryLabel yet.
    const priorIdentityId = await upsertSupplierIdentity(deps.db, {
      orgId: deps.orgId,
      name: "Acme Manufacturing",
      website: "https://acme.example",
      country: "Italy",
      categoryLabel: null,
    });
    await upsertOrgSupplierData(deps.db, { identityId: priorIdentityId, orgId: deps.orgId, aiScore: null });

    // Seed an existing suppliers row for the deepen UPDATE-by-id to target
    // (mirrors a quick-scan candidate already sitting in the suppliers table).
    const seedResult = await deps.db.prepare(`INSERT INTO suppliers (event_id, name) VALUES (?, ?)`).run(1, "Acme Manufacturing");
    const supplierId = seedResult.lastInsertRowid;

    const deepen = makeProcessSupplierDeepen(deps, AGENT);
    await deepen(supplierId as number, scoutSupplier());

    const known = await findKnownSuppliers(deps.db, deps.orgId);
    expect(known).toHaveLength(1);
    expect(known[0].ai_score).toBe(92); // fakeQualifier's overall_score — no longer null
    expect(known[0].last_category).toBe(deps.categoryLabel);

    // Phase 4 D-02: the deepen path also back-links suppliers.identity_id.
    const row = (deps.db as unknown as { rows: Record<string, unknown>[] }).rows.find(r => r.id === supplierId);
    expect(row?.identity_id).toBe(known[0].identity_id);
  });

  it("D2: the enrichTask closure mirrors resolved enrichment into org_supplier_data.enrichment", async () => {
    const { deps } = baseDeps({
      scrapeSupplierContact: async (): Promise<ContactChannels> => ({ contact_email: "", contact_url: "", phone: "", linkedin: "", source: "" }),
    });
    const seedResult = await deps.db.prepare(`INSERT INTO suppliers (event_id, name) VALUES (?, ?)`).run(1, "Acme Manufacturing");
    const supplierId = seedResult.lastInsertRowid;

    const deepen = makeProcessSupplierDeepen(deps, AGENT);
    await deepen(supplierId as number, scoutSupplier());
    await Promise.allSettled(deps.backgroundTasks);

    const known = await findKnownSuppliers(deps.db, deps.orgId);
    expect(known).toHaveLength(1);
    expect(known[0].enrichment).toBe(expectedEnrichmentJson);
  });

  it("D3: repository upsert failures (sync path and enrichTask) never throw into the deepen flow", async () => {
    const { deps } = baseDeps({
      scrapeSupplierContact: async (): Promise<ContactChannels> => ({ contact_email: "", contact_url: "", phone: "", linkedin: "", source: "" }),
    });
    const seedResult = await deps.db.prepare(`INSERT INTO suppliers (event_id, name) VALUES (?, ?)`).run(1, "Acme Manufacturing");
    const supplierId = seedResult.lastInsertRowid;

    const realDb = deps.db;
    const throwingDb = {
      ...realDb,
      prepare(sql: string) {
        if (/insert\s+into\s+supplier_identities/i.test(sql) || /update\s+org_supplier_data\s+set\s+enrichment/i.test(sql)) {
          return { run: async () => { throw new Error("repository down"); }, get: async () => undefined, all: async () => [] };
        }
        return realDb.prepare(sql);
      },
    } as typeof realDb;

    const deepen = makeProcessSupplierDeepen({ ...deps, db: throwingDb }, AGENT);
    await expect(deepen(supplierId as number, scoutSupplier())).resolves.toBeUndefined();
    const settled = await Promise.allSettled(deps.backgroundTasks);
    expect(settled.every(r => r.status === "fulfilled")).toBe(true);
  });
});
