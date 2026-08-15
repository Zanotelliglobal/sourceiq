# Change Request Backlog — collected 2026-08-15

Ten change requests gathered in a single working session (screenshots of a reference
site, `sourceiq.cloud`, plus plain-text asks). Each is logged here as a scoped,
ready-to-plan backlog item. Item 1 (rename) has since been completed; the remaining
nine have not yet been implemented. Ordered roughly by dependency/sequencing risk, not
by priority.

---

## 1. Renamed the product to SourceGPT (complete)

**Type:** Rebrand · **Effort:** large, cross-cutting · **Risk:** high (touches
production config, external services, legal docs)

The startup renamed from SourceIQ to SourceGPT (corrected from an earlier
"SupplyAI" placeholder in this same conversation — SourceGPT was final). This was the
**last item** collected this session and closed out this backlog round.

**Scope, as grounded against the repo before this rename landed:**
- A case-insensitive grep for the old brand name across `.ts`/`.tsx` found **~162
  occurrences in ~40 files**, including:
  - `package.json` (`"name"` field)
  - UI/branding: `app/layout.tsx`, `app/page.tsx`, `app/opengraph-image.tsx`,
    `components/AppShell.tsx`, `components/TopNav.tsx`, `components/SiteFooter.tsx`,
    `components/EventSwitcher.tsx`, `components/LandingContent.tsx`,
    `components/CookieConsent.tsx`, `components/OnboardingChecklist.tsx`
  - App pages: `app/billing/page.tsx`, `app/events/[id]/page.tsx`,
    `app/events/new/page.tsx`, `app/settings/page.tsx`, `app/supplier/rfi/page.tsx`,
    `app/legal/privacy/page.tsx`, `app/legal/terms/page.tsx`
  - Backend/copy strings: `lib/agents.ts` (agent prompts), `lib/contact.ts`,
    `lib/mail.ts` (email templates/sender name), `lib/notifications.ts`,
    `lib/observability.ts`, `lib/legal.ts`, `lib/plans.ts`, `lib/roles.ts`,
    `lib/tenant.ts`
  - i18n: `lib/i18n/config.ts`, `de.ts`, `es.ts`, `fr.ts`, `it.ts`
  - Tests: `tests/prompt-injection-defense.test.ts` (brand name likely used as an
    injection-guard fixture — needed care, not blind find/replace)
  - Docs: `README.md`, `docs/LAUNCH-PLAN.md`,
    `docs/competitive-comparison-sourcegpt-vs-sourceready.md`,
    `docs/competitive-sourceready-backlog.md`, `docs/e2e-audit-report.md`,
    `docs/linkedin-content-plan.md`, `docs/product-feedback-backlog.md`
  - No `.env.example` file exists in the repo, and no old-brand-prefixed env var names
    were found — env vars are already domain-neutral (`STRIPE_PRICE_*`,
    `ANTHROPIC_API_KEY`, etc.), so this was **not** a source of hidden rename debt.

**Open questions raised at the time (some may remain open outside this repo):**
- Whether a `sourcegpt.com`/similar domain existed that needed migrating, or
  DNS/redirect work — out of scope for code changes.
- Stripe: any product/price *display names* in the Stripe dashboard referencing the
  old brand — code only stores price IDs, not names, so this was a Stripe-dashboard
  edit, not a code change, flagged so it wasn't missed.
- Clerk: application display name / email templates in the Clerk dashboard likely
  also referenced the old brand — same as above, a dashboard edit outside this repo.
- Support/contact email addresses used in `lib/mail.ts` and legal pages — needed the
  real new address before find/replace, not a placeholder.
- The `-ux-autoresearch` and `-autoresearch` internal research/planning directories
  (not shipped product) were intentionally left under their pre-rename names as
  historical record rather than renamed, per the 01-01 bulk-rename decision.
- Whether "SupplyAI" needed a fresh logo/wordmark (visual asset work, not text
  rename) — `design-system/MASTER.md` and `app/opengraph-image.tsx` referenced the
  old branding assets at the time.

**Approach taken:** scripted case-aware find/replace of the old brand name (all
letter-casings) with the new one across app/lib/components/docs, except
the two `-autoresearch` history directories and with manual review of
`tests/prompt-injection-defense.test.ts` (confirmed the brand string there was
incidental, not load-bearing for the guard logic), followed by `package.json` name
bump, `npm run typecheck && npm run lint && npm test && npm run build`, and a manual
pass over legal pages (Privacy/Terms) since those are user-facing legal text, not just
branding.

**Note:** "SourceGPT" embeds a third-party trademark ("GPT," associated with OpenAI).
Worth a quick trademark/naming-risk sanity check before this ships publicly — flagging,
not blocking, since that's a legal/business call outside this repo.

---

## 2. Pricing restructure

**Type:** Pricing/billing change · **Effort:** medium-large

Replace the current 5-tier structure in `lib/plans.ts` (free €0 / basic €49 / growth
€89 / premium €149 / pro €399) with a **3 paid tiers + 1 enterprise ("contact us", no
listed price)** structure, matching the reference site's layout.
- Free trial available **only on the base paid tier** (no separate free tier).
- Base tier price ~$1,400–1,500/month (vs. current €49 basic) — a currency switch
  (EUR→USD) is implied, not just a number change.
- Roughly 1.5–2x step-up between each paid tier.
- Enterprise tier: no listed price, "Contact us" CTA, presumably custom limits.

**Where:** `lib/plans.ts` (`TIERS`, `TierLimits`, cadence pricing), Stripe price env
vars (`STRIPE_PRICE_<TIER>_<CADENCE>` — will need new Stripe Price objects created for
the new tier names/amounts), `app/billing/page.tsx` (pricing display), landing page
pricing section if present.

**Open questions:** exact tier names and per-tier limits (events/mo, waves/event,
suppliers/event, seats) for the new 3+1 structure aren't specified yet — will need
either a follow-up input or reasonable defaults scaled from the current limits ladder.
Currency (USD vs EUR) and whether existing paying customers on old tiers get
grandfathered pricing.

---

## 3. Landing page footer + closing CTA banner

**Type:** Marketing page addition · **Effort:** small-medium

Add, before the footer:
- A closing CTA banner ("Don't see a perfect fit?"-style prompt).

And a footer containing:
- Logo + one-line mission tagline
- Contact email
- Social icons (Facebook, Instagram, LinkedIn)
- Legal links: Privacy Policy, Terms & Conditions, CCPA Policy
- Copyright line

**Where:** a `components/SiteFooter.tsx` **already exists** in the repo — this is
likely an extend/redesign task rather than a from-scratch build. `app/legal/privacy`
and `app/legal/terms` already exist; a **CCPA Policy page does not** (only privacy +
terms were found) — that's a new page, not just a new link.

**Open question:** CCPA Policy content needs to be drafted (legal text), not just a
link stub — flagging as a dependency, not blocking the footer layout work itself.

---

## 4. Single Sign-On (SSO) login option

**Type:** Auth feature · **Effort:** medium, external-dependency-gated

Add SSO as a login option alongside existing email/password (+ "Remember me"/"Forgot
password?" if not already present).

**Where:** Clerk-hosted auth (`<SignIn/>`/`<SignUp/>` components, wherever configured)
— Clerk supports enterprise SSO/SAML connections, but this is typically gated to a
paid Clerk plan tier and requires per-connection setup (each customer's IdP) rather
than a single code change.

**Open question (blocking, needs verification before scoping further):** does the
current Clerk plan/subscription support SAML/Enterprise SSO connections? This needs
checking in the Clerk dashboard, not the codebase — the code-side change is likely
small (enabling the Clerk SSO connection UI) but the commercial/plan gate needs
resolving first.

---

## 5. Support/help chatbot widget (in-app + public)

**Type:** New feature · **Effort:** medium-large, build-vs-buy decision needed

Add a chat widget for asking questions, available on both public marketing pages and
inside the logged-in app, styled like a Zendesk/Intercom-style widget per the
reference screenshot.

**Open question (blocking):** build vs. buy —
- **Buy**: integrate a real vendor (Zendesk, Intercom, Crisp, etc.) — fast to ship,
  recurring cost, real support-ticket/agent-handoff workflow.
- **Build**: a lightweight in-house widget (likely LLM-backed given the existing
  Anthropic SDK usage in `lib/agents.ts`) — cheaper recurring cost, more engineering
  effort, no human-agent escalation path unless also built.

Recommend resolving this decision before scoping implementation tasks further.

---

## 6. Feature-grid repositioning (landing page "what we do" section)

**Type:** Marketing copy change · **Effort:** small (copy-only, no code logic changes)

Resolved via discussion against the actual codebase (grepped for `RFP`, `erp/webhook/
integration`, `marketplace` — see below):

- **Include as-is** (both are real, shipped functionality): Autonomous Sourcing Engine,
  Compliance & Audit.
- **Reposition to match actual (partial) functionality**, not the reference's stronger
  claims: Workflow Automation, Collaboration Hub, Budget & Spend Intelligence.
- **Reposition "Supplier Marketplace"** copy specifically to: *"AI discovers and
  verifies suppliers live from the web"* — explicitly **not** "100k+ pre-screened
  database," since no such pre-built database exists in this codebase (confirmed: the
  only "marketplace" reference in the codebase is an incidental mention in an
  enrichment-agent prompt about acceptable review-score sources, not a real feature).
- **Exclude entirely**: RFP & Intake Tools, ERP/API Integrations — grep confirmed
  **zero** RFP terminology/functionality and **no genuine ERP or public API
  integration** exists today (only Stripe's own webhook and an inbound-mail webhook for
  email-reply parsing were found, neither of which is a customer-facing integration
  feature).

**Where:** landing page feature-grid section (`components/LandingContent.tsx` or
`app/page.tsx`, per the file inventory above).

**Remaining work:** draft the actual repositioned copy for Workflow Automation,
Collaboration Hub, and Budget & Spend Intelligence (not yet drafted — only the
Supplier Marketplace copy was finalized in discussion).

---

## 7. RFP Matching as a third investigation-intake method

**Type:** New feature · **Effort:** large (new parsing pipeline + UI flow)

Add the ability to upload an RFP/brief document as a new way to start an investigation,
alongside the existing two methods:
- **Full Investigation** (`/api/orchestrate` — multi-agent scout→qualify→enrich→contact,
  real web_search, consumes wave_count/billing)
- **Quick Investigation** (`/api/investigate-quick` — single no-tools Sonnet call,
  unverified `is_quick_result=true` rows)

After the RFP is parsed, the buyer chooses which of the two existing engines (quick or
full) to run against the extracted brief — RFP matching is an **intake/parsing** step,
not a third execution engine.

**Where:** likely extends the existing classifier pattern
(`/api/classify` → `runClassifierAgent()` in `lib/agents.ts`, currently free-text input
→ `{category, subcategory, confidence}`) to accept document upload (PDF/DOCX) instead
of/in addition to free text, then routes into the existing new-event flow
(`app/events/new/page.tsx`) pre-filled from the parsed brief.

**Open questions:** document parsing approach (PDF text extraction library, or feed
the file directly to Claude if using a model with native document support), file size/
type limits, what extracted fields map to (`category`, `subcategory`, `description`,
`requirements`, `target_countries`, etc. on `sourcing_events`), and error handling for
unparseable documents.

---

## 8. Demo video + demo screenshots on landing page

**Type:** Marketing page addition · **Effort:** small-medium (mostly asset-dependent)

Add a demo video and screenshots to the landing page hero/marketing section, matching
the reference layout: embedded dashboard screenshot next to the headline, "Watch Demo"
CTA that triggers video playback.

**Where:** landing page hero section (`components/LandingContent.tsx` / `app/page.tsx`).

**Open question:** the actual video and screenshot **assets** don't exist yet — this
needs either real product screenshots captured from the live app, or a recorded demo
video, before the UI slot can be wired up meaningfully (a placeholder can ship first).

---

## 9. Supplier feedback via star rating

**Type:** New feature · **Effort:** small-medium (new column/table + UI widget)

Let buyers rate individual suppliers with a star rating (likely 1–5).

**Where:** supplier row/detail view in `app/events/[id]/page.tsx`; new schema addition
on/near the `suppliers` table.

**Open question (blocking, needs a decision before schema design):** is this
**internal buyer-side feedback** (e.g., "how good was this supplier's response/fit,"
scoped per event, private to the org) — a simple additive column on `suppliers`
(`buyer_rating INT`) — or a **reusable, cross-event supplier-quality signal**
(aggregated across orgs/events, informing future scouting) — which would need a
separate `supplier_ratings` table keyed by `(supplier_identity, org_id, event_id,
rater_user_id)` since the current `suppliers` table is per-event, not a shared
supplier identity registry. Recommend confirming which model before implementing.

**Update:** item **#10** below (persistent cross-investigation supplier repository)
directly resolves this — if #10 ships, ratings should attach to the shared repository
entry rather than a per-event column, so ratings accumulate across every event/org
that encounters that supplier. Recommend sequencing #10 before #9, or designing both
together, rather than building a per-event rating column now and migrating later.

---

## 10. Persistent cross-investigation supplier repository

**Type:** New data feature · **Effort:** large (new shared data model + dedup/write
path across every investigation entry point) · **Depends on:** clarifies/resolves the
open schema question in **#9**

Store supplier names (and their known data) into a durable repository every time an
investigation runs — quick scan, full investigation, or (once built) RFP matching —
so that a growing, reusable "known suppliers" repo builds up over time instead of each
event's discoveries being siloed to that one `sourcing_events` row.

**Why this matters / what it unlocks:** today, `suppliers` rows are scoped to a single
`event_id` — nothing survives or is reusable across events even within the same org,
let alone across orgs. A persistent repository would let a new investigation check
"have we (or has anyone) already found/verified this supplier" before spending
AI-search budget rediscovering it, and is also what would make item **#6**'s
"Supplier Marketplace" feature-grid tile *actually true* in the future (today it's
intentionally repositioned to "AI discovers and verifies suppliers live from the web"
specifically because no persistent database exists yet — this item is the path to
eventually earning that stronger claim honestly).

**Where:** the existing per-event dedup logic (`lib/dedup.ts`'s `normName`/`domainOf`,
used by both `/api/orchestrate` and `/api/investigate-quick`) already normalizes names/
domains for **within-event** dedup — this item extends that same normalization to a
**new, durable table** that persists across events. Write path hooks into
`makeProcessSupplier`/`makeProcessSupplierQuick` (`lib/process-supplier.ts`), the
insertion point both investigation types already funnel through.

**Open questions (blocking — need a decision before schema design, and directly
determine how #9's rating feature should be modeled):**
- **Scope of sharing** — is this repository scoped per-org (each org builds its own
  private supplier knowledge base) or platform-wide (shared across all orgs/tenants)?
  Platform-wide is far more valuable (network effect: org A's discovery helps org B)
  but raises real multi-tenancy/data-ownership questions — supplier company names/
  websites are arguably public info, but any org-specific enrichment, scores, or notes
  attached to a supplier must **not** leak across tenants. Needs an explicit decision,
  not an assumption.
- **What gets persisted** — just `{name, website, country}` as a lightweight identity
  record, or the fuller enrichment payload (contact info, AI score, review data)? The
  fuller the record, the more this becomes a real "supplier marketplace," but also the
  more it needs its own refresh/staleness policy (enrichment data goes stale; a 2026
  contact scrape shouldn't silently look "current" in 2028).
- **Identity/dedup key** — company name + domain is a reasonable first pass (mirrors
  existing `normName`/`domainOf` logic) but real-world supplier identity is messier
  (subsidiaries, name changes, multiple regional entities) — decide how much fuzzy-
  matching rigor this needs at v1 vs. later.
- **Relationship to #9 (star ratings)** — if this repository exists, ratings almost
  certainly belong on the **repository entry** (one supplier, ratings accumulate across
  every event/org that has dealt with it) rather than on the per-event `suppliers` row.
  Recommend deciding #10's scope first, since it determines whether #9 needs its own
  new table or can attach directly to this one.
- **Backfill** — does this apply going forward only, or does existing `suppliers` data
  get backfilled into the new repository retroactively?

---

## Suggested sequencing

1. **#1 (rename)** first if at all possible — every other item's new code/copy should
   land under the SupplyAI name rather than being renamed twice. If the domain/Stripe/
   Clerk dashboard side of the rename isn't ready yet, at minimum land the in-repo
   code/copy rename before starting new feature work, to avoid compounding diff noise.
2. **#5, #9** (chatbot, star rating) are the most self-contained — good candidates for
   early, isolated PRs once naming lands.
3. **#3, #6, #8** (footer, feature-grid copy, demo assets) are landing-page copy/layout
   work — can be batched together since they touch the same file(s).
4. **#2 (pricing)** and **#4 (SSO)** both have an external-dependency blocker (new
   Stripe Price objects; Clerk plan verification) — resolve those blockers in parallel
   with other work, then implement.
5. **#7 (RFP matching)** is the largest single item — sequence last, after the intake
   surface it plugs into (new-event flow) has settled from any other changes above.
