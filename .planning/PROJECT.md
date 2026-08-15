# SourceIQ (renaming to SourceGPT)

## What This Is

SourceIQ is a Next.js-based, multi-tenant AI supplier-discovery platform: buyers
describe a sourcing need, a multi-agent pipeline (scout → qualify → enrich → contact
scrape) discovers, verifies, and shortlists real-world suppliers via live web search,
and buyers can then run outreach campaigns to the shortlist directly from the app.
A faster, unverified "Quick Investigation" mode also exists alongside the full,
verified pipeline. The product is mid-rebrand to **SourceGPT**.

## Core Value

Buyers get a vetted, real supplier shortlist for a sourcing need faster than manual
research would produce — and can act on it (outreach) without leaving the app.

## Business Context

- **Customer**: B2B procurement/sourcing teams (buyers) sourcing new suppliers.
- **Revenue model**: Subscription SaaS via Stripe, tiered by usage (events/waves/
  suppliers/seats), with a free-trial window.
- **Success metric**: Verified, qualified suppliers discovered and shortlisted per
  paying org (drives renewal/expansion); output of this milestone should also unblock
  the pricing-tier restructure captured below.
- **Strategy notes**: `docs/change-request-backlog.md` — 10 change requests collected
  from a working session against a reference competitor site (`sourceiq.cloud`),
  ordered by dependency/sequencing risk. This is the source idea document for this
  milestone.

## Requirements

### Validated

- ✓ Multi-agent discovery pipeline (orchestrator → scout → qualifier → enricher →
  contact-finder) with live web search — existing
- ✓ Streaming (SSE) discovery wave with real-time supplier results — existing
- ✓ Quick Investigation: fast, names-only, unverified supplier scan with "Deepen into
  full investigation" upgrade path — existing
- ✓ Multi-tenant org isolation (Clerk auth, org-scoped events/suppliers) — existing
- ✓ Subscription billing & plan-tier enforcement (Stripe), wave/spend/rate limits —
  existing
- ✓ Supplier outreach (drafted + sent email, native-language drafting, inbound-reply
  parsing via Svix webhook) — existing
- ✓ CSV/PDF export of supplier shortlists — existing
- ✓ i18n support (de/es/fr/it locales) — existing

### Active

- [ ] **Rename product SourceIQ → SourceGPT** across code, copy, docs (~162 occurrences
      in ~40 files per repo grep) — first in sequence; new work should land under the
      new name rather than being renamed twice. (Backlog #1)
- [ ] **Pricing restructure**: replace current 5-tier EUR structure (`lib/plans.ts`)
      with 3 paid tiers + 1 "Contact us" enterprise tier, USD pricing, free trial only
      on the base paid tier, ~1.5-2x step-up between tiers. New Stripe Price objects
      required. (Backlog #2)
- [ ] **Landing page footer + closing CTA banner**: extend existing
      `components/SiteFooter.tsx` with mission tagline, contact email, social icons,
      legal links (Privacy/Terms/**new CCPA page**), copyright; add a pre-footer
      closing CTA banner. (Backlog #3)
- [ ] **SSO login option** alongside email/password, via Clerk enterprise SSO/SAML
      connections (pending verification that the current Clerk plan supports it).
      (Backlog #4)
- [ ] **Support/help chatbot widget** (public + in-app) — build-vs-buy decision needed
      before implementation (vendor like Intercom/Zendesk/Crisp vs. lightweight
      in-house LLM-backed widget using the existing Anthropic SDK). (Backlog #5)
- [ ] **Feature-grid repositioning** on the landing page "what we do" section —
      copy-only change reconciling marketing claims with actually-shipped
      functionality (confirmed via grep against the codebase). (Backlog #6)
- [ ] **RFP Matching intake method**: upload an RFP/brief document as a third way to
      start an investigation (alongside free-text classify), extracting fields that
      pre-fill the existing new-event flow; buyer still chooses Quick or Full
      investigation to run against the parsed brief. (Backlog #7)
- [ ] **Demo video + screenshots** on the landing page hero — mostly asset-dependent;
      placeholder can ship before real assets exist. (Backlog #8)
- [ ] **Supplier star-rating feedback** (1-5) — schema/scope decision needed: per-event
      column vs. cross-event supplier-identity table; directly depends on #10 below.
      (Backlog #9)
- [ ] **Persistent cross-investigation supplier repository**: durable, deduped
      supplier record store spanning quick scan / full investigation / (future) RFP
      matching, so discoveries aren't siloed per-event. Scope (per-org vs.
      platform-wide), persisted fields, dedup rigor, and backfill are open questions
      to resolve before schema design; resolves #9's schema ambiguity. (Backlog #10)

### Out of Scope

- **Cross-org supplier-quality signal sharing beyond what #10 explicitly enables** —
  any "network effect" beyond the persistent-repository scope decided in #10 is
  deferred; don't build ahead of that decision.
- **DNS/domain migration, Stripe/Clerk dashboard display-name edits, and legal-name
  changes for the rename** — these are external dashboard/business actions outside
  this repo's code, tracked as open questions in backlog #1 but not code-change work.
- **Trademark risk review of "SourceGPT"** ("GPT" is an OpenAI-associated term) — a
  legal/business call flagged in backlog #1, not something this repo's code changes
  resolve.

## Context

- Brownfield codebase: Next.js 14 / React 19 / TypeScript, Neon Postgres (serverless
  HTTP driver, no multi-statement transactions), Clerk auth, Stripe billing, Resend
  email, Anthropic Claude SDK for all agent tiers. Full stack/architecture detail in
  `.planning/codebase/STACK.md` and `.planning/codebase/ARCHITECTURE.md`.
- This milestone's scope is a 10-item change-request backlog gathered in one session
  against a reference competitor site (`sourceiq.cloud`) plus plain-text asks — see
  `docs/change-request-backlog.md` for full detail, open questions, and the
  suggested-sequencing rationale per item.
- Several Active items have **blocking open questions** noted inline (SSO's Clerk-plan
  gate, chatbot's build-vs-buy call, pricing's exact tier limits/names, RFP matching's
  parsing approach, ratings' schema model, repository's sharing scope) — these need
  resolving (via `/gsd-discuss-phase` or direct user decision) before or during
  planning of the relevant phase, not assumed away.
- The backlog's own "Suggested sequencing" section doesn't yet mention item #10 —
  noted as a known gap in the source doc, not a blocker for roadmap creation, since
  #10's dependency relationship to #9 is already spelled out in both items' text.

## Constraints

- **Rename sequencing**: land the SourceIQ→SourceGPT rename (backlog #1) first,
  before other backlog items, so new copy/code lands under the final name instead of
  being renamed twice — explicit sequencing decision from the source document.
- **Tech stack**: Next.js/TypeScript/Neon Postgres/Clerk/Stripe/Anthropic SDK — new
  features should follow existing patterns (agent tiers in `lib/agents.ts`, gated API
  routes, `lib/tenant.ts` org isolation) rather than introducing a parallel stack.
- **Serverless request timeouts**: Vercel enforces short defaults (60s classify, 300s
  orchestrate `maxDuration`) — any new long-running work (e.g. RFP document parsing)
  must fit within or route around this.
- **No multi-statement DB transactions**: Neon's HTTP driver limits atomicity to
  single statements — new schema/write-path work (e.g. the supplier repository) must
  design around this.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use `docs/change-request-backlog.md` as the idea document for this milestone (auto mode, no live questioning) | User already ran a full backlog-gathering session; re-asking would duplicate work | — Pending |
| Treat "SourceGPT" (not the transient "SupplyAI" placeholder) as the final rebrand name | Backlog #1 explicitly states SourceGPT is the corrected, final choice | — Pending |
| Sequence rename (#1) before all other backlog items | Explicit sequencing guidance in the source backlog doc | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-15 after initialization*
