# SourceReady Competitive Backlog

Derived from a teardown of SourceReady (app.sourceready.com) — product, filters, pricing, and
growth surfaces. This backlog lists features worth adopting, prioritized by **impact × effort**.

## Strategic framing (read first)

SourceReady and SourceGPT are **different architectures**:

- **SourceReady** = a search engine over a static, pre-indexed directory (~800k suppliers). A
  `Supplier` exists independently of any buyer; the buyer's `Inquiry` runs a filter query; the
  product is *find → filter → unlock contact* (contacts paywalled at ~20 credits). Their data spine
  is US customs / bill-of-lading trade data (powers "partnered customer", export volume, shipment
  badges).
- **SourceGPT** = an agentic workflow that *generates* suppliers per project. `suppliers.event_id` is
  `NOT NULL` — suppliers are children of a `sourcing_event`, scouted by agents, scored, and pushed
  through an **outreach funnel** (`funnel_stage`, `outreach_status`, `reply_token`,
  `supplier_responded_at`, `buyer_approved_at`). SourceGPT actually *contacts* suppliers and manages
  replies — where SourceReady stops.

**We do not copy their directory model.** We borrow their *field taxonomy* and *UX patterns* to make
our generated results look as authoritative as their indexed ones, and we lean into what their model
can't do: running outreach, and including contacts instead of paywalling them.

Scoring key: Impact (1–5, business value) · Effort (S/M/L) · Priority = Impact ÷ Effort.

---

## Epic 1 — Structured supplier record ("credibility layer")  ★ top priority

Adopt SourceReady's field taxonomy so our per-event suppliers read as authoritative. Mostly additive
columns on the existing `suppliers` table + enrichment-agent output changes.

> **✅ Shipped (#20):** rows 1.1–1.6 are live. The scout now emits structured fields during discovery,
> normalized to a controlled vocabulary in `lib/taxonomy.ts` (`business_type`, banded `employee_count`,
> numeric `founded_year`, 0–5 `review_score`, and `capability_tags`), persisted additively on
> `suppliers`, and rendered on the supplier cards. `certifications[]` was already stored structured.

| # | Feature | Impact | Effort | Notes |
|---|---------|--------|--------|-------|
| 1.1 ✅ | `business_type` enum (Manufacturer/Distributor/Trading/Wholesaler/Service/Other) | 4 | S | shipped #20 — controlled set in `lib/taxonomy.ts` |
| 1.2 ✅ | Banded `employee_count` (their 11 buckets) | 3 | S | shipped #20 — 11 bands, normalizes free-text `employees` |
| 1.3 ✅ | Numeric `founded_year` (filterable min/max) | 3 | S | shipped #20 — parsed from `founded` |
| 1.4 ✅ | `review_score` (0–5) | 3 | S | shipped #20 — display on cards |
| 1.5 ✅ | Structured `certifications[]` (ISO9001/BSCI/CE…) | 4 | S | shipped #20 — already stored as a JSON array |
| 1.6 ✅ | Capability **tag taxonomy** (OEM/ODM, Low MOQ, custom packaging, eco-friendly, patented, high-capacity, small-batch…) | 5 | M | shipped #20 — controlled vocab emitted by scout; powers match cards |
| 1.7 | `partnered_customers[]` + `partnered_customer_count` ("ships to Nike…") | 4 | M | strong trust signal; from web/enrichment |
| 1.8 | `key_export_markets[]` | 2 | S | |
| 1.9 | Verification badges (VAT/registry/website-live/cert-DB checks) | 4 | M | our analog to their Alibaba/Thomasnet badges |
| 1.10 | `extension_data` JSON (user-defined custom fields) | 2 | M | Pro-gated like theirs |

---

## Epic 2 — Events as persistent projects ("retention layer")

Reframe `sourcing_events` from transactional searches into durable, revisitable projects. Most data
already exists — this is mostly UI + light schema.

> **✅ Shipped (#21/#29):** 2.1 and 2.2 turned out to already be satisfied by existing `/dashboard`
> and funnel-stage UI — no code needed. 2.3 (outreach thread history) was the one genuine gap and is
> now live: `lib/outreach-log.ts` + `GET /api/outreach-log` + a timeline section in the supplier
> `DetailPanel`.

| # | Feature | Impact | Effort | Notes |
|---|---------|--------|--------|-------|
| 2.1 ✅ | Projects list view (browse past events) | 5 | M | shipped — already satisfied by `/dashboard` |
| 2.2 ✅ | Saved-suppliers / shortlist view per project | 4 | M | shipped — already satisfied by `funnel_stage` grouping |
| 2.3 ✅ | Revisitable outreach threads (reply history per supplier) | 4 | M | shipped #21/#29 — reads `outreach_logs` |
| 2.4 | Rename/pin/archive projects | 2 | S | explicitly out of scope in #21; still open |
| 2.5 | Cross-project search | 3 | M | "Search chats" analog |
| 2.6 | Soft data lock-in messaging on cancel (what you'd lose) | 3 | S | retention nudge |

---

## Epic 3 — Advanced search & filtering

Give power users structured filtering alongside the agent chat.

| # | Feature | Impact | Effort | Notes |
|---|---------|--------|--------|-------|
| 3.1 | Filter panel with tabbed groups (General/Product/Profile/Highlight/Verification) | 4 | M | filters over stored suppliers |
| 3.2 | "AI filter" free-text → maps to structured filters | 4 | M | chat↔filter bridge |
| 3.3 | "Get suggestions" AI autocomplete on fields | 2 | S | |
| 3.4 | Match-any / match-all toggles on multi-selects | 2 | S | |
| 3.5 | "Exclude selection" negative filters | 2 | S | |
| 3.6 | Suggested follow-up chips under each answer | 3 | S | high UX polish per effort |
| 3.7 | Result-count summary + proactive refine question | 2 | S | |
| 3.8 | Manual-filter → Clear-all → Apply-search flow | 2 | S | filter panel controls (their point 19) |

---

## Epic 4 — Product object

Introduce Product as a browsable object. (Product research / ideation / image-generation /
full-profile / shipment-data views — their points 29–33 — are **out of scope**, deliberately dropped.)

| # | Feature | Impact | Effort | Notes |
|---|---------|--------|--------|-------|
| 4.1 | Product as first-class object (name/category/images), child of supplier | 3 | L | |
| 4.2 | Composer mode buttons (Supplier search / Product search) | 3 | M | |

---

## Epic 5 — Chat/interaction UX polish

| # | Feature | Impact | Effort | Notes |
|---|---------|--------|--------|-------|
| 5.1 | Named, saved chats in left rail | 3 | M | |
| 5.2 | Grouped results in answers (by category) | 3 | S | |
| 5.3 | Thumbs up/down feedback on answers | 2 | S | feeds quality loop |
| 5.4 | Share button on a result/search | 2 | S | mild virality |
| 5.5 | "AI may make mistakes" disclaimer bar | 1 | XS | trust/compliance |
| 5.6 | Chat-first workspace layout w/ persistent history | 3 | M | overall shell (their point 21) |
| 5.7 | Cross-object left-nav (Suppliers / Products / Inquiries) | 3 | M | three-object browse (their point 11) — **confirmed live** 2026-08-07 teardown: sidebar has Supplier/Product/Inquiry as distinct top-level modes below New chat/Search chats |
| 5.8 | Pin/collapse sidebar + Help/support (?) entry | 1 | S | nav polish (their points 46, 47) |

---

## Epic 6 — Credits & monetization

Evaluate a credit model alongside the current flat event limits. **Deliberately do NOT copy the
contact-unlock paywall** — "contacts included" is our positioning wedge.

| # | Feature | Impact | Effort | Notes |
|---|---------|--------|--------|-------|
| 6.1 | Credit currency alongside/instead of event limits | 3 | M | strategic, decide first |
| 6.2 | Daily credit refresh on free tier (habitual return) | 3 | S | upgrade pressure |
| 6.3 | Pro-gated features with inline "Upgrade" cards | 3 | S | e.g. verification depth, extension data |
| 6.4 ✅ | Fill the abandoned $49–99 pricing middle (they jump $25→$299) | 4 | S | shipped #31/#32 — new €89/mo "Growth" tier between Basic (€49) and Premium (€149) |
| 6.5 | ~~Contact-unlock paywall~~ | — | — | **intentionally skipped** — anti-pattern for us |
| 6.6 | Tiered plans (Free/mid/Pro/Custom) | — | — | **already shipped** — `lib/plans.ts` TIERS (their point 38) |

> Their point 45 (workspace concept) is **already satisfied** by SourceGPT's Clerk **organizations** —
> multi-user tenant with its own event pool. No new work; noted for completeness.

### Design reference: SourceReady credit-management UI (screenshots, 2026-08-12)

User supplied 4 screenshots of `app.sourceready.com/[workspaceId]/settings/subscription` as a
concrete visual reference for whatever Issue L (#45) ends up deciding. **Not an implementation
trigger** — #45 is still a strategic decision gated on the same PR #120 business call (final
credit-tier pricing/allocations) as the rest of Epic 6.1–6.3. Captured here so the reference isn't
lost before that decision lands:

- **Tri-category credits widget** on the subscription page: "Paid credits" / "Free credits" /
  "Daily credits", each with its own progress bar and remaining/total count.
- **Daily credits reset messaging**: "Daily credits reset to 30 at 00:00 UTC" — an explicit,
  visible reset cadence rather than a silent monthly rollover.
- **"Earn extra credit" CTA button** directly on the credits widget (ties to Epic 7.4, already
  filed as #42/Issue I — persistent "earn more" sidebar CTA).
- **Two-tab usage view**: "Usage overview" (aggregate cards — Active users / Inquiries tracked /
  Features — over a selectable date range) vs. "Activity log" (per-user table: user, credits used,
  feature/inquiry, billing date).
- **Plan badge + Upgrade**: "Free Plan $0" badge with an adjacent "Upgrade" button on the same
  settings page (ties to Epic 7.5 / #42, already filed).
- **Persistent sidebar "Credits left" widget** outside the settings page too (e.g. "180/230",
  "Resets daily at 00:00 UTC") plus an "Earn extra 1000+ credits" link — the always-visible version
  of the same CTA.

If/when #45 resolves in favor of a credit currency, this list is the starting design spec for
SourceGPT's own credit-management surface (`app/settings/page.tsx` + a persistent nav widget) —
noting again that the contact-unlock paywall pattern (6.5) stays explicitly out of scope regardless.

---

## Epic 7 — Growth flywheel

Fuse shipped onboarding (#18) + referrals (#19) into a rewarded activation loop.

> **✅ Shipped (#22/#28):** 7.1 and 7.3 are live — a 4-task quick-start checklist
> (`lib/onboarding.ts`) granting bonus events per org on completion, plus a `REFERRAL_REWARD_CAP_PER_ORG`
> cap and centralized reward constant in `lib/referrals.ts`.

| # | Feature | Impact | Effort | Notes |
|---|---------|--------|--------|-------|
| 7.1 ✅ | Gamified "Quick start" checklist that rewards activation | 4 | M | shipped #22/#28 |
| 7.2 | Rewards for reviews (G2/Capterra) + social posts | 4 | M | their distribution engine; still open |
| 7.3 ✅ | Referral cap per org + reward-per-conversion tuning | 3 | S | shipped #22/#28 |
| 7.4 | Persistent "earn extra credits/events" sidebar CTA | 2 | S | explicitly out of scope in #22; still open |
| 7.5 | Always-visible Upgrade button next to plan badge | 1 | XS | explicitly out of scope in #22; still open |

---

## Epic 8 — Speed / perceived latency  ★ (SourceReady's biggest felt advantage)

SourceReady feels instant because it's a **lookup over a pre-indexed directory** — nothing is
generated at request time. SourceGPT **generates** suppliers live (multi-agent scout → qualify →
enrich → contact), so it is inherently slower. The orchestration is already pool-parallelized
(`SCOUT_CONCURRENCY`, `QUAL_CONCURRENCY`), so the remaining latency is model choice, live
generation, and inline enrichment — all reclaimable.

> **✅ Shipped (#23/#24, #30/#33/#36):** 8.1 (per-agent model right-sizing via `AGENT_MODELS` in
> `lib/agents.ts`), 8.3 (contact scrape deferred off the critical path), and 8.4 (supplier cards
> stream via `supplier_found` the instant they're qualified, enrichment=null) are all live. 8.2 was
> largely subsumed by 8.1 — Haiku has no extended-thinking budget to tune — but residual effort
> tuning on the two Sonnet-tier verifiers (grounded qualifier, contact finder) was explicitly called
> out as a follow-up, not done. The model-aware cost-telemetry gap noted as a follow-up in #24 was
> also closed separately (#25/#34).

| # | Feature | Impact | Effort | Notes |
|---|---------|--------|--------|-------|
| 8.1 ✅ | Right-size models per agent — Haiku/Sonnet for classifier/qualifier/enricher/contact-finder/reply-classifier; keep Opus for scout + orchestrator | 5 | S | shipped #23/#24 |
| 8.2 | Tune `effort` down (+ limit thinking) on the two remaining Sonnet-tier verifiers (grounded qualifier, contact finder) | 2 | S | residual — needs an eval to avoid weakening verification rigor; called out in #24 |
| 8.3 ✅ | Defer contact enrichment (scrape + contact-finder) to background, off the discovery critical path | 4 | M | shipped #33 |
| 8.4 ✅ | Stream each supplier card the moment it's qualified (progressive results) + defer LLM enrichment too | 4 | M | shipped #30/#33/#36 |
| 8.5 | Raise scout/qual concurrency within rate limits | 2 | S | env-tunable already; still open |
| 8.6 | Cap/early-exit the grounded-qualifier iteration loop (up to 6 Opus calls) | 3 | S | `agents.ts` `for i<6` hotspot |
| 8.7 | Persistent, reusable supplier store — cached results return instantly for repeat/similar queries | 5 | L | the real "become lookup-fast" move; ties to Epic 1/2 |

---

## Recommended sequencing — status

1. ✅ **Epic 8.1–8.2 (latency quick wins)** — shipped #23/#24. 8.2 residual (Sonnet-tier effort
   tuning) still open, see 8.2 above.
2. ✅ **Epic 1 (credibility layer)** — 1.1–1.6 shipped #20. 1.7–1.10 still open.
3. ✅ **Epic 2 (persistent projects)** — 2.1–2.3 shipped #21/#29. 2.4–2.6 still open.
4. ✅ **Epic 7 (growth flywheel)** — 7.1 + 7.3 shipped #22/#28. 7.2/7.4/7.5 still open.
5. ✅ **Epic 8.3–8.4 (defer enrichment + progressive streaming)** — shipped #30/#33/#36.
6. **Epic 3 (filtering)** — next up; depends on Epic 1's structured fields, which are now in place.
7. ✅ **Epic 6.4 (pricing middle)** — shipped #31/#32 (Growth tier).
8. **Epic 8.7 (supplier cache)** + **Epic 4 (Product object)** — larger architectural bets, still open.
9. **Epic 5** — polish, fold in opportunistically, still open.

Everything above that isn't a Product-related AI feature (Epic 4's dropped points 29–33) or the
contact-unlock paywall (6.5) remains eligible — see the second batch below for what's left.

## First batch — filed and shipped

- ✅ **Issue A** (#20) — Epic 1.1–1.6: structured supplier fields + capability tag taxonomy
- ✅ **Issue B** (#21) — Epic 2.1–2.3: events as persistent projects (list + shortlist + threads)
- ✅ **Issue C** (#22) — Epic 7.1 + 7.3: quick-start activation checklist + referral cap
- ✅ **Issue D** (#23) — Epic 8.1–8.2: latency quick wins (per-agent model right-sizing + effort tuning)
- ✅ (unplanned, filed mid-stream) **#25** — model-aware token cost accounting (follow-up from #24)
- ✅ (unplanned, filed mid-stream) **#30/#31** — defer enrichment fully off critical path; Growth pricing tier

## Second batch — filed

Ordered by the sequencing above (3 → 8.7/4 → remaining growth/latency scraps → 5), each scoped
tightly enough to ship independently like the first batch:

- ✅ **Issue E** (#38) — Epic 3.1–3.2: filter panel with tabbed groups (General/Product/Profile/
  Highlight/Verification) + "AI filter" free-text → structured-filter bridge. The core of Epic 3;
  3.3–3.8 are cheap polish that can ride along or follow separately.
- ✅ **Issue F** (#39) — Epic 1.7–1.9: `partnered_customers[]`/count, `key_export_markets[]`, and
  verification badges (VAT/registry/website-live/cert-DB checks). Extends the credibility layer
  Epic 1 already shipped; 1.10 (`extension_data`) is lower priority and Pro-gated, can wait.
- ✅ **Issue G** (#40) — Epic 2.4–2.6: rename/pin/archive projects, cross-project search, soft data
  lock-in messaging on cancel. Closes out the persistent-projects epic.
- ✅ **Issue H** (#41) — Epic 8.2 + 8.5 + 8.6: residual effort tuning on the two Sonnet-tier
  verifiers, raise scout/qual concurrency within rate limits, cap the grounded-qualifier iteration
  loop. Cheap latency scraps, bundle-able into one PR.
- ✅ **Issue I** (#42) — Epic 7.2 + 7.4 + 7.5: review/social-post credit rewards, persistent "earn
  more" sidebar CTA, always-visible Upgrade button. Growth-flywheel polish, low effort each.
- ✅ **Issue J** (#43) *(larger, sequence later)* — Epic 8.7: persistent, reusable supplier
  store/cache for instant repeat/similar-query results. The real "become lookup-fast" move; filed
  as a design spike — cache-key/staleness policy first, implementation as a follow-up.
- ✅ **Issue K** (#44) *(larger, sequence later)* — Epic 4: Product as a first-class object
  (name/category/images, child of supplier) + composer mode buttons. Deliberately excludes the
  dropped research/ideation/image-gen/full-profile/shipment-data surfaces (points 29–33).
- ✅ **Issue L** (#45) *(strategic decision needed first)* — Epic 6.1–6.3: whether to introduce a
  credit currency alongside/instead of flat event limits, daily free-tier refresh, and Pro-gated
  upgrade cards. Filed as a decision issue (`question` label), not an implementation issue.
- ✅ **Issue M** (#46) *(grab-bag, first bundle)* — Epic 5: chat/UX polish, bundle 1 (saved chats,
  grouped results, thumbs up/down, disclaimer bar). Share button, cross-object nav, and sidebar
  pin/collapse deferred to a later Epic 5 bundle rather than filing 8 tiny issues.

## Appendix — live teardown notes (2026-08-07)

Manual DOM capture of `app.sourceready.com/[workspaceId]/settings/inquiry` (browser extension
blocked by device policy, so captured via copy/paste of rendered HTML). Two passes, same route:

**Pass 1 — desktop-width viewport.** The route rendered SourceReady's main chat surface, not a
settings form: left rail (New chat, Search chats, chat history grouped by month, usage/credits
gauge, avatar menu) + main panel showing a template carousel (~24 example prompts across six modes:
Supplier search, Product ideation, Image search, Product research, Keyword trends, Product video) +
a chat input bar (attachment, "Supplier search" quick-mode button, More, send). Global chrome:
Intercom widget, PostHog analytics/session-recording. No settings fields/toggles anywhere in the DOM
despite the `/settings/inquiry` route name — confirms this URL is just SourceReady's internal path
for the Inquiry chat mode, not a config screen.

**Pass 2 — narrower viewport (DevTools docked / zoom / window not maximized).** Same route instead
rendered a **responsive gate**: "Continue Settings on Desktop — Setting are available on desktop
only. Open on your computer to continue," with a preview screenshot and a "Send Desktop Link to My
Email" CTA. Confirms Settings is a genuinely separate, desktop-breakpoint-gated screen that simply
didn't render in pass 1 because pass 1's capture was itself already below their desktop breakpoint —
neither pass has actually seen the real settings form yet.

Useful structural finding from pass 2 (visible in the sidebar even under the gate): confirms Epic 5.7
above — **Supplier / Product / Inquiry are three distinct top-level nav modes** (icons: factory,
hexagon/product, order-inquiry), separate from the template-carousel prompts. Also newly visible:
credits gauge with a "Earn extra 1000+ credits" nudge row pinned above the avatar/help footer —
relevant to Epic 7 (7.4's "persistent earn-more sidebar CTA" is literally this row in their product).

**Open follow-up:** get an actual desktop-width capture of `/settings/inquiry` to document the real
settings fields (if any exist beyond the Inquiry chat mode itself). Until then, 8.2/Epic-1/Epic-3
scoping already in this doc is unaffected — nothing above was inferred from the unseen settings form.
