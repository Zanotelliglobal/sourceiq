import { describe, it, expect } from "vitest";
import {
  upsertSupplierIdentity,
  upsertOrgSupplierData,
  updateOrgSupplierDataRating,
  findKnownSuppliers,
  repositoryEntryMatchesEvent,
  type Db,
  type RepositoryEntry,
} from "@/lib/supplier-repository";

// ─── Fakes ──────────────────────────────────────────────────────────────────
// No mocking framework in this repo (see tests/usage.test.ts) — a minimal
// in-memory, regex-matched SQL stand-in that understands the exact upsert
// shapes emitted by lib/supplier-repository.ts, including their
// `ON CONFLICT ... DO UPDATE` semantics (Pitfall 3 in RESEARCH.md: a silent
// no-op fallback here would make isolation assertions pass without
// exercising any real logic).

type Row = Record<string, unknown>;

function fakeRepositoryDb(opts: { throwOnIdentityInsert?: boolean } = {}) {
  const identities: Row[] = [];
  const orgData: Row[] = [];
  let nextIdentityId = 1;
  let nextOrgDataId = 1;

  const db = {
    identities,
    orgData,
    prepare(sql: string) {
      return {
        async run(...params: unknown[]) {
          // supplier_identities upsert: ON CONFLICT (org_id, norm_name) DO UPDATE
          if (/insert\s+into\s+supplier_identities/i.test(sql)) {
            if (opts.throwOnIdentityInsert) {
              throw new Error("simulated identity insert failure");
            }
            const [orgId, name, normNameVal, domain, website, country, lastCategory] = params;
            // Empty norm_name rows are exempt from uniqueness (partial index
            // WHERE norm_name <> '') — never collide, always insert fresh.
            const existing =
              normNameVal === ""
                ? undefined
                : identities.find(
                    (r) => r.org_id === orgId && r.norm_name === normNameVal
                  );
            if (existing) {
              existing.name = name;
              existing.domain = domain ?? existing.domain;
              existing.website = website ?? existing.website;
              existing.country = country ?? existing.country;
              existing.last_category = lastCategory ?? existing.last_category;
              return { changes: 1, lastInsertRowid: existing.id as number };
            }
            const row: Row = {
              id: nextIdentityId++,
              org_id: orgId,
              name,
              norm_name: normNameVal,
              domain,
              website,
              country,
              last_category: lastCategory,
            };
            identities.push(row);
            return { changes: 1, lastInsertRowid: row.id as number };
          }

          // org_supplier_data upsert: ON CONFLICT (identity_id) DO UPDATE
          if (/insert\s+into\s+org_supplier_data/i.test(sql)) {
            const [identityId, orgId, aiScore] = params;
            const existing = orgData.find((r) => r.identity_id === identityId);
            if (existing) {
              existing.ai_score = aiScore;
              return { changes: 1, lastInsertRowid: existing.id as number };
            }
            const row: Row = {
              id: nextOrgDataId++,
              identity_id: identityId,
              org_id: orgId,
              enrichment: null,
              ai_score: aiScore,
              notes: null,
              rating: null,
            };
            orgData.push(row);
            return { changes: 1, lastInsertRowid: row.id as number };
          }

          // org_supplier_data manual field updates (used directly by tests to
          // simulate buyer-entered notes/rating, mirroring the two-org test
          // design in RESEARCH.md).
          if (/^\s*update\s+org_supplier_data\s+set\s+notes/i.test(sql)) {
            const [notes, rating, identityId] = params;
            const row = orgData.find((r) => r.identity_id === identityId);
            if (row) {
              row.notes = notes;
              row.rating = rating;
            }
            return { changes: row ? 1 : 0, lastInsertRowid: undefined };
          }

          if (/^\s*update\s+org_supplier_data\s+set\s+enrichment/i.test(sql)) {
            const [enrichment, identityId] = params;
            const row = orgData.find((r) => r.identity_id === identityId);
            if (row) row.enrichment = enrichment;
            return { changes: row ? 1 : 0, lastInsertRowid: undefined };
          }

          // updateOrgSupplierDataRating: compound identity_id AND org_id
          // predicate (T-04-03) — unlike the enrichment/notes updates above,
          // this must NOT match on identity_id alone, so a mismatched org_id
          // (cross-tenant write attempt) is a genuine no-op (changes: 0).
          if (/^\s*update\s+org_supplier_data\s+set\s+rating/i.test(sql)) {
            const [rating, identityId, orgId] = params;
            const row = orgData.find((r) => r.identity_id === identityId && r.org_id === orgId);
            if (row) row.rating = rating;
            return { changes: row ? 1 : 0, lastInsertRowid: undefined };
          }

          return { changes: 0, lastInsertRowid: undefined };
        },
        async get() {
          return undefined;
        },
        async all(...params: unknown[]) {
          // findKnownSuppliers: SELECT ... FROM supplier_identities si LEFT
          // JOIN org_supplier_data osd ON osd.identity_id = si.id WHERE si.org_id = ?
          if (/from\s+supplier_identities\s+si/i.test(sql)) {
            const orgId = params[0];
            return identities
              .filter((si) => si.org_id === orgId)
              .map((si) => {
                const osd = orgData.find((r) => r.identity_id === si.id);
                return {
                  identity_id: si.id,
                  org_id: si.org_id,
                  name: si.name,
                  norm_name: si.norm_name,
                  domain: si.domain,
                  website: si.website,
                  country: si.country,
                  last_category: si.last_category,
                  enrichment: osd?.enrichment ?? null,
                  ai_score: osd?.ai_score ?? null,
                  notes: osd?.notes ?? null,
                  rating: osd?.rating ?? null,
                };
              });
          }
          // Plain "SELECT * FROM supplier_identities" (structural isolation test).
          if (/select\s+\*\s+from\s+supplier_identities/i.test(sql)) {
            return identities;
          }
          return [];
        },
      };
    },
  };
  return db as unknown as Db;
}

describe("lib/supplier-repository", () => {
  it("REPO-01: a supplier persisted via upsert helpers is retrievable via findKnownSuppliers, and survives a second read (no event-lifecycle side effect between reads)", async () => {
    const db = fakeRepositoryDb();
    const identityId = await upsertSupplierIdentity(db, {
      orgId: 1,
      name: "Acme Corp",
      website: "https://acme.example",
      country: "Italy",
      categoryLabel: "Precision Machining & CNC",
    });
    await upsertOrgSupplierData(db, { identityId, orgId: 1, aiScore: 88 });

    const firstRead = await findKnownSuppliers(db, 1);
    expect(firstRead).toHaveLength(1);
    expect(firstRead[0].name).toBe("Acme Corp");

    // Re-query without any event-lifecycle side effect between the two reads —
    // proves persistence survives across "events" (nothing here resets state).
    const secondRead = await findKnownSuppliers(db, 1);
    expect(secondRead).toHaveLength(1);
    expect(secondRead[0].name).toBe("Acme Corp");
  });

  it("REPO-03: upserting the exact same (orgId, name, website) twice produces exactly one row", async () => {
    const db = fakeRepositoryDb();
    await upsertSupplierIdentity(db, {
      orgId: 1,
      name: "Acme Corp",
      website: "https://acme.example",
      country: "Italy",
      categoryLabel: "Precision Machining & CNC",
    });
    await upsertSupplierIdentity(db, {
      orgId: 1,
      name: "Acme Corp",
      website: "https://acme.example",
      country: "Italy",
      categoryLabel: "Precision Machining & CNC",
    });

    const rows = (db as unknown as { identities: Record<string, unknown>[] }).identities;
    expect(rows.filter((r) => r.org_id === 1).length).toBe(1);
  });

  it("REPO-03 adjacency: 'Acme Corp' then 'Acme Corporation' (both normName-collapse to the same norm_name) produce exactly one row", async () => {
    const db = fakeRepositoryDb();
    await upsertSupplierIdentity(db, {
      orgId: 1,
      name: "Acme Corp",
      website: null,
      country: null,
      categoryLabel: null,
    });
    await upsertSupplierIdentity(db, {
      orgId: 1,
      name: "Acme Corporation",
      website: null,
      country: null,
      categoryLabel: null,
    });

    const rows = (db as unknown as { identities: Record<string, unknown>[] }).identities;
    expect(rows.filter((r) => r.org_id === 1).length).toBe(1);
    // Most-recent-wins per RESEARCH.md Open Question 2.
    expect(rows[0].name).toBe("Acme Corporation");
  });

  it("REPO-04: a query scoped to org A never returns org B's private fields, even when both orgs independently discovered a same-named supplier (two-org isolation)", async () => {
    const db = fakeRepositoryDb();

    const idA = await upsertSupplierIdentity(db, {
      orgId: 1,
      name: "Acme Corp",
      website: "https://acme.example",
      country: "Italy",
      categoryLabel: "Precision Machining & CNC",
    });
    await upsertOrgSupplierData(db, { identityId: idA, orgId: 1, aiScore: 90 });
    await db
      .prepare(`UPDATE org_supplier_data SET notes=?, rating=? WHERE identity_id=?`)
      .run("Org A confidential", 5, idA);

    const idB = await upsertSupplierIdentity(db, {
      orgId: 2,
      name: "Acme Corp",
      website: "https://acme.example",
      country: "Italy",
      categoryLabel: "Precision Machining & CNC",
    });
    await upsertOrgSupplierData(db, { identityId: idB, orgId: 2, aiScore: 40 });
    await db
      .prepare(`UPDATE org_supplier_data SET notes=?, rating=? WHERE identity_id=?`)
      .run("Org B confidential", 2, idB);

    // REPO-06: never merges across orgs.
    expect(idA).not.toBe(idB);

    const resultsForOrgA = await findKnownSuppliers(db, 1);
    expect(resultsForOrgA).toHaveLength(1);
    expect(resultsForOrgA[0].ai_score).toBe(90);
    expect(resultsForOrgA[0].notes).toBe("Org A confidential");
    expect(resultsForOrgA[0].rating).toBe(5);
    expect(JSON.stringify(resultsForOrgA)).not.toContain("Org B confidential");
    expect(JSON.stringify(resultsForOrgA)).not.toContain("40");
    // Rating "2" as a bare number is a fragile substring check (matches many
    // things); assert directly on the field instead — no row for org A ever
    // carries org B's rating value.
    expect(resultsForOrgA.some((r) => r.rating === 2)).toBe(false);

    const resultsForOrgB = await findKnownSuppliers(db, 2);
    expect(resultsForOrgB).toHaveLength(1);
    expect(resultsForOrgB[0].ai_score).toBe(40);
    expect(resultsForOrgB[0].notes).toBe("Org B confidential");
    expect(resultsForOrgB[0].rating).toBe(2);
    expect(JSON.stringify(resultsForOrgB)).not.toContain("Org A confidential");
    expect(JSON.stringify(resultsForOrgB)).not.toContain("90");
    expect(resultsForOrgB.some((r) => r.rating === 5)).toBe(false);
  });

  it("REPO-04 structural isolation: a SELECT * FROM supplier_identities row has no enrichment/ai_score/notes/rating keys", async () => {
    const db = fakeRepositoryDb();
    await upsertSupplierIdentity(db, {
      orgId: 1,
      name: "Acme Corp",
      website: null,
      country: null,
      categoryLabel: null,
    });

    const rows = await db.prepare(`SELECT * FROM supplier_identities`).all();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const keys = Object.keys(row as Record<string, unknown>);
      expect(keys.filter((k) => ["enrichment", "ai_score", "notes", "rating"].includes(k)).length).toBe(0);
    }
  });

  it("best-effort failure: if the identity upsert throws, callers can catch it without corrupting other state", async () => {
    const db = fakeRepositoryDb({ throwOnIdentityInsert: true });
    let threw = false;
    try {
      await upsertSupplierIdentity(db, {
        orgId: 1,
        name: "Acme Corp",
        website: null,
        country: null,
        categoryLabel: null,
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    const results = await findKnownSuppliers(db, 1);
    expect(results).toHaveLength(0);
  });

  it("REPO-01 idempotency edge: calling upsertSupplierIdentity twice back-to-back with identical arguments produces exactly one row", async () => {
    const db = fakeRepositoryDb();
    const params = {
      orgId: 1,
      name: "Acme Corp",
      website: "https://acme.example",
      country: "Italy",
      categoryLabel: "Precision Machining & CNC",
    };
    await upsertSupplierIdentity(db, params);
    await upsertSupplierIdentity(db, params);

    const rows = (db as unknown as { identities: Record<string, unknown>[] }).identities;
    expect(rows.length).toBe(1);
  });

  it("REPO-03 empty-name edge: names that normalize to '' never collide with each other (partial index WHERE norm_name <> '')", async () => {
    const db = fakeRepositoryDb();
    await upsertSupplierIdentity(db, {
      orgId: 1,
      name: "!!!",
      website: null,
      country: null,
      categoryLabel: null,
    });
    await upsertSupplierIdentity(db, {
      orgId: 1,
      name: "???",
      website: null,
      country: null,
      categoryLabel: null,
    });

    const rows = (db as unknown as { identities: Record<string, unknown>[] }).identities;
    expect(rows.filter((r) => r.org_id === 1 && r.norm_name === "").length).toBe(2);
  });

  it("REPO-01/03 concurrency edge: two parallel upserts with the same (orgId, name) produce exactly one row", async () => {
    const db = fakeRepositoryDb();
    const params = {
      orgId: 1,
      name: "Acme Corp",
      website: "https://acme.example",
      country: "Italy",
      categoryLabel: "Precision Machining & CNC",
    };
    await Promise.all([upsertSupplierIdentity(db, params), upsertSupplierIdentity(db, params)]);

    const rows = (db as unknown as { identities: Record<string, unknown>[] }).identities;
    expect(rows.filter((r) => r.org_id === 1).length).toBe(1);
  });
});

describe("REPO-05 matching heuristic", () => {
  it("M1: category exact match + geography match returns true", () => {
    expect(
      repositoryEntryMatchesEvent(
        { country: "IT", last_category: "Precision Machining & CNC" },
        "Precision Machining & CNC",
        "IT, DE",
      ),
    ).toBe(true);
  });

  it("M2: category mismatch returns false", () => {
    expect(
      repositoryEntryMatchesEvent(
        { country: "IT", last_category: "Textiles" },
        "Precision Machining & CNC",
        "IT",
      ),
    ).toBe(false);
  });

  it("M3: geography mismatch returns false", () => {
    expect(
      repositoryEntryMatchesEvent(
        { country: "US", last_category: "Precision Machining & CNC" },
        "Precision Machining & CNC",
        "IT, DE",
      ),
    ).toBe(false);
  });

  it("M4: permissive null category returns true (open match)", () => {
    expect(
      repositoryEntryMatchesEvent(
        { country: "IT", last_category: null },
        "Precision Machining & CNC",
        "IT",
      ),
    ).toBe(true);
  });

  it("M5: global — empty target_countries matches any country", () => {
    expect(
      repositoryEntryMatchesEvent(
        { country: "IT", last_category: "Precision Machining & CNC" },
        "Precision Machining & CNC",
        "",
      ),
    ).toBe(true);
  });

  it("M6: case-insensitive category match", () => {
    expect(
      repositoryEntryMatchesEvent(
        { country: "it", last_category: "PRECISION MACHINING & CNC" },
        "precision machining & cnc",
        "IT",
      ),
    ).toBe(true);
  });

  it("M7: whitespace tolerance in target_countries", () => {
    expect(
      repositoryEntryMatchesEvent(
        { country: "IT", last_category: "Textiles" },
        "Textiles",
        "  it , de ",
      ),
    ).toBe(true);
  });

  it("M8: AND semantics — same-country wrong-industry does NOT match", () => {
    expect(
      repositoryEntryMatchesEvent(
        { country: "IT", last_category: "Textiles" },
        "Precision Machining & CNC",
        "IT",
      ),
    ).toBe(false);
  });

  it("M9: null entry country + empty target_countries (global) matches", () => {
    expect(
      repositoryEntryMatchesEvent(
        { country: null, last_category: "Textiles" },
        "Textiles",
        "",
      ),
    ).toBe(true);
  });

  it("M10: null entry country + specific target_countries does NOT match (under-match safer than over-match)", () => {
    expect(
      repositoryEntryMatchesEvent(
        { country: null, last_category: "Textiles" },
        "Textiles",
        "IT",
      ),
    ).toBe(false);
  });
});

describe("REPO-05 pre-search integration shape", () => {
  it("R1: findKnownSuppliers + repositoryEntryMatchesEvent filters to only category+geography matches", async () => {
    const db = fakeRepositoryDb();
    const idTextilesIT1 = await upsertSupplierIdentity(db, {
      orgId: 1,
      name: "Filati Rossi Srl",
      website: null,
      country: "IT",
      categoryLabel: "Textiles",
    });
    const idTextilesIT2 = await upsertSupplierIdentity(db, {
      orgId: 1,
      name: "Tessuti Bianchi SpA",
      website: null,
      country: "IT",
      categoryLabel: "Textiles",
    });
    await upsertSupplierIdentity(db, {
      orgId: 1,
      name: "Auto Parts GmbH",
      website: null,
      country: "IT",
      categoryLabel: "Automotive",
    });

    const knownSuppliers = await findKnownSuppliers(db, 1);
    const relevantKnown = knownSuppliers.filter((s: RepositoryEntry) =>
      repositoryEntryMatchesEvent(s, "Textiles", "IT"),
    );

    expect(relevantKnown).toHaveLength(2);
    const ids = relevantKnown.map((s) => s.identity_id).sort();
    expect(ids).toEqual([idTextilesIT1, idTextilesIT2].sort());
  });

  it("R2: empty repository returns [] and does not throw", async () => {
    const db = fakeRepositoryDb();
    const knownSuppliers = await findKnownSuppliers(db, 1);
    const relevantKnown = knownSuppliers.filter((s: RepositoryEntry) =>
      repositoryEntryMatchesEvent(s, "Textiles", "IT"),
    );
    expect(relevantKnown).toEqual([]);
  });
});

describe("updateOrgSupplierDataRating (Phase 4, RATE-01/02/03)", () => {
  it("writes a rating (1-5) onto the org_supplier_data row scoped to (identityId, orgId)", async () => {
    const db = fakeRepositoryDb();
    const identityId = await upsertSupplierIdentity(db, {
      orgId: 1,
      name: "Acme Corp",
      website: "https://acme.example",
      country: "Italy",
      categoryLabel: "Precision Machining & CNC",
    });
    await upsertOrgSupplierData(db, { identityId, orgId: 1, aiScore: 88 });

    await updateOrgSupplierDataRating(db, { identityId, orgId: 1, rating: 4 });

    const results = await findKnownSuppliers(db, 1);
    expect(results).toHaveLength(1);
    expect(results[0].rating).toBe(4);
  });

  it("clears a rating back to null (toggle-to-clear)", async () => {
    const db = fakeRepositoryDb();
    const identityId = await upsertSupplierIdentity(db, {
      orgId: 1,
      name: "Acme Corp",
      website: "https://acme.example",
      country: "Italy",
      categoryLabel: "Precision Machining & CNC",
    });
    await upsertOrgSupplierData(db, { identityId, orgId: 1, aiScore: 88 });
    await updateOrgSupplierDataRating(db, { identityId, orgId: 1, rating: 3 });

    await updateOrgSupplierDataRating(db, { identityId, orgId: 1, rating: null });

    const results = await findKnownSuppliers(db, 1);
    expect(results[0].rating).toBeNull();
  });

  it("cross-org isolation: org A's rating write never appears on org B's identical-named supplier", async () => {
    const db = fakeRepositoryDb();
    const idA = await upsertSupplierIdentity(db, {
      orgId: 1,
      name: "Acme Corp",
      website: "https://acme.example",
      country: "Italy",
      categoryLabel: "Precision Machining & CNC",
    });
    await upsertOrgSupplierData(db, { identityId: idA, orgId: 1, aiScore: 90 });

    const idB = await upsertSupplierIdentity(db, {
      orgId: 2,
      name: "Acme Corp",
      website: "https://acme.example",
      country: "Italy",
      categoryLabel: "Precision Machining & CNC",
    });
    await upsertOrgSupplierData(db, { identityId: idB, orgId: 2, aiScore: 40 });

    await updateOrgSupplierDataRating(db, { identityId: idA, orgId: 1, rating: 5 });

    const resultsForOrgB = await findKnownSuppliers(db, 2);
    expect(resultsForOrgB[0].rating).toBeNull();
  });

  it("mismatched org_id (cross-tenant write attempt on a real identity_id) is a genuine no-op", async () => {
    const db = fakeRepositoryDb();
    const identityId = await upsertSupplierIdentity(db, {
      orgId: 1,
      name: "Acme Corp",
      website: "https://acme.example",
      country: "Italy",
      categoryLabel: "Precision Machining & CNC",
    });
    await upsertOrgSupplierData(db, { identityId, orgId: 1, aiScore: 88 });

    // Attempt to write using the correct identity_id but the WRONG org_id —
    // must not match (compound predicate), so nothing is written.
    await updateOrgSupplierDataRating(db, { identityId, orgId: 999, rating: 5 });

    const results = await findKnownSuppliers(db, 1);
    expect(results[0].rating).toBeNull();
  });
});
