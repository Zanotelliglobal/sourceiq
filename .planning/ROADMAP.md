# Roadmap: SourceIQ → SourceGPT

## Overview

This milestone ships a 10-item change-request backlog on top of a live, revenue-generating
product. The journey starts with a wide-blast-radius but mechanically simple rename
(SourceIQ → SourceGPT, including a manual security-relevant prompt review), so all
subsequent work lands under the final name. It then splits into two independent tracks:
a self-contained marketing/pricing surface refresh, and the architecturally significant
persistent supplier repository — the single highest-leverage, highest-risk piece of the
backlog, which supplier star ratings depend on directly. The milestone closes with three
largely independent, parallelizable additions (RFP document intake, SSO login, and a
support chatbot) that each carry their own external/vendor decision but share no hard
architectural coupling with each other.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Rename & Brand Migration** - SourceIQ → SourceGPT across every user-facing surface and internal identifier, with a human-verified pass over security-relevant prompt text.
- [ ] **Phase 2: Marketing & Pricing Surface** - New 3+1 tier USD pricing page, footer/CTA/CCPA legal surface, and repositioned feature-grid copy, with existing customers protected from billing outage.
- [ ] **Phase 3: Persistent Supplier Repository** - Durable, deduped, org-scoped supplier identity store shared across quick scan, full investigation, and (later) RFP matching, with private org data isolated from shared identity fields.
- [ ] **Phase 4: Supplier Star Ratings** - Buyers rate suppliers 1-5 stars at the repository-identity level, coexisting with the existing per-event thumbs-up/down signal.
- [ ] **Phase 5: RFP Intake, SSO & Support Chatbot** - Document-based investigation intake, enterprise SSO login, and an in-app/public support widget, each additive to existing flows.

## Phase Details

### Phase 1: Rename & Brand Migration

**Goal**: Every user-facing and internal-code surface reflects "SourceGPT" instead of "SourceIQ", with the security-relevant prompt text in `lib/agents.ts` manually reviewed and verified unchanged in behavior.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: BRAND-01, BRAND-02, BRAND-03, BRAND-04, BRAND-05
**Success Criteria** (what must be TRUE):

  1. A user browsing any public page, in-app page, email, or legal page — in any supported locale (de/es/fr/it) — sees "SourceGPT" branding, never "SourceIQ"
  2. `package.json`'s name and internal code identifiers reflect the new name where reasonable to change
  3. The `INJECTION_DEFENSE` anti-impersonation clause and outreach non-disclosure rules in `lib/agents.ts` have been manually reviewed and renamed by a human, with the guard's behavior confirmed unchanged (not just "tests green")
  4. A repo-wide, case-insensitive grep for "SourceIQ" returns zero unintended hits, with a documented exception list covering: the two `-autoresearch` history directories, `.planning/` (this milestone's own planning docs, which necessarily narrate the rename), the dead/legacy `sourceiq.db*` local-dev artifacts, and `.claude/worktrees/` tooling scratch directories (expanded during Phase 1 planning, see `01-CONTEXT.md` D-09 and `REQUIREMENTS.md` BRAND-05)

**Plans**: 2/4 plans executed
Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Bulk scripted rename (SourceIQ → SourceGPT) across app/, lib/ (excl. agents.ts), components/, tests/ (excl. prompt-injection-defense.test.ts), i18n locales, docs/, package.json, brand assets

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 01-02-PLAN.md — Manual, human-verified rename of lib/agents.ts's INJECTION_DEFENSE/identityRules security-critical prompt text
- [x] 01-03-PLAN.md — Manual rename of legal pages and narrative docs (change-request-backlog.md, .claude/CLAUDE.md)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 01-04-PLAN.md — Full verification suite, dual-scope BRAND-05 grep sweep, and phase sign-off

**UI hint**: yes

### Phase 2: Marketing & Pricing Surface

**Goal**: Buyers see an accurate, revenue-ready marketing and pricing surface — new tier structure, refreshed footer/legal/CTA content, and feature-grid copy that matches shipped functionality — without disrupting any existing paying customer's billing.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: PRICE-01, PRICE-02, PRICE-03, PRICE-04, PRICE-05, MKT-01, MKT-02, MKT-03, MKT-04, MKT-05
**Success Criteria** (what must be TRUE):

  1. Buyer sees 3 paid tiers plus a "Contact us" enterprise tier (no listed price) in USD on the pricing page, with roughly a 1.5-2x step-up between paid tiers and a base tier priced ~$1,400-1,500/month
  2. Buyer can start a free trial only on the base paid tier; no separate free tier is offered anywhere on the page
  3. Every existing organization's current plan value continues to resolve to a valid tier immediately after deploy — no billing-gate outage for existing paying customers
  4. Landing page footer shows logo, mission tagline, contact email, social icons, legal links (Privacy, Terms, and a real-content CCPA page), and a copyright line, preceded by a closing CTA banner before the footer
  5. The "what we do" feature-grid copy matches actually-shipped functionality per the resolved backlog mapping (reworded/repositioned/removed as specified), and the hero section has a working demo video/screenshot slot (placeholder acceptable)

**Plans**: TBD
**UI hint**: yes

### Phase 3: Persistent Supplier Repository

**Goal**: Suppliers discovered through any investigation path persist in a durable, deduped, org-scoped identity store that outlives any single event, with shared identity fields architecturally isolated from org-private data.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: REPO-01, REPO-02, REPO-03, REPO-04, REPO-05, REPO-06
**Success Criteria** (what must be TRUE):

  1. A supplier discovered in one event is still present and retrievable in the org's repository after that event/session ends
  2. Suppliers discovered via quick scan, full investigation, or (once built) RFP matching all write through the same single shared insertion path
  3. Re-discovering a supplier whose name/domain normalizes to an already-known record does not create a duplicate repository entry
  4. A query bug scoped to one org's data path cannot expose another org's private enrichment, AI score, notes, or rating data (verified by an explicit two-org test)
  5. A new investigation can check the repository for an already-known supplier before spending AI-search budget rediscovering it, and the repository stays scoped per-org (not platform-wide) for this milestone

**Plans**: TBD

### Phase 4: Supplier Star Ratings

**Goal**: Buyers can rate suppliers 1-5 stars, with the rating attached to the supplier's durable repository identity so it accumulates across every event that encounters that supplier within the org.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: RATE-01, RATE-02, RATE-03
**Success Criteria** (what must be TRUE):

  1. A buyer can assign a 1-5 star rating to a supplier from the supplier row/detail view in an event page
  2. A supplier's star rating is attached to its repository entry and displays consistently across every event within the org that encounters that supplier, not reset per event
  3. The existing per-event `feedback_signal` thumbs-up/down field still works unchanged alongside the new star rating

**Plans**: TBD
**UI hint**: yes

### Phase 5: RFP Intake, SSO & Support Chatbot

**Goal**: Buyers gain three independent, additive entry points — document-based investigation intake, enterprise SSO login, and self-serve product support — with no disruption to existing investigation, auth, or billing flows.
**Mode:** mvp
**Depends on**: Phase 2, Phase 3
**Requirements**: RFP-01, RFP-02, RFP-03, RFP-04, RFP-05, SSO-01, SSO-02, CHAT-01, CHAT-02
**Success Criteria** (what must be TRUE):

  1. A buyer can upload a PDF RFP/brief document and see it parsed into the same fields the free-text classifier produces (category, subcategory, description, requirements, target_countries, etc.), pre-filled into the new-event form for review and edit before submission — extraction never auto-submits silently
  2. An unparseable or invalid RFP upload produces a clear, actionable error instead of a silent failure or a corrupted event
  3. After RFP intake, the buyer chooses which existing engine (Quick Investigation or Full Investigation) to run against the extracted brief — RFP matching remains intake-only, never a third execution engine
  4. A buyer's organization can sign in via SSO (SAML/OIDC) as an additive option, while existing "Remember me" and "Forgot password?" affordances remain present and unaffected for non-SSO accounts
  5. A chat widget is available on both public marketing pages and inside the logged-in app, answers from a bounded product-specific knowledge scope, and falls back to a human-contact path rather than guessing on billing/account questions it isn't confident about

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Rename & Brand Migration | 2/4 | In Progress|  |
| 2. Marketing & Pricing Surface | 0/TBD | Not started | - |
| 3. Persistent Supplier Repository | 0/TBD | Not started | - |
| 4. Supplier Star Ratings | 0/TBD | Not started | - |
| 5. RFP Intake, SSO & Support Chatbot | 0/TBD | Not started | - |
