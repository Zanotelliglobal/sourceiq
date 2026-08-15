# Project Research Summary

**Project:** SourceIQ → SourceGPT milestone (B2B AI supplier-sourcing SaaS, 10-item change-request backlog)
**Domain:** Brownfield extension of a live Next.js 14 / React 19 / TypeScript / Neon Postgres / Clerk / Stripe / Anthropic SDK product
**Researched:** 2026-08-15
**Confidence:** MEDIUM-HIGH

## Executive Summary

This milestone is not a greenfield build — it is ten discrete change requests layered onto an already-live, revenue-generating product, and the research consistently converges on one theme: reuse existing patterns, don't introduce parallel infrastructure. Six of the ten items (rename, pricing, footer/CCPA page, feature-grid copy, demo assets, plus SSO's code-side surface) are low-to-medium complexity and use primitives already in the codebase (Clerk, Stripe, existing marketing components). The remaining four — RFP intake (#7), support chatbot (#5), SSO/SAML (#4), and the persistent cross-investigation supplier repository (#10) — carry genuine architectural and vendor decisions, and #10 is the single highest-leverage, highest-risk item in the entire backlog.

The recommended approach: build the persistent supplier repository (#10) first as a new, explicitly-designed data layer (shared identity fields in one table, org-private enrichment/scores/ratings in a separate access-controlled table), then attach star ratings (#9) to it, then build RFP intake (#7) as an independent new route that feeds the same repository write path. For the support chatbot (#5), build in-house using the existing Anthropic SDK and SSE pattern rather than buying a vendor suite. For SSO (#4), the code lift is small; the real blocker is confirming Clerk's Pro-plan Enterprise Connections entitlement before scoping.

The two highest-severity risks are the rebrand's collision with security-relevant prompt text in `lib/agents.ts` (a blind find/replace can silently corrupt the anti-impersonation guard, or an overcautious exclusion can leave stale brand references in live prompts) and cross-tenant data leakage in the new supplier repository (treating it as "just another org_id-scoped table" instead of a genuinely new shared-identity/private-annotation data shape). A secondary risk — orphaning existing paying customers' plan values during the pricing restructure — is a live-customer-facing outage risk if not handled with an explicit legacy-tier fallback and migration plan.

## Key Findings

### Recommended Stack

No new core stack is needed for six of the ten backlog items — they build directly on the existing Next.js/Clerk/Stripe/Postgres/Anthropic primitives. Four items have open stack questions, resolved as follows.

**Core technologies:**
- Claude native PDF document blocks (existing `@anthropic-ai/sdk` 0.116.0, GA feature) — extracts structured RFP fields directly from uploaded PDFs without a new OCR/parsing vendor; reuses the exact SDK already used for classify/scout/qualify.
- `mammoth` 1.12.1 — pure-JS DOCX text extraction (Claude's document blocks are PDF-only); feeds extracted text into the same extraction prompt as the PDF path.
- Clerk Enterprise Connections (feature of already-installed `@clerk/nextjs`, no new package) — unified SAML 2.0 + OIDC SSO, available on Clerk's Pro plan ($20/mo) with one free connection included, $75/mo per additional connection (volume discounts above 15).
- `pg_trgm` (built-in Postgres extension, Neon-supported) — fuzzy supplier-name matching for the repository dedup, paired with a domain-based upsert key as the primary hard match.
- In-house support widget using the existing `@anthropic-ai/sdk` + SSE streaming pattern (no `ai`/`@ai-sdk/anthropic` needed) — avoids a second AI-call abstraction and a second vendor bill (Crisp/Intercom/Zendesk/Chatwoot all considered and rejected as over-scoped or unpredictably priced for a first version).

**Avoid:** `pdf-parse` (unmaintained, breaks in Vercel serverless due to native `canvas` dependency), dedicated OCR vendors (Textract/Document AI) as a first cut, Python entity-resolution tooling (wrong runtime), Anthropic Files API as default (still beta, unnecessary for one-shot extraction).

### Expected Features

**Must have (table stakes):**
- 3-tier + enterprise "Contact us" pricing table with comparison grid and monthly/annual toggle
- Footer with legal links, CCPA page (dated, listing consumer rights), closing CTA banner
- SSO as an additive option alongside email/password (not a replacement)
- Support widget on both public and in-app surfaces, with a human-contact fallback
- RFP intake with a mandatory "review & edit before continuing" step — never silent auto-submit
- Graceful error handling for bad/unparseable RFP uploads
- Star rating (1-5) UI convention, simple and familiar
- Basic name+domain dedup in the persistent supplier store (extending existing `lib/dedup.ts` logic, not inventing new matching)

**Should have (competitive differentiators):**
- AI-native RFP parsing reusing the existing Claude pipeline (vs. a bolted-on OCR vendor)
- Persistent, deduped supplier repository that lets new investigations skip re-discovering already-verified suppliers — the single highest-leverage item in the backlog
- Confidence-scored per-field display in the RFP review step
- Ratings feeding back into future scouting/qualification ranking (only once repository has volume)

**Defer (v2+):**
- Platform-wide (cross-tenant) supplier repository sharing — explicitly out of scope per PROJECT.md
- Aggregated cross-org "wisdom of the crowd" supplier score
- Advanced fuzzy identity resolution (subsidiaries, name-change tracking)
- Full support-vendor suite (Zendesk/Intercom) with ticketing — only if in-house widget proves insufficient
- Escalation-to-human-ticket path for support widget

### Architecture Approach

For the three architecturally significant items (#7, #9, #10), the recommended build order is #10 → #9 → #7. The repository (#10) introduces the one genuinely new layer this milestone needs and must land first because star ratings (#9) are explicitly meant to attach to a repository entry, not a per-event column (avoiding a schema migration + data-reconciliation problem shortly after launch). RFP intake (#7) is architecturally the most independent — a new intake path, not a new execution engine — and can benefit from #10 already existing so RFP-sourced suppliers flow through the same write path from day one.

**Major components:**
1. `lib/supplier-repository.ts` (NEW) — cross-event, org-scoped supplier identity store; single-statement Postgres upsert (`INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING`) keyed on `(org_id, identity_key)`, reusing `lib/dedup.ts`'s `normName`/`domainOf` — no new fuzzy-matching library. Written as a fire-and-forget background task via the existing `schedule()`/`backgroundTasks` mechanism, never on the critical SSE path.
2. `lib/supplier-ratings.ts` + `supplier_ratings` table (NEW) — per-rater 1-5 rating keyed to `repository_id`, coexisting with (not replacing) the already-shipped `suppliers.feedback_signal` thumbs-up/down per-event signal.
3. `app/api/rfp-intake/route.ts` + `lib/agents.ts: runRfpExtractionAgent()` (NEW) — its own route with its own `maxDuration` (recommend 120-180s, distinct from `classify`'s 60s and `orchestrate`'s 300s), full authenticated org context, PDF via native Claude document blocks, DOCX via `mammoth` text extraction, output feeding the existing `app/events/new/page.tsx` pre-fill flow unchanged.
4. Data model split for the repository: a shared/global identity table (name, normalized name, domain, country) with no access-gating `org_id`, separate from a per-org table for private relationship data (enrichment, AI score, notes, star rating) that has `org_id` as a real access-control column joined by FK — this split is the core architectural decision of the milestone.

### Critical Pitfalls

1. **Blind or overcautious brand rename in security-relevant prompt text** (`lib/agents.ts`'s `INJECTION_DEFENSE` anti-impersonation clause and outreach non-disclosure rules) — automated tests only assert on a template-literal placeholder, not the literal brand string, so "tests green" does not confirm correctness. Avoid by manually reading and renaming every match in `lib/agents.ts`, then grep-verifying no stale references remain.
2. **Pricing restructure orphaning existing paying customers** — if new `TIERS` keys replace old ones without a legacy-mapping fallback, `getTier(org.plan)` returns undefined for every existing customer at deploy time, likely inside a revenue-critical billing gate. Avoid by keeping old tier keys resolvable (grandfathered mapping) until a verified backfill migration completes, and treating the EUR→USD switch as an explicit tagged migration.
3. **Building RFP intake as a single synchronous route reusing `/api/classify`'s pattern** — hits Vercel's ~4.5MB request body ceiling and a 60s timeout mismatch for real multi-page documents, and risks a PDF library with native bindings breaking silently in serverless. Avoid with direct-to-storage upload (or accept in-memory transient parsing for v1), a serverless-verified pure-JS library (`mammoth`/`unpdf`, never `pdf-parse`), and a dedicated `maxDuration` sized for realistic documents.
4. **Cross-tenant data leakage in the shared supplier repository** — the highest-risk item in the milestone. Reusing the existing single-table `org_id`-gated pattern for a deliberately partially shared entity risks any single query bug exposing one org's private enrichment/scores/notes to every other tenant. Avoid by splitting shared identity fields from org-private fields at the schema level (not just query level), routing every org-private read through one reviewed access-check helper, and requiring an explicit two-org test case as an acceptance criterion.
5. **Shipping star ratings before the repository's scope is settled** — forces a rushed retrofit/migration. Sequence #10's data-model decision before #9's schema, per the backlog's own guidance.

## Implications for Roadmap

Based on combined research, the ten backlog items cluster into five roadmap phases, ordered primarily by architectural dependency and risk profile.

### Phase 1: Rename & Brand Migration
**Rationale:** Touches the most files (~162 occurrences/~40 files) and has a security-relevant subtlety (`lib/agents.ts` prompt content) that should be resolved and stabilized before other feature work lands on top of renamed code paths.
**Delivers:** SourceIQ → SourceGPT rename across the codebase, with a verified, human-reviewed pass over `lib/agents.ts`'s injection-defense and outreach non-disclosure text.
**Addresses:** Backlog #1.
**Avoids:** Pitfall 1 (blind/overcautious rename corrupting or leaving stale security-relevant prompt text) — requires a manual grep+read-through checklist item independent of automated test results.

### Phase 2: Marketing & Pricing Surface
**Rationale:** Self-contained, low-to-medium complexity, no dependency on the architecturally heavier items; groups naturally since footer/CTA/CCPA and pricing both touch the marketing site and are independent of each other and of #4/#5/#7/#9/#10.
**Delivers:** 3-tier + enterprise comparison pricing table with monthly/annual toggle; footer extension + closing CTA banner + CCPA policy page; feature-grid copy updates; demo assets.
**Addresses:** Backlog #2, #3, #6, #8 (table-stakes pricing-page and legal/trust patterns from FEATURES.md).
**Avoids:** Pitfall 2 (orphaned legacy tier keys / EUR-USD migration gap) — requires an explicit legacy-mapping/backfill plan and a query against every existing `organizations.plan` value before removing any tier key, plus a staged Stripe subscription migration rather than a bulk cutover.

### Phase 3: Persistent Supplier Repository (Foundational Data Layer)
**Rationale:** The single highest-leverage and highest-risk item in the backlog; #9 (ratings) explicitly depends on this shipping first, and #7 (RFP intake) benefits from it existing. Must be designed and reviewed as its own data-model/access-control step before any dependent feature builds on it.
**Delivers:** `supplier_repository` table (shared identity, no access-gating `org_id`) + per-org relationship/enrichment data with FK join; `lib/supplier-repository.ts` with atomic upsert (`INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING`, keyed on domain + `pg_trgm` fuzzy fallback); fire-and-forget hook into `makeProcessSupplier`/`...Quick`/`...Deepen`; async idempotent backfill of existing supplier rows.
**Uses:** `pg_trgm` (STACK.md), single-statement upsert pattern required by Neon's HTTP driver constraint.
**Implements:** `lib/supplier-repository.ts` (ARCHITECTURE.md).
**Avoids:** Pitfall 4 (cross-tenant leakage) — requires the shared/private schema split and a mandatory two-org visibility test as an acceptance gate, not an afterthought.

### Phase 4: Supplier Star Ratings
**Rationale:** Small and self-contained once Phase 3's schema exists; the backlog itself only gates this on the repository's scope decision, nothing else.
**Delivers:** `supplier_ratings` table (per-rater, upsert-on-conflict), `lib/supplier-ratings.ts`, `app/api/supplier-ratings/route.ts`, star-widget in `app/events/[id]/page.tsx` coexisting with (not replacing) the already-shipped `feedback_signal` thumbs-up/down.
**Addresses:** Backlog #9.
**Avoids:** The pitfall of shipping ratings on a per-event column that later needs migration (explicitly warned against in both ARCHITECTURE.md and PITFALLS.md).

### Phase 5: RFP Intake, SSO, and Support Chatbot (Parallelizable)
**Rationale:** These three items are largely independent of each other and of Phases 3-4 (RFP intake benefits from but does not strictly require the repository), and each has its own external/vendor-configuration dependency that can be resolved in parallel with the others.
**Delivers:**
- RFP intake: new `/api/rfp-intake` route with its own `maxDuration` (120-180s) and auth posture, native Claude PDF document blocks + `mammoth` for DOCX, mandatory review/edit step feeding the existing new-event form, PDF-only v1 scope reasonable if DOCX proves rare.
- SSO: Clerk Enterprise Connections entry point in the sign-in flow, gated on confirming Pro-plan entitlement in the Clerk dashboard before scoping.
- Support chatbot: in-house widget reusing existing `@anthropic-ai/sdk` + SSE pattern, FAQ/product-question scope only, gated with a confidence threshold and human-contact fallback for billing/account questions, sequenced content-wise after Phase 2's pricing restructure to avoid quoting stale prices.
**Addresses:** Backlog #4, #5, #7.
**Avoids:** Pitfall 3 (synchronous single-route RFP parsing hitting body-size/timeout limits) and the anti-feature of an unmoderated support bot answering billing questions.

### Phase Ordering Rationale

- Rename first because it is a wide-blast-radius mechanical change with one subtle security trap that should be resolved before other phases touch the same files.
- Marketing/pricing second because it is fully independent, low-risk, and unblocks revenue-facing changes (new pricing) without waiting on the harder architectural work.
- The repository (#10) must precede ratings (#9) — this is not a preference, it's stated explicitly in the backlog's own text and confirmed architecturally (ratings need a stable cross-event identity key that only exists once the repository's write path is live).
- RFP intake, SSO, and the support chatbot are grouped last because none of them block or are blocked by the repository/ratings pair in a hard sense, and each has an external, non-code dependency (Clerk plan verification, build-vs-buy decision) that benefits from parallel resolution rather than serial blocking.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Persistent Supplier Repository):** Needs a dedicated data-model/access-control design spike before implementation — this is the least-precedented pattern in the existing codebase (no prior "shared identity, private annotation" table exists) and the RLS-vs-Neon-HTTP-driver compatibility question flagged in PITFALLS.md needs its own investigation if Row-Level Security is pursued as a defense-in-depth layer.
- **Phase 5, RFP intake specifically:** Needs an early spike to confirm realistic multi-page/scanned-document behavior with Claude's native PDF blocks and to finalize the upload path (direct-to-storage vs. in-memory transient) before building the surrounding UI.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Rename):** Mechanical, well-understood find/replace with one documented manual-review checklist item.
- **Phase 2 (Marketing & Pricing):** Established B2B SaaS pricing-page and legal-page conventions, well-documented in FEATURES.md; Stripe's own migration tooling covers the pricing-restructure mechanics.
- **Phase 4 (Star Ratings):** Small, standard CRUD + UI widget once Phase 3's schema exists.
- **Phase 5, SSO and support chatbot specifically:** Clerk's Enterprise Connections and the in-house SSE-chatbot pattern are both directly documented/precedented in this codebase and in official Clerk docs — low ambiguity once the plan-tier/build-vs-buy decisions are confirmed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Core recommendations (Claude native PDF, Clerk Enterprise Connections, pg_trgm) grounded in official vendor docs (HIGH); chatbot vendor pricing comparisons and AI SDK characterization rely on third-party aggregator sources (MEDIUM) |
| Features | MEDIUM-HIGH | General B2B SaaS pricing/legal-page UX patterns are well-documented (HIGH); procurement/RFP-tool and supplier-repository conventions are less standardized industry-wide (MEDIUM) |
| Architecture | HIGH | Grounded directly in this repo's own `.planning/codebase/ARCHITECTURE.md` and primary source files (`lib/process-supplier.ts`, `lib/dedup.ts`, `lib/db.ts`, route files) — only one external fact (Vercel function duration limits) needed independent verification |
| Pitfalls | HIGH (code-grounded items) / MEDIUM (external best-practice items) | Rename, pricing-orphaning, and repository-leakage pitfalls are grounded directly in this repo's code (`lib/agents.ts`, `lib/plans.ts`, `lib/tenant.ts`); Stripe migration and Vercel serverless-limit claims are MEDIUM, cross-checked across multiple independent sources |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Existing customer grandfathering decision (Pricing, #2):** Research flags the risk but the actual business decision (grandfather at old price/currency vs. migrate to new tiers) is not yet made — must be resolved and implemented as code (not a manual Stripe-dashboard fix) before Phase 2 is considered complete.
- **Supplier repository sharing scope (#10):** Per-org v1 is the recommended safe default across all four research files, but this is explicitly the backlog's own open question — confirm this is the accepted default before Phase 3 planning locks in the schema, since platform-wide sharing has materially different architectural consequences.
- **Clerk plan tier verification (SSO, #4):** Research indicates Enterprise Connections requires Clerk's Pro plan; confirm the org's actual current Clerk plan/billing tier before scoping Phase 5's SSO work, as this is an external dependency not resolvable through code research alone.
- **Support chatbot build-vs-buy (#5):** Research recommends "build in-house," but this is a judgment call, not a technical certainty — confirm the org agrees with deferring a vendor purchase (Crisp/Intercom/Chatwoot/Zendesk) before Phase 5 planning finalizes the approach.
- **RLS compatibility with Neon's HTTP driver (#10):** Flagged in PITFALLS.md as needing its own design spike if pursued as a defense-in-depth layer for the org-private repository table — not resolved by this research round.

## Sources

### Primary (HIGH confidence)
- [PDF support - Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/pdf-support)
- [Clerk Pricing](https://clerk.com/pricing) and [Enterprise Connections overview - Clerk Docs](https://clerk.com/docs/guides/configure/auth-strategies/enterprise-connections/overview)
- [Migrate subscriptions to Stripe Billing (Stripe official docs)](https://docs.stripe.com/billing/subscriptions/migrate-subscriptions)
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)
- `.planning/codebase/ARCHITECTURE.md`, `.planning/PROJECT.md`, `docs/change-request-backlog.md` (internal, primary source for scoping/dependencies)
- Direct code inspection: `lib/agents.ts`, `lib/process-supplier.ts`, `lib/dedup.ts`, `lib/db.ts`, `lib/plans.ts`, `lib/tenant.ts`, `app/api/classify/route.ts`, `app/api/qualify/route.ts`, `tests/prompt-injection-defense.test.ts`

### Secondary (MEDIUM confidence)
- [Must Have Components for B2B SaaS Pricing Pages – 2026](https://genesysgrowth.com/blog/components-b2b-saas-pricing-pages)
- [CCPA Privacy Policy: The Complete Guide - CookieYes](https://www.cookieyes.com/blog/ccpa-privacy-policy/)
- [Fuzzy Matching in PostgreSQL: Taming Messy Text With pg_trgm - Medium](https://medium.com/@techybob/fuzzy-matching-in-postgresql-taming-messy-text-with-pg-trgm-bc3af9335f2f)
- [Intercom vs Zendesk / Crisp / Chatwoot pricing comparisons](https://crisp.chat/en/comparisons/intercom-vs-zendesk/)
- [Preventing Cross-Tenant Data Leakage in Multi-Tenant SaaS Systems - Agnite Studio](https://agnitestudio.com/blog/preventing-cross-tenant-leakage/)
- [Process PDFs on Vercel: Reliable Serverless Guide](https://www.buildwithmatija.com/blog/process-pdfs-on-vercel-serverless-guide)

### Tertiary (LOW confidence)
- [Vercel AI SDK 6.0 coverage — dev.to tutorials](https://dev.to/bean_bean/the-ultimate-guide-to-building-ai-powered-web-apps-with-the-vercel-ai-sdk-in-2026-1c6a) — used only to characterize an alternative not recommended as default, not load-bearing for any decision

---
*Research completed: 2026-08-15*
*Ready for roadmap: yes*
