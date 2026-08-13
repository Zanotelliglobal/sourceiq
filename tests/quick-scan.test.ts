import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { normName, domainOf } from "@/lib/dedup";
import { makeProcessSupplierQuick, type QuickScoutCandidate, type ProcessSupplierQuickDeps } from "@/lib/process-supplier";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

// ─── Fakes ──────────────────────────────────────────────────────────────────
// No mocking framework in this repo (see tests/usage.test.ts) — a minimal
// typed fakeDb stub, same shape as tests/process-supplier.test.ts's, just
// enough to support the quick-scan INSERT + the SELECT that reads it back.
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
          return { changes: 0, lastInsertRowid: undefined };
        },
        async get(...params: unknown[]) {
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

function candidate(overrides: Partial<QuickScoutCandidate> = {}): QuickScoutCandidate {
  return { name: "Acme Manufacturing", country: "Italy", website: "https://acme.example", ...overrides };
}

function baseQuickDeps(overrides: Partial<ProcessSupplierQuickDeps> = {}): { deps: ProcessSupplierQuickDeps; events: Record<string, unknown>[] } {
  const events: Record<string, unknown>[] = [];
  const deps: ProcessSupplierQuickDeps = {
    db: fakeDb(),
    eventId: 1,
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

  it("investigate-quick's route never references wave_count", () => {
    expect(quickSource).not.toMatch(/wave_count/);
  });

  it("orchestrate's wave_count UPDATE runs unconditionally, not gated behind isTargeted", () => {
    const updateMatch = orchestrateSource.match(/await db\.prepare\(`UPDATE sourcing_events SET status='scouting', wave_count=\?[^)]*\)\)\s*\n\s*\.run\(waveNumber, event\.id\);/);
    expect(updateMatch).toBeTruthy();

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
