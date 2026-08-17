# Requirements: SourceIQ → SourceGPT

**Defined:** 2026-08-15
**Core Value:** Buyers get a vetted, real supplier shortlist for a sourcing need faster than manual research would produce — and can act on it (outreach) without leaving the app.

## v1 Requirements

Requirements for this milestone (the 10-item change-request backlog in
`docs/change-request-backlog.md`). Each maps to a roadmap phase.

### Brand (rename SourceIQ → SourceGPT)

- [x] **BRAND-01**: Every user-facing surface (UI copy, page titles, OG image, emails,
      legal pages, i18n locales de/es/fr/it) reads "SourceGPT", not "SourceIQ"

- [x] **BRAND-02**: `package.json` name and any internal code identifiers reflect the
      new name where reasonable to change

- [x] **BRAND-03**: The `SourceIQ` string embedded in `lib/agents.ts`'s
      INJECTION_DEFENSE anti-impersonation clause and outreach non-disclosure rules is
      manually reviewed and renamed (not blind find/replace), with a human verifying
      the guard's behavior is unchanged

- [x] **BRAND-04**: `tests/prompt-injection-defense.test.ts` is manually reviewed to
      confirm the brand string used there is incidental fixture data, not load-bearing
      for the guard logic, before/after the rename

- [x] **BRAND-05**: A repo-wide grep for the old name (case-insensitive) after the
      rename returns zero unintended hits, with the following as the complete,
      documented exception list: the two `-autoresearch` history directories; the
      `.planning/` directory (this milestone's own planning docs narrate the rename
      and necessarily reference the old name); the `sourceiq.db`/`.db-shm`/`.db-wal`
      local-dev SQLite artifacts (confirmed dead/legacy, unreferenced by any current
      source); and `.claude/worktrees/` (unrelated tooling scratch directories, not
      shipped product). This exception list was expanded from the original two-item
      list during Phase 1 planning (see `01-CONTEXT.md` D-09) once research confirmed
      each additional item is genuinely out of the rename's blast radius, not an
      oversight.

### Pricing

- [ ] **PRICE-01**: Buyer sees 3 paid tiers + 1 "Contact us" enterprise tier (no listed
      price) on the pricing page, replacing the current 5-tier display

- [ ] **PRICE-02**: New tier pricing is displayed in USD with roughly a 1.5-2x
      step-up between paid tiers, base tier priced ~$1,400-1,500/month

- [ ] **PRICE-03**: Free trial is available only on the base paid tier (no separate
      free tier offered)

- [ ] **PRICE-04**: New Stripe Price objects exist for every new tier/cadence
      combination and are wired to `lib/plans.ts`

- [ ] **PRICE-05**: Every existing organization's current `plan` value continues to
      resolve to a valid tier after deploy (no billing-gate outage for existing paying
      customers) — either via a grandfathered legacy-tier mapping or a completed,
      verified migration

### Marketing Surface

- [ ] **MKT-01**: Landing page includes a closing CTA banner ("Don't see a perfect
      fit?"-style) before the footer

- [ ] **MKT-02**: Footer includes logo + one-line mission tagline, contact email,
      social icons (Facebook, Instagram, LinkedIn), legal links (Privacy, Terms, CCPA),
      and a copyright line

- [ ] **MKT-03**: A new CCPA Policy page exists at a legal route parallel to the
      existing Privacy/Terms pages, with real (not placeholder) policy content

- [ ] **MKT-04**: Landing page "what we do" feature grid copy is repositioned per the
      backlog's resolved mapping: include Autonomous Sourcing Engine and Compliance &
      Audit as-is; reword Workflow Automation, Collaboration Hub, and Budget & Spend
      Intelligence to match actual (partial) functionality; reposition "Supplier
      Marketplace" copy to "AI discovers and verifies suppliers live from the web";
      remove RFP & Intake Tools and ERP/API Integrations tiles entirely

- [ ] **MKT-05**: Landing page hero/marketing section has a demo video and/or
      screenshot slot wired up (placeholder acceptable if real assets aren't ready yet)

### Supplier Repository

- [x] **REPO-01**: A new persistent, org-scoped supplier identity store exists,
      separate from the per-event `suppliers` table, that survives across events

- [x] **REPO-02**: Every supplier discovered via quick scan, full investigation, or (once
      built) RFP matching is written into the repository through a single shared write
      path (extending `lib/process-supplier.ts`'s existing insertion point)

- [x] **REPO-03**: The repository dedups on the same name/domain normalization already
      used for within-event dedup (`lib/dedup.ts`), so re-discovering a known supplier
      doesn't create a duplicate identity record

- [x] **REPO-04**: Shared/public supplier identity fields (name, domain, country) are
      modeled separately from org-private fields (enrichment, AI score, notes, rating)
      so a single query bug cannot leak one org's private data to another org

- [x] **REPO-05**: A new investigation can check the repository for an already-known
      supplier before spending AI-search budget rediscovering it

- [x] **REPO-06**: Repository is scoped per-org (not platform-wide) for this milestone —
      see Out of Scope

### Supplier Ratings

- [ ] **RATE-01**: A buyer can rate a supplier 1-5 stars from the supplier row/detail
      view in the event page

- [ ] **RATE-02**: Ratings attach to the supplier's repository entry (REPO-01), not a
      per-event column, so ratings accumulate across every event that encounters that
      supplier within the org

- [ ] **RATE-03**: The new star rating coexists with (does not replace) the existing
      per-event `feedback_signal` thumbs-up/down field

### RFP Matching Intake

- [ ] **RFP-01**: A buyer can upload a PDF RFP/brief document as a third way to start
      an investigation, alongside the existing free-text description flow

- [ ] **RFP-02**: The uploaded document is parsed into the same fields the free-text
      classifier produces (category, subcategory, description, requirements,
      target_countries, etc.) via a dedicated route with its own timeout budget

- [ ] **RFP-03**: The buyer sees and can review/edit every extracted field before the
      new-event form is submitted — extraction never auto-submits silently

- [ ] **RFP-04**: An unparseable or invalid upload produces a clear, actionable error
      instead of a silent failure or a corrupted event

- [ ] **RFP-05**: After intake, the buyer chooses which existing engine (Quick
      Investigation or Full Investigation) to run against the extracted brief — RFP
      matching is intake only, not a third execution engine

### Single Sign-On

- [ ] **SSO-01**: A buyer's organization can sign in via SSO (SAML/OIDC) as an
      additive option alongside existing email/password login

- [ ] **SSO-02**: Existing "Remember me" / "Forgot password?" affordances remain
      present and unaffected for non-SSO accounts

### Support Chatbot

- [ ] **CHAT-01**: A chat widget is available on both public marketing pages and
      inside the logged-in app for asking product questions

- [ ] **CHAT-02**: The widget answers from a bounded, product-specific knowledge scope
      and falls back to a human-contact path rather than guessing on billing/account
      questions it isn't confident about

## v2 Requirements

Deferred to a future release. Tracked but not in this milestone's roadmap.

### Supplier Repository

- **REPO-V2-01**: Platform-wide (cross-org) supplier repository sharing / network
  effect

- **REPO-V2-02**: Aggregated cross-org "wisdom of the crowd" supplier quality score
- **REPO-V2-03**: Advanced fuzzy identity resolution (subsidiaries, historical name
  changes, multi-entity matching beyond name+domain)

- **REPO-V2-04**: Retroactive backfill of pre-existing `suppliers` rows into the new
  repository (v1 applies going forward only unless explicitly revisited)

### Support Chatbot

- **CHAT-V2-01**: Full support-vendor suite (Zendesk/Intercom-style) with ticketing
  and human-agent handoff workflow — only if the in-house widget proves insufficient

### RFP Matching

- **RFP-V2-01**: DOCX (and other non-PDF) document support for RFP intake — PDF-only
  for v1

- **RFP-V2-02**: Persistent storage/retention of uploaded RFP documents

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Cross-org supplier-quality signal sharing beyond what the repository scope decision explicitly enables | Deferred until the per-org v1 scope proves out; network-effect sharing raises data-governance questions not yet resolved |
| DNS/domain migration, Stripe/Clerk dashboard display-name edits, legal entity-name changes for the rename | External dashboard/business actions outside this repo's code |
| Trademark/naming-risk review of "SourceGPT" | Legal/business call flagged in the backlog, not resolved by code changes |
| Escalation-to-human-ticket path for the support chatbot | Deferred to v2 vendor suite if needed; v1 is a bounded FAQ/product-question widget only |
| Platform-wide supplier repository sharing | See REPO-06 / REPO-V2-01 — per-org only for this milestone |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BRAND-01 | Phase 1 | Complete |
| BRAND-02 | Phase 1 | Complete |
| BRAND-03 | Phase 1 | Complete |
| BRAND-04 | Phase 1 | Complete |
| BRAND-05 | Phase 1 | Complete |
| PRICE-01 | Phase 2 | Pending |
| PRICE-02 | Phase 2 | Pending |
| PRICE-03 | Phase 2 | Pending |
| PRICE-04 | Phase 2 | Pending |
| PRICE-05 | Phase 2 | Pending |
| MKT-01 | Phase 2 | Pending |
| MKT-02 | Phase 2 | Pending |
| MKT-03 | Phase 2 | Pending |
| MKT-04 | Phase 2 | Pending |
| MKT-05 | Phase 2 | Pending |
| REPO-01 | Phase 3 | Complete |
| REPO-02 | Phase 3 | Complete |
| REPO-03 | Phase 3 | Complete |
| REPO-04 | Phase 3 | Complete |
| REPO-05 | Phase 3 | Complete |
| REPO-06 | Phase 3 | Complete |
| RATE-01 | Phase 4 | Pending |
| RATE-02 | Phase 4 | Pending |
| RATE-03 | Phase 4 | Pending |
| RFP-01 | Phase 5 | Pending |
| RFP-02 | Phase 5 | Pending |
| RFP-03 | Phase 5 | Pending |
| RFP-04 | Phase 5 | Pending |
| RFP-05 | Phase 5 | Pending |
| SSO-01 | Phase 5 | Pending |
| SSO-02 | Phase 5 | Pending |
| CHAT-01 | Phase 5 | Pending |
| CHAT-02 | Phase 5 | Pending |

**Coverage:**

- v1 requirements: 33 total
- Mapped to phases: 33 ✓
- Unmapped: 0

---
*Requirements defined: 2026-08-15*
*Last updated: 2026-08-15 after roadmap creation*
