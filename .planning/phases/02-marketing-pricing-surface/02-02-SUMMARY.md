---
phase: 02-marketing-pricing-surface
plan: 02
subsystem: marketing
tags: [landing-page, pricing, feature-grid, cta, i18n, lucide-react]
requires:
  - "02-01: lib/plans.ts TIERS catalog (Basic/Growth/Premium/Enterprise USD), Tier.contactSales, Tier.featured, displayPrice(), cadenceSuffix()"
provides:
  - "components/LandingContent.tsx pricing section reading live from TIERS.filter"
  - "6-tile 'what we do' feature grid section"
  - "Closing CTA banner section ('Don't see a perfect fit?')"
  - "Hero media slot backed by public/hero-placeholder.svg"
affects:
  - "components/LandingContent.tsx"
  - "public/hero-placeholder.svg"
tech-stack:
  patterns:
    - "Pricing cards derived via TIERS.filter(t => t.key !== 'free').map(...) instead of a hardcoded local array — single source of truth in lib/plans.ts"
    - "Feature-bullet strings per tier derived dynamically from tier.limits (eventsPerMonth/suppliersPerEvent/seats/outreach/export) using the UNLIMITED sentinel, mirroring app/billing/page.tsx's limitLabel() pattern"
    - "CTA class chosen via tier.featured (btn-cta vs btn-secondary), not a hardcoded tier-key check, to keep the amber accent tied to the featured flag"
key-files:
  created:
    - public/hero-placeholder.svg
  modified:
    - components/LandingContent.tsx
key-decisions:
  - "No cadence toggle exists on the landing page (only app/billing/page.tsx has one) — introduced a fixed `const cadence: Cadence = 'monthly'` inside the pricing map, preserving the page's pre-existing always-monthly display behavior instead of adding new toggle UI not requested by the plan"
  - "Hero's hardcoded fake-data stat tiles/supplier rows were REMOVED ENTIRELY (not kept as a hidden/visual fallback) and replaced by a single <img src=\"/hero-placeholder.svg\"> inside the pre-existing browser-frame wrapper, plus a 'Product preview' caption"
  - "Feature-bullet copy per pricing tier is derived from tier.limits fields rather than a hardcoded strings array, so it can never overstate capabilities not present in lib/plans.ts (e.g., dropped the original hardcoded 'SSO & role-based access' Enterprise claim, unbacked by any TierLimits field)"
estimate:
  tokens: 55000
  raw_tokens: 45000
  tasks: 3
  confidence: low
actuals:
  tokens: 48000
  tasks: 3
  commits: 3
requirements-completed: [PRICE-01, PRICE-03, MKT-01, MKT-04, MKT-05]
coverage:
  PRICE-01: "Pricing cards render live from TIERS.filter(t => t.key !== 'free') — Basic/Growth/Premium/Enterprise, no hardcoded local price array"
  PRICE-03: "Basic-tier card is the sole 'Start free trial' CTA (Link to /sign-up); Growth/Premium use 'Choose {plan}'; Enterprise uses 'Contact sales' mailto"
  MKT-01: "Closing CTA banner ('Don't see a perfect fit?' / 'Talk to sales') added after Final CTA, before footer position"
  MKT-04: "6-tile feature grid shipped in the exact specified order with non-overstating copy; RFP & Intake Tools and ERP/API Integrations tiles excluded"
  MKT-05: "Hero media slot replaced with real <img src='/hero-placeholder.svg'> + committed SVG asset"
duration: "~55 min"
completed: 2026-08-16
status: complete
---

# Phase 02 Plan 02: Pricing/Feature-Grid/CTA Landing Page Expansion Summary

Expanded `components/LandingContent.tsx` from the plan 02-01 tracer catalog into the full public marketing surface: a live 4-tier pricing grid sourced from `lib/plans.ts`, a new 6-tile "what we do" feature grid, a new closing CTA banner, a real hero media slot backed by a committed placeholder SVG, and removal of the pre-existing duplicate inline footer.

## Accomplishments

- Pricing section now maps over `TIERS.filter(t => t.key !== "free")` — Basic, Growth, Premium, Enterprise — with per-tier CTA branching on `tier.contactSales` (Enterprise → `mailto:${COMPANY.contactEmail}`, "Contact sales") and `tier.key === "basic"` (→ `/sign-up`, "Start free trial"); Growth/Premium render `t("Choose {plan}", { plan: t(tier.name) })`.
- Growth's "Most popular" amber badge and its `.btn-cta` CTA class are driven by `tier.featured === true`, not a hardcoded `tier.key === "growth"` check — if `featured` moves in `lib/plans.ts`, the badge and accent follow automatically.
- Hero's hardcoded fake-data "Product preview" block (stat tiles + fake supplier rows) was replaced with a single `<img src="/hero-placeholder.svg">` inside the existing browser-frame wrapper, plus a `t("Product preview")` caption. `public/hero-placeholder.svg` is a new, real, committed SVG (4 stat tiles + 4 supplier rows in muted blue/slate/emerald/amber, with a baked-in "Product preview — placeholder" caption).
- New "What SourceGPT does" feature grid section (3-wide desktop / 2-wide tablet / stacked mobile, `gap-6`) renders exactly 6 tiles in the required order, each `.card p-7` with a blue icon chip and `text-base font-semibold` title (not `font-bold`, per the 2-weight new-content budget):
  1. **Autonomous Sourcing Engine** (Zap) — "Describe a sourcing need once — AI agents scout, score, and shortlist real suppliers from live web search, end to end."
  2. **Compliance & Audit** (ShieldCheck) — "Every discovery and outreach action is scoped to your organization and logged, with GDPR-aligned data handling built in."
  3. **Workflow Automation** (RefreshCw) — "Background agents automatically enrich and verify suppliers as your pipeline moves — no manual re-checking required."
  4. **Collaboration Hub** (Users) — "Invite your team into a shared organization workspace — everyone sees the same supplier pipeline."
  5. **Budget & Spend Intelligence** (DollarSign) — "Set a spend ceiling per sourcing event and track AI usage cost as it happens — no runaway bills."
  6. **Supplier Marketplace** (Globe2, repositioned, locked copy) — "AI discovers and verifies suppliers live from the web."
- New closing CTA banner section (`## Don't see a perfect fit?` / body / "Talk to sales" `mailto:` button using `.btn-cta`) added after the dark Final CTA section, before the (now-deleted) footer position — the 4th and final amber-accent site on the page.
- Deleted the entire inline `<footer>` block from `LandingContent.tsx`; the global `SiteFooter.tsx` (rendered by `app/layout.tsx`) is now the sole footer on the landing page, fixing the pre-existing stacked-two-footers bug. `Sparkles` import retained (still used in the Hero badge).

## Task Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | `e8b8481` | feat(02-02): read pricing cards live from lib/plans.ts and add hero media slot |
| 2 | `cfd9abd` | feat(02-02): add 6-tile feature grid and closing CTA banner sections |
| 3 | `cdfa7da` | fix(02-02): delete duplicate inline footer from LandingContent |

## Files Created

- `public/hero-placeholder.svg` — static placeholder asset for the Hero media slot; `viewBox="0 0 960 540"`, muted blue/slate/emerald/amber stat-tile and supplier-row mock, with a baked-in "Product preview — placeholder" caption. Swappable for a real screenshot/video with zero code change (D-08).

## Files Modified

- `components/LandingContent.tsx` (231 → 268 lines): imports extended (`RefreshCw`, `DollarSign` from lucide-react; `TIERS`, `displayPrice`, `cadenceSuffix`, `UNLIMITED`, `Cadence` from `@/lib/plans`; `COMPANY` from `@/lib/legal`); Hero fake-data block replaced with real `<img>`; pricing card array restructured to a live `TIERS.filter` map; new feature-grid section inserted between "How it works" and "Pricing"; new closing CTA banner section inserted after Final CTA; inline `<footer>` block deleted entirely.

## Decisions Made

1. **Fixed "monthly" cadence, no new toggle UI.** The plan's Task 1 action item (c) assumed an existing cadence-toggle pattern (weekly/monthly/yearly) to preserve on the landing page. On inspection, no such toggle exists anywhere in the original `LandingContent.tsx` — only `app/billing/page.tsx` has one; the landing page's original 3-card array used a single hardcoded `"$499"` / `"per month"` string. Resolved by introducing `const cadence: Cadence = "monthly"` inside the pricing map, exactly preserving the page's pre-existing implicit always-monthly display, rather than adding new toggle UI the plan didn't otherwise specify. No user decision needed — this preserves prior behavior 1:1.
2. **Feature bullets derived from `tier.limits`, not a hardcoded array.** `lib/plans.ts`'s `Tier` type has no features-copy array — only structured `TierLimits`. Feature bullets for each pricing card are derived dynamically from `eventsPerMonth`/`suppliersPerEvent`/`seats`/`outreach`/`export`, using the same `UNLIMITED` sentinel pattern as `app/billing/page.tsx`'s `limitLabel()`. This satisfies "read live from `lib/plans.ts`" and avoids overstating capabilities (e.g., did not carry over the original hardcoded "SSO & role-based access" Enterprise bullet, which isn't backed by any `TierLimits` field).
3. **Hero fake-data removed entirely, not kept as fallback.** The original stat-tile/supplier-row mock content was deleted outright rather than hidden/retained as a fallback; the `<img>` referencing the committed SVG is now the sole primary visual anchor in the Hero frame, per D-08.

## Deviations from Plan

### Auto-fixed / Clarified (non-blocking)

**1. [Rule 3 - clarification] No pre-existing cadence toggle to preserve**
- **Found during:** Task 1
- **Issue:** Plan assumed an existing weekly/monthly/yearly toggle on the landing pricing section; none exists (only `/billing` has one).
- **Fix:** Fixed `cadence = "monthly"` inside the map — matches prior always-monthly display exactly.
- **Files:** `components/LandingContent.tsx`
- **Commit:** `e8b8481`

**2. [Rule 3 - out-of-scope build blocker] Pre-existing `@anthropic-ai/sdk` build failure**
- **Found during:** Task 1 (attempted `npm run build` per the plan's `<verify>` step)
- **Issue:** `npm run build` fails with `Module not found: Can't resolve '../../core/credentials.mjs'` from `@anthropic-ai/sdk`, traced through `lib/agents.ts` → unrelated API routes — not caused by any file this plan touches. This is the same pre-existing issue documented in `.planning/phases/02-marketing-pricing-surface/deferred-items.md` from plan 02-01 (a stray `anthropic-ai-sdk-0.116.0.tgz` tarball still sits at the repo root, confirming it's the same unresolved condition).
- **Fix (verification substitution):** Since the full build cannot run, verification for all 3 tasks used `npm run typecheck` (passed cleanly each time) + `npm run lint` (passed cleanly) + the plan's own `grep`-based acceptance-criteria checks, in place of the `npm run build` command specified in each task's `<verify><automated>` block. Per the Scope Boundary rule, this pre-existing, out-of-scope failure was not fixed.
- **Files:** none (verification-method substitution only; no code changed to work around this)
- **Commit:** n/a (documented here and already logged in `deferred-items.md`)

### Non-blocking observation (backstop verification item, for the plan 02-04 human checkpoint)

**3. Feature-grid tile body char counts run slightly over the plan's ~110-char backstop estimate.** The plan's `must_haves` backstop asserted char counts of 110/108/105/89/98/51 (all "under 110") for the 6 tile bodies. Counting the verbatim UI-SPEC Copywriting Contract text actually shipped gives higher counts for the first three tiles (roughly 118/120/116/97/96/54) — 6-10 characters over the stated estimate. Since (a) this is explicitly a non-blocking "backstop" verification item, not an automated gate, (b) the text shipped is the UI-SPEC's exact locked copy (the safest, most defensible source), and (c) each tile card has generous `p-7` (28px) padding and `leading-relaxed` body text that comfortably accommodates 3 lines at 16px/1.5 without breaking the grid, no copy was shortened. Flagging here for the plan 02-04 visual checkpoint to confirm no layout issue results.

None of the above required a Rule 4 (architectural) escalation — no user decision needed.

## Known Stubs

None. All content shipped is either live-data-driven (`lib/plans.ts` pricing) or real static UI (feature grid, CTA banner, hero SVG) — no hardcoded-empty-value or "coming soon" placeholders were introduced.

## Threat Flags

None. The one new trust-boundary item (static SVG asset serving) was already anticipated and dispositioned `accept` in the plan's own `<threat_model>`; no new surface was introduced beyond it.

## Issues Encountered

- See "Deviations from Plan" above — the pre-existing `@anthropic-ai/sdk` build failure required substituting `npm run typecheck` + `npm run lint` + targeted `grep` checks for the plan's `npm run build` verification step on all 3 tasks. `npx vitest run tests/plans.test.ts` was also re-run after all tasks (24/24 passed), confirming no regression to `lib/plans.ts` (untouched by this plan, as expected).

## User Setup Required

None.

## Next Phase Readiness

- Plan 02-03 (SiteFooter/SocialIcons/CCPA page) operates on disjoint files (`components/SiteFooter.tsx`, `components/icons/SocialIcons.tsx`, `app/legal/ccpa/page.tsx`) and was not touched by this plan.
- Plan 02-04 (full phase verification: typecheck + lint + test + build + human visual checkpoint) can now run against the composed result of 02-01/02-02/02-03. Note for that checkpoint: the pre-existing `@anthropic-ai/sdk` build failure (documented in `deferred-items.md`) will still block a clean `npm run build` unless resolved separately — it is unrelated to any file this phase's plans touch.
- The amber-accent-cap of exactly 4 sites (Hero CTA, Growth badge+CTA, Final CTA, Closing CTA banner) is grep-verifiable via `grep -c 'btn-cta' components/LandingContent.tsx` — confirmed as exactly 4 occurrences at the end of this plan's work.

## Self-Check: PASSED

- FOUND: `components/LandingContent.tsx`
- FOUND: `public/hero-placeholder.svg`
- FOUND commit: `e8b8481`
- FOUND commit: `cfd9abd`
- FOUND commit: `cdfa7da`
