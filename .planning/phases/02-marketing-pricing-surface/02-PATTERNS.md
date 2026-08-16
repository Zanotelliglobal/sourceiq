# Phase 2: Marketing & Pricing Surface - Pattern Map

**Mapped:** 2026-08-15
**Files analyzed:** 8
**Analogs found:** 8 / 8 (all are in-place edits of existing files, or new files with an exact-template analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `lib/plans.ts` | config/model (pricing catalog) | CRUD (in-place edit of existing data structure) | itself (extend in place) | exact — no external analog needed, edit existing file |
| `app/api/stripe/checkout/route.ts` | route/controller | request-response | itself (extend in place) | exact |
| `app/billing/page.tsx` | component/page | request-response (renders catalog + triggers checkout) | itself (extend in place) | exact |
| `components/LandingContent.tsx` | component | request-response (static + client-rendered marketing content) | itself (extend in place) | exact |
| `components/SiteFooter.tsx` | component | request-response (static render) | itself (extend in place) | exact |
| `components/icons/SocialIcons.tsx` (NEW) | component/utility | request-response (static SVG render) | no existing icon-wrapper component in repo; closest structural analog is any small presentational component — use `components/legal/LegalLayout.tsx`'s plain-props-in/JSX-out shape as the structural template | role-match (no direct analog; new pattern, inline SVG) |
| `app/legal/ccpa/page.tsx` (NEW) | route/page (server component) | request-response (static SSR content) | `app/legal/privacy/page.tsx` (and `app/legal/terms/page.tsx`) | exact |
| `tests/plans.test.ts` | test | CRUD (assertions on pricing catalog functions) | itself (extend/update in place) | exact |
| `public/hero-placeholder.svg` (NEW) | asset | file I/O (static asset) | none (new asset type in this repo — `public/` currently empty) | no analog — new asset |

## Pattern Assignments

### `lib/plans.ts` (config, CRUD — single source of truth)

**Analog:** itself, `lib/plans.ts:1-133` (read in full this session)

**Current shape to extend, not replace** (lines 34-43):
```typescript
export type Tier = {
  key: TierKey;
  name: string;
  blurb: string;
  /** Baseline monthly price in EUR (used to derive weekly/yearly display prices). */
  monthlyEur: number;
  limits: TierLimits;
  /** Highlighted as the recommended tier in the UI. */
  featured?: boolean;
};
```

**Rename pattern** — `monthlyEur` → `monthlyUsd` throughout the file (type, all 5 `TIERS` entries, `displayPrice()` lines 116-127, `cadenceSuffix()` unaffected). Add `contactSales?: boolean` to the `Tier` type per RESEARCH.md Pitfall 2 (do not reuse `monthlyUsd === 0` for Enterprise/"Contact us" — that already means "Free" at 2 call sites).

**Existing helper functions to keep unchanged in signature** (lines 98-132):
```typescript
export function getTier(key: string): Tier | undefined {
  return TIERS.find(t => t.key === key);
}

export function priceEnvVar(tier: TierKey, cadence: Cadence): string {
  return `STRIPE_PRICE_${tier.toUpperCase()}_${cadence.toUpperCase()}`;
}

export function priceIdFor(tier: TierKey, cadence: Cadence): string | null {
  return process.env[priceEnvVar(tier, cadence)] || null;
}
```

**Comment style to preserve** (lines 1-9, 24-31, 80-83) — this file uses long, rationale-explaining block comments above non-obvious business logic (e.g. why `maxEventSpendUsd` exists, why Stripe prices are env-var-resolved not hardcoded). New/changed tiers should get comparable inline rationale comments (e.g. why Basic gets `outreach: true` if that recommendation is adopted — see RESEARCH.md Assumption A2).

**Do NOT delete the `"free"` key** — `TierKey` union and the `free` entry in `TIERS` must remain (RESEARCH.md Pitfall 1); `lib/usage.ts:144-152`'s `effectiveTier()` does a non-null-asserted `getTier("free")!` fallback, and `app/api/stripe/webhook/route.ts:33` writes `plan = "free"` on cancellation.

---

### `app/api/stripe/checkout/route.ts` (route/controller, request-response)

**Analog:** itself, full file read this session (108 lines)

**Existing validation-before-branch pattern to preserve** (lines 38-44):
```typescript
const tier = getTier(tierKey);
if (!tier || tierKey === "free") {
  return NextResponse.json({ error: "Invalid plan selected" }, { status: 400 });
}
if (!CADENCES.has(cadence)) {
  return NextResponse.json({ error: "Invalid billing cadence" }, { status: 400 });
}
```
Extend this exact condition to also reject `tier.contactSales === true` (per Security Domain in RESEARCH.md) — same style, same status code, same error string pattern.

**Session creation pattern to extend for the Basic trial** (lines 70-83):
```typescript
async function createSession(customer: string) {
  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: priceId!, quantity: 1 }],
    subscription_data: { metadata: { org_id: String(ctx!.orgId), tier: tierKey, cadence } },
    metadata: { org_id: String(ctx!.orgId), tier: tierKey, cadence },
    success_url: `${appUrl}/dashboard?checkout=success`,
    cancel_url: `${appUrl}/billing?checkout=cancelled`,
    allow_promotion_codes: true,
  });
}
```
Add `trial_period_days: 14` (and optionally `payment_method_collection`/`trial_settings`) inside `subscription_data`/top-level, gated on `tierKey === "basic"` — merge into one object, don't duplicate `subscription_data`. See RESEARCH.md Pattern 2 for the exact merged shape and Assumption A3 caveat (verify field nesting against `stripe` package's own TS types before merging).

**Auth/role pattern already in place, keep unchanged** (lines 14-18):
```typescript
const ctx = await getOrgContext();
if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const denied = requireRole(ctx, "admin");
if (denied) return denied;
```

**Error handling pattern** (lines 85-106) — nested try/catch: inner catch recovers a stale Stripe customer id once, outer catch converts any thrown error into a clean `NextResponse.json({ error: message }, { status: 500 })` with a `console.error` log line. Follow this exact shape for any new error branch.

---

### `app/billing/page.tsx` (component/page, request-response)

**Analog:** itself (417 lines; specific ranges cited in RESEARCH.md, not fully re-read here — reuse those citations)

**Price-zero-means-Free branch to update** (per RESEARCH.md Pitfall 2, cites `app/billing/page.tsx:370-377` and `:403-404`):
```typescript
{price === 0 ? (<div ...>{t("Free")}</div>) : (<div ...>€{price.toLocaleString()}...)}
...
) : tier.key === "free" ? (<div ...>{t("No card required")}</div>
```
Must become: check `tier.contactSales` first (render "Contact sales"/"Contact us"), else `€` → `$`, else existing Free/no-card-required branch stays for the `free` key only. Follow existing `t(...)` i18n-wrapping convention on every user-facing string.

**Tier-filtering pattern (recommended, D-04/Pitfall 1 discretion):** `TIERS.filter(t => t.key !== "free")` before `.map(...)` in the comparison grid, matching the array-filter style already used elsewhere in the codebase (e.g. `CADENCES` lookups).

---

### `components/LandingContent.tsx` (component, request-response — client component)

**Analog:** itself, full 231-line file read this session

**i18n pattern to follow for every new string** (used throughout, e.g. line 32, 39, 49):
```typescript
const t = useT();
...
{t("Multi-agent supplier intelligence")}
```
All new copy (feature-grid tiles, closing CTA banner, footer removal) must go through `t("...")` — never hardcode English strings outside `t()`, per `components/LanguageProvider.tsx`'s fallback-to-English pattern (no build break if a locale key is missing).

**Existing card-grid section structure to copy for the new feature-grid section** (closest existing analog: "How it works" section, lines 120-141):
```jsx
<section className="max-w-screen-xl mx-auto px-4 sm:px-6 py-24">
  <div className="text-center max-w-2xl mx-auto mb-16">
    <h2 className="text-3xl font-bold text-slate-900 tracking-tight">{t("...")}</h2>
    <p className="text-slate-500 mt-3">{t("...")}</p>
  </div>
  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
    {[ /* array of {Icon, title, body} */ ].map(step => (
      <div key={step.title} className="card p-7">
        <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center mb-4">
          <step.Icon className="w-5 h-5 text-blue-600" />
        </div>
        <h3 className="font-bold text-slate-900">{step.title}</h3>
        <p className="text-sm text-slate-500 mt-2 leading-relaxed">{step.body}</p>
      </div>
    ))}
  </div>
</section>
```
For the 6-tile feature grid, use `grid-cols-1 md:grid-cols-3` (3-wide × 2-row) and per UI-SPEC.md typography contract, tile titles use `text-base font-semibold` (16px/600), not `font-bold` (this section's existing H3 style is `font-bold` — do NOT copy that weight for new tile titles, only the container/icon-chip structure).

**Pricing cards array-map pattern to restructure** (lines 150-186) — current 3-card inline array (`Trial`/`Growth`/`Enterprise`) is the direct analog/target for the new 4-card Basic/Growth/Premium/Enterprise array. Preserve the `.map(p => ...)` structure, `p.highlight`/`featured` badge treatment (lines 159-164), and CTA `<Link>` pattern (lines 177-182) — but read `monthlyUsd`/`contactSales` from `lib/plans.ts`'s `TIERS` rather than a local hardcoded array, since D-04 requires reading live pricing data (not the hardcoded strings shown today).

**Final CTA section as closing-CTA-banner template** (lines 189-209) — same rounded-3xl dark banner treatment; the new "Don't see a perfect fit?" banner (MKT-01) should be a lighter-weight sibling section immediately after this one, reusing the same `max-w-screen-xl mx-auto px-4 sm:px-6 py-24` outer wrapper rhythm (UI-SPEC.md's `4xl`/96px justified exception) but a distinct (non-dark, non-amber-duplicate) visual treatment since amber accent is reserved for this section's button already — per UI-SPEC.md Color section, banner's own "Talk to sales" button IS allowed amber (4th declared accent use).

**Inline footer to DELETE** (lines 211-228) — this entire `<footer>` block is a duplicate of the global `SiteFooter.tsx` (rendered by `app/layout.tsx`); remove it per RESEARCH.md Pattern 3. Do not extend it — extend `SiteFooter.tsx` instead.

**Hero product-preview block to convert into MKT-05's media slot** (lines 51-92) — currently 100% inline JSX/Tailwind with hardcoded fake data, no `<img>`/`<video>` element. Per Pitfall 4, wrap or replace with a real `<img src="/hero-placeholder.svg" alt="Product preview" />` inside a comparable bordered/browser-frame card, with a small caption ("Product preview") per UI-SPEC.md Copywriting Contract.

---

### `components/SiteFooter.tsx` (component, request-response — extend in place)

**Analog:** itself, full 19-line file read this session

**Current full content (extend, don't rebuild):**
```typescript
"use client";
import Link from "next/link";
import { useT } from "@/components/LanguageProvider";

export default function SiteFooter() {
  const t = useT();
  return (
    <footer className="border-t border-slate-200/80 mt-auto">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-xs text-slate-500">© {new Date().getFullYear()} SourceGPT. {t("AI-powered supplier intelligence.")}</p>
        <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
          <Link href="/legal/privacy" className="hover:text-slate-900 transition-colors">{t("Privacy Policy")}</Link>
          <Link href="/legal/terms" className="hover:text-slate-900 transition-colors">{t("Terms of Service")}</Link>
        </div>
      </div>
    </footer>
  );
}
```

**Logo mark to borrow from the deleted inline footer** (`components/LandingContent.tsx:214-218`):
```jsx
<div className="flex items-center gap-2 text-sm font-bold text-slate-900">
  <div className="w-6 h-6 rounded-lg bg-blue-600 flex items-center justify-center">
    <Sparkles className="w-3.5 h-3.5 text-white" />
  </div>
  SourceGPT
</div>
```
(`Sparkles` already imported from `lucide-react` in `LandingContent.tsx`; import it fresh in `SiteFooter.tsx` too.)

**Legal-links pattern to extend** — add CCPA alongside existing Privacy/Terms links, same `<Link>`/`hover:text-slate-900 transition-colors` styling:
```jsx
<Link href="/legal/ccpa" className="hover:text-slate-900 transition-colors">{t("CCPA Policy")}</Link>
```

**Contact email pattern** — reuse `COMPANY.contactEmail` from `lib/legal.ts` (`"hello@sourcegpt.org"` default), rendered as `<a href={`mailto:${COMPANY.contactEmail}`}>`, matching the `mailto` helper pattern already used in `app/legal/privacy/page.tsx:11` (`const mailto = (addr: string) => <a href={`mailto:${addr}`}>{addr}</a>;`).

**Overflow handling (UI-SPEC.md requirement):** use `flex-wrap` with `gap-4`/`gap-3` on the existing `flex-col sm:flex-row` container so the extended link/icon row wraps rather than clips on narrow viewports.

---

### `components/icons/SocialIcons.tsx` (NEW component)

**No direct analog exists in the repo** — this is genuinely new. Structural template: any small, typed, presentational component with no internal state (closest shape-analog: `components/legal/LegalLayout.tsx`'s prop-typed function components — `LegalSection`, `LegalList` — plain `{ prop }: { prop: Type }` destructured props, default export for the main component / named exports for sub-parts).

**Required shape per RESEARCH.md Pitfall 3 + UI-SPEC.md Registry Safety:**
```typescript
// components/icons/SocialIcons.tsx — NEW FILE
// Do NOT import from lucide-react: v1.x removed all brand icons (Facebook,
// Instagram, LinkedIn, GitHub, etc.) for trademark/bundle-size reasons.
export function FacebookIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      {/* path data sourced from Simple Icons at implementation time — do not freehand-trace */}
    </svg>
  );
}
// InstagramIcon, LinkedinIcon follow the same shape.
```

**Usage pattern in `SiteFooter.tsx`** (accessibility requirement per UI-SPEC.md Registry Safety section):
```jsx
<a href="https://facebook.com/..." aria-label="Follow SourceGPT on Facebook" className="text-slate-400 hover:text-slate-700 transition-colors">
  <FacebookIcon className="w-4 h-4" />
</a>
```
`aria-hidden="true"` on the `<svg>` itself, `aria-label` on the anchor — not a `title` element inside the SVG.

---

### `app/legal/ccpa/page.tsx` (NEW route, server component)

**Analog:** `app/legal/privacy/page.tsx` (full file read this session, 160 lines) — exact structural template, also mirrored by `app/legal/terms/page.tsx` (not re-read; same pattern per RESEARCH.md citation).

**Imports pattern** (lines 1-3):
```typescript
import type { Metadata } from "next";
import LegalLayout, { LegalSection, LegalList } from "@/components/legal/LegalLayout";
import { COMPANY } from "@/lib/legal";
```

**Metadata pattern** (lines 5-8):
```typescript
export const metadata: Metadata = {
  title: "Privacy Policy — SourceGPT",
  description: "How SourceGPT collects, uses, and protects personal data.",
};
```
For CCPA: `title: "CCPA Policy — SourceGPT"`, matching `app/layout.tsx`'s `template: "%s — SourceGPT"` convention.

**Component + mailto helper pattern** (lines 10-17):
```typescript
export default function PrivacyPolicy() {
  const mailto = (addr: string) => <a href={`mailto:${addr}`}>{addr}</a>;
  return (
    <LegalLayout
      title="Privacy Policy"
      intro={`This Privacy Policy explains how ${COMPANY.legalName}, operator of ${COMPANY.product} (the "Service")...`}
    >
```

**Section/list pattern** (repeated throughout, e.g. lines 31-42, 114-127):
```jsx
<LegalSection heading="2. Data we collect">
  <p>Depending on how you use the Service, we may collect:</p>
  <LegalList
    items={[
      <><strong>Account data</strong> — name, work email, organisation name...</>,
      ...
    ]}
  />
</LegalSection>
```
For CCPA, reuse this exact `<LegalSection>`/`<LegalList>` nesting for: categories of data collected (can reuse/reference the same category list as Privacy §2), right to know/delete/opt-out (CCPA-specific rights list), and a non-discrimination clause section — see RESEARCH.md Pattern 4 for a starter section skeleton.

**`LegalLayout` component itself** (`components/legal/LegalLayout.tsx`, full 58-line file read this session) — no changes needed, just consumed as-is:
```typescript
export default function LegalLayout({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) { ... }
export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) { ... }
export function LegalList({ items }: { items: React.ReactNode[] }) { ... }
```

**Back-link/back-to-dashboard pattern already built into `LegalLayout`** (lines 18-23) — automatically inherited by the new CCPA page, no extra work needed:
```jsx
<Link href="/dashboard" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700 mb-8">
  <ArrowLeft className="w-4 h-4" /> Back
</Link>
```

---

### `tests/plans.test.ts` (test file — must be updated in the same change)

**Analog:** itself (not re-read in full this session; exact failing assertions already cited verbatim in RESEARCH.md Pitfall 5, cite those directly):
- `tests/plans.test.ts:15` — `for (const key of ["free", "basic", "growth", "premium", "pro"] as const) { expect(getTier(key)?.key).toBe(key); }` (keys stay the same — no edit needed here structurally, but re-verify after tier data changes).
- `tests/plans.test.ts:62-67` — outreach-gating assertions (`basic` limits.outreach `false`, `growth` `true`) — must be reconciled with whichever outreach decision is made for the new Basic tier.
- `tests/plans.test.ts:69-78` — exact old Growth limits (`eventsPerMonth: 12`, `wavesPerEvent: 6`, `suppliersPerEvent: 400`, `seats: 5`) — must be updated to new limits.
- `tests/plans.test.ts:113,118,142` — `monthlyEur`-keyed price assertions — must be renamed to `monthlyUsd` (or whatever field name is chosen) throughout.

**Recommended new test (Wave-0 gap per RESEARCH.md Validation Architecture):** add an `effectiveTier()` defensive-regression test asserting it never throws for `plan` values `"free"`, `"trial"`, `"pro"`, and an arbitrary unknown string — directly covers PRICE-05.

---

## Shared Patterns

### i18n wrapping (`useT()` / `t()`)
**Source:** `components/LanguageProvider.tsx:44-50` (fallback-to-English behavior), used throughout `components/LandingContent.tsx` and `components/SiteFooter.tsx`
**Apply to:** every new user-facing string in `LandingContent.tsx` (feature grid, closing CTA banner, restructured pricing cards) and `SiteFooter.tsx` (tagline, CCPA link, social-icon `aria-label`s can stay plain English strings since they're accessibility metadata, but visible copy should go through `t()`).
```typescript
const t = useT();
{t("Some new copy string")}
```

### `@/*` path-alias imports
**Source:** consistent throughout the codebase (`import { COMPANY } from "@/lib/legal";`, `import LegalLayout from "@/components/legal/LegalLayout";`)
**Apply to:** all new/modified files — never use relative `../../lib/...` imports.

### Contact/mailto pattern
**Source:** `app/legal/privacy/page.tsx:11` (`const mailto = (addr: string) => <a href={`mailto:${addr}`}>{addr}</a>;`), `lib/legal.ts` `COMPANY.contactEmail`
**Apply to:** `SiteFooter.tsx` contact line, `LandingContent.tsx` closing CTA banner button ("Talk to sales"), Enterprise pricing card CTA ("Contact sales") — all route to `mailto:hello@sourcegpt.org` per UI-SPEC.md Copywriting Contract (no `/contact` route exists).

### Tailwind card/section rhythm
**Source:** `components/LandingContent.tsx` — `.card` class, `py-24` (96px) section vertical rhythm, `max-w-screen-xl mx-auto px-4 sm:px-6` outer wrapper, `gap-6` grid gaps
**Apply to:** new feature-grid section and closing CTA banner — must match this established rhythm per UI-SPEC.md's justified `4xl`/96px exception (new sections are interleaved between existing 96px-rhythm sections).

### Amber accent discipline
**Source:** UI-SPEC.md Color section, existing `.btn-cta` usage at `LandingContent.tsx:42` (Hero) and `:204` (Final CTA), `tier.featured` badge at `:159-164` (Growth card)
**Apply to:** exactly 4 call sites total across this phase — Hero CTA (unchanged), Growth pricing card badge+CTA (unchanged pattern, continued for new tier set), Final CTA button (unchanged), new Closing CTA banner's "Talk to sales" button (new 4th use). Never apply to Basic/Premium/Enterprise CTAs, footer, or nav.

### Error-response shape for API routes
**Source:** `app/api/stripe/checkout/route.ts` (full file) — `NextResponse.json({ error: "..." }, { status: NNN })`, validated-before-branch ordering, `console.error` before returning 500
**Apply to:** any new validation branch added to the checkout route (e.g. rejecting `contactSales` tier checkout attempts).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `components/icons/SocialIcons.tsx` | component | static render | No existing icon-wrapper/brand-icon component exists in this repo (`lucide-react` v1.x removed brand icons entirely) — this is genuinely new presentational-component territory; follow the small-typed-component shape convention from `components/legal/LegalLayout.tsx`'s sub-components instead of a literal analog |
| `public/hero-placeholder.svg` | asset | file I/O | `public/` directory is currently empty — no prior static-asset convention exists in this repo to mirror; a new flat-color/simple placeholder graphic must be authored as part of this phase's own work |

## Metadata

**Analog search scope:** `lib/`, `components/`, `app/legal/`, `app/api/stripe/`, `app/billing/`, `tests/` — all directories directly implicated by CONTEXT.md/RESEARCH.md's explicit file list; no broader repo-wide scan was needed since every touched file already has either an in-place-extend target (itself) or an exact sibling-route template (`app/legal/privacy`, `app/legal/terms`).
**Files scanned:** 8 read in full this session for this pattern map (`lib/plans.ts`, `components/SiteFooter.tsx`, `app/legal/privacy/page.tsx`, `lib/legal.ts`, `components/LandingContent.tsx`, `app/api/stripe/checkout/route.ts`, `components/legal/LegalLayout.tsx`), plus CONTEXT.md/RESEARCH.md/UI-SPEC.md already-cited line ranges for `app/billing/page.tsx`, `tests/plans.test.ts`, `lib/usage.ts`, `app/api/stripe/webhook/route.ts` reused rather than re-read (no benefit to re-reading ranges already verified and quoted verbatim in RESEARCH.md).
**Pattern extraction date:** 2026-08-15
