# Phase 2: Marketing & Pricing Surface - Research

**Researched:** 2026-08-15
**Domain:** In-repo pricing-catalog refactor (`lib/plans.ts`), Stripe Checkout Session trial configuration, Next.js/Tailwind marketing-page composition, legal-page content drafting
**Confidence:** HIGH (codebase mechanics — every claim below was read directly from source) / MEDIUM (Stripe trial-config API behavior — official docs confirmed via search, not fetched verbatim) / LOW→resolved (lucide-react social icons — confirmed via web search + GitHub issue, see Pitfall 3)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (Existing-customer grandfathering, PRICE-05):** The project has no real
  paying customers yet — grandfathering/migration concerns are moot. No legacy-tier
  mapping or Stripe migration logic is needed. PRICE-05's "no billing-gate outage"
  criterion is satisfied by a lightweight defensive check: don't leave orphaned
  `plan` values pointing at deleted tier keys. User confirmed directly: "I dont have
  any customers yet, not an issue."
- **D-02 (New tier structure):** Reuse existing tier **names** Basic, Growth, Premium
  for the 3 new paid tiers (re-priced in USD, re-scoped limits) rather than inventing
  new names. The current `pro` tier is retired/folded into the new "Contact us"
  Enterprise tier (no listed price).
- **D-03 (Pricing/limits derivation):** Basic lands ~$1,400-1,500/month; Growth and
  Premium step up roughly 1.5-2x each from the tier below, per PRICE-02. Exact
  numbers and per-tier limits (events/mo, waves/event, suppliers/event, seats) are
  left to the planner/researcher — scaled sensibly from the current limits ladder in
  `lib/plans.ts`, following the existing `TierLimits` shape.
- **D-04 (Currency):** Currency switches from EUR to USD (`monthlyEur` → a USD-based
  field, or equivalent rename) — touches `lib/plans.ts`, `app/billing/page.tsx`'s
  display, and the landing page pricing section in `components/LandingContent.tsx`.
- **D-05 (Free trial mechanics, PRICE-03):** Trial runs as a Stripe trial period on
  the Basic tier's checkout flow (`trial_period_days` set on the Stripe subscription,
  e.g. 14 days — matching the existing "14-day free trial, no credit card required"
  copy already in `app/page.tsx`'s `jsonLd`). No separate "Free/Trial" tier card
  should remain in the pricing UI — the landing page's current 3-card array
  (Trial/Growth/Enterprise, ~line 152-157) needs restructuring to show
  Basic/Growth/Premium + Enterprise, with Basic being the only trial-entry-point
  card. Whether card is required at Stripe Checkout for the trial is a Stripe
  Checkout config choice, left to implementation — not a new application code path.
- **D-06 (Feature-grid section, MKT-04):** New section content, not a copy edit — no
  feature-grid section currently exists anywhere in `LandingContent.tsx`. Add a new
  "what we do" feature-grid section (6 tiles) per `docs/change-request-backlog.md`
  §6:
  - Include as-is: Autonomous Sourcing Engine, Compliance & Audit.
  - Reword (partial/actual functionality): Workflow Automation, Collaboration Hub,
    Budget & Spend Intelligence — exact wording not yet drafted; Claude drafts it
    during planning/execution.
  - Reposition: "Supplier Marketplace" tile copy → *"AI discovers and verifies
    suppliers live from the web"* (exact wording already finalized).
  - Exclude entirely: RFP & Intake Tools, ERP/API Integrations tiles.
- **D-07 (CCPA policy page, MKT-03):** Draft a standard, genuine CCPA disclosure
  (categories of data collected, right to know/delete/opt-out, non-discrimination
  clause) adapted to SourceGPT's actual data practices — same treatment/tone as
  `app/legal/privacy` and `app/legal/terms`, added as a new route parallel to those
  two pages. No claim of formal legal review.
- **D-08 (Hero demo slot, MKT-05):** Ship a static screenshot placeholder in the hero
  — a styled image/card slot (e.g. browser-frame or product-card mock) showing a
  placeholder product screenshot, with structure wired so a real screenshot/video
  asset can drop in later. Not a video-player-with-play-button placeholder.
- **D-09 (Footer, MKT-01/MKT-02):** `components/SiteFooter.tsx` (19 lines today, only
  logo + Privacy/Terms links + copyright) gets extended in place — not rebuilt from
  scratch — to add: a one-line mission tagline, contact email, social icons
  (Facebook, Instagram, LinkedIn), and the new CCPA Policy link alongside existing
  Privacy/Terms links.
- **D-10 (Closing CTA banner):** A closing CTA banner ("Don't see a perfect
  fit?"-style) is added to `LandingContent.tsx` before the footer section —
  separate from and in addition to the existing "Final CTA" section already at
  ~line 189-209 (general "Deploy your first AI sourcing event today" CTA).
- **D-11 (Verification):** Full verification suite (`npm run typecheck && npm run
  lint && npm test && npm run build`) gates completion, matching the project's
  established pattern.

### Claude's Discretion

- Exact USD price points and per-tier limits within the ~$1,400-1,500 base / 1.5-2x
  step-up constraints. (Resolved below — see Standard Stack.)
- Exact reworded copy for Workflow Automation, Collaboration Hub, and Budget & Spend
  Intelligence feature-grid tiles.
- Visual layout/styling details for the new feature-grid section, footer extension,
  and closing CTA banner — following existing Tailwind/card patterns already used
  elsewhere in `LandingContent.tsx`.
- Whether Stripe Checkout requires a card for the Basic-tier trial period.
- New Stripe Price object naming/creation mechanics for the new tier × cadence
  matrix (PRICE-04) — standard `STRIPE_PRICE_<TIER>_<CADENCE>` env var pattern
  already established in `lib/plans.ts`.

### Deferred Ideas (OUT OF SCOPE)

None raised this session. Also out of scope per `PROJECT.md`: DNS/Stripe dashboard
display-name edits, trademark review.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PRICE-01 | 3 paid tiers + 1 "Contact us" enterprise tier on the pricing page, replacing the 5-tier display | See "New tier structure" in Architecture Patterns; Pitfall 1 (don't delete the `free` key, only stop displaying it) |
| PRICE-02 | USD pricing, ~1.5-2x step-ups, base ~$1,400-1,500/mo | See "Recommended price points" in Standard Stack |
| PRICE-03 | Free trial only on base paid tier, no separate free tier offered | See "Trial mechanics" in Architecture Patterns; Open Question 1 (dual trial mechanism) |
| PRICE-04 | New Stripe Price objects for every new tier × cadence, wired to `lib/plans.ts` | See "Stripe price env var matrix" in Code Examples; Environment Availability (manual Stripe dashboard step) |
| PRICE-05 | Existing orgs' `plan` values resolve to a valid tier post-deploy | See Pitfall 1 (orphaned `plan` values), D-01 (moot — no real customers) |
| MKT-01 | Closing CTA banner before the footer | See "Footer + closing CTA reconciliation" in Architecture Patterns |
| MKT-02 | Footer: logo, tagline, contact email, social icons, legal links (incl. CCPA), copyright | See Pitfall 3 (lucide-react social icons), Code Examples (SocialIcons component) |
| MKT-03 | New CCPA Policy page, real content, parallel route to Privacy/Terms | See "Legal page pattern" in Architecture Patterns; Code Examples (CCPA page skeleton) |
| MKT-04 | Feature-grid copy repositioned per backlog mapping | See "New tier structure" section skipped — see D-06 above; no additional research needed beyond backlog mapping (copy-only, no code-logic risk) |
| MKT-05 | Hero demo video/screenshot slot (placeholder acceptable) | See Pitfall 4 (existing hero mock is not a real media slot) |
</phase_requirements>

## Summary

This phase is a content/catalog refactor, not a new-technology phase: no new npm
packages, no new architecture layers. The two genuine engineering risks are (1) the
Stripe pricing-catalog surgery in `lib/plans.ts` — a single-source-of-truth object
consumed by three different UI/gating call sites — and (2) two pre-existing landmines
in the current codebase that this phase's scope will trip over if not accounted for:
a duplicate-footer bug (`SiteFooter.tsx` global + `LandingContent.tsx`'s own inline
`<footer>` both render on `/`) and a hard dependency conflict (the installed
`lucide-react@^1.30.0` removed all brand icons — including Facebook/Instagram/
LinkedIn — in its v1.0 release, so the icons MKT-02 asks for cannot be imported from
the library already used everywhere else in this file).

Everything else is copy and Tailwind composition following patterns already
established in the repo: `app/legal/privacy` and `app/legal/terms` give an exact
template for the new CCPA page (same `LegalLayout`/`LegalSection`/`LegalList`
components, same `COMPANY` constant, same `en`-source-language i18n pattern where
`t()` falls back to the English string if a locale key is missing — new copy is
never build-breaking for translation reasons).

The one item requiring most care in planning is the "Free trial only on Basic"
requirement (PRICE-03/D-05): the codebase already has a fully independent,
tier-agnostic **app-level** trial mechanism (`organizations.trial_ends_at`, set at
org auto-provisioning, unrelated to Stripe) that grants every new org 14 days of
Basic-equivalent access regardless of which tier they eventually subscribe to. Adding
a Stripe-side `trial_period_days` to the Basic checkout session (per D-05) creates a
**second**, independently-timed trial mechanism layered on top of the first. Neither
mechanism needs to be removed — `requireActiveSubscription()`/
`requireSpendableSubscription()` already OR-combine both signals — but the planner
should document this overlap explicitly rather than silently introduce a second trial
clock. See Open Question 1.

**Primary recommendation:** Extend `lib/plans.ts` in place (rename `monthlyEur` →
`monthlyUsd`, keep the `TierLimits` shape unchanged, keep the `free` tier key as an
internal/non-displayed fallback, rename `pro`'s display name to "Enterprise" with a
new `contactSales: true` flag rather than overloading `monthlyUsd === 0`). Remove
`LandingContent.tsx`'s duplicate inline `<footer>` and extend the global
`SiteFooter.tsx` instead (single footer, single source of truth). Use custom inline
SVG components for the three social icons rather than adding a new icon-pack
dependency.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Pricing catalog (tiers, limits, USD prices) | API / Backend (`lib/plans.ts`, shared) | Browser (renders it in 2 places) | `lib/plans.ts` has zero framework dependencies — it's plain TS consumed by both a client component (`LandingContent.tsx`) and a Next.js page (`app/billing/page.tsx`); it is the single source of truth by existing design, not something this phase introduces |
| Stripe Checkout Session creation (incl. trial config) | API / Backend (`app/api/stripe/checkout/route.ts`) | — | Must stay server-side: it holds `STRIPE_SECRET_KEY` and constructs the session before redirecting the browser |
| Subscription state sync (webhook) | API / Backend (`app/api/stripe/webhook/route.ts`) | Database | Stripe is the source of truth for `subscription_status`; the webhook mirrors it onto `organizations` — untouched by this phase except that `getTier(sub.metadata.tier)` must still resolve correctly against the new tier keys |
| Marketing landing page (hero, pricing cards, feature grid, closing CTA) | Browser / Client Component (`components/LandingContent.tsx`) | — | Already a `"use client"` component for i18n; no SSR data fetching involved, pure presentational composition |
| Site-wide footer | Browser / Client Component (`components/SiteFooter.tsx`), rendered from `app/layout.tsx` (server) | — | Rendered once, globally, for every route — this is the correct architectural home for MKT-02's footer requirements (not `LandingContent.tsx`'s inline duplicate, which should be removed) |
| CCPA legal page content | Frontend Server (SSR) — plain server component, no client interactivity | — | Matches `app/legal/privacy/page.tsx` / `app/legal/terms/page.tsx`, which are server components (no `"use client"`) |
| Billing gate logic (`requireActiveSubscription`, `effectiveTier`) | API / Backend (`lib/billing.ts`, `lib/usage.ts`) | Database | Reads `TIERS`/`org.plan`/`org.trial_ends_at` — must keep resolving correctly after the tier catalog changes (this is exactly PRICE-05's concern) |

## Standard Stack

### Core

No new libraries are required for this phase. The existing stack fully covers every
requirement:

| Library | Version (installed) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `stripe` | 22.4.0 (npm latest: 22.5.0 [VERIFIED: npm registry — `npm view stripe version` run this session]) | Checkout Session / subscription trial config | Already the project's payment processor; `trial_period_days`, `payment_method_collection`, and `trial_settings.end_behavior` are long-stable Checkout Session API fields, not new SDK surface — no version bump needed for this phase |
| `lucide-react` | ^1.30.0 (installed, per `package.json`) | Icons | Already used throughout `LandingContent.tsx`/`SiteFooter.tsx`; **cannot** supply the 3 social-brand icons MKT-02 needs — see Pitfall 3 |

### Supporting

No supporting packages need to be added. If the planner considers an icon-pack
dependency instead of inline SVGs for the social icons (see Pitfall 3), note that
`@icons-pack/react-simple-icons` returned a `SUS` verdict from the package-legitimacy
check this session — not because it is confirmed malicious, but because registry
metadata (age/downloads/repo) could not be resolved in this sandboxed environment.
**Recommendation: do not add it.** Use inline SVGs (zero new dependency surface,
matches the "small, in-place" scope of this phase).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom inline SVG social icons | `@icons-pack/react-simple-icons` (new dependency) | Saves ~15 lines of SVG markup per icon; costs a new dependency with an unverified legitimacy signal and a build-time bundle-size increase for 3 icons used exactly once |
| Renaming `pro` tier key to `enterprise` | Keep `pro` as the internal key, rename only `.name` to "Enterprise" | Renaming the key changes the `TierKey` union type and requires updating every literal `"pro"` reference (webhook fallback, `resolvePriceId`'s legacy-price fallback, tests); keeping the key and renaming only the display name is a 1-line change with zero blast radius — **recommended** |

**Installation:** None required.

**Version verification:** `stripe` confirmed current via `npm view stripe version`
this session (installed 22.4.0, latest 22.5.0 — no functional gap for the fields this
phase needs). `lucide-react`'s installed major version (1.x) was confirmed via the
package's own `package.json` `^1.30.0` range; the brand-icon removal was confirmed
via the Lucide project's own v1.0 migration announcement (see Sources).

## Package Legitimacy Audit

**No new external packages are being installed by this phase's recommended
approach** (inline SVGs, in-place edits to existing files). This section documents
the one alternative package that was evaluated and rejected:

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@icons-pack/react-simple-icons` | npm | unknown (lookup failed in sandbox) | unknown | unknown | SUS | **REMOVED from recommendation** — use inline SVGs instead |

**Packages removed due to [SLOP]/[SUS] verdict:** `@icons-pack/react-simple-icons`
(not being recommended; kept here only as a documented alternative the planner should
not reach for without a fresh legitimacy check from an unrestricted environment).

**Packages flagged as suspicious [SUS]:** none in the recommended path.

## Architecture Patterns

### System Architecture Diagram

```
Buyer's browser
   │
   ├─▶ GET /  (app/page.tsx, server)
   │      │  auth() → signed in? redirect /dashboard
   │      └─▶ renders <LandingContent/> (client)
   │              │
   │              ├─ Hero section ── [NEW] real screenshot/video slot (img/video
   │              │                   element wired to a placeholder asset,
   │              │                   replacing the current hardcoded fake-data
   │              │                   mock — see Pitfall 4)
   │              ├─ Proof stats (unchanged)
   │              ├─ How it works (unchanged)
   │              ├─ Pricing cards ── reads USD prices from lib/plans.ts's TIERS
   │              │                   (Basic/Growth/Premium + Enterprise "Contact us")
   │              │                   "Start free trial" CTA on Basic only → /sign-up
   │              ├─ [NEW] Feature grid ("what we do", 6 tiles, static copy)
   │              ├─ Final CTA (existing, unchanged)
   │              └─ [NEW] Closing CTA banner ("Don't see a perfect fit?")
   │
   │  (footer is NOT part of LandingContent after this phase — see below)
   │
   └─▶ app/layout.tsx (server, wraps EVERY route)
          ├─ <TopNav/>
          ├─ <main><AppShell>{children}</AppShell></main>   ← LandingContent renders here
          └─ <SiteFooter/>  ── [EXTENDED] logo + tagline + contact + social icons
                               (inline SVG) + Privacy/Terms/CCPA links + copyright

Buyer clicks "Choose Basic/Growth/Premium" on /billing (app/billing/page.tsx)
   │
   └─▶ POST /api/stripe/checkout  (app/api/stripe/checkout/route.ts, server)
          │  resolvePriceId(tier, cadence) → STRIPE_PRICE_<TIER>_<CADENCE> env var
          │  [NEW] if tier === "basic": subscription_data.trial_period_days = 14
          └─▶ stripe.checkout.sessions.create(...) → redirect to Stripe-hosted checkout
                 │
                 └─▶ Stripe sends webhook → app/api/stripe/webhook/route.ts
                        └─▶ syncSubscription(): getTier(metadata.tier) must resolve
                            against the NEW tier catalog (basic/growth/premium/pro)
                            → UPDATE organizations SET plan=..., subscription_status=...
```

### Recommended Project Structure

No new directories. Files touched:

```
lib/plans.ts                       # tier catalog surgery (rename field, reprice, relimit)
app/api/stripe/checkout/route.ts   # conditional trial_period_days for Basic tier
app/billing/page.tsx               # € → $ symbol, hide "free" tier column (recommended)
components/LandingContent.tsx      # pricing cards restructure, feature grid, closing
                                    # CTA, hero media slot, REMOVE inline <footer>
components/SiteFooter.tsx          # EXTEND: logo, tagline, contact, social icons, CCPA link
components/icons/SocialIcons.tsx   # [NEW] inline SVG Facebook/Instagram/LinkedIn (recommended)
app/legal/ccpa/page.tsx            # [NEW] mirrors app/legal/privacy structure
tests/plans.test.ts                # MUST be updated — see Pitfall 5
```

### Pattern 1: Extending the plan catalog (don't parallel-build)

**What:** `lib/plans.ts` is read by `LandingContent.tsx` (pricing cards),
`app/billing/page.tsx` (in-app billing UI), `lib/billing.ts` (Stripe price
resolution), and `lib/usage.ts` (`effectiveTier()` gating). All four must be edited
in the same change; none should get a parallel/local copy of tier data.

**When to use:** Any time the tier catalog itself changes shape or values.

**Example — the exact fields to touch in `lib/plans.ts`** (verified by reading the
file this session, `lib/plans.ts:1-133`):

```typescript
// Source: lib/plans.ts (existing structure, read this session)
export type TierKey = "free" | "basic" | "growth" | "premium" | "pro"; // keep as-is —
// do NOT rename "pro" to "enterprise": that would widen the diff to every literal
// "pro" reference (lib/billing.ts resolvePriceId's legacy fallback, webhook default,
// tests). Rename only the display name (see Tier.name below).

export type Tier = {
  key: TierKey;
  name: string;               // "pro" tier's name becomes "Enterprise"
  blurb: string;
  monthlyUsd: number;          // renamed from monthlyEur (D-04)
  contactSales?: boolean;      // NEW — true only for "pro"/"Enterprise". Needed
                                // because displayPrice() === 0 already means "Free"
                                // in 2 call sites (app/billing/page.tsx line 370,
                                // LandingContent's pricing card) — reusing 0 for
                                // "Contact us / no listed price" would collide with
                                // that existing "Free" rendering branch.
  limits: TierLimits;          // unchanged shape
  featured?: boolean;
};
```

### Pattern 2: Stripe Checkout trial config, applied only to one tier

**What:** `app/api/stripe/checkout/route.ts`'s `createSession()` currently sets no
trial fields at all — every tier/cadence checkout bills immediately. D-05 asks for a
Stripe-side trial specifically on Basic.

**When to use:** Only inside the `createSession` closure, gated on `tierKey ===
"basic"`.

**Example:**

```typescript
// Source: app/api/stripe/checkout/route.ts (existing shape, read this session,
// lines 70-83) — extend, don't replace
async function createSession(customer: string) {
  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: priceId!, quantity: 1 }],
    subscription_data: {
      metadata: { org_id: String(ctx!.orgId), tier: tierKey, cadence },
      ...(tierKey === "basic" ? { trial_period_days: 14 } : {}),
    },
    // Cardless trial (matches existing "No credit card required" hero copy,
    // app/page.tsx jsonLd "14-day free trial, no credit card required") —
    // OPTIONAL, left to implementation per D-05:
    ...(tierKey === "basic"
      ? {
          payment_method_collection: "if_required" as const,
          subscription_data: {
            metadata: { org_id: String(ctx!.orgId), tier: tierKey, cadence },
            trial_period_days: 14,
            trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
          },
        }
      : {}),
    metadata: { org_id: String(ctx!.orgId), tier: tierKey, cadence },
    success_url: `${appUrl}/dashboard?checkout=success`,
    cancel_url: `${appUrl}/billing?checkout=cancelled`,
    allow_promotion_codes: true,
  });
}
```

*(Note: the two `subscription_data` spreads above must be merged into one object in
the actual implementation — shown split here only to highlight which fields are
new. `payment_method_collection` per Stripe's Checkout Session API is a
top-level Session field, not nested under `subscription_data`.)*
[CITED: docs.stripe.com/payments/checkout/free-trials — confirmed via web search
synthesis of the official docs page this session; the full page content could not
be fetched verbatim (index/redirect page), so treat exact field nesting as MEDIUM
confidence and verify against Stripe's TypeScript types (`Stripe.Checkout.
SessionCreateParams`) before merging.]

### Pattern 3: Footer + closing CTA reconciliation

**What:** Today, `app/layout.tsx` (the root layout, wrapping **every** route
including `/`) renders `<SiteFooter/>` globally
[VERIFIED: app/layout.tsx:60-77 — `<div className="min-h-screen flex flex-col">
<TopNav /><main className="flex-1"><AppShell>{children}</AppShell></main>
<SiteFooter /></div>`]. Separately, `components/LandingContent.tsx` has its own
inline `<footer>` block at lines 212-228
[VERIFIED: components/LandingContent.tsx:212-228 — `<footer className="border-t
border-slate-100"> ... SourceGPT ... Privacy Policy ... Terms of Service ... ©
{new Date().getFullYear()} SourceGPT ...`]. Since `LandingContent` renders inside
`app/page.tsx`, which itself renders inside the root layout's `{children}` slot, the
landing page today literally stacks **two footers** back to back — a pre-existing
duplication bug, not something this phase introduces, but exactly the "open
discrepancy" CONTEXT.md flagged for the planner to resolve.

**Recommendation:**
1. Delete the inline `<footer>` block from `LandingContent.tsx` (lines 212-228).
2. Add the new closing CTA banner (D-10) immediately after the existing Final CTA
   section (currently ends ~line 209), i.e. it becomes the last thing
   `LandingContent` renders, flowing directly into the global `SiteFooter`.
3. Extend `SiteFooter.tsx` (D-09) to add the logo mark it currently lacks (borrow the
   `Sparkles`-icon-in-a-blue-rounded-square treatment from the inline footer being
   deleted — `components/LandingContent.tsx:214-218`), tagline, contact email
   (`COMPANY.contactEmail` from `lib/legal.ts`, already `"hello@sourcegpt.org"`),
   social icons, and the new CCPA link.

**When to use:** This is the only correct approach given `SiteFooter` is already the
single global footer instance; building footer content into `LandingContent` again
would re-create the duplication for any future page.

### Pattern 4: New legal page (CCPA)

**What:** `app/legal/privacy/page.tsx` and `app/legal/terms/page.tsx` share an
identical structural pattern: a server component (no `"use client"`), a `Metadata`
export, and a `<LegalLayout>` wrapper from `components/legal/LegalLayout.tsx` with
`<LegalSection>`/`<LegalList>` children, reading `COMPANY` and `LEGAL_LAST_UPDATED`
from `lib/legal.ts` [VERIFIED: app/legal/privacy/page.tsx:1-17, app/legal/terms/
page.tsx:1-17 — both import `LegalLayout, { LegalSection, LegalList } from
"@/components/legal/LegalLayout"` and `{ COMPANY } from "@/lib/legal"`].

**When to use:** Exactly this pattern for `app/legal/ccpa/page.tsx` — same imports,
same `metadata.title`/`description` shape (`"{X} — SourceGPT"` title template,
per `app/layout.tsx`'s `template: "%s — SourceGPT"`).

**Example:**

```typescript
// Source: mirrors app/legal/privacy/page.tsx structure (read this session)
import type { Metadata } from "next";
import LegalLayout, { LegalSection, LegalList } from "@/components/legal/LegalLayout";
import { COMPANY } from "@/lib/legal";

export const metadata: Metadata = {
  title: "CCPA Policy — SourceGPT",
  description: "Your California privacy rights under the CCPA/CPRA and how SourceGPT honors them.",
};

export default function CcpaPolicy() {
  const mailto = (addr: string) => <a href={`mailto:${addr}`}>{addr}</a>;
  return (
    <LegalLayout
      title="CCPA Policy"
      intro={`This notice supplements ${COMPANY.legalName}'s Privacy Policy for California residents...`}
    >
      <LegalSection heading="1. Categories of personal information we collect">
        {/* Reuse the same category list already drafted in app/legal/privacy §2 —
            account data, billing data, sourcing data, communications data, usage data */}
      </LegalSection>
      <LegalSection heading="2. Your CCPA rights">
        <LegalList items={[
          "Right to know what personal information is collected, used, and disclosed.",
          "Right to delete personal information, subject to certain exceptions.",
          "Right to opt out of the sale or sharing of personal information (SourceGPT does not sell personal data).",
          "Right to non-discrimination for exercising your CCPA rights.",
        ]} />
      </LegalSection>
      {/* ... additional sections mirroring the Privacy Policy's depth ... */}
    </LegalLayout>
  );
}
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stripe trial mechanics | A custom "days remaining" counter re-implemented for Basic-tier Stripe subscriptions | `subscription_data.trial_period_days` + `trial_settings.end_behavior` (native Checkout Session fields) | Stripe already tracks `subscription.status === "trialing"` and `trial_end`; the webhook (`app/api/stripe/webhook/route.ts`) already mirrors `status` onto `organizations.subscription_status` — no new state needed |
| Social brand icons | Hand-tracing brand logo shapes freehand | Copy canonical monochrome path data from Simple Icons (simple-icons project) or the brand's own press-kit SVG, wrapped in a small local component | Freehand-traced logos risk looking visibly wrong/off-brand; Simple Icons provides audited, minimal single-path SVGs for exactly this use case — as inline components, not a new dependency (see Pitfall 3) |
| i18n key coverage for new copy | Manually writing "TODO: translate" stubs into `de.ts`/`es.ts`/`fr.ts`/`it.ts` for every new string | Nothing — `useT()`'s `t()` falls back to the English source string when a locale key is missing [VERIFIED: components/LanguageProvider.tsx:44-50 — `return interpolate(table?.[en] ?? en, vars);`] | Adding new marketing copy in English via `t("...")` calls is never build-breaking or user-facing-broken; translating it is a legitimate follow-up task, not a blocker for this phase |

**Key insight:** Every genuine "don't hand-roll" risk in this phase is really "don't
duplicate an existing single source of truth" — the tier catalog, the footer, and the
trial-state machine already exist exactly once each in this codebase; the failure
mode to avoid is accidentally creating a second copy of any of them.

## Common Pitfalls

### Pitfall 1: Deleting the `free` tier key breaks a live non-null assertion

**What goes wrong:** `PRICE-01` says buyers should see "3 paid tiers + Contact us,
replacing the current 5-tier display" — it is tempting to read this as "delete the
`free` entry from `TIERS`." Doing so crashes the app.

**Why it happens:** `effectiveTier()` in `lib/usage.ts` has a final fallback line
[VERIFIED: lib/usage.ts:144-152 — `export function effectiveTier(org: Organization):
Tier { const byPlan = getTier(org.plan); if (byPlan) return byPlan; if
(org.subscription_status === "trialing" || org.plan === "trial") return
getTier("basic")!; return getTier("free")!; }`] that does `getTier("free")!` — a
non-null assertion. If `"free"` is removed from `TIERS`, `getTier("free")` returns
`undefined` and the `!` assertion lies to TypeScript; at runtime this throws for any
org whose `subscription_status` is not `"trialing"`/`org.plan !== "trial"` and whose
`plan` doesn't match any remaining key (e.g. any canceled subscriber — see next
bullet). Separately, `app/api/stripe/webhook/route.ts`'s `syncSubscription()`
explicitly sets `plan = "free"` on a canceled subscription
[VERIFIED: app/api/stripe/webhook/route.ts:33 — `const plan = status === "canceled"
? "free" : tierKey;`] — so `"free"` is an actively-written resting state, not
just a display artifact.

**How to avoid:** Keep the `"free"` key in the `TIERS` array (as the internal
zero-price fallback/canceled-subscription resting state). Only stop **rendering** a
Free/Trial card in `LandingContent.tsx`'s pricing section and (recommended, though
not explicitly locked) filter it out of `app/billing/page.tsx`'s
`TIERS.map(...)` comparison grid too, e.g. `TIERS.filter(t => t.key !== "free")`.

**Warning signs:** `tests/plans.test.ts`'s `getTier` describe block explicitly tests
`for (const key of ["free", "basic", "growth", "premium", "pro"] ...)` — if this test
starts failing because `"free"` no longer resolves, that's this exact bug.

### Pitfall 2: Reusing price === 0 for "Contact us" collides with the existing Free-tier rendering branch

**What goes wrong:** The natural-looking shortcut for the new "Contact us" Enterprise
tier is to set its `monthlyUsd` (or whatever the renamed price field is called) to
`0`, since there's "no listed price." This breaks the UI.

**Why it happens:** Both existing price-rendering call sites special-case exactly
`price === 0` to mean **Free** (with a "No card required" message), not "Contact
us": [VERIFIED: app/billing/page.tsx:370-377 — `{price === 0 ? (<div ...>{t("Free")}
</div>) : (<div ...>€{price.toLocaleString()}...)}`] and the same `price === 0`
branch drives the `tier.key === "free"` "No card required" copy at
[VERIFIED: app/billing/page.tsx:403-404 — `) : tier.key === "free" ? (<div ...>{t("No
card required")}</div>`]. `lib/plans.ts`'s own `displayPrice()` also special-cases
`tier.monthlyEur === 0` to always return `0` regardless of cadence
[VERIFIED: lib/plans.ts:116-117 — `if (tier.monthlyEur === 0) return 0;`].

**How to avoid:** Add a distinct discriminator field (e.g. `contactSales?: boolean`)
to the `Tier` type rather than reusing the zero-price branch, and update both render
sites (and `LandingContent.tsx`'s pricing card mapping) to check that field first, so
Enterprise renders "Contact us" / "Contact sales" rather than "Free" / "No card
required".

**Warning signs:** If the shipped Enterprise card ever shows the string "Free" or
"No card required," this is the bug.

### Pitfall 3: `lucide-react@1.x` removed the exact icons MKT-02 asks for

**What goes wrong:** MKT-02 requires Facebook, Instagram, and LinkedIn icons in the
footer. The obvious move — `import { Facebook, Instagram, Linkedin } from
"lucide-react"` — matching every other icon import already in this codebase
(`lucide-react` is imported in both `LandingContent.tsx` and used project-wide) —
fails, because these exports no longer exist in the installed version.

**Why it happens:** The project's `package.json` pins `"lucide-react": "^1.30.0"`
[VERIFIED: package.json dependency line, confirmed via `grep` this session — exact
line `"lucide-react": "^1.30.0",`]. Lucide's own v1.0 release notes state brand icons
(GitHub, Facebook, Instagram, Figma, Slack, etc.) were **removed entirely** for
trademark/legal-compliance reasons and bundle-size reduction — confirmed via the
Lucide project's own v1.0 migration announcement and a still-open upstream GitHub
issue (`lucide-icons/lucide#2792`) reporting exactly this deprecation for
Facebook/Instagram/Twitter/GitHub. [CITED: lucide.dev/guide/version-1 (via web
search synthesis this session) — MEDIUM confidence; the full page was not fetched
verbatim, but two independent search results (a `daily.dev` writeup and an `InfoQ`
writeup) both corroborate "Lucide Releases Version 1.0, Removing Brand Icons... for
legal/trademark reasons."]

**How to avoid:** Do not import brand icons from `lucide-react`. Create a small
local component (e.g. `components/icons/SocialIcons.tsx`) with 3 inline `<svg>`
components using standard 24×24 viewBox monochrome brand marks (source the path data
from Simple Icons or each brand's press kit at implementation time — do not
freehand-trace). This adds zero new dependencies and matches the "small, in-place"
scope of D-09.

**Warning signs:** A TypeScript build error (`Module '"lucide-react"' has no exported
member 'Facebook'`) at `npm run typecheck`/`npm run build` time is the exact failure
this pitfall predicts — if the planner sees this, it confirms the finding above
rather than indicating a fixable typo.

### Pitfall 4: The hero already has a fake-data mockup that looks like — but is not — a media slot

**What goes wrong:** MKT-05 asks for "a hero demo video and/or screenshot slot...
placeholder acceptable." Skimming the current Hero section, it's easy to conclude
this requirement is already satisfied — there is a styled browser-frame card there
today.

**Why it happens:** The existing Hero "Product preview" block
[VERIFIED: components/LandingContent.tsx:51-92 — `{/* Product preview */}` through
the closing of the browser-frame `<div>`, containing hardcoded fake stats
(`"Suppliers found": "52"`, etc.) and 3 hardcoded fake supplier rows (`"Rheinmetall
Precision GmbH"`, `"Tokyo Micro Components"`, `"Baltic CNC Solutions"`)] is entirely
inline JSX/Tailwind markup with hardcoded fake data — not an `<img>` or `<video>`
element. D-08 explicitly requires "structure wired so a real screenshot/video asset
can drop in later" — a hardcoded JSX mock cannot have an asset file "dropped in"
without a code change; it satisfies the visual bar today but not the "wired for a
real asset" requirement.

**How to avoid:** Either (a) wrap the existing card's content in a container that
can be replaced by a single `<img src="/hero-placeholder.{png,svg}" />` (with the
current fake-data grid becoming a fallback/placeholder graphic rather than the
production-intended element), or (b) add a distinct, clearly-labeled media slot
(e.g. a bordered card with a placeholder image and a subtle "Product screenshot"
caption) alongside/instead of the current mock. Note `public/` is currently **empty**
[VERIFIED: `ls -la public/` this session — directory contains only `.`/`..`, no
files], so any placeholder image referenced by path must be added as a new static
asset (even a simple flat-color placeholder SVG) as part of this phase's work, not
assumed to already exist.

**Warning signs:** If the plan's task list has no line item that touches `public/`
or introduces an `<img>`/`<video>` tag in the Hero section, MKT-05 is very likely
only cosmetically addressed, not structurally.

### Pitfall 5: `tests/plans.test.ts` hardcodes exact tier values that will fail after this phase

**What goes wrong:** Running `npm test` after re-pricing/re-limiting `lib/plans.ts`
without also updating `tests/plans.test.ts` fails the D-11 verification gate.

**Why it happens:** The test file asserts exact numbers and tier semantics that this
phase changes: `getTier("pro")` resolving as a distinct enumerated key
[VERIFIED: tests/plans.test.ts:15 — `for (const key of ["free", "basic", "growth",
"premium", "pro"] as const) { expect(getTier(key)?.key).toBe(key); }`], `outreach:
false` on Basic and `true` starting at Growth
[VERIFIED: tests/plans.test.ts:62-67 — `it("outreach is a growth+ capability", () =>
{ expect(getTier("basic")!.limits.outreach).toBe(false); expect(getTier("growth")!.
limits.outreach).toBe(true); ...`], Growth's exact old limits
[VERIFIED: tests/plans.test.ts:69-78 — `expect(growth.limits.eventsPerMonth).toBe(12);
expect(growth.limits.wavesPerEvent).toBe(6); expect(growth.limits.suppliersPerEvent).
toBe(400); expect(growth.limits.seats).toBe(5);`], and `monthlyEur`-keyed price
assertions [VERIFIED: tests/plans.test.ts:113,118,142 — `expect(displayPrice(basic,
"monthly")).toBe(basic.monthlyEur);` / `expect(displayPrice(basic, "yearly")).toBe
(Math.round(basic.monthlyEur * 12 * 0.8));` / `const prices = TIERS.map(t =>
t.monthlyEur);`].

**How to avoid:** Treat `tests/plans.test.ts` as an in-scope file for this phase's
plan, not an incidental casualty discovered at verification time. Every assertion
above needs a corresponding edit reflecting the new field name, new limit numbers,
and (if the planner adopts the "grant outreach to Basic" recommendation below) the
new outreach semantics.

**Warning signs:** `npm test` failures in `plans.test.ts` specifically (not other
test files) after editing `lib/plans.ts` is exactly this — expected, not a surprise,
and must be fixed as part of the same plan, not deferred.

## Code Examples

### Recommended price points and limits (Claude's discretion per D-03)

These numbers are a **business judgment call**, not verified against any external
pricing-strategy source — tag `[ASSUMED]`, flagged in the Assumptions Log below.
They satisfy PRICE-02's numeric constraints exactly (Basic in the $1,400-1,500
window; each step-up between 1.5x and 2x):

```typescript
// Source: derived this session from lib/plans.ts's existing TierLimits shape —
// NOT verified against any external source; a business/product judgment call.
{
  key: "basic", name: "Basic", monthlyUsd: 1450,
  limits: { eventsPerMonth: 15, wavesPerEvent: 5, suppliersPerEvent: 300, seats: 5,
            outreach: true, export: true, maxEventSpendUsd: 100 },
},
{
  key: "growth", name: "Growth", monthlyUsd: 2500,  // 2500/1450 ≈ 1.72x
  featured: true,
  limits: { eventsPerMonth: 30, wavesPerEvent: 10, suppliersPerEvent: 600, seats: 15,
            outreach: true, export: true, maxEventSpendUsd: 250 },
},
{
  key: "premium", name: "Premium", monthlyUsd: 4500,  // 4500/2500 = 1.8x
  limits: { eventsPerMonth: UNLIMITED, wavesPerEvent: UNLIMITED,
            suppliersPerEvent: UNLIMITED, seats: UNLIMITED,
            outreach: true, export: true, maxEventSpendUsd: 750 },
},
{
  key: "pro", name: "Enterprise", contactSales: true, monthlyUsd: 0 /* unused when contactSales */,
  limits: { eventsPerMonth: UNLIMITED, wavesPerEvent: UNLIMITED,
            suppliersPerEvent: UNLIMITED, seats: UNLIMITED,
            outreach: true, export: true, maxEventSpendUsd: 1000 },
},
```

**Rationale for granting `outreach: true` to Basic** (a deviation from today's
"outreach is a growth+ capability" test): at a $1,450/month price point, gating a
core capability (live supplier outreach) behind a second $2,500/month tier is
inconsistent with typical enterprise-SaaS packaging, where the base tier at this
price band is already fully-featured and differentiation is volume/seat-based, not
capability-based. This is a recommendation, not a locked decision — if the planner
disagrees, keep `outreach: false` on Basic and update the rationale/comment in
`lib/plans.ts` accordingly, but either way `tests/plans.test.ts`'s "outreach is a
growth+ capability" test must be reconciled with whatever is decided (see Pitfall 5).

### Stripe price env var matrix (PRICE-04)

The existing `priceEnvVar()` pattern needs exactly 9 new env vars (3 paid tiers × 3
cadences); Enterprise needs none (no self-serve checkout, "Contact us" only):

```
STRIPE_PRICE_BASIC_WEEKLY    STRIPE_PRICE_BASIC_MONTHLY    STRIPE_PRICE_BASIC_YEARLY
STRIPE_PRICE_GROWTH_WEEKLY   STRIPE_PRICE_GROWTH_MONTHLY   STRIPE_PRICE_GROWTH_YEARLY
STRIPE_PRICE_PREMIUM_WEEKLY  STRIPE_PRICE_PREMIUM_MONTHLY  STRIPE_PRICE_PREMIUM_YEARLY
```

Each requires a real Stripe Price object created in the Stripe dashboard (or via an
authenticated `stripe` CLI/API call using the account's live/test secret key) —
**this cannot be done by the execution agent inside this sandbox** (no
`STRIPE_SECRET_KEY` access, and it is an external dashboard/account action). See
Environment Availability below.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `lucide-react` importing brand/company icons directly (`Facebook`, `Instagram`, `Github`, etc.) | Brand icons removed entirely; use Simple Icons or custom inline SVGs | Lucide v1.0 (installed range `^1.30.0` is already past this change) | Any new social-icon UI work in this codebase must use inline SVGs, not `lucide-react` |
| Stripe Checkout Sessions defaulting to card-required trials | `payment_method_collection: "if_required"` + `trial_settings.end_behavior.missing_payment_method` for cardless trials | Stable Stripe Billing feature, not a recent change | Directly relevant to D-05's "whether card is required" discretion point |

**Deprecated/outdated:** `lib/plans.ts`'s `monthlyEur` field and the EUR pricing
model are being retired by this phase itself (not an external deprecation) — no
external library deprecation drives this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Recommended USD price points ($1,450 / $2,500 / $4,500) and per-tier limits | Code Examples — "Recommended price points" | Business/pricing-strategy judgment call, not externally verified; if wrong, only requires editing 3 numbers in `lib/plans.ts` (and `tests/plans.test.ts`) — low blast radius, no architectural risk |
| A2 | Granting `outreach: true` to the Basic tier (deviating from the current "outreach is growth+" gate) | Code Examples — rationale note | If the planner disagrees, `outreach: false` on Basic is a 1-line revert; either way `tests/plans.test.ts` needs a corresponding edit |
| A3 | Exact Stripe Checkout Session field nesting for `payment_method_collection` (top-level Session field, not under `subscription_data`) and `trial_settings.end_behavior.missing_payment_method` values (`cancel`/`pause`/`create_invoice`) | Architecture Patterns — Pattern 2 | Sourced from web-search synthesis of Stripe's own docs (not fetched verbatim this session, and not cross-checked against the installed `stripe` npm package's TypeScript types); verify against `Stripe.Checkout.SessionCreateParams` in `node_modules/stripe/types/` (or Stripe's own API reference) before merging — a field-nesting mistake here would surface as a TypeScript compile error against the `stripe` SDK's types, not a silent runtime bug |
| A4 | Whether `app/billing/page.tsx`'s in-app tier-comparison grid should also filter out the `free` tier column (D-04 only explicitly names this file for currency-display changes, not tier-count filtering) | Pitfall 1 recommendation | Low risk either way — showing a "Free" resting-state column in the authenticated in-app billing page (as opposed to the public marketing pricing page, which PRICE-01 explicitly targets) is arguably acceptable; flagged as Open Question 2 for the planner/user to confirm |

**If this table is empty:** N/A — see rows above.

## Open Questions (RESOLVED)

1. **(RESOLVED — recommendation adopted in plan 02-01 Task 2 per D-05.)** Does "Start
   free trial" on the Basic pricing card need to go through Stripe Checkout at all,
   given the existing app-level trial already grants 14 days of Basic-equivalent
   access at signup regardless of tier?
   - What we know: Today, all 3 landing-page pricing cards' CTAs link straight to
     `/sign-up` [VERIFIED: components/LandingContent.tsx:177-182 — `<Link
     href="/sign-up" className={...}>{p.cta}</Link>`], not to any Stripe checkout
     call. Signing up auto-provisions an org with `plan='trial'`,
     `subscription_status='trialing'`, `trial_ends_at = now() + 14 days`
     [VERIFIED: lib/tenant.ts:63-67], completely independent of Stripe. Stripe
     checkout (`/api/stripe/checkout`) is only invoked later, from `/billing`, when
     the user actively picks a tier to subscribe to
     [VERIFIED: app/billing/page.tsx:83-98 — `checkout(tierKey)` posts to
     `/api/stripe/checkout`].
   - What's unclear: D-05's instruction to set `trial_period_days` "on the Basic
     tier's checkout flow" implies this fires when a user (whose app-level trial may
     already be running, or may have already ended) later goes to `/billing` and
     clicks "Choose Basic" — at which point they'd get a **second**,
     independently-timed Stripe trial layered on top of (or after) the app-level
     one. Whether that's the intended UX (effectively extending trial-eligible users
     an additional Stripe-side trial period) or an unintentional double-grant is not
     resolved by CONTEXT.md.
   - Recommendation: Implement `trial_period_days` on the Basic-tier Checkout
     Session exactly as D-05 states (satisfies PRICE-04's literal requirement and is
     a self-contained, low-risk change), and leave the existing app-level trial
     mechanism (`lib/tenant.ts`, `lib/billing.ts`) completely untouched — do not try
     to unify or de-duplicate the two mechanisms in this phase; that's a larger
     billing-architecture change outside this phase's stated scope. Flag the overlap
     to the user/PM as a UX note, not a blocking defect.
   - **Adopted resolution:** Recommendation adopted verbatim. Plan 02-01 Task 2 sets
     `subscription_data.trial_period_days: 14` gated on `tierKey === "basic"` inside
     `app/api/stripe/checkout/route.ts` (D-05); the app-level trial mechanism in
     `lib/tenant.ts`/`lib/billing.ts` remains untouched. The dual-mechanism overlap
     is documented in 02-01-PLAN.md `must_haves.key_links` (third bullet) and
     surfaced to the user via the plan 02-04 human checkpoint copy — not treated
     as a blocking defect.

2. **(RESOLVED — recommendation adopted in plan 02-01 Task 3.)** Should
   `app/billing/page.tsx`'s in-app tier-comparison grid also drop the `free` tier
   column, or is showing it there (as the canceled-subscription resting state)
   acceptable since PRICE-01 targets "the pricing page" specifically?
   - What we know: D-04 names `app/billing/page.tsx` explicitly for currency-display
     changes. PRICE-01's literal wording is about "the pricing page" (the public
     marketing surface).
   - What's unclear: Whether "no separate free tier offered anywhere on the page"
     (PRICE-03's wording) is meant to extend to the authenticated in-app billing
     page too, or only the public marketing pricing section.
   - Recommendation: Filter it out for consistency (`TIERS.filter(t => t.key !==
     "free")` in the billing page's comparison grid) — a canceled subscriber
     landing on `/billing` and seeing an oddly-priced "Free" column next to
     enterprise-tier pricing reads as a UI regression either way, independent of
     which requirement technically governs it.
   - **Adopted resolution:** Recommendation adopted verbatim. Plan 02-01 Task 3
     applies `TIERS.filter(t => t.key !== "free")` before `.map(...)` in
     `app/billing/page.tsx`'s tier comparison grid, so the internal `free` tier is
     not rendered in the authenticated in-app UI. The `free` key itself remains in
     the `TIERS` catalog as the internal fallback per Pitfall 1.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `stripe` npm package | PRICE-04 (checkout code changes) | ✓ | 22.4.0 installed, 22.5.0 latest [VERIFIED: npm registry] | — (no upgrade needed) |
| Stripe Dashboard access (create 9 new Price objects, set env vars) | PRICE-04 | ✗ (not available to the execution agent in this sandbox — requires the user's live Stripe account credentials) | — | **No fallback for actually creating live Price objects** — this must be a `checkpoint:human-verify`-style task in the plan, where the user creates the Price objects (dashboard or their own authenticated `stripe` CLI session) and supplies the resulting price IDs as env vars. Until those env vars are set, `resolvePriceId()` already degrades gracefully (missing env var → that tier/cadence combination is simply unavailable for checkout, matching existing established behavior — no hard failure) [VERIFIED: lib/billing.ts:39-46] |
| `public/` static asset for hero placeholder | MKT-05 | ✗ (directory exists but is empty) [VERIFIED: `ls -la public/` this session] | — | Add a simple placeholder graphic (flat-color SVG or PNG) as part of this phase's own work — not an external dependency, just an asset that doesn't exist yet |

**Missing dependencies with no fallback:**
- Live Stripe Price object creation (PRICE-04) — inherently a human/dashboard action;
  plan must include an explicit checkpoint for this rather than assuming it can be
  scripted end-to-end by the execution agent.

**Missing dependencies with fallback:**
- Hero placeholder asset — not missing a *dependency*, just missing an asset file
  that this phase's own task list should create.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.9 [VERIFIED: package.json / CLAUDE.md tech-stack section] |
| Config file | `vitest.config.ts` (confirmed present at repo root this session) |
| Quick run command | `npx vitest run tests/plans.test.ts` |
| Full suite command | `npm test` (== `vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PRICE-01 | 3 paid tiers + Enterprise, `free` key still resolves internally | unit | `npx vitest run tests/plans.test.ts -t "getTier"` | ✅ (needs edits — see Pitfall 5) |
| PRICE-02 | New USD price points, correct cadence math | unit | `npx vitest run tests/plans.test.ts -t "displayPrice"` | ✅ (needs edits — field rename) |
| PRICE-03 | No free tier displayed; Basic is the only trial entry point | manual/visual | none automated — requires visually inspecting the rendered landing page | ❌ Wave 0 gap — no landing-page rendering test exists in this repo today |
| PRICE-04 | Stripe price env var resolution for new tier × cadence matrix | unit | `npx vitest run tests/plans.test.ts -t "priceEnvVar\|priceIdFor"` | ✅ (already generic — tier-name-agnostic, no edits needed) |
| PRICE-05 | No org's `plan` value crashes `effectiveTier()` | unit | new test recommended: assert `effectiveTier()` never throws for `plan` values `"free"`, `"trial"`, `"pro"`, and an arbitrary unknown string | ❌ Wave 0 gap — not currently tested as a defensive/negative case |
| MKT-01 | Closing CTA banner renders | manual/visual | none automated (no component-rendering test infra for `LandingContent.tsx` exists in this repo) | ❌ Wave 0 gap |
| MKT-02 | Footer renders logo/tagline/contact/social/legal/copyright | manual/visual + `npm run build` (compile-time catch for the lucide-react import pitfall) | `npm run build` | ❌ no dedicated test; `npm run build`/`npm run typecheck` will catch the Pitfall-3 import error |
| MKT-03 | CCPA page exists, renders, is linked from footer | manual/visual + route existence | `npm run build` (Next.js build fails if the page has a syntax/type error) | ❌ no dedicated test |
| MKT-04 | Feature-grid copy matches backlog mapping | manual/visual (copy review) | none automated | ❌ N/A — copy-only, not a logic behavior |
| MKT-05 | Hero has a real media slot (not just the existing fake-data mock) | manual/visual | none automated | ❌ Wave 0 gap |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/plans.test.ts` (fastest relevant
  feedback loop for the pricing-catalog tasks)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** `npm run typecheck && npm run lint && npm test && npm run build`
  (per D-11, matching Phase 1's established pattern)

### Wave 0 Gaps

- [ ] No automated rendering/snapshot test exists for `LandingContent.tsx` or
  `SiteFooter.tsx` in this repo — all UI-shape requirements (MKT-01, MKT-02, MKT-04,
  MKT-05, PRICE-01/03's "no free tier displayed") rely on manual/visual verification
  at the human-checkpoint stage, per this project's established pattern (no existing
  React Testing Library / component-test infra to extend).
- [ ] Recommended new unit test in `tests/plans.test.ts` (or a new
  `tests/billing-defensive.test.ts`): assert `effectiveTier()` returns a valid `Tier`
  object (never throws) for every `plan` value currently reachable in the DB
  (`"free"`, `"trial"`, `"pro"`, and one arbitrary/unknown string) — directly covers
  PRICE-05's "no billing-gate outage" concern as an automated regression guard rather
  than relying only on manual inspection.
- [ ] Framework install: none — Vitest is already fully configured.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Unchanged by this phase — Clerk auth untouched |
| V3 Session Management | no | Unchanged |
| V4 Access Control | yes (narrowly) | `app/api/stripe/checkout/route.ts` already enforces `requireRole(ctx, "admin")` before allowing checkout [VERIFIED: app/api/stripe/checkout/route.ts:17-18] — no change needed, but any new tier/cadence validation added must preserve this existing role gate, not bypass it |
| V5 Input Validation | yes | The checkout route already validates `tierKey`/`cadence` against known enums before resolving a price id [VERIFIED: app/api/stripe/checkout/route.ts:38-44] — when adding the Basic-tier trial branch, keep this validate-before-branch ordering (don't set `trial_period_days` before confirming `tierKey` is a real, checkout-eligible tier) |
| V6 Cryptography | no | Stripe webhook signature verification already exists and is untouched by this phase [VERIFIED: app/api/stripe/webhook/route.ts:66-77] |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A user manually POSTing `{tier: "pro", cadence: "monthly"}` (or the renamed Enterprise key) to `/api/stripe/checkout` to try to self-serve-checkout the "Contact us" tier that should have no listed price | Elevation of Privilege / Tampering | The checkout route must reject checkout attempts for any tier flagged `contactSales: true` (Enterprise) with the same "Invalid plan selected" 400 response it already gives for `tier === "free"` [VERIFIED: app/api/stripe/checkout/route.ts:38-41 — `if (!tier || tierKey === "free") { return NextResponse.json({ error: "Invalid plan selected" }, { status: 400 }); }`] — extend this same condition to also reject `tier.contactSales === true`, otherwise a crafted request could attempt to purchase Enterprise via Stripe despite it having no configured price (which would simply 503 today per the existing missing-price-id path, but the explicit reject is cleaner and matches existing style) |
| Stale/incorrect `STRIPE_PRICE_<TIER>_<CADENCE>` env vars pointing to the OLD EUR-priced Stripe Price objects after this phase's deploy, silently letting a buyer check out at the old (lower) EUR price | Tampering (of pricing intent, not of request data) | Not an application-code risk — a deployment/ops risk. The plan should include a step to unset/replace all OLD `STRIPE_PRICE_*` env vars at the same time the new ones are set, so no window exists where a buyer could complete checkout against a stale EUR price object. This is exactly why PRICE-04 requires **new** Price objects rather than editing existing ones in place — Stripe Price objects are immutable by design, so the old ones must be superseded, not mutated |

## Sources

### Primary (HIGH confidence)

- `lib/plans.ts`, `lib/billing.ts`, `lib/usage.ts`, `lib/tenant.ts`, `lib/db.ts`,
  `lib/legal.ts`, `components/SiteFooter.tsx`, `components/LandingContent.tsx`,
  `components/AppShell.tsx`, `components/legal/LegalLayout.tsx`,
  `components/LanguageProvider.tsx`, `app/layout.tsx`, `app/page.tsx`,
  `app/billing/page.tsx`, `app/legal/privacy/page.tsx`, `app/legal/terms/page.tsx`,
  `app/api/stripe/checkout/route.ts`, `app/api/stripe/webhook/route.ts`,
  `tests/plans.test.ts`, `docs/change-request-backlog.md` — all read directly this
  session (file paths and line numbers cited inline above).
- `npm view stripe version` — run this session, confirmed 22.4.0 installed / 22.5.0
  latest.

### Secondary (MEDIUM confidence)

- docs.stripe.com/payments/checkout/free-trials — Stripe's official trial
  documentation, content confirmed via WebSearch synthesis (not fetched verbatim —
  the page redirects to a variant-selector index that this session's WebFetch could
  not get past). [Stripe Subscription Trials Guide (RapidDev)](https://www.rapidevelopers.com/stripe-guide/how-to-implement-subscription-trials-with-stripe-api)
- lucide.dev/guide/version-1 — Lucide's v1.0 migration announcement re: brand icon
  removal, confirmed via two independent secondary writeups. [Lucide Releases Version 1.0, Removing Brand Icons and Cutting Bundle Size (daily.dev)](https://daily.dev/posts/lucide-releases-version-1-0-removing-brand-icons-and-cutting-bundle-size-for-millions-of-projects-sdgeh2nej) · [Lucide Releases Version 1.0 (InfoQ)](https://www.infoq.com/news/2026/06/lucide-v1-icons/)
- [lucide-icons/lucide GitHub Issue #2792](https://github.com/lucide-icons/lucide/issues/2792) — user-reported deprecation warnings for Twitter/GitHub/Facebook/Instagram icons.

### Tertiary (LOW confidence)

- None used as load-bearing claims — the `@icons-pack/react-simple-icons`
  legitimacy-check attempt returned only `SUS` due to sandboxed-network lookup
  failure, not a substantive finding; it is not recommended and not relied upon.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; existing `stripe`/`lucide-react` versions
  confirmed directly.
- Architecture: HIGH — every structural claim (footer duplication, plan-catalog
  fan-out, checkout route shape, legal page pattern) verified by reading the actual
  source files this session.
- Pricing/limits recommendation: LOW/ASSUMED — a business judgment call within the
  locked numeric constraints, not externally verified (see Assumptions Log A1/A2).
- Stripe trial API field details: MEDIUM — corroborated by web search against
  official Stripe docs, but not fetched verbatim; recommend a final check against
  the installed `stripe` package's TypeScript types before merging (see A3).
- Pitfalls: HIGH — Pitfalls 1, 2, 4, 5 are all directly demonstrated by reading
  existing source code; Pitfall 3 (lucide-react) is HIGH-confidence on "the icons
  don't exist in v1" (corroborated by 2 independent secondary sources plus an
  upstream GitHub issue) though the exact release-version cutover wasn't verified
  against a primary changelog.

**Research date:** 2026-08-15
**Valid until:** 30 days (stable domain — no fast-moving external dependencies;
re-verify `stripe` package version and Stripe API field names if this research is
reused after that window, and re-run the package-legitimacy check on any icon-pack
alternative from an unrestricted network environment before adopting it)
