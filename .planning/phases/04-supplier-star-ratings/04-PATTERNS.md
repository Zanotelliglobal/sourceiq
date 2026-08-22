# Phase 4: Supplier Star Ratings - Pattern Map

**Mapped:** 2026-08-21
**Files analyzed:** 7 (all modified, no new files)
**Analogs found:** 7 / 7 (all in-file — every "analog" is an adjacent block in the same file being modified)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `lib/db.ts` | config/migration (schema DDL) | CRUD (schema evolution) | same file — existing `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ...` block (lines ~250-290) | exact |
| `lib/process-supplier.ts` (3 factories) | service | event-driven (best-effort side-effect write) | same file — existing repository-upsert `try {} catch {}` blocks in `makeProcessSupplier` (~177-191), `makeProcessSupplierQuick` (~316-330), `makeProcessSupplierDeepen` (~407-421) | exact |
| `lib/supplier-repository.ts` (`updateOrgSupplierDataRating`) | service (repository helper) | CRUD | same file — `updateOrgSupplierDataEnrichment` (lines 119-126) | exact |
| `app/api/qualify/route.ts` (`set_rating` action) | route/controller | request-response | same file — `set_feedback` action (lines ~76-87) | exact |
| `app/api/sourcing-events/[id]/route.ts` (GET query) | route/controller | request-response (read/JOIN) | same file — existing `SELECT * FROM suppliers WHERE event_id = ?` query (lines 21-23) | exact |
| `app/events/[id]/page.tsx` (`setRating` handler + star UI) | component/hook (client) | request-response (optimistic update) | same file — `setFeedback` handler (lines 1855-1871) + thumbs toggle UI (lines 390-423) | exact |
| `tests/supplier-repository.test.ts` / `tests/process-supplier.test.ts` | test | CRUD (unit, fake-DB) | same file — existing fake-DB regex-matcher pattern (`tests/supplier-repository.test.ts:1-90`) | exact |

All seven files already contain a directly-analogous pattern for the exact same role/data-flow combination — no external file had to be searched, since `feedback_signal`, `ai_score`/`enrichment`, and the identity-upsert side effect are pre-existing near-identical features in this exact codebase. No "no analog" entries.

## Pattern Assignments

### `lib/db.ts` — add `suppliers.identity_id` column

**Analog:** same file, existing ALTER-pattern block, e.g. `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS opted_out BOOLEAN NOT NULL DEFAULT false;` (~line 251) and the block of `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS feedback_signal SMALLINT;` / `feedback_updated_at TIMESTAMPTZ;` (~lines 279-280).

**Core pattern — incremental schema evolution** (verbatim style to copy):
```typescript
// Lightweight answer-quality signal (#46 — chat/UX polish bundle 1): a
// thumbs up/down on the AI's qualification for a supplier, mirroring the
// single-column + timestamp pattern used for opted_out above rather than a
// separate audit table (fine for a v1 quality signal, not a legal record).
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS feedback_signal SMALLINT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS feedback_updated_at TIMESTAMPTZ;
```

**Required placement for the new column:** `CREATE TABLE IF NOT EXISTS suppliers` is defined at line 221 (before `supplier_identities` at line 315). Per RESEARCH.md's Assumption A2, add:
```sql
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS identity_id BIGINT;
```
directly AFTER the `org_supplier_data` `CREATE TABLE` block (after line 343) — no inline `REFERENCES` clause at that point (table-creation-order safe, no dependency on statement order). Comment style to mirror (from the `supplier_identities`/`org_supplier_data` block comment already in the file):
```typescript
// Persistent Supplier Repository (Phase 3). Two tables split for structural
// per-org isolation: ...
```

**org_supplier_data.rating** already exists — verified at line ~340:
```sql
CREATE TABLE IF NOT EXISTS org_supplier_data (
  id            BIGSERIAL PRIMARY KEY,
  identity_id   BIGINT NOT NULL REFERENCES supplier_identities(id) ON DELETE CASCADE,
  org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  enrichment    TEXT,
  ai_score      INTEGER,
  notes         TEXT,
  rating        SMALLINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
No change needed here — do not re-add `rating`.

---

### `lib/process-supplier.ts` — write `identity_id` onto `suppliers` in all 3 factories

**Analog:** same file, the existing best-effort repository-upsert block, `makeProcessSupplier` (~lines 173-191):
```typescript
// Repository upsert (Phase 3 REPO-01/02/03/04). Best-effort, non-blocking:
// failure here must NEVER throw into the per-event suppliers.INSERT
// critical path above. Neon HTTP driver forbids multi-statement
// transactions, so identity + org-private are two independent round trips
// — self-healing on retry (next discovery of same supplier will re-upsert).
let identityId: number | null = null;
try {
  identityId = await upsertSupplierIdentity(deps.db, {
    orgId: deps.orgId,
    name: s.name,
    website: s.website,
    country: s.country,
    categoryLabel: deps.categoryLabel,
  });
  await upsertOrgSupplierData(deps.db, {
    identityId,
    orgId: deps.orgId,
    aiScore: score.overall_score,
  });
} catch { /* best-effort — repository write failure never blocks per-event flow */ }
```

**Required extension** (append inside the same `try` block, after `identityId`/`identityIdDeepen` resolves, in all 3 factories):
```typescript
if (identityId !== null) {
  try {
    await deps.db.prepare(`UPDATE suppliers SET identity_id=? WHERE id=?`).run(identityId, supplierId);
  } catch { /* best-effort — identity_id linkage failure never blocks the supplier row */ }
}
```
Note this is a SEPARATE inner try (own statement) — do not fold it into the same statement as the repository upsert (single-statement rule, Pitfall 4). `supplierId` is already in scope: `makeProcessSupplier` assigns it from `result.lastInsertRowid` at line 168 (before this block); `makeProcessSupplierQuick` likewise at line 313; `makeProcessSupplierDeepen` receives it as its own parameter (line 358).

**Quick-scan variant** (`makeProcessSupplierQuick`, ~lines 316-330) — same shape, `categoryLabel: null`, `aiScore: null`:
```typescript
try {
  const identityId = await upsertSupplierIdentity(deps.db, {
    orgId: deps.orgId,
    name: candidate.name,
    website: candidate.website,
    country: candidate.country,
    categoryLabel: null,
  });
  await upsertOrgSupplierData(deps.db, { identityId, orgId: deps.orgId, aiScore: null });
} catch { /* best-effort */ }
```
Add the same `identity_id`-write inner block here too (variable name `identityId` already local to this try).

**Deepen variant** (`makeProcessSupplierDeepen`, ~lines 407-421) uses `identityIdDeepen` as its local variable name — extend with the same pattern, substituting `identityIdDeepen` for `identityId`.

---

### `lib/supplier-repository.ts` — add `updateOrgSupplierDataRating()`

**Analog:** same file, `updateOrgSupplierDataEnrichment` (lines 119-126):
```typescript
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
```

**New function to add (place directly after `updateOrgSupplierDataEnrichment`), with the compound `org_id` scope per Pitfall 3 (defense-in-depth beyond `identity_id`'s UNIQUE index):**
```typescript
/**
 * Upsert the org-private star rating for an identity (Phase 4 RATE-01/02).
 * Scoped by identity_id AND org_id (defense-in-depth beyond the identity_id
 * unique index — see 04-RESEARCH.md Pitfall 3). `rating` is null to clear
 * (D-07 toggle-off).
 */
export async function updateOrgSupplierDataRating(
  db: Db,
  params: { identityId: number; orgId: number; rating: number | null }
): Promise<void> {
  await db
    .prepare(`UPDATE org_supplier_data SET rating=?, updated_at=now() WHERE identity_id=? AND org_id=?`)
    .run(params.rating, params.identityId, params.orgId);
}
```

**Header comment convention** (file top, lines 1-16) — this module's docblock already documents the two-table split and mandatory `orgId` parameter convention; no changes needed there, but new JSDoc on the new function should match the terse one-line-summary + rationale style seen throughout (`upsertOrgSupplierData`, `updateOrgSupplierDataEnrichment`, `findKnownSuppliers`).

---

### `app/api/qualify/route.ts` — add `set_rating` action

**Analog:** same file, `set_feedback` action (lines 76-87):
```typescript
// Lightweight quality signal on a supplier's AI assessment (#46). -1/0/1;
// 0 means "cleared" (re-clicking an active thumb toggles it off client-side).
if (action === "set_feedback") {
  if (!supplier_id) return NextResponse.json({ error: "supplier_id required" }, { status: 400 });
  const signal = body.signal;
  if (signal !== -1 && signal !== 0 && signal !== 1) {
    return NextResponse.json({ error: "signal must be -1, 0, or 1" }, { status: 400 });
  }
  await db.prepare(
    "UPDATE suppliers SET feedback_signal = ?, feedback_updated_at = datetime('now') WHERE id = ?"
  ).run(signal, supplier_id);
  return NextResponse.json({ success: true });
}
```
Tenant check already runs above both branches: `orgOwnsSupplier(ctx.orgId, supplier_id)` at line ~33.

**New branch to add** (place adjacent to `set_feedback`, after it):
```typescript
if (action === "set_rating") {
  if (!supplier_id) return NextResponse.json({ error: "supplier_id required" }, { status: 400 });
  const rating = body.rating;
  if (rating !== null && (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return NextResponse.json({ error: "rating must be an integer 1-5, or null to clear" }, { status: 400 });
  }
  const row = await db.prepare("SELECT identity_id FROM suppliers WHERE id = ?").get(supplier_id) as
    { identity_id: number | null } | undefined;
  if (!row?.identity_id) {
    return NextResponse.json({ error: "Rating unavailable for this supplier" }, { status: 400 });
  }
  await updateOrgSupplierDataRating(db, { identityId: row.identity_id, orgId: ctx.orgId, rating });
  return NextResponse.json({ success: true });
}
```

**Imports pattern** (top of file, lines 1-11) — new import to add alongside the existing `@/lib/*` group:
```typescript
import { updateOrgSupplierDataRating } from "@/lib/supplier-repository";
```

**Anti-pattern warning** (do not deviate): never accept `identity_id` directly from the request body — always resolve it server-side via `SELECT identity_id FROM suppliers WHERE id = ?` on the already-tenant-checked `supplier_id`.

---

### `app/api/sourcing-events/[id]/route.ts` — LEFT JOIN `org_supplier_data` into GET

**Analog:** same file, existing supplier-list query (lines 21-23):
```typescript
const suppliers = await db.prepare(
  "SELECT * FROM suppliers WHERE event_id = ? ORDER BY ai_score DESC, created_at ASC"
).all(id) as Record<string, unknown>[];
```

**Required change:**
```typescript
const suppliers = await db.prepare(
  `SELECT s.*, osd.rating AS rating
   FROM suppliers s
   LEFT JOIN org_supplier_data osd ON osd.identity_id = s.identity_id AND osd.org_id = ?
   WHERE s.event_id = ?
   ORDER BY s.ai_score DESC, s.created_at ASC`
).all(ctx.orgId, id) as Record<string, unknown>[];
```
`ctx.orgId` is already bound at line 12-13 of this file (`getOrgContext()`), no new context resolution needed. Positional `?` order: `org_id` param first (matches first `?` occurrence in the SQL text, left-to-right per this wrapper's normalization, `lib/db.ts:20-21`).

---

### `app/events/[id]/page.tsx` — client `Supplier` type, `setRating` handler, star control in `DetailPanel`

**Analog 1 — client type** (lines 20-39): add two fields alongside `feedback_signal: number | null;`:
```typescript
identity_id: number | null;
rating: number | null;
```

**Analog 2 — optimistic handler** (`setFeedback`, lines 1853-1871):
```typescript
async function setFeedback(supplierId: number, signal: number) {
  const prev = suppliers.find(s => s.id === supplierId)?.feedback_signal ?? null;
  setSuppliers(p => p.map(s => s.id === supplierId ? { ...s, feedback_signal: signal } : s));
  if (selected?.id === supplierId) setSelected(s => s ? { ...s, feedback_signal: signal } : s);
  try {
    const res = await fetch("/api/qualify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_feedback", supplier_id: supplierId, signal }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    setSuppliers(p => p.map(s => s.id === supplierId ? { ...s, feedback_signal: prev } : s));
    if (selected?.id === supplierId) setSelected(s => s ? { ...s, feedback_signal: prev } : s);
    addLog(`ERR could not save feedback: ${String(err)}`);
    pushToast("error", t("Could not save feedback. Please try again."));
  }
}
```

**New handler to add (adjacent to `setFeedback`):**
```typescript
async function setRating(supplierId: number, rating: number | null) {
  const prev = suppliers.find(s => s.id === supplierId)?.rating ?? null;
  setSuppliers(p => p.map(s => s.id === supplierId ? { ...s, rating } : s));
  if (selected?.id === supplierId) setSelected(s => s ? { ...s, rating } : s);
  try {
    const res = await fetch("/api/qualify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_rating", supplier_id: supplierId, rating }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    setSuppliers(p => p.map(s => s.id === supplierId ? { ...s, rating: prev } : s));
    if (selected?.id === supplierId) setSelected(s => s ? { ...s, rating: prev } : s);
    addLog(`ERR could not save rating: ${String(err)}`);
    pushToast("error", t("Could not save rating. Please try again."));
  }
}
```

**Analog 3 — `DetailPanel` signature + thumbs UI** (lines 197-215, 390-423):
```typescript
function DetailPanel({ supplier, onClose, onMove, onOutreach, onFollowUp, onFeedback }: {
  supplier: Supplier;
  onClose: () => void;
  onMove: (id: number, stage: string) => void;
  onOutreach: (s: Supplier) => void;
  onFollowUp: (s: Supplier) => void;
  onFeedback: (id: number, signal: number) => void;
}) {
```
Add `onRating: (id: number, rating: number | null) => void;` to this prop signature. At the invocation site (~line 2694-2701), add `onRating={setRating}`.

**Thumbs UI block to sit beside** (lines 390-423, inside `{supplier.score_rationale && (...)}`, note this is INSIDE a conditional gated on AI rationale):
```tsx
{/* AI Assessment */}
{supplier.score_rationale && (
  <div>
    <div className="flex items-center justify-between mb-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{t("AI Assessment")}</div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onFeedback(supplier.id, supplier.feedback_signal === 1 ? 0 : 1)}
          title={t("Good assessment")}
          aria-label={t("Good assessment")}
          aria-pressed={supplier.feedback_signal === 1}
          className={`p-1 rounded-md border transition-colors ${
            supplier.feedback_signal === 1
              ? "bg-emerald-50 border-emerald-200 text-emerald-600"
              : "border-transparent text-slate-500 hover:text-emerald-600 hover:bg-emerald-50"
          }`}
        >
          <ThumbsUp className="w-3.5 h-3.5" />
        </button>
        {/* ...ThumbsDown mirror... */}
      </div>
    </div>
    ...
  </div>
)}
```

**IMPORTANT (per Open Question 2 in RESEARCH.md, resolved): do NOT nest the new star block inside this `{supplier.score_rationale && (...)}` conditional** — render it as its OWN sibling block, gated instead on `supplier.identity_id !== null` (D-03), so quick-scan suppliers (which lack `score_rationale` but DO have `identity_id`) still get the rating control.

**New star-row block to add (per 04-UI-SPEC.md — authoritative over RESEARCH.md's illustrative `w-4 h-4` sizing):**
```tsx
{/* Star rating (Phase 4, RATE-01/02/03) — entirely separate field from
    feedback_signal (D-08). Hidden entirely when identity_id is null (D-03,
    all pre-Phase-4 rows) — no disabled/tooltip/loading state. */}
{supplier.identity_id !== null && (
  <div>
    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
      {t("Rating")}
    </div>
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={() => setRating(supplier.id, supplier.rating === n ? null : n)}
          aria-label={t("Rate {n} stars", { n })}
          aria-pressed={supplier.rating !== null && n <= supplier.rating}
          className="p-1 rounded-md border border-transparent transition-colors text-slate-300 hover:text-blue-600"
        >
          <Star
            className="w-3.5 h-3.5"
            fill={supplier.rating !== null && n <= supplier.rating ? "currentColor" : "none"}
            {...(supplier.rating !== null && n <= supplier.rating ? {} : {})}
          />
        </button>
      ))}
    </div>
  </div>
)}
```
Notes on UI-SPEC compliance (authoritative values — supersede RESEARCH.md's illustrative code):
- Icon size: `w-3.5 h-3.5` (14px), NOT `w-4 h-4` — matches the existing thumbs icon size exactly (page.tsx:408,421) and is deliberately distinct from the unrelated shortlist `Star` icon sizes (`w-4 h-4` / `w-2.5 h-2.5` / `w-3 h-3` at lines 567, 902, 2496).
- Gap between the 5 star buttons: `gap-1` (4px) — matches existing thumbs-button gap.
- Label-to-row gap: `mb-2` (8px) — matches "AI Assessment" label pattern.
- Filled star color: `text-blue-600` (`#2563EB`, Trust Blue) with `fill="currentColor"` — NOT amber (amber is reserved for the "Add to Short List" CTA in this same file).
- Unfilled star color: `text-slate-300`.
- Label copy: exactly `"Rating"`, routed through `t("Rating")`, same typography as `"AI Assessment"` header (`text-[10px] font-bold uppercase tracking-widest text-slate-500`).
- Per-star aria-label: `t("Rate {n} stars", { n })` for n = 1-5.
- No numeric fraction display (e.g. "4/5") — filled-star count + label alone is sufficient per UI-SPEC.
- Error toast copy: exactly `t("Could not save rating. Please try again.")` (already reflected in the `setRating` handler above).

**Existing `Star` icon collision sites to NOT touch** (D-05 context, confirm no accidental edits):
```typescript
// line 7 (import) — already includes Star, no import change needed
// line 567:  <Star className="w-4 h-4" /> {t("Add to Short List")}
// line 902:  <Star className="w-2.5 h-2.5" /> {t("Shortlist")}
// line 2496: <Star className="w-3 h-3" /> {t("Shortlist all responders ({n})", { n: stageCounts["responded"] })}
```

---

### `tests/supplier-repository.test.ts` / `tests/process-supplier.test.ts` — extend fake-DB unit tests

**Analog:** `tests/supplier-repository.test.ts` fake-DB regex-matcher (lines 1-40+):
```typescript
import { describe, it, expect } from "vitest";
import {
  upsertSupplierIdentity,
  upsertOrgSupplierData,
  findKnownSuppliers,
  repositoryEntryMatchesEvent,
  type Db,
  type RepositoryEntry,
} from "@/lib/supplier-repository";

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
          if (/insert\s+into\s+supplier_identities/i.test(sql)) {
            // ... regex-matched INSERT/UPDATE simulation
          }
          // ...
        },
      };
    },
  };
  return db as unknown as Db;
}
```

**Required extensions:**
1. Import `updateOrgSupplierDataRating` alongside the existing imports from `@/lib/supplier-repository`.
2. Add a new regex matcher branch in `fakeRepositoryDb().prepare()` for `/update\s+org_supplier_data\s+set\s+rating/i` that updates the in-memory `orgData` array's matching row's `rating` field, mirroring however the existing enrichment-update matcher is structured (search the file for the `updateOrgSupplierDataEnrichment` test/matcher, likely a sibling branch already present since that function predates this phase — reuse its exact `WHERE identity_id=?` matching shape and add the `AND org_id=?` predicate check).
3. New test cases per the RESEARCH.md Phase Requirements → Test Map: (a) writes rating 1-5 and null values correctly, (b) cross-org isolation — a rating write scoped to `identity_id X, org_id A` must NOT affect a row with the same `identity_id` but `org_id B` (mirror the existing org-isolation test pattern already used for `findKnownSuppliers`, via substring-negation assertions per STATE.md's noted convention).
4. In `tests/process-supplier.test.ts`, add an assertion per factory (`makeProcessSupplier`, `makeProcessSupplierQuick`, `makeProcessSupplierDeepen`) that the fake DB receives an `UPDATE suppliers SET identity_id=?` (or equivalent) call after the identity resolves — following whatever existing fake-DB assertion style that test file already uses for verifying `upsertSupplierIdentity`/`upsertOrgSupplierData` calls.

## Shared Patterns

### Best-effort, non-blocking repository writes
**Source:** `lib/process-supplier.ts`, all three factories' existing `try { ... } catch { /* best-effort */ }` blocks around `upsertSupplierIdentity`/`upsertOrgSupplierData`.
**Apply to:** The new `identity_id` back-write in all three factories — must be its own nested `try/catch`, never allowed to throw into the per-event `suppliers` INSERT/UPDATE critical path.
```typescript
if (identityId !== null) {
  try {
    await deps.db.prepare(`UPDATE suppliers SET identity_id=? WHERE id=?`).run(identityId, supplierId);
  } catch { /* best-effort — identity_id linkage failure never blocks the supplier row */ }
}
```

### Tenant isolation gate
**Source:** `app/api/qualify/route.ts` line ~33, `orgOwnsSupplier(ctx.orgId, supplier_id)` — runs before every action branch in the POST handler.
**Apply to:** The new `set_rating` action automatically inherits this gate since it's added as a new branch in the same handler, after the existing check — no new tenancy code needed, but DO NOT bypass it or reorder it below the new branch.

### Compound `identity_id AND org_id` scoping on `org_supplier_data` writes
**Source:** `lib/supplier-repository.ts` (pattern established across `upsertOrgSupplierData`, `updateOrgSupplierDataEnrichment`, `findKnownSuppliers` — though the enrichment update currently only filters `WHERE identity_id=?`, this phase upgrades the pattern for the new rating function per Pitfall 3's defense-in-depth requirement).
**Apply to:** `updateOrgSupplierDataRating` — MUST include `AND org_id=?` in its `WHERE` clause, unlike the pre-existing `updateOrgSupplierDataEnrichment` which only has `WHERE identity_id=?` (do not copy that gap forward).

### Optimistic client update + revert-on-failure
**Source:** `app/events/[id]/page.tsx` `setFeedback` (lines 1855-1871) and `moveStage`'s equivalent pattern just above it.
**Apply to:** The new `setRating` handler — capture `prev`, apply optimistically to both `suppliers` list state and `selected` (DetailPanel's currently-open supplier) state, `fetch`, revert both on failure + toast.

### Toggle-to-clear interaction
**Source:** `app/events/[id]/page.tsx` thumbs buttons, e.g. `onClick={() => onFeedback(supplier.id, supplier.feedback_signal === 1 ? 0 : 1)}` (line 398).
**Apply to:** Each star button — `onClick={() => setRating(supplier.id, supplier.rating === n ? null : n)}` — note the comparison is against the SPECIFIC star index `n` clicked (not a binary "is anything set" check like the thumbs use), since a star row has 5 discrete values instead of 2.

### Single-statement writes only (no multi-statement transactions)
**Source:** `.claude/CLAUDE.md` Constraints; `lib/db.ts` Neon HTTP driver comments; every existing repository helper.
**Apply to:** All new writes in this phase (identity_id back-write, rating write) — each is already naturally a single independent statement; do not attempt to combine the identity_id write and the rating write, or the identity resolve-then-rating-write in the API route, into one query/transaction.

## No Analog Found

None — every file in this phase's scope is a modification to an existing file that already contains a directly-analogous pattern for the same role/data-flow combination (feedback_signal for the interaction/API shape, ai_score/enrichment for the repository-write shape, the existing ALTER-pattern for schema evolution).

## Metadata

**Analog search scope:** `lib/db.ts`, `lib/process-supplier.ts`, `lib/supplier-repository.ts`, `app/api/qualify/route.ts`, `app/api/sourcing-events/[id]/route.ts`, `app/events/[id]/page.tsx`, `tests/supplier-repository.test.ts` — all read directly in this session (see line-range citations above).
**Files scanned:** 7 (all files to be modified — no external analog search needed, every pattern precedent lives in-file)
**Pattern extraction date:** 2026-08-21
**UI-SPEC precedence note:** `04-UI-SPEC.md` supersedes `04-RESEARCH.md`'s illustrative `w-4 h-4` icon-size example — the authoritative value for the star icons is `w-3.5 h-3.5` (14px), matching the existing thumbs icon size and deliberately distinct from the three unrelated shortlist `Star` icon sizes in the same file (`w-4 h-4`, `w-2.5 h-2.5`, `w-3 h-3`).
