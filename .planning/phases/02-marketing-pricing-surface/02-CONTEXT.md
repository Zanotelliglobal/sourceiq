# Phase 2: Marketing & Pricing Surface - Context

**Gathered:** 2026-08-15 (interactive discussion — default mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the current 5-tier EUR pricing structure (`lib/plans.ts`) with 3 paid tiers +
1 "Contact us" enterprise tier, priced in USD with a ~$1,400-1,500/month base tier and
roughly 1.5-2x step-ups between paid tiers. Free trial is available only on the base
paid tier (no separate free tier). Rework the landing page (`components/LandingContent.tsx`):
add a closing CTA banner before the footer, extend `components/SiteFooter.tsx` with
logo/tagline/contact/social/legal links/copyright, add a new CCPA Policy page, add a
new feature-grid "what we do" section with specific resolved copy per tile, and wire up
a hero demo video/screenshot placeholder slot. Out of scope: DNS/Stripe dashboard
display-name edits, trademark review (per PROJECT.md Out of Scope).

</domain>

<decisions>
## Implementation Decisions

### Existing-customer grandfathering (PRICE-05)
- **D-01:** The project has **no real paying customers yet** — grandfathering/migration
  concerns are moot. No legacy-tier mapping or Stripe migration logic is needed.
  PRICE-05's "no billing-gate outage" acceptance criterion should be satisfied simply by
  ensuring any existing dev/test org rows still resolve to a valid tier after the
  `TIERS` catalog changes (e.g. don't leave orphaned `plan` values pointing at deleted
  tier keys) — a lightweight defensive check, not a migration project. — **User
  confirmed directly:** "I dont have any customers yet, not an issue."

### New tier structure
- **D-02:** Reuse the existing tier **names** Basic, Growth, and Premium for the 3 new
  paid tiers (re-priced in USD at the new higher price points, re-scoped limits) rather
  than inventing new names. The current `pro` tier is retired/folded into the new
  "Contact us" Enterprise tier (no listed price).
- **D-03:** Base tier (Basic) lands in the ~$1,400-1,500/month range; Growth and Premium
  step up roughly 1.5-2x each from the tier below, per PRICE-02. Exact numbers and
  per-tier limits (events/mo, waves/event, suppliers/event, seats) are left to the
  planner/researcher to derive — scaled sensibly from the current limits ladder in
  `lib/plans.ts`, following the existing `TierLimits` shape.
- **D-04:** Currency switches from EUR to USD (`monthlyEur` → a USD-based field, or
  equivalent rename) — this touches `lib/plans.ts`, `app/billing/page.tsx`'s display,
  and the landing page pricing section in `components/LandingContent.tsx`.

### Free trial mechanics (PRICE-03)
- **D-05:** Trial runs as a Stripe trial period on the **Basic** tier's checkout flow
  (`trial_period_days` set on the Stripe subscription, e.g. 14 days — matching the
  existing "14-day free trial, no credit card required" copy already in `app/page.tsx`'s
  `jsonLd`). No separate "Free/Trial" tier card should remain in the pricing UI — the
  landing page's current 3-card array (Trial/Growth/Enterprise, ~line 152-157 in
  `components/LandingContent.tsx`) needs restructuring to show Basic/Growth/Premium +
  Enterprise, with Basic being the only trial-entry-point card.
- Whether card is required at Stripe Checkout for the trial is a Stripe Checkout
  config choice, left to implementation — not a new application code path.

### Feature-grid section (MKT-04)
- **D-06:** This is **new section content**, not a copy edit — no feature-grid section
  currently exists anywhere in `components/LandingContent.tsx` (confirmed by grep: zero
  matches for "Autonomous Sourcing," "Compliance," "Workflow Automation," "Collaboration
  Hub," "Marketplace" in the current landing page). Add a new "what we do" feature-grid
  section (6 tiles) per the backlog's already-resolved mapping
  (`docs/change-request-backlog.md` §6):
  - **Include as-is:** Autonomous Sourcing Engine, Compliance & Audit.
  - **Reword** (partial/actual functionality, less than reference-site claims):
    Workflow Automation, Collaboration Hub, Budget & Spend Intelligence — exact wording
    not yet drafted anywhere; Claude drafts it during planning/execution (user
    explicitly chose "add the section per backlog spec," not a review checkpoint for
    this copy).
  - **Reposition:** "Supplier Marketplace" tile copy → *"AI discovers and verifies
    suppliers live from the web"* (exact wording already finalized in the backlog).
  - **Exclude entirely:** RFP & Intake Tools, ERP/API Integrations tiles (grep-confirmed
    no such functionality exists today).

### CCPA policy page (MKT-03)
- **D-07:** Draft a standard, genuine CCPA disclosure (categories of data collected,
  right to know/delete/opt-out, non-discrimination clause) adapted to SourceGPT's
  actual data practices — same treatment/tone as the existing `app/legal/privacy` and
  `app/legal/terms` pages (real content, not a placeholder stub), added as a new route
  parallel to those two pages. No claim of formal legal review.

### Hero demo slot (MKT-05)
- **D-08:** Ship a **static screenshot placeholder** in the hero — a styled
  image/card slot (e.g. browser-frame or product-card mock) showing a placeholder
  product screenshot, with the structure wired so a real screenshot/video asset can
  drop in later. Not a video-player-with-play-button placeholder.

### Footer + closing CTA (MKT-01, MKT-02)
- **D-09:** `components/SiteFooter.tsx` (19 lines today, only logo + Privacy/Terms
  links + copyright) gets extended in place — not rebuilt from scratch — to add: a
  one-line mission tagline, contact email, social icons (Facebook, Instagram,
  LinkedIn), and the new CCPA Policy link alongside existing Privacy/Terms links.
- **D-10:** A closing CTA banner ("Don't see a perfect fit?"-style) is added to
  `components/LandingContent.tsx` before the footer section — separate from and in
  addition to the existing "Final CTA" section already at ~line 189-209 (that one is a
  general "Deploy your first AI sourcing event today" CTA; the new one specifically
  addresses fit/plan uncertainty per the backlog's framing).

### Verification
- **D-11:** Full verification suite (`npm run typecheck && npm run lint && npm test &&
  npm run build`) gates completion, matching the project's established pattern (same as
  Phase 1).

### Claude's Discretion
- Exact USD price points and per-tier limits within the ~$1,400-1,500 base / 1.5-2x
  step-up constraints.
- Exact reworded copy for Workflow Automation, Collaboration Hub, and Budget & Spend
  Intelligence feature-grid tiles.
- Visual layout/styling details for the new feature-grid section, footer extension, and
  closing CTA banner — following existing Tailwind/card patterns already used elsewhere
  in `LandingContent.tsx`.
- Whether Stripe Checkout requires a card for the Basic-tier trial period.
- New Stripe Price object naming/creation mechanics for the new tier × cadence matrix
  (PRICE-04) — standard `STRIPE_PRICE_<TIER>_<CADENCE>` env var pattern already
  established in `lib/plans.ts`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Backlog source
- `docs/change-request-backlog.md` §2 (lines 78-100) — pricing restructure scope, open
  questions (now resolved above).
- `docs/change-request-backlog.md` §3 (lines 104-124) — footer + closing CTA banner
  scope, CCPA open question (resolved above).
- `docs/change-request-backlog.md` §6 (lines 167-194) — feature-grid repositioning,
  fully resolved tile-by-tile mapping (Include/Reword/Reposition/Exclude).

### Requirements
- `.planning/REQUIREMENTS.md` — PRICE-01 through PRICE-05, MKT-01 through MKT-05 (full
  acceptance criteria for this phase).

### Roadmap
- `.planning/ROADMAP.md` — Phase 2 goal and success criteria (lines 63-78).

### Project context
- `.planning/PROJECT.md` — Out of Scope section.
- `.planning/STATE.md` — prior note on trialing orgs already getting Basic-equivalent
  limits via `effectiveTier()` (relevant background for D-05, though that specific
  mechanism was about the current trial state, not a locked requirement for this phase).

No external specs — requirements fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/plans.ts` — single source of truth for `TIERS`, `TierLimits`, cadence pricing
  (`CADENCES`, `YEARLY_DISCOUNT`, `WEEKLY_PREMIUM`), `priceEnvVar()`/`priceIdFor()`
  Stripe price-id resolution pattern. Extend/modify in place, don't parallel-build.
- `components/SiteFooter.tsx` (19 lines) — existing footer component to extend, not
  replace. (Note: `components/LandingContent.tsx` also has its own inline `<footer>`
  block at ~line 212-228 that duplicates some footer content — planner should
  reconcile whether `SiteFooter.tsx` is actually used on the landing page or whether
  the inline footer needs to become the extension target instead.)
- `app/billing/page.tsx` (417 lines) — reads from `lib/plans.ts` for the in-app billing
  UI; must stay in sync with any `TIERS`/currency-field renames.
- `app/legal/privacy/page.tsx`, `app/legal/terms/page.tsx` — existing legal page pattern
  to mirror for the new CCPA page route.

### Established Patterns
- Stripe price resolution: `priceEnvVar(tier, cadence)` → `STRIPE_PRICE_<TIER>_<CADENCE>`
  env var lookup, missing env var just hides that option (no hard failure).
- Verification pattern: `npm run typecheck && npm run lint && npm test && npm run
  build` (same as Phase 1).

### Integration Points
- `components/LandingContent.tsx` (231 lines) — Hero → Proof stats → How it works →
  Pricing (inline 3-card array, ~line 143-187) → Final CTA (~line 189-209) → inline
  footer (~line 212-228). New feature-grid section, closing CTA banner, and pricing
  card restructuring all land here.
- `app/page.tsx` — server wrapper with `jsonLd` structured data already stating "14-day
  free trial, no credit card required" (D-05 should stay consistent with this existing
  claim).
- `app/api/billing/status/route.ts`, `lib/billing.ts` — read `TIERS`/tier keys; must
  keep working with new tier catalog.

</code_context>

<specifics>
## Specific Ideas

No specific visual mockups or exact price numbers were provided in this session — the
user deferred those specifics to Claude's discretion within the constraints already
locked above (base ~$1,400-1,500/mo, 1.5-2x step-ups, Basic/Growth/Premium names,
6-tile feature grid per the backlog's resolved mapping).

</specifics>

<deferred>
## Deferred Ideas

None raised this session — no scope-creep suggestions came up during discussion.

### Reviewed Todos (not folded)
None — `todo.match-phase 2` returned zero matches.

</deferred>

---

*Phase: 2-Marketing & Pricing Surface*
*Context gathered: 2026-08-15*
