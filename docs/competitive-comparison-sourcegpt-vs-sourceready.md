# SourceGPT vs. SourceReady — Competitive Comparison

Sources: this codebase (`docs/LAUNCH-PLAN.md`, `docs/competitive-sourceready-backlog.md`,
`docs/product-feedback-backlog.md`, `docs/e2e-audit-report.md`, `lib/plans.ts`,
`app/events/new/page.tsx`, `app/events/[id]/page.tsx`) for Product A; public web search +
an earlier in-repo live-app teardown (screenshots) for Product B. **SourceReady's
`app.sourceready.com` could not be reached directly in this pass** (WebFetch was
unavailable), so Product B claims below are either (a) carried over from the existing
teardown in `docs/competitive-sourceready-backlog.md`, which *did* capture real DOM/
screenshots on 2026-08-07/08-12, or (b) drawn from public marketing copy and third-party
reviews (G2, review blogs) via web search — labeled accordingly. Nothing here was
independently re-verified against a fresh login.

---

## 1. What each product does

**SourceGPT (ours).** A Next.js 14 B2B sourcing app where a buyer describes a need and a
pipeline of Claude agents (scout → qualify → enrich → contact-finder), each with live
web search, generates and verifies a fresh set of candidate suppliers *per sourcing
event* — nothing is looked up from a pre-built directory. Suppliers move through an
outreach funnel (Long List → Contacted → Responded → Short List, plus Declined), and the
agents can draft and send anonymous or disclosed outreach emails and manage replies.

**SourceReady (competitor).** Per marketing copy and the earlier in-repo teardown: a
chat/search product over a large pre-indexed supplier directory (claims of "4M+"
manufacturers in public marketing copy; the earlier internal teardown cites "~800k" —
these are inconsistent and neither is independently verified here). The buyer runs
natural-language or filtered queries against that static index; results are enriched
with customs/trade-data badges (e.g., "ships to Nike"), and contacts are paywalled
behind a credit-unlock mechanic. Public marketing copy (not confirmed in the live-app
teardown) also claims an "always-on AI agent" that handles supplier communication and
negotiation on the buyer's behalf.

---

## 2. Pros of SourceGPT

- **Two-speed discovery (Quick Scan → Deepen).** A fast, names-only, unverified pre-scan
  (~10s) sits alongside the full verified investigation (~60-90s), with a one-click
  "Deepen" to upgrade a single candidate into the real, web-search-verified pipeline
  (`app/events/[id]/page.tsx` `SupplierRow`/`handleDeepen`). This is a genuine
  differentiator SourceReady's static-directory model can't replicate — SourceReady is
  fast because it never generates anything at request time; SourceGPT is fast *and* can
  still verify on demand.
- **Agentic, live-web-search verification, not a static index.** Suppliers are generated
  and qualified per event via Claude agents with `web_search`, so results reflect current
  reality rather than a directory snapshot that can go stale. This is the core
  architectural difference already documented in
  `docs/competitive-sourceready-backlog.md`.
- **Contacts included, not paywalled.** SourceGPT deliberately does not gate contact
  details behind a credit-unlock mechanic (explicitly called out as an anti-pattern to
  avoid in Epic 6.5 of the competitive backlog) — a buyer sees the full supplier record
  once qualified.
- **Runs the outreach, not just the search.** SourceGPT drafts and sends RFI/outreach
  emails (anonymous or disclosed) and tracks replies through a funnel
  (`long_list → contacted → responded → shortlisted`), whereas SourceReady's confirmed
  UI (2026-08-07 teardown) is a chat/search surface with no observed send/reply-tracking
  UI — SourceReady's *marketing copy* separately claims an outreach/negotiation agent,
  but that has not been seen in the live product (see Section 4).
- **Per-event hard spend ceiling.** `maxEventSpendUsd` in `lib/plans.ts` (e.g. $5 Free,
  $20 Basic, up to $400 Pro) caps cumulative AI/agent cost per event regardless of tier —
  a concrete cost-control guarantee that's hard for a buyer-facing product to promise
  without an agentic-cost architecture like this one.
- **Compliance/trust surface already built.** GDPR erasure, PII scrubbing before Sentry
  egress, prompt-injection isolation on agent inputs, suppression/unsubscribe handling,
  and audit logging are all merged (per `docs/LAUNCH-PLAN.md` trust-signal table) — a
  meaningful asset for the enterprise-procurement ICP SourceGPT is targeting, where
  "an AI agent emails our suppliers" needs a controls story.
- **Funnel-stage workflow view.** The Long List/Contacted/Responded/Short List/Declined
  pipeline with per-stage counts gives a buyer a project-management view of sourcing
  progress that a pure search/filter tool doesn't have natively.

---

## 3. Cons of SourceGPT

Pulled from `docs/e2e-audit-report.md` and `docs/product-feedback-backlog.md` (known,
not newly discovered), plus explicit gaps vs. SourceReady already flagged in the
competitive backlog:

- **Billing/spend-gate hole (blocker).** `past_due` orgs can still trigger new LLM spend
  across all four spend-triggering routes — the intended `requireSpendableSubscription()`
  gate exists only on a stale branch, not on `develop` (E2E audit F1). This is the single
  item flagged as blocking a real paid launch in `LAUNCH-PLAN.md` §0.
- **Quick Scan bypasses the per-event supplier cap**, and unverified quick-scan rows
  permanently consume slots from the real per-event supplier cap the buyer paid for
  (E2E audit F2/F3) — undermines the tier-limit guarantees in `lib/plans.ts`.
- **Event brief can't be edited post-creation for several fields** — `subcategory`,
  `ship_to`, `outreach_anonymous`, and `buyer_*` identity fields are all missing from the
  PATCH allowlist (E2E audit F4), which is the root cause of a known UX dead-end: no way
  to switch outreach from anonymous to disclosed after event creation, or edit the
  sender's name/role once switched (product-feedback-backlog item 3).
- **No manual "move to Shortlist" action** — funnel-stage changes only happen through the
  automated outreach/qualify flow; a buyer can't just decide to shortlist a supplier from
  the UI (product-feedback-backlog item 2, confirmed still unresolved in the E2E audit).
- **No account-level company/role profile** — only per-event `buyer_name`/`buyer_role`
  exist; there's no durable account-level identity for outreach signatures, exports, or
  invoices (product-feedback-backlog item 4).
- **Several tier/billing UX gaps**: the upgrade modal on `/events/new` hardcodes
  "Subscribe to Pro" regardless of the tier catalog or which limit was actually hit (E2E
  audit, high-priority); Free/Basic-tier users still see an Auto-Outreach button that
  403s instead of an "Upgrade" link (unlike Export, which already does this correctly).
- **No credit-management UI pattern.** SourceReady's confirmed subscription-settings
  screenshots (captured 2026-08-12, cited in the competitive backlog) show a
  tri-category credits widget (Paid/Free/Daily), explicit daily-reset messaging, a
  persistent sidebar "credits left" widget, and an "earn extra credits" CTA — SourceGPT
  has none of this today; its usage surface is a flat events/month bar
  (`app/dashboard/page.tsx`) that, per E2E audit F10, doesn't even surface the two caps
  that actually constrain day-to-day work (`suppliersPerEvent`, `maxEventSpendUsd`).
- **Inherently slower than a lookup-only competitor.** Because SourceGPT generates
  suppliers live via a multi-agent pipeline, it cannot match a pre-indexed directory's
  perceived instant-search speed — latency work is ongoing (model right-sizing, deferred
  enrichment, progressive streaming all shipped) but a persistent/cached supplier store
  (Epic 8.7) — the real fix for repeat/similar queries — is still open.
- **Minor but real UX papercuts**: ambiguous ranking between "Launch AI Discovery" and
  "Quick Scan instead" CTAs with no distinguishing copy until hover; low-confidence
  auto-classification shown with the same visual weight as high-confidence; disabled
  action buttons with no explanatory tooltip; support email domain mismatch
  (`sourcegpt.app` vs. `sourcegpt.org`).

---

## 4. Pros of SourceReady

- **[Confirmed — live-app teardown]** Distinct top-level nav modes for Supplier /
  Product / Inquiry, a chat-first workspace with saved/searchable chat history, and a
  template carousel of ~24 example prompts across six modes (Supplier search, Product
  ideation, Image search, Product research, Keyword trends, Product video) — a broader
  surface area than SourceGPT's single sourcing-event flow.
- **[Confirmed — live-app teardown]** A more mature credit/usage settings surface:
  tri-category credit widget (Paid/Free/Daily) with progress bars, explicit daily-reset
  messaging, a persistent sidebar credits-left widget, an "earn extra credits" CTA, and a
  two-tab usage view (aggregate overview vs. per-user activity log).
- **[Inferred — marketing copy]** Perceived speed: because it's a search over a static,
  pre-indexed directory rather than a live multi-agent generation pipeline, simple
  queries likely return near-instantly, vs. SourceGPT's 60-90s full-investigation
  discovery wave (10s for Quick Scan).
- **[Inferred — marketing copy]** Trade/customs-data-backed verification badges
  ("ships to Nike"-style partnered-customer signals) sourced from real bill-of-lading
  data — a credibility layer SourceGPT has only partially replicated (its own
  `partnered_customers[]`/verification-badge work, Epic 1.7-1.9, is listed as shipped in
  the competitive backlog but was not independently re-verified in this pass).
- **[Inferred — marketing copy, G2]** Broad directory scale (marketing claims "4M+"
  manufacturers across 200+ countries; earlier internal teardown cited "~800k" — these
  two figures conflict and neither is independently confirmed here) and reasonably
  positive review sentiment on G2 around search speed and result relevance.
- **[Inferred — marketing copy]** Quote-comparison tooling (extracting unit price, MOQ,
  shipping terms, lead time from supplier quotes into a side-by-side comparison) —
  SourceGPT has no equivalent post-quote comparison feature today.
- **[Inferred — marketing copy]** Also claims an "always-on AI agent" that handles
  parallel supplier conversations, reminders, and negotiation — if real, this would
  directly contest SourceGPT's "we run the outreach" wedge. This claim was **not**
  observed in the actual product during the live-app teardown (which showed only a
  chat/search UI with no visible send/reply-tracking surface), so it is flagged as
  unconfirmed marketing copy rather than a verified capability.

---

## 5. Cons of SourceReady

- **[Confirmed — live-app teardown]** Settings (including presumably billing/account
  config) is gated behind a desktop-only breakpoint — narrower viewports get a
  "Continue Settings on Desktop" responsive wall instead of the actual form, a real
  usability constraint for anyone not on a full desktop browser.
- **[Confirmed — competitive backlog / architecture]** It is fundamentally a
  find-and-filter tool over a static directory: a `Supplier` exists independent of any
  buyer, and its own architecture stops at "unlock the contact" — the buyer still has to
  leave the product to actually reach out, unless the newer AI-outreach claim (Section 4,
  unconfirmed) is real and shipped.
- **[Confirmed — pricing research]** Contact details are paywalled behind a credit-unlock
  mechanic (~20 credits per contact per the competitive backlog's teardown) — a
  friction/monetization pattern SourceGPT deliberately avoids.
- **[Inferred — review search]** A pricing gap between its $25-35/mo Entry tier and
  ~$299-379/mo Pro tier, with no clearly public mid-tier — SourceGPT's own backlog already
  flagged and closed this same gap on its own side (Growth tier at €89/mo).
- **[Inferred — review site]** At least one review mentions limitations sourcing from
  European countries, suggesting directory coverage may be stronger for Asia-Pacific
  (notably China) manufacturing than other regions — unconfirmed depth or scope.
- **[Inferred — positioning]** Public marketing (Shopify brands, first/second product,
  Alibaba-alternative framing) targets SMB/DTC e-commerce operators sourcing physical
  goods from China — a different ICP than SourceGPT's stated enterprise-procurement
  target, which may mean less applicability for large-scale, multi-category, or
  services-inclusive B2B procurement than an SMB reader might assume from name
  similarity alone.
- **No visible compliance/trust surface** was found in any public page or the internal
  teardown — no equivalent to SourceGPT's GDPR-erasure, PII-scrubbing, or audit-log
  messaging discovered so far; this is an absence-of-evidence finding, not a confirmed
  gap, since SourceReady's real settings/legal pages were never fully captured (desktop
  breakpoint wall, Section "Confirmed" above).

---

## 6. So what — positioning takeaways

- **Lead with "we run the outreach," but verify the counter-claim first.** SourceReady's
  marketing copy now claims an "always-on AI agent" for supplier communication — if that
  ships for real, the current wedge ("nobody else runs outreach for the buyer," per
  `LAUNCH-PLAN.md`) needs a fallback angle (compliance controls, contacts-included
  pricing) rather than resting on being the only one who contacts suppliers.
  **Recommendation:** get a fresh, logged-out or trial screenshot of SourceReady's
  outreach/negotiation surface (if reachable without creating an account) before
  finalizing any comparison copy that claims exclusivity here.
- **The credit-management UI gap is real and already scoped.** SourceReady's confirmed
  credits widget (tri-category, daily reset, persistent sidebar CTA) is a concrete UX
  pattern SourceGPT lacks; it's already captured as a design reference in
  `docs/competitive-sourceready-backlog.md` Epic 6, gated on the same #45 pricing
  decision blocking paid launch — closing that loop closes two gaps at once.
- **"Contacts included, no paywall" is a clean, easy-to-state differentiator** against a
  confirmed 20-credit contact-unlock mechanic — safe to lead with regardless of the
  outreach-agent uncertainty above.
- **Fix the billing/spend-gate blocker before using compliance as a selling point.** The
  `past_due`-still-spends gap (E2E audit F1) undercuts the "controls an enterprise
  buyer can sign off on" pitch in `LAUNCH-PLAN.md` — ship that fix before this comparison
  doc or any external-facing content leans on the compliance framing.
- **ICP mismatch may be an opportunity, not just a risk.** SourceReady's public
  positioning skews SMB/DTC (Shopify brands, first product, Alibaba alternative);
  SourceGPT's enterprise-procurement framing may simply not compete head-to-head for a
  large share of SourceReady's actual customer base — worth confirming via the 50-target
  ICP research already planned in `LAUNCH-PLAN.md` §2 rather than assuming direct overlap.
