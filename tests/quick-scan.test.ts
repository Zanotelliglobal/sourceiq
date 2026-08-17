import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { normName, domainOf } from "@/lib/dedup";
import { makeProcessSupplierQuick, type QuickScoutCandidate, type ProcessSupplierQuickDeps } from "@/lib/process-supplier";
import { findKnownSuppliers } from "@/lib/supplier-repository";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

// ─── Fakes ──────────────────────────────────────────────────────────────────
// No mocking framework in this repo (see tests/usage.test.ts) — a minimal
// typed fakeDb stub, same shape as tests/process-supplier.test.ts's, just
// enough to support the quick-scan INSERT + the SELECT that reads it back.
//
// Repository tables (Phase 3 REPO-02) get their own row stores, with real
// `ON CONFLICT` upsert semantics (dedup on (org_id, norm_name) for
// supplier_identities, on identity_id for org_supplier_data) — mirroring
// lib/supplier-repository.ts's actual SQL exactly, per Pitfall 3: a naive
// blind-INSERT fake here would let a dedup regression in
// makeProcessSupplierQuick pass silently.
function fakeDb() {
  const rows: Record<string, unknown>[] = [];
  let nextId = 1;

  const identities: Record<string, unknown>[] = [];
  const orgData: Record<string, unknown>[] = [];
  let nextIdentityId = 1;
  let nextOrgDataId = 1;

  const insertColumns = (sql: string): string[] => {
    const m = sql.match(/\(([^)]+)\)\s*VALUES/i);
    return m ? m[1].split(",").map(c => c.trim()) : [];
  };

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
          if (/^\s*insert/i.test(sql)) {
            const cols = insertColumns(sql);
            const row: Record<string, unknown> = { id: nextId++ };
            cols.forEach((c, i) => { row[c] = params[i]; });
            rows.push(row);
            return { changes: 1, lastInsertRowid: row.id as number };
          }
          return { changes: 0, lastInsertRowid: undefined };
        },
        async get(...params: unknown[]) {
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

function candidate(overrides: Partial<QuickScoutCandidate> = {}): QuickScoutCandidate {
  return { name: "Acme Manufacturing", country: "Italy", website: "https://acme.example", ...overrides };
}

function baseQuickDeps(overrides: Partial<ProcessSupplierQuickDeps> = {}): { deps: ProcessSupplierQuickDeps; events: Record<string, unknown>[] } {
  const events: Record<string, unknown>[] = [];
  const deps: ProcessSupplierQuickDeps = {
    db: fakeDb(),
    eventId: 1,
    orgId: 1,
    send: (e) => { events.push(e); },
    ...overrides,
  };
  return { deps, events };
}

// ─── Dedup (lib/dedup.ts) — shared between /api/orchestrate and
// /api/investigate-quick so a quick scan can't produce a duplicate of an
// existing supplier under a slightly different name/website. ─────────────
describe("quick-scan dedup (lib/dedup.ts)", () => {
  it("normName collapses company-suffix variants of the same name", () => {
    expect(normName("Acme Manufacturing Inc.")).toBe(normName("Acme Mfg"));
    expect(normName("Acme Manufacturing Inc.")).toBe("acme");
  });

  it("normName treats genuinely different companies as different", () => {
    expect(normName("Acme Manufacturing Inc.")).not.toBe(normName("Zenith Industries"));
  });

  it("domainOf strips protocol, www, and path so the same site dedups regardless of URL form", () => {
    expect(domainOf("https://www.acme.example/about")).toBe("acme.example");
    expect(domainOf("http://acme.example")).toBe("acme.example");
    expect(domainOf(null)).toBe("");
    expect(domainOf(undefined)).toBe("");
  });

  it("a quick-scan candidate matching an existing supplier's normalized name is claimed as a dupe", () => {
    const existing = [{ name: "Acme Manufacturing Inc.", website: null as string | null }];
    const seenNames = new Set(existing.map(s => normName(s.name)).filter(Boolean));

    const fresh = [candidate({ name: "Acme Mfg" }), candidate({ name: "Brand New Supplier Co" })];
    const claimed = fresh.filter(c => !seenNames.has(normName(c.name)));

    expect(claimed).toHaveLength(1);
    expect(claimed[0].name).toBe("Brand New Supplier Co");
  });

  it("a quick-scan candidate sharing an existing supplier's website domain is claimed as a dupe", () => {
    const existing = [{ name: "Totally Different Name Ltd", website: "https://www.acme.example" as string | null }];
    const seenDomains = new Set(existing.map(s => domainOf(s.website)).filter(Boolean));

    const fresh = [candidate({ website: "https://acme.example/contact" }), candidate({ name: "Fresh Co", website: "https://fresh.example" })];
    const claimed = fresh.filter(c => !seenDomains.has(domainOf(c.website)));

    expect(claimed).toHaveLength(1);
    expect(claimed[0].name).toBe("Fresh Co");
  });
});

// ─── is_quick_result defaults (lib/process-supplier.ts's
// makeProcessSupplierQuick) — a quick-scan insert must land as an
// unverified, zero-wave, unscored placeholder row so the UI's badge/export/
// long-list-count exclusions (all keyed on is_quick_result) have something
// correct to key off. ────────────────────────────────────────────────────
describe("makeProcessSupplierQuick insert defaults", () => {
  it("inserts with is_quick_result=true, wave=0, ai_score=null, enrichment=null, funnel_stage='long_list'", async () => {
    const { deps, events } = baseQuickDeps();
    const process = makeProcessSupplierQuick(deps);

    const saved = await process(candidate());

    expect(saved.is_quick_result).toBe(true);
    expect(saved.wave).toBe(0);
    expect(saved.ai_score).toBeNull();
    expect(saved.enrichment).toBeNull();
    expect(saved.funnel_stage).toBe("long_list");
  });

  it("streams a supplier_found event carrying the inserted row", async () => {
    const { deps, events } = baseQuickDeps();
    const process = makeProcessSupplierQuick(deps);

    const saved = await process(candidate({ name: "Zenith Industries" }));

    const found = events.find(e => e.type === "supplier_found") as { supplier: { id: number; name: string } };
    expect(found).toBeTruthy();
    expect(found.supplier.id).toBe(saved.id);
    expect(found.supplier.name).toBe("Zenith Industries");
  });

  it("falls back to an empty country/null website when the scout candidate omits them", async () => {
    const { deps } = baseQuickDeps();
    const process = makeProcessSupplierQuick(deps);

    const saved = await process(candidate({ country: "", website: "" }));

    expect(saved.country).toBe("");
    expect(saved.website).toBeNull();
  });
});

// ─── Repository upsert (Phase 3 REPO-02) — makeProcessSupplierQuick must
// also write through to the shared supplier_identities/org_supplier_data
// repository, with ai_score and last_category left null (quick-scan has no
// qualifier score or category at insert time). ─────────────────────────────
describe("makeProcessSupplierQuick repository upsert (REPO-02)", () => {
  it("Q1: writes an identity row with ai_score=null and last_category=null", async () => {
    const { deps } = baseQuickDeps({ orgId: 1 });
    const process = makeProcessSupplierQuick(deps);

    await process(candidate({ name: "Acme", country: "IT", website: "https://acme.example" }));

    const known = await findKnownSuppliers(deps.db, 1);
    expect(known).toHaveLength(1);
    expect(known[0].name).toBe("Acme");
    expect(known[0].ai_score).toBeNull();
    expect(known[0].last_category).toBeNull();
  });

  it("Q2: calling the quick-scan processor twice for the same (orgId, name) produces exactly one identity row", async () => {
    const { deps } = baseQuickDeps({ orgId: 1 });
    const process = makeProcessSupplierQuick(deps);

    await process(candidate({ name: "Acme" }));
    await process(candidate({ name: "Acme" }));

    const known = await findKnownSuppliers(deps.db, 1);
    expect(known).toHaveLength(1);
  });

  it("Q3: if the repository upsert throws, the outer suppliers INSERT still succeeds and returns the saved supplier", async () => {
    const { deps } = baseQuickDeps({ orgId: 1 });
    const realDb = deps.db;
    const throwingDb = {
      ...realDb,
      prepare(sql: string) {
        if (/insert\s+into\s+supplier_identities/i.test(sql)) {
          return { run: async () => { throw new Error("repository down"); }, get: async () => undefined, all: async () => [] };
        }
        return realDb.prepare(sql);
      },
    } as typeof realDb;
    const process = makeProcessSupplierQuick({ ...deps, db: throwingDb });

    const saved = await process(candidate({ name: "Acme" }));

    expect(saved).toBeTruthy();
    expect(saved.name).toBe("Acme");
  });
});

// ─── Outreach exclusion (app/api/outreach/route.ts) — no extracted lib
// function to call directly (the candidate query is inline in the route
// handler), so this is a source-inspection test mirroring the established
// pattern in tests/prompt-injection-defense.test.ts: its job is to catch a
// future edit to either query dropping the exclusion, not to prove the SQL
// executes correctly against a real DB. ─────────────────────────────────
describe("outreach candidate queries exclude is_quick_result rows", () => {
  const SOURCE = readFileSync(join(__dirname, "..", "app", "api", "outreach", "route.ts"), "utf8");

  it("excludes is_quick_result rows from the explicit supplier_ids selection query", () => {
    const explicitQuery = SOURCE.match(/SELECT \* FROM suppliers WHERE event_id=\?[^`]*AND id IN/);
    expect(explicitQuery).toBeTruthy();
    expect(explicitQuery![0]).toContain("is_quick_result = false");
  });

  it("excludes is_quick_result rows from the default long_list selection query", () => {
    const defaultQuery = SOURCE.match(/SELECT \* FROM suppliers WHERE event_id=\?[^`]*funnel_stage='long_list'/);
    expect(defaultQuery).toBeTruthy();
    expect(defaultQuery![0]).toContain("is_quick_result = false");
  });
});

// ─── wave_count semantics — a quick scan must never advance wave_count
// (it's not a real wave and doesn't count against wavesPerEvent), while a
// deepen/targeted request through /api/orchestrate IS a real wave and must
// increment it exactly like a normal discovery wave. Neither route exposes
// this as an extracted, directly-callable unit (wave_count only ever shows
// up inline as a raw UPDATE), so — same rationale as the outreach-exclusion
// tests above — this is source inspection rather than a behavioral test. ──
describe("wave_count semantics", () => {
  const quickSource = readFileSync(join(__dirname, "..", "app", "api", "investigate-quick", "route.ts"), "utf8");
  const orchestrateSource = readFileSync(join(__dirname, "..", "app", "api", "orchestrate", "route.ts"), "utf8");

  it("investigate-quick's route never writes wave_count (only mentions it in comments explaining why not)", () => {
    // The word appears in explanatory comments (see route.ts's header) but
    // must never appear in an actual SQL statement — assert there's no
    // `wave_count=` (a column assignment) anywhere in the file.
    expect(quickSource).not.toMatch(/wave_count\s*=/);
  });

  it("orchestrate's wave_count UPDATE runs unconditionally, not gated behind isTargeted", () => {
    expect(orchestrateSource).toContain(
      "await db.prepare(`UPDATE sourcing_events SET status='scouting', wave_count=?, updated_at=datetime('now') WHERE id=?`)"
    );
    expect(orchestrateSource).toContain(".run(waveNumber, event.id);");

    // The UPDATE statement itself must not be wrapped in an `if (!isTargeted)`
    // (or similar) guard — find the line and confirm the immediately
    // preceding non-blank line is not a conditional on isTargeted.
    const lines = orchestrateSource.split("\n");
    const updateLineIdx = lines.findIndex(l => l.includes("wave_count=?"));
    expect(updateLineIdx).toBeGreaterThan(-1);
    let precedingIdx = updateLineIdx - 1;
    while (precedingIdx >= 0 && lines[precedingIdx].trim() === "") precedingIdx--;
    expect(lines[precedingIdx]).not.toMatch(/if\s*\(\s*!?\s*isTargeted/);
  });

  it("orchestrate synthesizes a targeted-scout plan (real wave machinery) when `targeted` is present, rather than skipping wave bookkeeping", () => {
    expect(orchestrateSource).toContain("const isTargeted = Array.isArray(targeted) && targeted.length > 0;");
    // isTargeted only changes WHAT gets scouted (targeted-scout vs the
    // planned agents), not whether wave-limit/spend-ceiling/wave_count
    // bookkeeping runs — those checks execute unconditionally, further down
    // the file than where isTargeted is computed, well before isTargeted's
    // first branching use.
    const isTargetedIdx = orchestrateSource.indexOf("const isTargeted =");
    const waveCheckIdx = orchestrateSource.indexOf("checkWaveLimit(tier, waveNumber)");
    const waveCountIdx = orchestrateSource.indexOf("wave_count=?, updated_at=datetime('now')");
    expect(waveCheckIdx).toBeGreaterThan(isTargetedIdx);
    expect(waveCountIdx).toBeGreaterThan(isTargetedIdx);
  });
});
