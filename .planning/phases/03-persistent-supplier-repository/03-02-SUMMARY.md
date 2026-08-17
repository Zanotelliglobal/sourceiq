---
phase: 03-persistent-supplier-repository
plan: 02
subsystem: supplier-repository
tags: [postgres, supplier-repository, write-path, upsert, idempotency, tdd]

# Dependency graph
requires:
  - "lib/supplier-repository.ts: upsertSupplierIdentity, upsertOrgSupplierData, updateOrgSupplierDataEnrichment, findKnownSuppliers (Plan 03-01)"
provides:
  - "makeProcessSupplierQuick() writes to the persistent repository (identity + null ai_score/last_category), best-effort, org-scoped"
  - "makeProcessSupplierDeepen() writes to the persistent repository both synchronously (identity + real ai_score) and from its enrichTask closure (enrichment second-write), best-effort, org-scoped"
  - "orgId threaded through ProcessSupplierQuickDeps and its sole production caller (app/api/investigate-quick/route.ts)"
  - "All three makeProcessSupplier* write paths converge on the shared (org_id, norm_name) conflict target — REPO-02 fully satisfied"
affects: [process-supplier, investigate-quick-route]

actuals:
  tokens: 5480
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Same best-effort try/catch pattern from Plan 03-01 applied to two more call sites — repository write failure never blocks the surrounding suppliers table INSERT/UPDATE critical path"
    - "Quick-scan writes aiScore=null and categoryLabel=null (no qualifier score or category exists yet at that point in the flow) — the identity/org-data upsert still succeeds because those columns are nullable"
    - "Deepen's ON CONFLICT (org_id, norm_name) DO UPDATE overwrites a prior quick-scan's null ai_score with the real deepen score, proving three independent write paths converge on a single per-org identity row per supplier (REPO-03 cross-path idempotency)"
    - "Test-fake upgrade: tests/process-supplier.test.ts's fakeDb repo-table handling was upgraded from a blind INSERT (adequate for Plan 03-01, which never asserted on repository state) to real ON CONFLICT dedup semantics matching lib/supplier-repository.ts's actual SQL, plus a findKnownSuppliers join-query responder — required because this plan's D1 test asserts exact row counts across two independent write paths"

key-files:
  created: []
  modified:
    - lib/process-supplier.ts
    - app/api/investigate-quick/route.ts
    - tests/process-supplier.test.ts
    - tests/quick-scan.test.ts

key-decisions:
  - "Plan's acceptance-criteria grep counts for Task 2 (\"identityIdDeepen appears exactly 3 times\", \"updateOrgSupplierDataEnrichment appears exactly 2 times\") undercounted relative to the plan's own literal code snippet in <action> — implemented verbatim from that snippet (5 and 3 occurrences respectively; see Deviations). No behavior change, purely a plan-authoring counting discrepancy."

patterns-established:
  - "Any future third+ write path into the supplier repository (e.g. Plan 03-03's RFP-matching path, if one arrives) should follow the same best-effort try/catch immediately after its own critical-path suppliers write, using null for any field it can't yet compute."

requirements-completed: [REPO-02]

coverage:
  - id: D1
    description: "A supplier discovered via makeProcessSupplierQuick() writes through to supplier_identities/org_supplier_data with ai_score=null and last_category=null"
    requirement: "REPO-02"
    verification:
      - kind: unit
        ref: "tests/quick-scan.test.ts#Q1"
        status: pass
    human_judgment: false
  - id: D2
    description: "Calling makeProcessSupplierQuick() twice for the same (orgId, name) produces exactly one identity row"
    requirement: "REPO-02, REPO-03"
    verification:
      - kind: unit
        ref: "tests/quick-scan.test.ts#Q2"
        status: pass
    human_judgment: false
  - id: D3
    description: "A repository upsert failure inside makeProcessSupplierQuick() never blocks the outer suppliers INSERT or the function's return value"
    requirement: "REPO-02"
    verification:
      - kind: unit
        ref: "tests/quick-scan.test.ts#Q3"
        status: pass
    human_judgment: false
  - id: D4
    description: "makeProcessSupplierDeepen() is idempotent with a prior quick-scan repository write for the same supplier: exactly one identity row, ai_score/last_category now reflect the deepen write (overwriting the quick-scan's nulls)"
    requirement: "REPO-02, REPO-03"
    verification:
      - kind: unit
        ref: "tests/process-supplier.test.ts#D1"
        status: pass
    human_judgment: false
  - id: D5
    description: "makeProcessSupplierDeepen()'s enrichTask closure mirrors resolved enrichment into org_supplier_data.enrichment (Pattern 2 second-write)"
    requirement: "REPO-02"
    verification:
      - kind: unit
        ref: "tests/process-supplier.test.ts#D2"
        status: pass
    human_judgment: false
  - id: D6
    description: "A repository upsert failure inside makeProcessSupplierDeepen()'s sync path or enrichTask never throws into the deepen flow"
    requirement: "REPO-02"
    verification:
      - kind: unit
        ref: "tests/process-supplier.test.ts#D3"
        status: pass
    human_judgment: false
  - id: D7
    description: "typecheck and lint both exit 0 across all modified files"
    verification:
      - kind: unit
        ref: "npm run typecheck; npm run lint"
        status: pass
    human_judgment: false
  - id: D8
    description: "Full standing test suite (246 tests, 23 files) passes, run outside the sandboxed node_modules read-restriction that blocks @anthropic-ai/sdk's credentials.mjs module resolution"
    verification:
      - kind: unit
        ref: "npx vitest run (sandbox disabled)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-08-16
status: complete
---

# Phase 3 Plan 02: Expansion — Write-Path Coverage for Quick-Scan + Deepen Summary

**Extended the Plan 03-01 supplier repository write path from one call site to all three (`makeProcessSupplier`, `makeProcessSupplierQuick`, `makeProcessSupplierDeepen`), proving cross-path idempotency: a supplier discovered by quick-scan then deepened converges on exactly one `supplier_identities` row with its null `ai_score` overwritten by the real deepen score.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-16
- **Completed:** 2026-08-16
- **Tasks:** 2 (both `type="auto" tdd="true"`)
- **Files modified:** 4 (`lib/process-supplier.ts`, `app/api/investigate-quick/route.ts`, `tests/process-supplier.test.ts`, `tests/quick-scan.test.ts`)

## Accomplishments

- Added `orgId: number` to `ProcessSupplierQuickDeps` and threaded `ctx.orgId` through the sole production caller, `app/api/investigate-quick/route.ts`'s `makeProcessSupplierQuick({ db, eventId, orgId, send })` call.
- Wired a best-effort `upsertSupplierIdentity` + `upsertOrgSupplierData` call into `makeProcessSupplierQuick`, immediately after its existing `supplier_found` send and before `return saved` — `aiScore: null` and `categoryLabel: null` since quick-scan has neither a qualifier score nor a category label at insert time.
- Wired the same pair into `makeProcessSupplierDeepen`'s synchronous critical path (after the `UPDATE suppliers ...` / `supplier_updated` send, before the `enrichTask` closure), this time with the real `score.overall_score` and `deps.categoryLabel` — deepen has both.
- Added the enrichment second-write (Pattern 2) inside `makeProcessSupplierDeepen`'s existing `enrichTask` closure: `updateOrgSupplierDataEnrichment` is called with the resolved `enrichmentJson`, gated on `identityIdDeepen !== null`, mirroring the identical pattern already proven in `makeProcessSupplier` (Plan 03-01).
- Upgraded `tests/process-supplier.test.ts`'s `fakeDb()` repository-table handling from Plan 03-01's blind-INSERT stand-in to real `ON CONFLICT` dedup semantics (matching `lib/supplier-repository.ts`'s actual SQL: dedup on `(org_id, norm_name)` for identities, on `identity_id` for org data), plus a `findKnownSuppliers`-shaped join-query responder on `all()`. This was required because this plan's idempotency test (D1) asserts exact row counts across two independent write paths — the old blind-INSERT fake would have silently produced two rows and let a real dedup regression pass.
- Extended `tests/quick-scan.test.ts`'s `fakeDb()` with the identical repository-table + join-query handling (that file had none from Plan 03-01, since quick-scan wasn't wired to the repository until now), and added `orgId: 1` to `baseQuickDeps()`.
- Added 6 new tests: Q1/Q2/Q3 in `tests/quick-scan.test.ts` (REPO-02 write-through, REPO-03 dedup across repeated quick-scans, best-effort failure isolation) and D1/D2/D3 in `tests/process-supplier.test.ts` (cross-path idempotency, enrichment second-write, best-effort failure isolation in both the sync path and the enrichTask closure).

## Task Commits

1. **Task 1 — Wire repository upsert into `makeProcessSupplierQuick`** - `3ea193a` (feat) — `lib/process-supplier.ts`, `app/api/investigate-quick/route.ts`, `tests/quick-scan.test.ts`.
2. **Task 2 — Wire repository upsert into `makeProcessSupplierDeepen` (sync + enrichTask)** - `63e084f` (feat) — `lib/process-supplier.ts`, `tests/process-supplier.test.ts`.

**Plan metadata:** (this commit, made immediately after this SUMMARY)

## Files Modified

- `lib/process-supplier.ts` — Added `orgId: number` to `ProcessSupplierQuickDeps`; added a best-effort identity + org-data upsert (`aiScore: null`, `categoryLabel: null`) inside `makeProcessSupplierQuick`, right before `return saved`. Added a best-effort identity + org-data upsert (`aiScore: score.overall_score`, `categoryLabel: deps.categoryLabel`) inside `makeProcessSupplierDeepen`'s synchronous path, and a best-effort `updateOrgSupplierDataEnrichment` call inside its `enrichTask` closure, gated on the new `identityIdDeepen` variable.
- `app/api/investigate-quick/route.ts` — Added `orgId: ctx.orgId` to the `makeProcessSupplierQuick({...})` call (the only production caller, already had `ctx` in scope).
- `tests/process-supplier.test.ts` — Imported `makeProcessSupplierDeepen`, `findKnownSuppliers`, `upsertSupplierIdentity`, `upsertOrgSupplierData`. Replaced the Plan 03-01 blind-INSERT repository-table stand-in with real `ON CONFLICT` dedup logic and a `findKnownSuppliers` join-query responder. Added a `makeProcessSupplierDeepen repository upsert (REPO-02)` describe block with D1/D2/D3.
- `tests/quick-scan.test.ts` — Imported `findKnownSuppliers`. Added the same repository-table + join-query handling to its own `fakeDb()`. Added `orgId: 1` to `baseQuickDeps()`. Added a `makeProcessSupplierQuick repository upsert (REPO-02)` describe block with Q1/Q2/Q3.

## Decisions Made

- **Plan acceptance-criteria grep-count discrepancy (not a code deviation).** The plan's Task 2 acceptance criteria stated `grep -c "identityIdDeepen"` should return exactly 3 and `grep -c "updateOrgSupplierDataEnrichment"` should return exactly 2. Implementing the plan's own `<action>` code snippet verbatim (declaration, sync assignment, the `identityId: identityIdDeepen` parameter inside `upsertOrgSupplierData`, the `if (identityIdDeepen !== null)` guard, and the `identityId: identityIdDeepen` parameter inside `updateOrgSupplierDataEnrichment`) produces 5 and 3 occurrences respectively — the plan's stated counts undercounted its own snippet. No code was altered to force a different count; the implementation matches the plan's literal action text exactly, and functional correctness was verified independently by the full test suite (246/246 passing) rather than by grep count.

## Deviations from Plan

### Auto-fixed Issues

None — both tasks were additive, code-only changes with no bugs, missing critical functionality, or blocking issues discovered during implementation.

**Total deviations:** 0 functional deviations. One documented plan-authoring discrepancy (acceptance-criteria grep counts vs. the plan's own code snippet — see Decisions Made above), with no code impact.

## Issues Encountered

- **Pre-existing, out-of-scope `@anthropic-ai/sdk` module-resolution failure, now root-caused.** As documented in `.planning/phases/02-marketing-pricing-surface/deferred-items.md` and reconfirmed in `03-01-SUMMARY.md`, `tests/process-supplier.test.ts` and `tests/quick-scan.test.ts` fail at test-collection time inside this execution sandbox with `Cannot find module '.../node_modules/@anthropic-ai/sdk/core/credentials.mjs'`. This plan investigated further and found the exact cause: the sandbox's filesystem read policy denies any path matching `**/credentials*` (intended to block reading credential files like AWS/SSH keys) in combination with a broad `**/node_modules` read deny — and `@anthropic-ai/sdk` happens to ship a file literally named `credentials.mjs` inside `node_modules`, so Node's ESM resolver hits a permission error trying to read it. Confirmed directly: `ls node_modules/@anthropic-ai/sdk/core/credentials.mjs` returns `Operation not permitted` inside the sandbox. This is unrelated to any code in this plan (or Plan 03-01) — it is a sandbox filesystem-policy artifact, exactly matching the prior phase's "Resolved/reclassified" finding that the user's own out-of-sandbox run was 100% green. **Verification performed with the sandbox disabled** (per the executor's own sandbox-evidence protocol) confirms this: all 29 tests in the two affected files pass (13 in `process-supplier.test.ts` including the new D1/D2/D3; 16 in `quick-scan.test.ts` including the new Q1/Q2/Q3), and the full 23-file/246-test standing suite passes cleanly. `npm run typecheck` and `npm run lint` were also verified green both inside and outside the sandbox. This plan's edits to both test files do not fix or worsen the sandbox-only symptom — it remains out of scope per the executor's Scope Boundary rule and should continue to be tracked independently (it is not a real defect in the shipped code, per the user's own out-of-sandbox confirmation in Phase 02).

## User Setup Required

None — no new environment variables or external service configuration required. This plan only extends existing, already-deployed schema/write paths from Plan 03-01.

## Next Phase Readiness

- REPO-02 is now fully satisfied: all three discovery flows (full investigation, quick scan, deepen) write through the shared `lib/supplier-repository.ts` upsert helpers, converging on the same `(org_id, norm_name)` conflict target.
- Cross-path idempotency (REPO-03) is proven end-to-end by test D1: a supplier discovered by quick-scan then deepened produces exactly one `supplier_identities` row, with the deepen's real `ai_score`/`last_category` overwriting the quick-scan's nulls.
- Plan 03-03's REPO-05 pre-search read path (checking `findKnownSuppliers` before launching a new discovery wave) can now rely on ALL THREE discovery flows having already populated the repository — no flow is left unwired.
- The sandbox `@anthropic-ai/sdk`/`credentials.mjs` module-resolution artifact remains present and is now root-caused (sandbox `**/credentials*` + `**/node_modules` read-deny policy colliding with a package file literally named `credentials.mjs`) — it should be resolved at the sandbox-configuration level (e.g., narrowing the `**/credentials*` deny pattern to exclude `node_modules`) rather than in this repo's code, since the repo's code and tests are confirmed correct via out-of-sandbox verification.

---
*Phase: 03-persistent-supplier-repository*
*Completed: 2026-08-16*

## Self-Check: PASSED

- FOUND: `lib/process-supplier.ts` (modified — `makeProcessSupplierQuick` + `makeProcessSupplierDeepen` repository wiring)
- FOUND: `app/api/investigate-quick/route.ts` (modified — `orgId` threaded to `makeProcessSupplierQuick`)
- FOUND: `tests/process-supplier.test.ts` (modified — D1/D2/D3 added, fakeDb upgraded)
- FOUND: `tests/quick-scan.test.ts` (modified — Q1/Q2/Q3 added, fakeDb extended)
- FOUND commit: `3ea193a`
- FOUND commit: `63e084f`
