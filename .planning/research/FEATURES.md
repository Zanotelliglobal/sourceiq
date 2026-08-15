# Feature Research

**Domain:** B2B AI supplier-sourcing SaaS — milestone scope: pricing restructure, marketing
page additions (footer/CTA/CCPA), SSO login, support chatbot widget, RFP document
intake, supplier star-rating, persistent cross-investigation supplier repository
**Researched:** 2026-08-15
**Confidence:** MEDIUM-HIGH (general B2B SaaS UX patterns are well-documented; procurement-specific
sourcing-tool conventions are less standardized, so those items lean MEDIUM)

This file covers only the six backlog items that need "what does good look like"
research (#2, #3, #4-UX, #5, #7, #9, #10). Items #1 (rename), #6 (feature-grid copy),
and #8 (demo assets) are not feature-landscape questions and are out of scope for this
file per the research brief.

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or unsafe to buy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Tiered pricing table (3 tiers) with a comparison grid, not just three price cards | B2B buyers rarely decide alone — a feature-by-feature comparison table lets the champion justify the choice to a manager/finance approver. Comparison tables are reported to drive materially higher pricing-page conversion in B2B SaaS versus bare price cards. | LOW | Column layout, one "Most Popular"/"Best Value" tier highlighted, all three tiers show CTA buttons ("Start free trial" on base tier per backlog, "Talk to sales" on others as appropriate). |
| Monthly/annual billing toggle | Single most commonly cited lever for pricing-page conversion; buyers expect to see the annual discount before committing. | LOW-MEDIUM | Needs both cadence Price objects already implied by existing `STRIPE_PRICE_<TIER>_<CADENCE>` pattern in `lib/plans.ts` — mechanically straightforward, mostly a UI toggle plus price-lookup swap. |
| Enterprise "Contact us" tier with no listed price | Signals custom negotiation/volume pricing is available without making the buyer feel nickel-and-domed; standard in every B2B SaaS pricing page with an enterprise segment. | LOW | No Stripe object needed if it just routes to a contact form/Calendly/email — becomes a marketing-copy + CTA-routing task, not a billing task. |
| Footer with legal links (Privacy, Terms, and now CCPA), contact info, copyright | Baseline expectation for any commercial web product; missing legal links is a trust signal red flag and a real compliance gap once CCPA applies. | LOW | `SiteFooter.tsx` already exists; this is an extend, not a build. |
| CCPA policy page reachable from footer, dated, listing consumer rights + how to exercise them | Once a business meets CCPA's revenue/data thresholds, the policy must be conspicuously linked (word "privacy" in a persistent header/footer link) and must state what data is collected, whether it's shared/sold, consumer rights, and a "last updated" date. | LOW-MEDIUM | Content drafting is the real cost here (legal text), not the page shell — flagged correctly as an open dependency in the backlog. |
| Closing CTA banner above the footer | Standard SaaS landing-page pattern: a final, low-friction conversion prompt after the buyer has scrolled through the whole page, distinct from the primary hero CTA. | LOW | Purely presentational; no backend dependency. |
| SSO as an *option* alongside email/password (not a replacement) | Enterprise buyers expect SSO to be additive — killing password login for smaller customers who don't have an IdP would break the product for the majority of the customer base. | LOW (code) / MEDIUM (external) | Clerk itself supports this as an added connection type; the code lift is small, the commercial/plan gate is the real blocker (see Anti-Features/Dependencies). |
| Support widget visible on both public marketing pages and inside the logged-in app | Buyers expect pre-sales questions answered without emailing sales, and existing customers expect the same escape hatch without leaving the app; a widget present on only one surface reads as unfinished. | LOW-MEDIUM | Mechanically simple (a floating launcher + iframe or custom panel) regardless of build-vs-buy; the two surfaces likely need different content scopes (pricing/product questions publicly vs. account/usage questions in-app). |
| Structured RFP-brief intake with an explicit "review & edit before continuing" step | Users of any AI-extraction workflow (parsing tools, RFP/RFQ platforms) expect a confirmation/edit screen before extracted data is acted on — never a silent auto-submit. This is consistently how comparable RFP/RFQ intelligence tools operate: draft extraction → confidence flags → human review → proceed. | MEDIUM | Reuses the existing new-event flow's fields (`category`, `subcategory`, `description`, `requirements`, `target_countries`) as a pre-fill target — the extraction output is a form-fill, not a black box. |
| Graceful error handling for bad/unparseable RFP uploads (wrong file type, empty/scanned-image PDF, oversized file) | Users of document-upload features expect clear feedback ("we couldn't read page 3", "please upload a text-based PDF") rather than a silent failure or a generic 500; this is standard document-intake UX, not a sourcing-specific bar. | LOW-MEDIUM | Needs explicit size/type validation before the parse call, and a fallback path (let the user manually fill the classify form) rather than a dead end. |
| Star rating (1-5) visible per supplier in the event/supplier detail view | Once any feedback mechanism exists on a listed entity, users expect the simple, familiar 1-5 star affordance rather than a bespoke scale — this is a UI convention, not a differentiator. | LOW | Pure UI + one numeric field; complexity is entirely in the schema-scope decision (see Dependencies), not the widget itself. |
| Basic identity-based dedup in any persistent supplier store (name + domain normalization) | Any vendor/supplier master-data effort that skips dedup degrades into duplicate, contradictory records almost immediately — this is treated as baseline hygiene in vendor master-data-management practice, not an advanced feature. | MEDIUM | The codebase already has this logic for within-event dedup (`lib/dedup.ts` `normName`/`domainOf`) — the table-stakes bar is extending the *same* logic to a durable, cross-event table, not inventing new matching logic. |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable — and should align with
the product's core value (fast, verified, actionable supplier shortlists).

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| AI-native RFP parsing using the existing Claude SDK (vs. a generic OCR/regex extraction pipeline) | Because the product already runs a multi-agent Claude pipeline for discovery, extending that same model to read a brief and extract structured fields (rather than bolting on a separate parsing vendor) is faster to ship, keeps a single AI vendor relationship, and can reuse the existing classifier agent pattern (`runClassifierAgent()`) almost directly. Differentiates versus most sourcing tools that treat document intake and AI matching as two disconnected systems. | MEDIUM-HIGH | Real complexity: PDF/DOCX text extraction (or native document support if the model tier allows it), confidence scoring per extracted field, and fitting parsing within Vercel's serverless timeout constraints (60s classify / 300s orchestrate ceilings noted in PROJECT.md). |
| Persistent, deduped supplier repository that lets a *new* investigation skip re-discovering a supplier it (or another org) already verified | This is the single highest-leverage differentiator in the backlog: it turns a per-event, throwaway discovery into compounding platform value, directly reduces AI-search spend on repeat investigations, and is the honest path to eventually earning the "Supplier Marketplace" positioning the product currently can't claim. Comparable to how enterprise vendor-master-data platforms position a "golden record" as their core value prop. | HIGH | Needs an explicit scope decision (per-org vs. platform-wide sharing — see Dependencies/Anti-Features), a staleness/refresh policy for any enrichment data attached to a record, and a write-path hook into both `makeProcessSupplier` and `makeProcessSupplierQuick`. This is a foundational data-model change, not a bolt-on. |
| Supplier rating as an input signal to future scouting/qualification, not just a static display number | Vendor-scorecard platforms distinguish "just showing a score" from "using the score" — feeding accumulated ratings back into which suppliers get surfaced or how they're ranked is the differentiating layer beyond a plain rating widget. | MEDIUM (once #10 exists) | Explicitly depends on the persistent repository (#10) existing first — rating an ephemeral per-event row has no way to inform a *future* investigation. This is a v1.x/v2 differentiator, not a same-phase build. |
| Confidence-scored, per-field extraction display in the RFP intake review step (flagging low-confidence fields for extra scrutiny) | Best-in-class AI extraction tools (RFP/RFQ intelligence platforms) show *why* a field was filled and how confident the model was, rather than presenting a flat pre-filled form — this reduces silent errors and builds trust in the AI layer, which matters given this product's AI-first positioning. | MEDIUM | Additive on top of the table-stakes review screen; needs the classifier/parser to emit per-field confidence, not just a final object. |
| In-app support widget grounded in the product's own live data (e.g., "why did this supplier get a low score" contextual help) vs. a generic FAQ bot | A widget that can answer in-app, contextual questions (using the existing Anthropic SDK and the org's own event data) is materially more useful than a static FAQ deflection bot, and plays to the product's existing AI-agent investment. | HIGH | Meaningfully harder than a vendor-bought widget: needs retrieval grounding against the user's own account/event data with strict tenant isolation, a confidence/escalation policy, and ongoing knowledge-base curation — this is the "build" side of the build-vs-buy decision and should not be scoped lightly. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems — deliberately avoid these, or scope them
away for this milestone.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Platform-wide (cross-tenant) supplier repository sharing by default, with no explicit isolation model | Feels like the "obvious" way to unlock network effects — org A's discovery instantly helps org B, echoing how vendor master-data platforms talk about "golden records." | Cross-tenant data leakage is consistently flagged as the highest-severity, easiest-to-accidentally-introduce bug class in multi-tenant SaaS; a single missed tenant-scoping check on org-specific enrichment/ratings/notes would leak one customer's proprietary sourcing intelligence to a competitor using the same platform — a trust-breaking event, not a recoverable bug. | Split the model explicitly: a shared, public-fact layer (company name, domain, country — arguably public information) vs. a strictly per-org layer (ratings, notes, enrichment scores, contact details) that never crosses tenant boundaries without an explicit, separately-decided opt-in. Backlog #10 already flags this as an open question — treat "public identity shared, everything else org-scoped" as the safe default absent a stronger business decision. |
| Fully autonomous RFP auto-submit (parse document → auto-launch investigation with zero human review) | Feels like the fastest, most "AI-magic" path and matches the product's AI-first pitch. | Silent misclassification (wrong category/subcategory, wrong target countries, truncated requirements) would burn a paid wave/billing event on a bad investigation with no chance to correct it first — expensive and erodes trust in the AI layer exactly where it matters most. | Always route through the existing new-event flow as a pre-filled draft the buyer reviews/edits before choosing Quick or Full — this is both the safer pattern and literally how the backlog already scopes item #7 ("buyer still chooses which engine to run against the parsed brief"). |
| Cross-event, cross-org aggregated "wisdom of the crowd" supplier rating shown as a single public score, before the repository's sharing model is decided | Feels like an obvious enhancement once ratings exist — "show the average rating across everyone who's used this supplier." | This directly is the "cross-org supplier-quality signal sharing" explicitly marked Out of Scope in PROJECT.md for this milestone, and building it ahead of the #10 scope decision means re-architecting whatever ships first; it also raises the same tenant-isolation risk as the repository sharing question above, compounded by reputational stakes (a wrong aggregated score could unfairly tank or inflate a real supplier's standing across every customer). | Ship ratings scoped to whatever #10 decides (per-org or platform-identity-linked-but-tenant-scoped-values) and treat any *aggregated, cross-tenant* score display as a distinct, later decision — not an automatic consequence of the rating feature shipping. |
| Buying a full-featured support-vendor suite (e.g., Zendesk's complete ticketing platform) purely to get a chat widget | Feels like the "proven, low-risk" choice since Zendesk/Intercom are the market-standard reference the backlog screenshot was pulled from. | Recurring per-seat vendor cost for a feature-rich helpdesk when the actual near-term need is a lightweight FAQ/product-question widget is over-scoped spend, and the backlog explicitly flags this as an open build-vs-buy decision rather than a foregone conclusion — buying the wrong tier locks in cost before usage patterns are known. | Resolve build-vs-buy explicitly before implementation (as the backlog already recommends): a lightweight, in-house LLM-backed widget (reusing the existing Anthropic SDK) covers the FAQ/product-question case cheaply; escalation-to-a-real-human-ticket only needs to be added if support volume actually justifies it later. Don't buy a full helpdesk suite to solve a chat-widget-shaped problem. |
| An unmoderated AI support widget with no confidence threshold or human-escalation path, answering account/billing-specific questions | Feels "done" once the bot can answer *some* questions correctly in a demo. | AI hallucination in customer support is a well-documented failure mode — high-stakes categories (billing, refunds, contract terms) need near-zero hallucination tolerance; an ungated bot confidently misquoting a price or plan limit is a support and trust liability, especially right after a pricing-tier restructure (item #2) when quoted numbers are actively changing. | Gate the widget with a confidence threshold and always offer a clear "talk to a human" / email-support fallback for anything billing-, contract-, or account-specific; treat general FAQ/product-question deflection as the safe, in-scope use case for a first version. |
| A rich, fully-normalized fuzzy-matching identity resolution system (subsidiaries, name-change history, multi-entity resolution) as v1 of the supplier repository | Feels like "doing dedup properly" since real-world supplier identity is genuinely messy (subsidiaries, regional entities, name changes). | This is exactly the kind of scope creep that turns a medium-sized schema change into an open-ended data-engineering project; the backlog itself flags this as a "v1 vs. later" rigor decision, and enterprise vendor-master-data platforms treat advanced fuzzy identity resolution as a mature-stage capability, not a bootstrap-stage one. | Ship v1 with the same normalization approach the codebase already uses for within-event dedup (name normalization + domain matching) extended to the new durable table; treat deeper identity resolution (subsidiary graphs, name-change tracking) as an explicit future consideration once the repository has real usage data showing it's actually needed. |

## Feature Dependencies

```
Persistent supplier repository (#10)
    └──requires-decision──> Sharing scope (per-org vs. platform-wide) + what fields persist
                                 └──blocks──> Supplier star-rating schema design (#9)

Supplier star-rating (#9)
    └──should-attach-to──> Persistent supplier repository (#10), not a per-event column
                              (backlog explicitly recommends sequencing #10 before #9,
                               or designing both together, to avoid a later migration)

RFP document intake (#7)
    └──feeds-into──> Existing new-event flow (app/events/new/page.tsx)
    └──still-requires──> Buyer choice of Quick vs. Full investigation engine (unchanged)
    └──enhances──> Persistent supplier repository (#10), as a third population source
                     alongside quick scan and full investigation

Pricing restructure (#2)
    └──requires──> New Stripe Price objects (external dependency, not code)
    └──interacts-with──> Support chatbot (#5) — quoted prices/limits must stay in sync
                          with whatever the bot might answer about billing

SSO login (#4)
    └──gated-by──> Clerk plan verification for SAML/Enterprise SSO connections
                    (external/commercial dependency, resolve before scoping code)

Landing footer + CTA + CCPA page (#3)
    └──requires──> CCPA policy legal text (content dependency, not a layout blocker)
    └──independent-of──> all other items (safe to batch with #6/#8 landing-page work)

Support chatbot (#5)
    └──requires-decision──> build vs. buy (blocks implementation scoping either way)
    └──if-build──> reuses existing Anthropic SDK usage pattern (lib/agents.ts)
```

### Dependency Notes

- **Supplier star-rating (#9) requires a decision on the persistent repository (#10):**
  rating a per-event `suppliers` row is a schema dead end if the repository ships later,
  because ratings would then need migrating from an event-scoped column to a
  repository-scoped table. The backlog itself makes this explicit — treat #10's scope
  decision as a hard prerequisite for #9's schema design, not a nice-to-have sequencing
  preference.
- **RFP intake (#7) enhances the persistent repository (#10)** rather than depending on
  it: RFP-sourced supplier discoveries should flow through the same
  `makeProcessSupplier`/`makeProcessSupplierQuick` write path as quick scan and full
  investigation, making the repository (once built) a third funnel target, not a
  separate data path.
- **Pricing (#2) and the support chatbot (#5) have a soft interaction, not a hard
  dependency:** if the chatbot answers pricing/plan questions (even generically), it
  must be kept in sync with whatever tier names/limits/prices the restructure lands on
  — sequencing the chatbot's pricing-related content after the pricing restructure
  avoids the bot confidently quoting stale numbers.
- **SSO (#4) and pricing (#2) both gate on an external, non-code dependency** (Clerk
  plan verification; new Stripe Price objects) — these can be resolved in parallel with
  other, self-contained work (chatbot, star rating, landing-page batch) per the
  backlog's own suggested sequencing.

## MVP Definition

### Launch With (v1)

Minimum viable scope for this milestone's six research-covered items.

- [ ] 3-tier + enterprise pricing table with comparison grid and monthly/annual toggle — core of item #2, table stakes, no dependencies.
- [ ] Footer extension (mission tagline, contact, social, legal links) + closing CTA banner + CCPA page (content + shell) — item #3, fully independent, low complexity.
- [ ] SSO login option added alongside (not replacing) email/password, gated on Clerk plan verification — item #4's UX-relevant scope; ship once the plan question resolves.
- [ ] Lightweight in-house support widget (public + in-app), FAQ/product-question scope only, with a clear human-contact fallback and no unguarded billing/account answers — item #5's safe v1, pending the build-vs-buy call landing on "build."
- [ ] RFP document upload with parse → confirm/edit pre-filled form → buyer chooses Quick/Full — item #7's full table-stakes shape, since the review step is non-negotiable for trust and billing-safety reasons.
- [ ] Persistent supplier repository v1: per-org scope (not platform-wide) as the safe default, lightweight identity fields (name/domain/country) plus existing enrichment payload, name+domain dedup reusing existing normalization logic — item #10's minimum defensible scope.
- [ ] Supplier star rating attached to the repository entry (per backlog's own recommendation to sequence after/with #10), values scoped per-org even though the repository record may eventually be shared — item #9 built correctly the first time.

### Add After Validation (v1.x)

- [ ] Confidence-scored per-field display in the RFP intake review step — add once basic parse-and-confirm is live and real extraction-error patterns are observed.
- [ ] Escalation-to-human-ticket path for the support widget — add once support volume/question types from the v1 FAQ widget show real demand for it.
- [ ] Ratings feeding back into scouting/qualification ranking — add once enough rating volume exists in the repository to be a meaningful signal.

### Future Consideration (v2+)

- [ ] Platform-wide (cross-tenant) supplier repository sharing — explicit out-of-scope per PROJECT.md; revisit only as a deliberate business decision, not an incremental extension.
- [ ] Aggregated, cross-org "wisdom of the crowd" supplier score display — same reasoning as above; defer until the sharing-scope decision is made and its tenant-isolation/reputational implications are separately resourced.
- [ ] Advanced fuzzy identity resolution (subsidiaries, name-change tracking, multi-entity merge) for the supplier repository — defer until v1's name+domain dedup shows real-world gaps.
- [ ] Full support-vendor suite integration (Zendesk/Intercom) with ticketing — only if the build-vs-buy decision favors buy, or if v1's in-house widget proves insufficient at scale.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Pricing restructure (3-tier + comparison + toggle) | HIGH | MEDIUM | P1 |
| Footer + CTA banner + CCPA page | MEDIUM | LOW | P1 |
| SSO login option | HIGH (for enterprise deals) | MEDIUM (code) / gated (external) | P1 |
| Support chatbot widget (FAQ-scope, build) | MEDIUM | MEDIUM | P1 |
| RFP intake (upload → confirm → route to engine) | HIGH | HIGH | P1 |
| Persistent supplier repository (per-org scope) | HIGH | HIGH | P1 |
| Supplier star rating (attached to repository) | MEDIUM | LOW (once #10 exists) | P1 |
| Confidence-scored RFP field display | MEDIUM | MEDIUM | P2 |
| Support widget human-ticket escalation | MEDIUM | MEDIUM | P2 |
| Ratings feeding scouting/ranking | MEDIUM | MEDIUM | P2 |
| Platform-wide repository sharing | HIGH (long-term) | HIGH | P3 |
| Aggregated cross-org supplier score | MEDIUM | HIGH | P3 |
| Advanced fuzzy identity resolution | LOW (near-term) | HIGH | P3 |

**Priority key:**
- P1: Must have for this milestone
- P2: Should have, add once v1 usage data exists
- P3: Nice to have, explicitly deferred (some permanently, per Out of Scope in PROJECT.md)

## Competitor Feature Analysis

| Feature | Reference competitor (`sourceiq.cloud`, per backlog screenshots) | General B2B SaaS / procurement-tool pattern | Our Approach |
|---------|--------------------------------------------------------------|----------------------------------------------|--------------|
| Pricing page | 3 tiers + "Contact us" enterprise, no visible toggle confirmed in backlog notes | Comparison table + monthly/annual toggle is the modern standard, seen across the majority of well-converting B2B SaaS pricing pages | Match the reference's tier count, but add the toggle and full comparison grid — the toggle is cheap to build and is the single highest-cited pricing-page conversion lever. |
| Chat widget | Zendesk/Intercom-styled widget per screenshot | Vendor tools (Intercom/Zendesk) offer proactive triggers + AI deflection + ticket escalation out of the box; in-house LLM widgets can match the AI-deflection piece cheaply but not the ticketing/escalation infrastructure | Build in-house v1 (FAQ-scope, reusing existing Anthropic SDK), explicitly deferring ticket escalation rather than matching the reference's implied full-vendor feature set immediately. |
| Supplier marketplace / database | Reference implies a "100k+ pre-screened database" positioning | Vendor master-data platforms treat a persistent, deduped supplier record as core infrastructure with staleness/refresh policies, not a static database | Build toward this honestly via the persistent repository (#10), starting per-org rather than claiming a pre-built cross-org database that doesn't exist yet (per #6's copy repositioning). |
| RFP/intake tools | Reference lists "RFP & Intake Tools" as a marketed feature-grid tile | RFP/RFQ intelligence platforms extract structured fields with confidence scoring and mandate a human-review step before use | Build the review-step version from day one (never auto-submit), matching the safer, more mature end of the RFP-tooling spectrum rather than a same-page "instant magic" pitch. |

## Sources

- [The SaaS Pricing Page Playbook: Practices and Real Examples](https://www.webstacks.com/blog/saas-pricing-page-design)
- [Must Have Components for B2B SaaS Pricing Pages – 2026](https://genesysgrowth.com/blog/components-b2b-saas-pricing-pages)
- [B2B SaaS Pricing Page Best Practices That Actually Drive Revenue in 2026](https://successknocks.com/b2b-saas-pricing-page-best-practices/)
- [CCPA Privacy Policy: The Complete Guide - CookieYes](https://www.cookieyes.com/blog/ccpa-privacy-policy/)
- [8 CCPA Website Requirements for Compliance - getterms.io](https://getterms.io/blog/ccpa-website-requirements-for-compliance)
- [CCPA (CPRA) Privacy Policy Template - TermsFeed](https://www.termsfeed.com/blog/sample-ccpa-privacy-policy-template/)
- [SSO Implementation Checklist: Enterprise Security Requirements for B2B SaaS - SSOJet](https://ssojet.com/ciam-101/sso-implementation-checklist-enterprise-security-requirements-for-b2b-saas)
- [SAML SSO in B2B SaaS: The complete guide for developers and enterprise buyers - Scalekit](https://www.scalekit.com/blog/saml-sso-in-b2b-saas-the-complete-guide-for-developers-and-enterprise-buyers)
- [The 10 enterprise features every B2B SaaS needs - WorkOS](https://workos.com/blog/enterprise-readiness-checklist-2026)
- [Intercom vs Zendesk: Which Support Platform Scales Better? - Denser.ai](https://denser.ai/blog/intercom-vs-zendesk/)
- [Intercom vs. Zendesk: Pricing, Features, and Best Use Cases 2026 - Freqens](https://www.freqens.com/blog/intercom-vs-zendesk-pricing-features-and-best-use-cases-2026)
- [AI-Powered RFQ Software - AutoRFP.ai](https://autorfp.ai/rfq-software)
- [FAQ — RFQ/RFP Document Intelligence](https://notion-style-portfolio.vercel.app/projects/rfq-rfp-document-intelligence/faq)
- [Auto-fill RFPs in seconds - Cassidy AI](https://www.cassidyai.com/use-case/autofill-rfps)
- [Gartner's Supplier Scorecard Improves Supplier Performance](https://www.gartner.com/en/supply-chain/research/supplier-scorecard)
- [Vendor Scorecard 101: Definition, Examples, and Benefits - Precoro](https://precoro.com/blog/vendor-scorecard-definition-benefits-examples-free-template/)
- [Vendor Rating: The Complete Procurement Guide For 2026 - Kodiak Hub](https://www.kodiakhub.com/blog/vendor-rating-guide)
- [Vendor Master Data Management: Best Practices Guide - Ivalua](https://www.ivalua.com/blog/vendor-master-data-management/)
- [How Veridion Supports Master Data Management](https://veridion.com/insights/articles/how-veridion-supports-master-data-management)
- [Preventing Cross-Tenant Data Leakage in Multi-Tenant SaaS Systems - Agnite Studio](https://agnitestudio.com/blog/preventing-cross-tenant-leakage/)
- [Designing Database Isolation for B2B Multi-Tenant SaaS - Ajit Singh](https://singhajit.com/multi-tenant-database-isolation/)
- [Data isolation in multi-tenant SaaS environments - Redis](https://redis.io/blog/data-isolation-multi-tenant-saas/)
- [AI Chatbot Hallucination in Customer Service 2026 - Social Intents](https://www.socialintents.com/blog/ai-chatbot-hallucination-in-customer-service/)
- [How to Reduce AI Hallucinations in Customer Support: 7 Proven Techniques - IrisAgent](https://irisagent.com/blog/how-to-reduce-ai-hallucinations-in-customer-support/)
- Internal: `.planning/PROJECT.md`, `docs/change-request-backlog.md` (this repo's own scoping and open-questions analysis, treated as primary source for what's already decided vs. open)

---
*Feature research for: B2B AI supplier-sourcing SaaS (SourceIQ/SourceGPT) — milestone: pricing, marketing pages, SSO, support chatbot, RFP intake, supplier ratings, supplier repository*
*Researched: 2026-08-15*
