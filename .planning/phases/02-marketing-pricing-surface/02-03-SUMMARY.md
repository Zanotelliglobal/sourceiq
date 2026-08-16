---
phase: 02-marketing-pricing-surface
plan: 03
subsystem: marketing
tags: [footer, legal, ccpa, social-icons, svg, lucide-react-workaround]
requires:
  - "02-02: components/LandingContent.tsx inline <footer> deleted — global SiteFooter.tsx is now the sole footer on the landing page"
provides:
  - "components/icons/SocialIcons.tsx — FacebookIcon/InstagramIcon/LinkedinIcon inline-SVG brand icons"
  - "components/SiteFooter.tsx extended with logo, tagline, mailto contact, 3 social icons, 3 legal links, copyright"
  - "app/legal/ccpa/page.tsx — real CCPA/CPRA disclosure page"
affects:
  - "components/SiteFooter.tsx"
  - "components/icons/SocialIcons.tsx"
  - "app/legal/ccpa/page.tsx"
tech-stack:
  patterns:
    - "Inline-SVG brand-icon module instead of a new npm dependency — lucide-react ^1.30.0 dropped all brand/company icons in its v1.0 release (Pitfall 3), and the evaluated alternative (@icons-pack/react-simple-icons) returned a SUS package-legitimacy verdict during phase research, so it was not added"
    - "Brand icon path data copied verbatim from canonical sources (Simple Icons CC0, Font Awesome Free) and normalized into a single shared 24x24 viewBox via SVG <g transform=\"scale(...)\"> rather than freehand-traced, satisfying the project's anti-tampering constraint (T-02-06)"
    - "CCPA page mirrors the existing app/legal/privacy and app/legal/terms server-component structure exactly (Metadata export, local mailto() helper, LegalLayout/LegalSection/LegalList composition) instead of inventing a new legal-page pattern"
key-files:
  created:
    - components/icons/SocialIcons.tsx
    - app/legal/ccpa/page.tsx
  modified:
    - components/SiteFooter.tsx
key-decisions:
  - "Social media hrefs are placeholder destinations (https://facebook.com/sourcegpt, https://instagram.com/sourcegpt, https://linkedin.com/company/sourcegpt) — no live SourceGPT social accounts exist yet. The requirement satisfied is that the icons render, are labeled, and link somewhere plausible, not that the destinations resolve to real accounts in the wild (plan Task 2 discretion)."
  - "LinkedIn icon sourced from Font Awesome Free's linkedin-in glyph (native viewBox 0 0 448 512) rather than Simple Icons, per the pre-resolved decision carried into this execution; wrapped in <g transform=\"translate(1.5 0) scale(0.046875)\"> to normalize into the shared 24x24 viewBox without redrawing the path."
  - "CCPA page content is the product's actual, real data-practice disclosure — it explicitly states it is not a legal opinion or a document reviewed by legal counsel (D-07, mitigates T-02-05 false-legal-review-claim repudiation risk), rather than a stock/boilerplate CCPA template."
estimate:
  tokens: 45000
  raw_tokens: 35000
  tasks: 3
  confidence: low
actuals:
  tokens: 34000
  tasks: 3
  commits: 3
requirements-completed: [MKT-02, MKT-03]
coverage:
  MKT-02: "Global SiteFooter.tsx extended in place with logo+wordmark, mailto contact, 3 labeled social icons, 3 legal links (Privacy/Terms/CCPA), tagline, and copyright, all wrapped in flex-wrap rows for narrow-viewport overflow safety"
  MKT-03: "New app/legal/ccpa/page.tsx ships a real CCPA/CPRA disclosure (categories collected, consumer rights, how to exercise them, notice at collection, financial incentives, contact) linked from the footer's new CCPA Policy link"
duration: "~25 min"
completed: 2026-08-16
status: complete
---

# Phase 02 Plan 03: Footer Social Icons & CCPA Policy Page Summary

Extended the global `SiteFooter.tsx` with a logo/wordmark, mailto contact, three custom inline-SVG social brand icons, and three legal links, then added a real `app/legal/ccpa/page.tsx` disclosure page mirroring the existing Privacy/Terms structure — closing out the last two marketing-surface requirements (MKT-02, MKT-03) for this phase.

## Accomplishments

- New `components/icons/SocialIcons.tsx` module exports `FacebookIcon`, `InstagramIcon`, `LinkedinIcon` as typed `SVGProps<SVGSVGElement>` presentational components, each rendering `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>`. This avoids two disallowed paths: importing brand icons from `lucide-react` (removed entirely in v1.0, per Pitfall 3) and adding a new npm dependency (`@icons-pack/react-simple-icons` was evaluated during phase research and returned a SUS package-legitimacy verdict, so it was not added).
- Facebook and Instagram icon path data copied verbatim from Simple Icons (CC0-licensed, native 24x24 viewBox, no transform needed). LinkedIn icon path data copied verbatim from Font Awesome Free's `linkedin-in` glyph (native viewBox `0 0 448 512`), wrapped in `<g transform="translate(1.5 0) scale(0.046875)">` to normalize it into the shared 24x24 viewBox — the path itself is never redrawn, only repositioned via SVG transform, satisfying the project's prohibition on freehand-traced brand marks (T-02-06 mitigation). Sourced 2026-08-16.
- `components/SiteFooter.tsx` extended from its prior 19-line minimal version into a full footer: top row splits into a left cluster (blue rounded-square `Sparkles` logo + "SourceGPT" wordmark, `mailto:${COMPANY.contactEmail}` contact link) and a right cluster (3 social-icon anchors with `aria-label="Follow SourceGPT on {Platform}"`, then Privacy/Terms/CCPA legal links); bottom row separates the tagline from the copyright line. Both rows use `flex flex-wrap` so the footer degrades gracefully on narrow viewports instead of overflowing.
- New `app/legal/ccpa/page.tsx` server component (no `"use client"`) mirrors the exact structural template of `app/legal/privacy/page.tsx` and `app/legal/terms/page.tsx` (`Metadata` export, local `mailto()` helper, `LegalLayout`/`LegalSection`/`LegalList` composition, `COMPANY` singleton for the contact address — no hardcoded email). Six sections:
  1. **Categories of personal information we collect** — reuses the same 5 categories from the Privacy Policy (Account, Billing, Sourcing, Communications, Usage & technical data).
  2. **Your CCPA rights** — right to know, right to delete, right to opt out (explicitly states SourceGPT does not sell or share personal data for cross-context behavioral advertising), right to correct, right to non-discrimination.
  3. **How to exercise your rights** — `mailto()` contact plus a verification-process paragraph.
  4. **Notice at collection** — what's collected at signup vs. during use, and the business purpose for each.
  5. **Financial incentives** — states plainly that no financial incentive/discount is offered in exchange for personal information.
  6. **Contact** — closing contact paragraph via `mailto()`.
  The intro paragraph explicitly states this notice "reflects our actual data practices — it is not, and does not claim to be, a legal opinion or a document reviewed by legal counsel" (D-07, mitigates T-02-05 repudiation risk of a false legal-review claim).
- Footer's new `/legal/ccpa` link target matches the new route exactly (`app/legal/ccpa/page.tsx` → `/legal/ccpa`).

## Task Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | `7b7c5a3` | feat(02-03): add inline-SVG social brand icons (Pitfall 3 workaround) |
| 2 | `b8cea30` | feat(02-03): extend global SiteFooter with full MKT-02 footer content |
| 3 | `c69c23c` | feat(02-03): add real CCPA disclosure page mirroring Privacy/Terms |

## Files Created

- `components/icons/SocialIcons.tsx` — `FacebookIcon`, `InstagramIcon`, `LinkedinIcon` named exports; file-header comment documents provenance (Simple Icons CC0 for Facebook/Instagram, Font Awesome Free `linkedin-in` for LinkedIn) and the reasoning for not using `lucide-react` or a new npm package.
- `app/legal/ccpa/page.tsx` — 81-line real CCPA/CPRA disclosure server component, structurally identical to `app/legal/privacy/page.tsx`.

## Files Modified

- `components/SiteFooter.tsx` (19 → 74 lines): added `FacebookIcon`/`InstagramIcon`/`LinkedinIcon` imports from `@/components/icons/SocialIcons` and `COMPANY` from `@/lib/legal`; rebuilt the footer markup with logo/wordmark, mailto contact, 3 labeled social icons, 3 legal links (Privacy/Terms/CCPA), tagline, and copyright, all inside `flex flex-wrap` containers.

## Decisions Made

1. **Placeholder social URLs, real icon rendering.** No live SourceGPT social accounts exist yet. The three social hrefs (`https://facebook.com/sourcegpt`, `https://instagram.com/sourcegpt`, `https://linkedin.com/company/sourcegpt`) are plausible placeholder destinations. The plan's requirement is satisfied by the icons rendering correctly with proper `aria-label`s, not by the URLs resolving to real accounts — this matches the plan's Task 2 discretion note.
2. **LinkedIn sourced from Font Awesome Free, not Simple Icons.** Per the pre-resolved decision carried into this execution, Facebook/Instagram use Simple Icons' native 24x24 paths directly, while LinkedIn uses Font Awesome Free's `linkedin-in` glyph (native `0 0 448 512` viewBox) normalized into the shared 24x24 box via `<g transform="translate(1.5 0) scale(0.046875)">` — computed as `scale = 24/512` with a small centering translate, never redrawing the path data by hand.
3. **CCPA content is a genuine disclosure, not a legal-review claim.** The intro paragraph explicitly disclaims formal legal review while still describing SourceGPT's actual data practices, directly satisfying D-07 and mitigating threat model item T-02-05 (repudiation risk of falsely implying legal counsel reviewed the notice).

## Deviations from Plan

### Auto-fixed / Verification substitution (non-blocking)

**1. [Rule 3 - out-of-scope build blocker] Pre-existing `@anthropic-ai/sdk` build failure**
- **Found during:** Task 2 (attempted `npm run build` per the plan's `<verify>` step)
- **Issue:** `npm run build` fails with `Module not found: Can't resolve '../../core/credentials.mjs'` from `@anthropic-ai/sdk`, traced through `lib/agents.ts` → `app/api/qualify/route.ts` — not caused by any file this plan touches. This is the same pre-existing, already-documented issue from `.planning/phases/02-marketing-pricing-surface/deferred-items.md`, first flagged in plan 02-01 (commit `a7823bc`) and re-confirmed unfixed in plan 02-02.
- **Fix (verification substitution):** Since the full build cannot run, verification for all 3 tasks used `npx tsc --noEmit` (0 errors on every file this plan touched) plus the plan's own literal `grep`-based acceptance-criteria checks, in place of the `npm run build` command specified in each task's `<verify><automated>` block. Per the Scope Boundary rule, this pre-existing, out-of-scope failure was not fixed and no code was changed to work around it.
- **Files:** none (verification-method substitution only)
- **Commit:** n/a (documented here and already logged in `deferred-items.md`)

No Rule 4 (architectural) escalations were needed — no user decision required.

## Known Stubs

None. The social media hrefs are placeholder destinations by explicit plan discretion (see Decisions Made #1), not stubs blocking the plan's goal — the icons, labels, and legal links are all fully wired and functional.

## Threat Flags

None. Both threat model items assigned to this plan (T-02-05 false-legal-review-claim, T-02-06 freehand-traced-icon tampering) were mitigated as designed; no new unaddressed surface was introduced.

## Issues Encountered

- See "Deviations from Plan" above — the pre-existing `@anthropic-ai/sdk` build failure required substituting `npx tsc --noEmit` plus targeted `grep` checks for the plan's `npm run build` verification step on Tasks 2 and 3.

## User Setup Required

None.

## Next Phase Readiness

- This plan operated on files disjoint from 02-01 and 02-02 (`components/icons/SocialIcons.tsx`, `components/SiteFooter.tsx`, `app/legal/ccpa/page.tsx`), so no merge conflicts are expected when the wave's plans are combined.
- Plan 02-04 (full phase verification: typecheck + lint + test + build + human visual checkpoint) can now run against the composed result of 02-01/02-02/02-03. The pre-existing `@anthropic-ai/sdk` build failure (documented in `deferred-items.md`) will still block a clean `npm run build` unless resolved separately — it is unrelated to any file any plan in this phase touches.
- Footer is now confirmed as the single, non-duplicated footer across the site (inline footer deleted in 02-02, global `SiteFooter.tsx` extended here) — no further footer-related work expected before ship.

## Self-Check: PASSED

- FOUND: `components/icons/SocialIcons.tsx`
- FOUND: `components/SiteFooter.tsx`
- FOUND: `app/legal/ccpa/page.tsx`
- FOUND commit: `7b7c5a3`
- FOUND commit: `b8cea30`
- FOUND commit: `c69c23c`
