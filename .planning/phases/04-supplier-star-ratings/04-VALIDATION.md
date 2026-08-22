---
phase: 4
slug: supplier-star-ratings
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-21
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.9 |
| **Config file** | `vitest.config.ts` — `environment: "node"`, includes `tests/**/*.test.ts` |
| **Quick run command** | `npx vitest run tests/supplier-repository.test.ts tests/process-supplier.test.ts` |
| **Full suite command** | `npm run test` (`vitest run`) |
| **Estimated runtime** | ~30 seconds |

Existing convention (confirmed by `tests/supplier-repository.test.ts` and
`tests/process-supplier.test.ts`): unit tests against `lib/` modules using a
hand-written fake DB (regex-matching SQL text against an in-memory store).
There are no existing tests that import and directly invoke
`app/api/*/route.ts` handlers. New tests for RATE-01/02/03 should extend
`updateOrgSupplierDataRating` and the `identity_id`-write additions to
`lib/process-supplier.ts` directly, following this convention rather than
introducing a new route-level test harness.

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/supplier-repository.test.ts tests/process-supplier.test.ts`
- **After every plan wave:** Run `npm run test` (full suite) + `npm run typecheck`
- **Before `/gsd-verify-work`:** Full suite green (`npm run test`, `npm run typecheck`, `npm run lint`) — matches the gate Phase 3 used (258/258 tests, clean typecheck/lint/build).
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-TBD | 01 | 1 | RATE-02 | T-04-01 (cross-org identity_id reuse) | `identity_id` is written onto the `suppliers` row in all 3 `makeProcessSupplier*()` factories | unit | `npx vitest run tests/process-supplier.test.ts` | ✅ (extend) | ⬜ pending |
| 04-01-TBD | 01 | 1 | RATE-01 | — | `updateOrgSupplierDataRating` writes 1-5 and null values correctly | unit | `npx vitest run tests/supplier-repository.test.ts` | ✅ (extend) | ⬜ pending |
| 04-01-TBD | 01 | 1 | RATE-02 | T-04-02 (IDOR / cross-org write) | `updateOrgSupplierDataRating` scoped by BOTH `identity_id` AND `org_id` | unit | `npx vitest run tests/supplier-repository.test.ts` | ✅ (extend — mirror existing cross-org isolation pattern) | ⬜ pending |
| 04-01-TBD | 01 | 1 | RATE-01 | — | Toggle-to-clear client interaction (re-clicking active star nulls it) | manual (no route/component test harness exists in this repo) | N/A — human checkpoint | ❌ Wave 0 (optionally extract `nextRatingValue(current, clicked)` as a pure function and unit test it) | ⬜ pending |
| 04-01-TBD | 01 | 1 | RATE-03 | — | `set_feedback`/`feedback_signal` behavior completely unmodified | regression | `npm run test` (full suite) | ✅ (existing suite acts as regression guard) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Task IDs are placeholders (TBD) — the planner assigns final task IDs; this map should be reconciled against `04-PLAN.md` once written.*

---

## Wave 0 Requirements

- [ ] Extend `tests/supplier-repository.test.ts`'s fake DB `prepare()` matcher to recognize an `UPDATE org_supplier_data SET rating=...` statement shape, alongside the existing enrichment/ai_score matchers.
- [ ] No new test framework install needed — Vitest is fully present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Toggle-to-clear star interaction in `DetailPanel` | RATE-01 | No route/component-level test harness exists in this repo (fake-DB unit-test convention only) | Open an event's supplier detail view, click a star to set a rating, re-click the same star and confirm it clears back to unrated |
| Rating persists across events for the same supplier identity | RATE-02 | Requires two live events resolving to the same `identity_id`, which is easiest to eyeball manually rather than construct as a fake-DB fixture | Rate a supplier in Event A, encounter the same real-world supplier in Event B (same org), confirm the rating already shows |
| Visual distinctness from the "Add to Short List" Star icon | RATE-01 (D-05) | Subjective visual/UX judgment, not a testable assertion | View `DetailPanel` and confirm the 5-star rating row reads as clearly distinct from the standalone Shortlist star, per D-05's "Rating" labeling requirement |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
