---
phase: 03-persistent-supplier-repository
plan: 03
subsystem: supplier-repository
tags: [postgres, supplier-repository, read-path, matching-heuristic, orchestrator-route, tdd]

# Dependency graph
requires:
  - "lib/supplier-repository.ts: findKnownSuppliers, RepositoryEntry (Plan 03-01)"
  - "All three write paths (makeProcessSupplier, makeProcessSupplierQuick, makeProcessSupplierDeepen) populating the repository (Plan 03-01, Plan 03-02)"
provides:
  - "lib/supplier-repository.ts: normCategory, parseTargetCountries, repositoryEntryMatchesEvent (REPO-05 matching heuristic)"
  - "app/api/orchestrate/route.ts: pre-search block queries findKnownSuppliers(db, ctx.orgId) before runOrchestrator(), folds category+geography matches into avoidNames"
affects: [orchestrate-route, supplier-repository]

actuals:
  tokens: 4300
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Route-level pre-search read (NOT threaded into lib/agents.ts runOrchestrator()) — the read/matching logic lives entirely in app/api/orchestrate/route.ts, keeping runOrchestrator() a pure LLM function with zero @/lib/db imports (RESEARCH.md Pitfall 1)"
    - "Category+geography matching uses AND semantics: null last_category is an open/permissive match (identity never seen under a category), empty target_countries is a global/permissive match (event has no geography constraint) — but the two signals are combined with AND, never OR, so a same-country wrong-industry supplier is never folded in"
    - "Best-effort try/catch around the pre-search query — a failure yields an empty relevantKnown list rather than breaking the existing scout dispatch path, matching the write-path best-effort pattern from Plan 03-01/03-02"

key-files:
  created: []
  modified:
    - lib/supplier-repository.ts
    - app/api/orchestrate/route.ts
    - tests/supplier-repository.test.ts

key-decisions:
  - "R1/R2 'integration-shape' tests were folded into Task 1's commit alongside M1-M10, since they exercise only findKnownSuppliers + repositoryEntryMatchesEvent directly (no dependency on route.ts) — Task 2's commit is route.ts-only. This is a commit-grouping choice, not a scope deviation: both tasks' <behavior> requirements (M1-M10, R1, R2) are all present and green."

patterns-established:
  - "Any future pre-search or read-path optimization that queries the repository from a route should follow the same best-effort try/catch-and-continue shape, never threading db access into lib/agents.ts."

requirements-completed: [REPO-05, REPO-06]

coverage:
  - id: D1
    description: "repositoryEntryMatchesEvent requires BOTH category match (or null category) AND geography match (or empty target_countries) — AND semantics, never OR"
    requirement: "REPO-05"
    verification:
      - kind: unit
        ref: "tests/supplier-repository.test.ts#REPO-05 matching heuristic M1-M10"
        status: pass
    human_judgment: false
  - id: D2
    description: "A new investigation started via POST /api/orchestrate queries the org's repository via findKnownSuppliers(db, ctx.orgId) before runOrchestrator() runs, and folds matches into avoidNames"
    requirement: "REPO-05"
    verification:
      - kind: unit
        ref: "tests/supplier-repository.test.ts#REPO-05 pre-search integration shape R1/R2; grep -c findKnownSuppliers/repositoryEntryMatchesEvent in app/api/orchestrate/route.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "lib/agents.ts has zero @/lib/db imports — the pre-search check lives entirely in the route, never threaded into runOrchestrator()"
    requirement: "REPO-05"
    verification:
      - kind: unit
        ref: "grep -c \"@/lib/db\" lib/agents.ts == 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "findKnownSuppliers uses LEFT JOIN (not INNER JOIN) so an orphaned identity-only row still surfaces to the pre-search check"
    requirement: "REPO-06"
    verification:
      - kind: unit
        ref: "grep -c \"INNER JOIN\" lib/supplier-repository.ts == 0; grep -c \"LEFT JOIN org_supplier_data\" lib/supplier-repository.ts == 1"
        status: pass
    human_judgment: false
  - id: D5
    description: "typecheck and lint both exit 0 across all modified files"
    verification:
      - kind: unit
        ref: "npm run typecheck; npm run lint"
        status: pass
    human_judgment: false
  - id: D6
    description: "Full standing test suite (258 tests, 23 files) passes, run outside the sandboxed node_modules read-restriction that blocks @anthropic-ai/sdk's credentials.mjs module resolution"
    verification:
      - kind: unit
        ref: "npx vitest run (sandbox disabled)"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-08-16
status: complete
---

# Phase 3 Plan 03: Read Path — Pre-Search Repository Check + Matching Heuristic (REPO-05) Summary

**Closed the read-then-write loop opened by Plans 03-01/03-02: added a category+geography matching heuristic to `lib/supplier-repository.ts` and wired a best-effort pre-search check into `app/api/orchestrate/route.ts` (never threaded into `lib/agents.ts`) so new discovery waves fold already-known suppliers into the scouts' `avoidNames` list before spending web-search budget rediscovering them.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-16
- **Completed:** 2026-08-16
- **Tasks:** 2 (both `type="auto" tdd="true"`)
- **Files modified:** 3 (`lib/supplier-repository.ts`, `app/api/orchestrate/route.ts`, `tests/supplier-repository.test.ts`)

## Accomplishments

- Added three new exports to `lib/supplier-repository.ts`: `normCategory(c)` (trim+lowercase, null/undefined-safe), `parseTargetCountries(targetCountries)` (comma-split, trimmed, lowercased, empty-filtered), and `repositoryEntryMatchesEvent(entry, eventCategory, eventTargetCountries)` (AND-semantics category+geography matcher — null `last_category` is an open/permissive match, empty `target_countries` is a global/permissive match, but both signals must independently pass).
- Inserted a pre-search block in `app/api/orchestrate/route.ts` at line 184 (immediately before the existing "Run orchestrator to plan agents" comment / `const plan = isTargeted` block at line 187 in the pre-plan file, now line 203 post-insertion) that calls `findKnownSuppliers(db, ctx.orgId)`, filters the result through `repositoryEntryMatchesEvent(s, categoryLabel, event.target_countries)`, and stores the matches in `relevantKnown`. Wrapped in try/catch — on failure, `relevantKnown` stays `[]` and the rest of the route is unaffected.
- Extended the existing `avoidNames` array (line 254, was line 236 pre-insertion) to fold in `relevantKnown.map(s => s.name)` alongside the pre-existing `existing.map(s => s.name)`, so scout prompts include repository-known suppliers in the "do not surface these" list.
- Added `findKnownSuppliers, repositoryEntryMatchesEvent, type RepositoryEntry` imports to `app/api/orchestrate/route.ts` from `@/lib/supplier-repository`.
- Confirmed `lib/agents.ts` remains completely untouched — zero `@/lib/db` imports (grep-gate verified), so `runOrchestrator()` stays a pure LLM function per RESEARCH.md Pitfall 1.
- Wrote 12 new tests in `tests/supplier-repository.test.ts`: M1-M10 (`describe("REPO-05 matching heuristic")`) covering category exact match, category mismatch, geography mismatch, permissive null category, global empty-target-countries, case-insensitivity, whitespace tolerance, AND-semantics (same-country wrong-industry must NOT match), and both null-entry-country edge cases (global match vs. specific-target no-match); plus R1/R2 (`describe("REPO-05 pre-search integration shape")`) exercising `findKnownSuppliers` + `repositoryEntryMatchesEvent` together against a populated and an empty repository.

## Task Commits

1. **Task 1 — Add matching-heuristic helpers + unit tests** - `9ad7d23` (feat) — `lib/supplier-repository.ts`, `tests/supplier-repository.test.ts` (M1-M10 + R1-R2, since R1/R2 exercise only the repository module directly with no route.ts dependency).
2. **Task 2 — Insert pre-search block into `app/api/orchestrate/route.ts`; fold matches into `avoidNames`** - `ef3199e` (feat) — `app/api/orchestrate/route.ts` only.

**Plan metadata:** (this commit, made immediately after this SUMMARY)

## Files Created/Modified

- `lib/supplier-repository.ts` — Appended `normCategory`, `parseTargetCountries`, `repositoryEntryMatchesEvent` after the existing `findKnownSuppliers` export, pasted verbatim from the plan's `<action>` snippet (RESEARCH.md-drafted).
- `app/api/orchestrate/route.ts` — Added an import line for `findKnownSuppliers`, `repositoryEntryMatchesEvent`, `type RepositoryEntry`. Inserted a `let relevantKnown: RepositoryEntry[] = []; try { ... } catch {}` block at line 184, immediately before the existing "Run orchestrator to plan agents" comment. Replaced the single-line `avoidNames` assignment (formerly line 236) with a spread of `existing.map(s => s.name)` and `relevantKnown.map(s => s.name)` (now at line 254).
- `tests/supplier-repository.test.ts` — Added `repositoryEntryMatchesEvent` and `type RepositoryEntry` to the existing import; added two new `describe` blocks (`REPO-05 matching heuristic` with M1-M10, `REPO-05 pre-search integration shape` with R1-R2) after the existing `describe("lib/supplier-repository", ...)` block.

## Decisions Made

- **R1/R2 tests grouped into Task 1's commit rather than Task 2's.** The plan's Task 2 `<behavior>` section specifies R1/R2 as tests to add alongside the route.ts wiring, but both tests exercise `findKnownSuppliers` + `repositoryEntryMatchesEvent` directly with an in-memory fake — neither imports from or depends on `app/api/orchestrate/route.ts`. Since they had no dependency on Task 2's route changes and both helpers were already available after Task 1, they were written and committed together with M1-M10 in `9ad7d23`, keeping Task 2's commit (`ef3199e`) scoped purely to the route.ts wiring. All plan-required behaviors (M1-M10, R1, R2) are present and green; this is a commit-grouping choice with zero functional impact.
- **Exact insertion point confirmed against the plan's line-number references.** The plan's `<action>` said to insert "immediately BEFORE the existing `const plan = isTargeted` block (line 187)... between the existing `send({ type: "planning", ... })` call and the `const plan = ...`". The actual pre-plan file has that `send(...)` call typed `{ type: "wave_start", ... }` (not literally `"planning"`) ending at line 181, with `const plan = isTargeted` at line 187 — the plan's line numbers and the "planning" label were both approximate/illustrative. The pre-search block was inserted at the position the plan's intent clearly describes: directly after the `send({ type: "wave_start", ... })` call and directly before the `// Run orchestrator to plan agents` comment / `const plan = isTargeted` statement. No functional ambiguity — verified by the `grep -c "findKnownSuppliers"`/`grep -c "repositoryEntryMatchesEvent"` acceptance-criteria gates both passing.

## Deviations from Plan

### Auto-fixed Issues

None — both tasks were additive, code-only changes with no bugs, missing critical functionality, or blocking issues discovered during implementation. Typecheck and lint were green on the first pass for both tasks.

**Total deviations:** 0 functional deviations. One documented commit-grouping choice (R1/R2 placement) and one documented plan-wording clarification (insertion-point label/line-number were illustrative, not literal) — see Decisions Made above.

## Issues Encountered

- **Pre-existing, out-of-scope `@anthropic-ai/sdk`/`credentials.mjs` sandbox artifact reproduces exactly as documented in Plans 03-01/03-02.** `tests/process-supplier.test.ts` and `tests/quick-scan.test.ts` fail at test-collection time inside this execution sandbox with `Cannot find module '.../node_modules/@anthropic-ai/sdk/core/credentials.mjs'` (the sandbox's `**/credentials*` deny-pattern collides with a package file literally named `credentials.mjs`, root-caused in Plan 03-02). This plan's own test file, `tests/supplier-repository.test.ts`, is unaffected and passes cleanly inside the sandbox (all 21 tests, including the 12 new M1-M10/R1-R2). **Verification performed with the sandbox disabled** confirms the full standing suite is unaffected by this plan's changes: all 23 test files / 258 tests pass, including the two previously-blocked files (13 tests in `process-supplier.test.ts`, 16 in `quick-scan.test.ts`). `npm run typecheck` and `npm run lint` were verified green both inside and outside the sandbox. This plan's edits do not touch either of the two affected test files and neither fix nor worsen the sandbox-only symptom — it remains out of scope per the executor's Scope Boundary rule.

## User Setup Required

None — no new environment variables or external service configuration required. This plan only adds a read-path query and matching logic against the already-deployed schema from Plan 03-01.

## Next Phase Readiness

- REPO-05 is now fully satisfied: `POST /api/orchestrate` runs a category+geography-filtered pre-search against the org's repository before scout dispatch, folds matched names into `avoidNames`, and does so without threading db access into `lib/agents.ts` (`runOrchestrator()` remains a pure LLM function, zero `@/lib/db` imports, grep-verified).
- REPO-06 (structural cross-org isolation, previously covered by Plan 03-01's two-org test) is reinforced here: the pre-search read is scoped by `findKnownSuppliers(db, ctx.orgId)`'s mandatory `orgId` parameter, so the read-path can never leak another org's repository entries.
- All three write paths (Plan 03-01's `makeProcessSupplier`, Plan 03-02's `makeProcessSupplierQuick`/`makeProcessSupplierDeepen`) and the read path (this plan) now form a complete write-then-read loop for the persistent supplier repository feature.
- The sandbox `@anthropic-ai/sdk`/`credentials.mjs` module-resolution artifact remains present and unresolved at the sandbox-configuration level (unrelated to any code in this phase); it should continue to be tracked and fixed independently, as noted in Plans 03-01/03-02.

---
*Phase: 03-persistent-supplier-repository*
*Completed: 2026-08-16*

## Self-Check: PASSED

- FOUND: `lib/supplier-repository.ts` (modified — normCategory/parseTargetCountries/repositoryEntryMatchesEvent added)
- FOUND: `app/api/orchestrate/route.ts` (modified — pre-search block + avoidNames extension)
- FOUND: `tests/supplier-repository.test.ts` (modified — M1-M10 + R1-R2 added, 21 tests total)
- FOUND commit: `9ad7d23`
- FOUND commit: `ef3199e`
