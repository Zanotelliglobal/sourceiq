// ─── PERSISTENT SUPPLIER REPOSITORY (Phase 3) ─────────────────────────────────
// Org-scoped supplier identity store that survives across events, separate
// from the per-event `suppliers` table. Two tables split for structural
// per-org isolation (D-01, REPO-04):
//   - supplier_identities: shared/public identity fields (name, domain,
//     country, website) — the dedup key.
//   - org_supplier_data:   org-private fields (enrichment, ai_score, notes,
//     rating) — a query scoped to supplier_identities alone structurally
//     cannot expose these; they are not columns on that table.
//
// Every write is a single-statement `INSERT ... ON CONFLICT ... DO UPDATE`
// (Neon HTTP driver forbids multi-statement transactions — see lib/db.ts).
// Every read takes `orgId` as a mandatory, non-optional parameter and filters
// `WHERE org_id = ?` directly, mirroring lib/tenant.ts's existing tenancy
// conventions (getOwnedEvent/orgOwnsEvent/orgOwnsSupplier).

import { getDb } from "@/lib/db";
import { normName, domainOf } from "@/lib/dedup";

export type Db = ReturnType<typeof getDb>;

export type UpsertIdentityParams = {
  orgId: number;
  name: string;
  website: string | null | undefined;
  country: string | null | undefined;
  categoryLabel: string | null | undefined;
};

export type UpsertOrgDataParams = {
  identityId: number;
  orgId: number;
  aiScore: number | null;
};

export type RepositoryEntry = {
  identity_id: number;
  org_id: number;
  name: string;
  norm_name: string;
  domain: string | null;
  website: string | null;
  country: string | null;
  last_category: string | null;
  enrichment: string | null;
  ai_score: number | null;
  notes: string | null;
  rating: number | null;
};

/**
 * Upsert a supplier identity, deduping on `(org_id, norm_name)` via
 * `normName()` (D-03 — reused, never reimplemented). Most-recent-wins on
 * `name`/`domain`/`website`/`country`/`last_category` (COALESCE keeps the
 * prior value when the new one is null, so a later write with less info
 * never blanks out a field a previous write had already populated).
 *
 * Never touches `notes`/`rating` — those are buyer-owned fields (Phase 4
 * RATE-01/02) that a re-discovery must never clobber.
 */
export async function upsertSupplierIdentity(
  db: Db,
  params: UpsertIdentityParams
): Promise<number> {
  const normNameValue = normName(params.name);
  const domain = domainOf(params.website) || null;
  const result = await db
    .prepare(
      `INSERT INTO supplier_identities (org_id, name, norm_name, domain, website, country, last_category)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (org_id, norm_name) DO UPDATE SET
         name = EXCLUDED.name,
         domain = COALESCE(EXCLUDED.domain, supplier_identities.domain),
         website = COALESCE(EXCLUDED.website, supplier_identities.website),
         country = COALESCE(EXCLUDED.country, supplier_identities.country),
         last_category = COALESCE(EXCLUDED.last_category, supplier_identities.last_category),
         updated_at = now()`
    )
    .run(
      params.orgId,
      params.name,
      normNameValue,
      domain,
      params.website || null,
      params.country || null,
      params.categoryLabel || null
    );
  return Number(result.lastInsertRowid);
}

/**
 * Upsert the org-private ai_score for an identity, deduping on `identity_id`
 * (1:1 with an identity row within its org). Never touches
 * `enrichment`/`notes`/`rating` in the SET clause — enrichment is written a
 * second time later (see updateOrgSupplierDataEnrichment), and notes/rating
 * are buyer-owned (Phase 4).
 */
export async function upsertOrgSupplierData(
  db: Db,
  params: UpsertOrgDataParams
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO org_supplier_data (identity_id, org_id, ai_score)
       VALUES (?, ?, ?)
       ON CONFLICT (identity_id) DO UPDATE SET
         ai_score = EXCLUDED.ai_score,
         updated_at = now()`
    )
    .run(params.identityId, params.orgId, params.aiScore);
}

/**
 * Mirror an asynchronously-resolved enrichment value into the org-private
 * table. Called from inside the existing `enrichTask` background closure
 * (see lib/process-supplier.ts) — `enrichment` resolves off the critical
 * path, after the initial upsertOrgSupplierData call above.
 */
export async function updateOrgSupplierDataEnrichment(
  db: Db,
  params: { identityId: number; enrichmentJson: string }
): Promise<void> {
  await db
    .prepare(`UPDATE org_supplier_data SET enrichment=?, updated_at=now() WHERE identity_id=?`)
    .run(params.enrichmentJson, params.identityId);
}

/**
 * Read every known supplier identity for an org, LEFT JOINed with its
 * org-private data. `orgId` is a MANDATORY, non-optional parameter — the
 * sole client-visible tenancy predicate for these tables (V4 Access Control,
 * RESEARCH.md Security Domain). LEFT JOIN (not INNER) per Pitfall 4: an
 * orphaned identity row from a partial write (identity upsert succeeded,
 * org-private upsert failed) still surfaces, with private fields coalesced
 * to null, rather than silently vanishing from the pre-search check.
 */
export async function findKnownSuppliers(db: Db, orgId: number): Promise<RepositoryEntry[]> {
  return db
    .prepare(
      `SELECT si.id AS identity_id, si.org_id, si.name, si.norm_name, si.domain, si.website,
              si.country, si.last_category, osd.enrichment, osd.ai_score, osd.notes, osd.rating
       FROM supplier_identities si
       LEFT JOIN org_supplier_data osd ON osd.identity_id = si.id
       WHERE si.org_id = ?`
    )
    .all<RepositoryEntry>(orgId);
}

// ─── REPO-05 Matching Heuristic (D-04, Claude's Discretion per 03-CONTEXT.md) ───
// See 03-RESEARCH.md 'REPO-05 Matching Heuristic' for full rationale.
// Category vocabulary is the fixed 13-item list client-side in
// app/events/new/page.tsx CATEGORIES; not server-enforced, so
// case-insensitive trim-normalized exact match is both sufficient and honest.
export function normCategory(c: string | null | undefined): string {
  return (c || "").trim().toLowerCase();
}

// target_countries is stored as comma-joined free text; no controlled vocab.
export function parseTargetCountries(targetCountries: string | null | undefined): string[] {
  return (targetCountries || "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

export function repositoryEntryMatchesEvent(
  entry: { country: string | null; last_category: string | null },
  eventCategory: string,
  eventTargetCountries: string | null | undefined,
): boolean {
  // Category: null entry.last_category = open match (never seen under a
  // category before, don't exclude); otherwise case-insensitive equality.
  const categoryMatch =
    !entry.last_category ||
    normCategory(entry.last_category) === normCategory(eventCategory);

  // Geography: empty target_countries = global (match any); otherwise
  // entry.country must be present and appear in the target list.
  const targets = parseTargetCountries(eventTargetCountries);
  const geoMatch =
    targets.length === 0 ||
    (!!entry.country && targets.includes(entry.country.trim().toLowerCase()));

  // AND semantics — same-country wrong-industry supplier does NOT match.
  return categoryMatch && geoMatch;
}
