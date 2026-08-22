---
phase: 04-supplier-star-ratings
reviewed: 2026-08-21T00:00:00Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - lib/db.ts
  - lib/supplier-repository.ts
  - lib/process-supplier.ts
  - app/api/qualify/route.ts
  - app/api/sourcing-events/[id]/route.ts
  - app/events/[id]/page.tsx
  - tests/supplier-repository.test.ts
  - tests/process-supplier.test.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 04: Code Review Report — Supplier Star Ratings

**Reviewed:** 2026-08-21
**Depth:** deep (per-file + cross-file trace: schema → repository → route → client)
**Files Reviewed:** 8
**Status:** issues_found (advisory only — `tdd_mode: false`, this review does not block phase closure)

## Summary

Reviewed both task commits (`9f26c92` Task 1, `43677a8` Task 2) against
`04-01-PLAN.md`, `04-CONTEXT.md`, `04-UI-SPEC.md`, `04-VALIDATION.md`, and
`COVERAGE.md`. The core security/isolation contract this phase exists to
enforce is implemented correctly and verified by direct code trace, not just
by trusting the SUMMARY's claims:

- `identity_id` is always resolved **server-side** from the already
  tenant-checked `supplier_id` (`app/api/qualify/route.ts:103-107`) — never
  trusted from the client body. Confirmed T-04-01 holds.
- `orgOwnsSupplier(ctx.orgId, supplier_id)` runs before the `set_rating`
  branch and is not reordered or bypassed (`app/api/qualify/route.ts:34-36`,
  `97`). Confirmed T-04-02 holds.
- `updateOrgSupplierDataRating` uses the compound `WHERE identity_id=? AND
  org_id=?` predicate, distinct from the single-predicate enrichment mirror,
  exactly as instructed (`lib/supplier-repository.ts:137-146`). Confirmed
  T-04-03 holds, and the four new tests (write/clear/cross-org/mismatched-org)
  genuinely exercise it via the fake DB's compound-match logic.
- Input validation on `rating` correctly rejects everything except `null` or
  an in-range integer — verified against non-integer, boolean, string,
  negative, `NaN`/`Infinity`, and out-of-range inputs by tracing
  `Number.isInteger()` semantics. Confirmed T-04-04 holds.
- The GET route's LEFT JOIN correctly scopes by both `identity_id` and
  `org_id` and passes params in the documented left-to-right order
  (`ctx.orgId` then `id`) — confirmed against the `?` positions in the SQL
  text. RATE-02 cross-event accumulation and D-03 (hide-if-no-identity) are
  both correctly wired end-to-end.
- The three `<Star>` call sites belonging to the unrelated "Add to Short
  List"/"Shortlist" feature (lines 604, 939, 2553) are untouched, and the new
  control's icon size (`w-3.5 h-3.5`) is distinct from all three (`w-4`,
  `w-2.5`, `w-3`), matching D-05/UI-SPEC exactly.
- `upsertOrgSupplierData`'s `ON CONFLICT (identity_id) DO UPDATE` intentionally
  excludes `rating` from its SET clause, so a re-discovery of the same
  supplier can never clobber a buyer-set rating — verified by reading the
  actual SQL, not just the comment above it.

No security vulnerabilities or data-loss-causing bugs were found. The
findings below are quality/correctness gaps that should still be tracked.

## Warnings

### WR-01: New "Rating" section header collides with a pre-existing, semantically different "Rating" quick-fact label in the same panel

**File:** `app/events/[id]/page.tsx:306` and `app/events/[id]/page.tsx:446`
**Issue:** `DetailPanel`'s "Quick facts" grid already renders a card labeled
`t("Rating")` for `supplier.review_score` (an AI/model-derived 0-5 review
score, rendered as `★ X.X / 5` text, line 306). Phase 4 adds a *second*,
completely different control also labeled `t("Rating")` (the buyer-writable
5-star toggle, line 446) — same translation key, same
`text-[10px] font-bold uppercase tracking-widest text-slate-500` styling,
rendered in the same scrollable panel. Because `identity_id` is populated on
essentially every supplier processed through the full discovery pipeline
(not just a rare edge case), both labeled "Rating" blocks will commonly be
visible simultaneously for the same supplier, with no differentiating text
(the model-review-score card literally shows `★ 4.2 / 5`, and just below/
after it, the new star control's header also reads plain "Rating"). This
directly undercuts D-05's stated goal of the new control needing to
"read as clearly distinct" — the icon size/color distinction was checked
against the *unrelated* shortlist star, but not against this *other*,
pre-existing "Rating" label already inside the same panel. This gap was not
caught by 04-UI-SPEC.md, the plan's `<read_first>` sections, or the Task 3
human-verify checkpoint (likely because the test supplier in that session
didn't have `review_score` populated).
**Fix:** Rename one of the two labels to disambiguate, e.g. relabel the
quick-fact card to `t("AI Review Score")` (keeping `review_score`'s existing
semantics) and leave the new buyer control as `t("Rating")`, or vice versa.
Example:
```tsx
{ label: "AI Review Score", v: supplier.review_score !== null ? `★ ${supplier.review_score.toFixed(1)} / 5` : null },
```

### WR-02: `set_rating` always reports `{ success: true }` even when the write matches zero rows

**File:** `app/api/qualify/route.ts:108-109`, `lib/supplier-repository.ts:137-146`
**Issue:** `updateOrgSupplierDataRating()` returns `void`, discarding the
`changes` count from the underlying `UPDATE ... WHERE identity_id=? AND
org_id=?`. The route then unconditionally responds `{ success: true }`
regardless of whether the compound predicate actually matched a row. In the
current call graph this should be rare (the only path that sets
`suppliers.identity_id` also ensures `upsertOrgSupplierData` already
succeeded for that same `(identityId, orgId)` pair), but "should be rare" is
exactly the kind of assumption a WHERE-clause defense-in-depth predicate
exists to guard against — if it is ever violated (e.g. a future data
migration, a manual DB fix, or a currently-unforeseen partial-failure
ordering), the buyer will be told their rating saved when nothing was
persisted, with no error surfaced anywhere.
**Fix:** Have `updateOrgSupplierDataRating` return the `changes` count and
have the route treat `changes === 0` as a failure:
```ts
// lib/supplier-repository.ts
export async function updateOrgSupplierDataRating(
  db: Db,
  params: { identityId: number; orgId: number; rating: number | null }
): Promise<{ changes: number }> {
  const result = await db
    .prepare(`UPDATE org_supplier_data SET rating=?, updated_at=now() WHERE identity_id=? AND org_id=?`)
    .run(params.rating, params.identityId, params.orgId);
  return { changes: result.changes };
}

// app/api/qualify/route.ts
const { changes } = await updateOrgSupplierDataRating(db, { identityId: row.identity_id, orgId: ctx.orgId, rating });
if (changes === 0) {
  return NextResponse.json({ error: "Rating unavailable for this supplier" }, { status: 400 });
}
return NextResponse.json({ success: true });
```

### WR-03: New Phase 4 user-facing strings were not added to any locale dictionary

**File:** `app/events/[id]/page.tsx:454` (`t("Rate {n} stars", { n })`),
`app/events/[id]/page.tsx:1926` (`t("Could not save rating. Please try
again.")`), `lib/i18n/de.ts`, `lib/i18n/es.ts`, `lib/i18n/fr.ts`, `lib/i18n/it.ts`
**Issue:** None of the four locale dictionaries contain entries for `"Rate
{n} stars"` or `"Could not save rating. Please try again."` (confirmed via
direct grep across all four files — zero matches). `useT()`'s fallback
(`components/LanguageProvider.tsx:45-52`) means these will silently render
in raw English for de/es/fr/it users rather than crashing, but this
contradicts 04-UI-SPEC.md's explicit claim that the "Rating" label "reuses
the exact sibling 'AI Assessment'/'Key Export Markets' header pattern
already proven at this panel width across de/es/fr/it locales" — that claim
is true for the *typography*, but the actual translated *text* for the two
brand-new strings introduced by this phase was never added. (Note: this is
consistent with a pre-existing gap elsewhere in the codebase — e.g. the
thumbs-feedback feature's `"Good assessment"`/`"Poor assessment"`/`"AI may
make mistakes..."` strings are also absent from all four dictionaries — so
this is not a novel regression, but it is a real, user-visible gap in a
phase whose own design doc asserts multi-locale parity.)
**Fix:** Add translated entries for `"Rate {n} stars"` and `"Could not save
rating. Please try again."` (and ideally `"Rating"`, shared with the
pre-existing quick-fact label once WR-01 is resolved) to `lib/i18n/de.ts`,
`es.ts`, `fr.ts`, and `it.ts`.

## Info

### IN-01: `identityId !== null` guard is unreachable given `upsertSupplierIdentity`'s return type

**File:** `lib/process-supplier.ts:191, 339, 437`, `lib/supplier-repository.ts:61-89`
**Issue:** `upsertSupplierIdentity()` is typed `Promise<number>` (not
`Promise<number | null>`) and its implementation always returns
`Number(result.lastInsertRowid)` — the `INSERT ... ON CONFLICT ... DO UPDATE
... RETURNING id` shape it emits (via `lib/db.ts`'s auto-appended
`RETURNING id`) will always yield a row, so `lastInsertRowid` is always
defined in practice. The three new `if (identityId !== null) { try {
...UPDATE suppliers SET identity_id... } }` guards added by this phase can
therefore never observe a `null` and are effectively dead conditionals. This
mirrors an existing pattern already used for the enrichment mirror call site
(`if (identityId !== null) { await updateOrgSupplierDataEnrichment(...) }`),
so it's a pre-existing house style rather than a new defect, but it's worth
noting the type contract and the runtime guard don't actually agree.
**Fix:** Either loosen `upsertSupplierIdentity`'s return type to `Promise<number
| null>` if a genuine null case is intended to exist somewhere, or drop the
redundant guard and rely on the outer `try/catch` alone, matching what the
type signature actually promises.

### IN-02: New star buttons lack the `title` tooltip the sibling thumbs buttons have

**File:** `app/events/[id]/page.tsx:451-463`
**Issue:** The adjacent thumbs-feedback buttons this control is explicitly
designed to sit beside both set `title={t("Good assessment")}` /
`title={t("Poor assessment")}` in addition to `aria-label` (lines 401, 414 in
the pre-existing code), giving sighted mouse users a native hover tooltip.
The five new star buttons only set `aria-label`, with no `title`, so hovering
a star (as opposed to a screen reader focusing it) shows no tooltip — a
minor inconsistency with the control it's meant to visually pair with.
**Fix:** Add `title={t("Rate {n} stars", { n })}` alongside the existing
`aria-label` for parity with the thumbs buttons.

---

_Reviewed: 2026-08-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
