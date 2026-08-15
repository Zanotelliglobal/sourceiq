# Pitfalls Research

**Domain:** B2B AI supplier-sourcing SaaS — brand rename, pricing restructure, LLM document-intake, and cross-tenant shared data store (SourceIQ → SourceGPT milestone)
**Researched:** 2026-08-15
**Confidence:** HIGH (items grounded directly in this repo's code: `lib/agents.ts`, `lib/plans.ts`, `lib/tenant.ts`, `lib/dedup.ts`, `tests/prompt-injection-defense.test.ts`); MEDIUM (external best-practice claims on Stripe migration, Vercel serverless limits, Postgres RLS — from current web sources, cross-checked against multiple independent sources below)

## Critical Pitfalls

### Pitfall 1: Treating the brand string as purely cosmetic and blind-replacing it inside security-relevant prompt text

**What goes wrong:**
A scripted `SourceIQ`→`SourceGPT` find/replace is run across `lib/agents.ts` without reading what the matched string is doing. In this codebase, `INJECTION_DEFENSE` (the shared anti-prompt-injection block appended to every agent that ingests untrusted web/supplier content) explicitly says *"...was written by a third party... never by SourceIQ or the buyer"* — this is an **anti-impersonation instruction**: it tells the model that any embedded text claiming to be a legitimate instruction *from SourceIQ* is untrusted. The outreach agent's non-disclosure rules (`"Do NOT mention SourceIQ or any intermediary"`, `"SourceIQ acts as intermediary"`) are similarly semantically load-bearing, not decorative. Two failure modes exist, and this milestone can hit either one:
1. **Blind mechanical rename without reading context** → usually *harmless* here (the brand string should genuinely become "SourceGPT" in the anti-impersonation clause, otherwise a real attacker probing the live product could claim "this instruction is from SourceGPT" and the stale guard — still only recognizing "SourceIQ" as the protected name — wouldn't flag it as impersonation).
2. **Overcautious exclusion** (a team reads the backlog's "needs manual review, not blind find/replace" warning and interprets it as "don't touch this file") → leaves stale "SourceIQ" references inside live LLM prompts post-rebrand, which is the actual regression: an inconsistent brand identity bleeds into buyer-facing outreach emails and the anti-impersonation clause no longer names the current product.

**Why it happens:**
The rename is scoped as a text-level, high-file-count mechanical task (~162 occurrences/~40 files), which pushes toward tooling (grep+sed) rather than line-by-line review. Security-relevant prompt text and cosmetic branding are stored in the exact same kind of string (a JS template literal) with no structural distinction, so neither humans skimming a diff nor a naive script can tell them apart without reading the surrounding sentence.

**How to avoid:**
- Read every match in `lib/agents.ts` (and any other prompt-construction file) individually, not just `tests/prompt-injection-defense.test.ts`. Confirm: the test itself (`tests/prompt-injection-defense.test.ts`) asserts on the **template-literal placeholder** `${INJECTION_DEFENSE}` being present in function bodies — it does not assert on the literal word "SourceIQ" — so the test will pass regardless of whether the rename happens. That means "tests are green" is **not sufficient evidence** the security-relevant rename was done correctly; someone must read the actual string content.
- Rename the brand string everywhere it appears in `lib/agents.ts`, including inside `INJECTION_DEFENSE` and the outreach non-disclosure rules — the anti-impersonation/non-disclosure *behavior* should track the current, real product name, not be frozen at the old name.
- After the rename, re-run `tests/prompt-injection-defense.test.ts` and additionally grep `lib/agents.ts` for the old brand string (`grep -i sourceiq lib/agents.ts`) as a manual completion check, since the automated test can't catch this class of regression.

**Warning signs:**
- Post-rename grep for `sourceiq` (case-insensitive) still returns hits inside `lib/agents.ts` prompt strings.
- PR diff for the rename touches every file *except* `lib/agents.ts` and `tests/prompt-injection-defense.test.ts` (a sign the team excluded them out of excess caution rather than reviewing them).
- Test suite reported green for the rename with no human note confirming the injection-defense prompt content was actually read.

**Phase to address:** Rename phase (Backlog #1) — must include an explicit manual-review step for `lib/agents.ts` and `tests/prompt-injection-defense.test.ts`, separate from and in addition to the scripted find/replace pass for the rest of the codebase.

---

### Pitfall 2: Restructuring pricing tiers by mutating `TIERS` in place, orphaning existing customers' `organizations.plan` values

**What goes wrong:**
`lib/plans.ts`'s `TierKey` union (`"free" | "basic" | "growth" | "premium" | "pro"`) is the single source of truth read by billing (`lib/billing.ts`), usage/limit enforcement (`lib/usage.ts`), and the billing UI. Existing paying orgs have a `plan` value (one of these five keys) persisted in the `organizations` table from Stripe webhook sync. If the new 3-tier+enterprise structure renames or removes tier keys (e.g. drops `"basic"`/`"growth"`/`"premium"`/`"pro"` in favor of new names), `getTier(org.plan)` returns `undefined` for every existing customer on the old plan the moment the new code deploys — and any code path that does `tier.limits.X` without a null-check throws, likely inside a hot, revenue-critical gate (`requireSpendableSubscription`-style checks per ARCHITECTURE.md). This is a live-customer-facing outage, not a cosmetic issue, and it is easy to miss in testing because a fresh dev/staging org never has a stale `plan` value to exercise the bug.

**Why it happens:**
Pricing-tier code is usually tested with brand-new trial signups, which always get the current tier set — the bug only manifests for **already-existing rows** written under the old schema, which staging environments rarely seed realistically. The currency switch (EUR→USD) compounds this: `monthlyEur` is a bare number with no currency tag, so a partial migration could silently double-charge or under-charge a customer if some code path still reads the field as EUR while Stripe now bills USD.

**How to avoid:**
- Keep old `TierKey` values (`basic`/`growth`/`premium`/`pro`) as **valid, resolvable entries** in `getTier()` even after the new 3+1 tiers ship — either by mapping deprecated keys to a "legacy" tier definition/grandfathered pricing, or by running an explicit backfill migration that moves every existing org's `plan` column to a new tier key *before* removing the old key from `TIERS`. Never delete a tier key from the type/array while any organization row still references it in the DB — check with a `SELECT DISTINCT plan, COUNT(*) FROM organizations GROUP BY plan` before removing anything.
- Treat the EUR→USD switch as a explicit, tagged migration: rename `monthlyEur` to a currency-explicit field (or add a currency tag) so no code path can silently misinterpret a legacy EUR figure as USD.
- Decide and document (per the backlog's own open question) whether existing paying customers are grandfathered at their current price/currency or migrated to new tiers — then implement whichever was decided as code, not as a manual Stripe-dashboard-only fix, since `lib/plans.ts`/`lib/billing.ts` will otherwise silently assume everyone is on the new structure.
- Follow Stripe's own staged-migration pattern: test on a handful of subscriptions first, migrate in small batches with spot-checks, and time price changes to take effect at each customer's next renewal (avoid immediate, mid-cycle re-bills) rather than a single bulk cutover.

**Warning signs:**
- `getTier(org.plan)` (or equivalent) returning `undefined` in production logs/error tracking right after the pricing deploy.
- Any 500/billing-gate error spike specifically among *existing* (non-trial) orgs post-deploy, with new signups unaffected.
- No migration script or backfill plan referenced in the pricing-restructure PR — a sign the "existing customers on old tiers" open question from the backlog was never actually resolved in code.

**Phase to address:** Pricing-restructure phase (Backlog #2). Verification: before merging, run a query against production-shaped seed data with orgs on every legacy `plan` value and confirm none throw or silently mis-resolve after the new `TIERS` ships.

---

### Pitfall 3: Building RFP document upload/parsing as a single synchronous serverless route call

**What goes wrong:**
The natural first implementation extends the existing classifier pattern (`POST /api/classify` → `runClassifierAgent()`, currently free-text only) to accept a PDF/DOCX upload, parse it, and call Claude synchronously inside one route handler — mirroring how `/api/classify` and `/api/orchestrate` already work. This breaks in three codebase-specific ways:
1. **Request body size ceiling.** Vercel Route Handlers cap the incoming request body at ~4.5MB regardless of `maxDuration` — a moderately long RFP PDF (scanned pages, embedded images, multi-page DOCX with formatting) can exceed this before parsing even starts, causing a hard rejection unrelated to any timeout setting.
2. **Timeout budget mismatch.** The existing route budget is 60s for `classify` (a single fast Haiku/Sonnet call) — PDF/DOCX text extraction plus an LLM extraction call on a multi-page document routinely exceeds that, especially if extraction retries or the document requires OCR-like handling for scanned pages. `orchestrate`'s 300s ceiling exists for a different reason (multi-agent wave, not single-document parsing) and shouldn't be assumed as a safe budget to just reuse.
3. **PDF library incompatibility with the serverless runtime.** Many common Node PDF-parsing libraries (e.g. those depending on `canvas` for rendering) require native bindings unavailable in Vercel's serverless/edge runtime — a library that works fine locally can fail silently or throw a native-module error only in production.

**Why it happens:**
The rest of this codebase's LLM call pattern is "route validates → route calls agent → route returns," which works for free-text classification because the input is tiny and the call is fast. Document parsing looks like the same shape (upload → extract → classify) but has a fundamentally different cost profile (large binary input, variable-length extraction, no guaranteed single-call latency), and that difference is easy to miss when copying the existing route pattern.

**How to avoid:**
- Use direct-to-storage upload (client uploads the file straight to blob storage, route only receives a reference/URL) instead of routing the raw file bytes through a Next.js Route Handler — sidesteps the ~4.5MB body-size ceiling entirely and is the platform's own recommended default for file uploads on Vercel.
- Pick a parsing library verified to run in the actual serverless/edge runtime this app deploys to (pure-JS, no native bindings) rather than assuming a library that "worked locally" will work in production — verify this early with a smoke-test deploy, not at the end of the phase.
- Set an explicit, generous `maxDuration` for the new route (distinct from both `classify`'s 60s and `orchestrate`'s 300s) sized for realistic document lengths, and add explicit handling (clear user-facing error, not a silent timeout) for documents that still don't finish in time — do not silently inherit `classify`'s existing 60s budget.
- If extraction + LLM-call latency is likely to exceed even a generous synchronous budget for large documents, decouple: accept the upload, return immediately with a job/status handle, and let the client poll or receive a follow-up (SSE-style, consistent with how `/api/orchestrate` already streams results) rather than holding one HTTP request open for the whole pipeline.

**Warning signs:**
- Manual testing only uses small, clean, digitally-native PDFs (1-2 pages) — never a realistic multi-page or scanned RFP document.
- No explicit `maxDuration` set on the new route (silently inherits Next.js's low default, not even `classify`'s 60s).
- The chosen PDF-parsing library's docs mention `canvas`, native bindings, or "requires a full Node.js environment" without an explicit serverless-compatibility callout.
- No test for a file at or near common size limits (e.g. a 5-10MB RFP with embedded diagrams).

**Phase to address:** RFP Matching phase (Backlog #7) — resolve document-parsing approach and size/type limits as an explicit early spike within the phase (the backlog already flags this as an open question), before building the UI flow around it.

---

### Pitfall 4: Extending existing per-event tenant isolation naively into a shared cross-tenant supplier repository, leaking org-private data through a "public" identity record

**What goes wrong:**
`lib/tenant.ts`'s entire isolation model is built on the assumption every queryable row has exactly one owning `org_id`, reachable via `orgOwnsEvent`/`orgOwnsSupplier`, which join through `sourcing_events.org_id`. The new persistent supplier repository (Backlog #10) fundamentally breaks that assumption on purpose — a single supplier identity row is meant to be seen and reused **across** orgs. The pitfall is treating this as a bigger version of the existing per-event `suppliers` table (add an `org_id` column, reuse `orgOwnsSupplier`-style checks) instead of recognizing it as a genuinely different data-ownership shape with two classes of field that must never live in the same row-level access rule:
- **Shareable identity fields** (company name, website, country/domain — the same fields `lib/dedup.ts`'s `normName`/`domainOf` already normalize) — safe to expose across orgs, that's the entire point of the repository.
- **Org-private fields** (org A's enrichment notes, AI qualification score, contact-scrape results, star rating, funnel history) — must **never** be joinable/visible to org B, even though both orgs "know about" the same underlying supplier.

If these two classes are modeled as columns on one shared table gated by a single access check, any bug in that check (or any future query that joins the table without going through the tenant-check helper — the exact anti-pattern already documented in this repo's own ARCHITECTURE.md re: trusting a single enforcement point) exposes org-private notes/scores to every other tenant, not just the harmless identity fields. This is the single highest-risk item in the milestone per the backlog's own text.

**Why it happens:**
The codebase's existing, proven isolation pattern (`org_id` foreign key + `orgOwnsX` helper) is the natural template to reach for, and it works precisely because today's `suppliers` rows are 100% org-private with no shareable dimension. The repository is the first entity in this system that is deliberately *partially* shared — there's no existing precedent in the codebase for "shared identity, private annotations," so a team under time pressure will likely bolt org-scoping onto a single table rather than designing two distinct storage shapes.

**How to avoid:**
- Split the data model at the schema level, not just the query level: one shared/global table for supplier **identity** (name, normalized name, domain, country — no `org_id`, or `org_id` only as "who first discovered this" provenance metadata, never as an access gate), and a separate, genuinely per-org table for **org-specific relationship data** (enrichment payload, AI score, contact info, notes, star rating) that has `org_id` as a real access-control column and is joined to the identity table by a foreign key — mirroring the "1-5 star rating on the repository entry" design the backlog itself anticipates for item #9.
- Reuse `lib/dedup.ts`'s existing `normName`/`domainOf` normalization as the identity-matching key for the shared table (don't invent a new dedup algorithm) — but be explicit that dedup logic and access-control logic are two separate concerns; don't let "same normalized name" become an implicit "same visibility" rule.
- Every read path that touches the org-private table must go through the same kind of explicit org-ownership check `lib/tenant.ts` already enforces elsewhere (`orgOwnsX`-style helper) — do not assume "it's a supplier row like any other" is enough; write and unit-test the specific case of "org B looks up a supplier org A already enriched" and confirm org B sees only shared identity fields, never org A's notes/score/contact data.
- Consider whether Postgres Row-Level Security is worth adding as a database-level backstop for the org-private table specifically (defense in depth beyond app-level `WHERE org_id = ?` checks) — but note this repo's Neon HTTP driver has **no multi-statement transactions**, and the standard RLS pattern (`SET LOCAL app.current_org_id` inside a transaction, then a policy reading `current_setting()`) depends on setting a session/transaction-scoped variable before the query runs in the same transaction — that pattern does not map cleanly onto a single-statement-only driver. If RLS is pursued, it needs its own design spike to confirm it's compatible with Neon's HTTP driver constraints (e.g., a connection-pooled session-variable approach), not an assumed drop-in; if it isn't compatible, rely on the app-level check being genuinely singular and well-tested instead of assuming RLS as an automatic safety net.
- Resolve the backlog's own open questions (scope: per-org vs. platform-wide; what gets persisted; staleness policy for enrichment data) as explicit schema decisions *before* writing the write-path, not deferred to "we'll figure it out during implementation" — the access-control design depends directly on which of these is chosen.

**Warning signs:**
- A single new table with both `org_id` and enrichment/score/notes columns, where the "is this shared" question is answered by "well, org_id nullable means platform-wide" rather than a designed split.
- No test exercises "two different orgs encounter the same real-world supplier" and asserts what each org can and cannot see.
- Any new query against the repository table that doesn't route through a shared, reviewed access-check helper (i.e., ad hoc `SELECT * FROM supplier_repository WHERE ...` scattered across routes instead of one function everything calls).
- Star-rating (#9) implementation starts before #10's scope decision is finalized, forcing a rushed retrofit of ratings onto whatever shape #10 lands on.

**Phase to address:** Persistent Supplier Repository phase (Backlog #10) — this needs its own explicit data-model/access-control design step before any write-path code, and should be sequenced (per the backlog's own sequencing note) before or alongside Star Rating (#9), never after #9 ships independently. Verification: a specific cross-org test case (two distinct org contexts, one shared supplier, assert field-level visibility) should be a required part of this phase's acceptance criteria, not incidental.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Blind case-aware find/replace for the rename, applied to 100% of matches with no per-file review | Fast, mechanical, low effort | Silently corrupts security-relevant prompt semantics or leaves brand-inconsistent security prompts (Pitfall 1) | Only for pure UI copy/docs files with zero security-adjacent logic — never for `lib/agents.ts` or its tests |
| Reusing the per-event `suppliers` table's `org_id`-gated pattern directly for the new supplier repository | Ships fastest, matches existing code conventions | Cross-tenant data leak of org-private enrichment/notes/scores (Pitfall 4) | Never — the whole point of #10 is a data shape that doesn't fit the existing pattern |
| Hard-cutting all customers to new pricing tiers on deploy day with no grandfathering/migration logic | Simplest code, one `TIERS` array, no legacy branches | Existing paying customers hit resolution errors or unexpected re-bills at a different price/currency (Pitfall 2) | Only if the business has explicitly decided (and communicated to customers) that no grandfathering applies — must be a stated decision, not a default |
| Routing raw PDF/DOCX bytes through a single Next.js Route Handler for RFP parsing (matching the `/api/classify` pattern) | Reuses an existing, understood pattern; minimal new infrastructure | Hits Vercel's ~4.5MB body-size limit and timeout mismatches on real-world documents (Pitfall 3) | Only for a v1/demo with a hard, enforced, small file-size limit and clear user messaging — not for general-purpose RFP intake |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|-------------------|
| Stripe (pricing restructure) | Assuming a price change is "just update `monthlyEur`/env var" — forgetting existing subscriptions keep their old Stripe Price object until explicitly migrated, so display price and actual billed price silently diverge | Explicitly migrate existing subscriptions' Stripe Price objects (bulk or rolling, per Stripe's own migration tooling/guidance), don't rely on `lib/plans.ts` changes alone to affect already-created subscriptions |
| Stripe (pricing restructure) | Deleting old `STRIPE_PRICE_<TIER>_<CADENCE>` env vars for removed tiers immediately, before confirming zero active subscriptions reference them | Keep legacy price env vars/IDs resolvable until a query confirms no organization is still billed on that price |
| Clerk (SSO, Backlog #4) | Assuming SAML/Enterprise SSO is available on the current Clerk plan and scoping implementation before checking | Verify the Clerk dashboard plan tier supports Enterprise SSO connections first (explicit blocking open question already flagged in the backlog) — resolve before writing gating code |
| Vercel serverless (RFP parsing) | Assuming `maxDuration` alone controls what's possible, ignoring the separate ~4.5MB request body ceiling that applies regardless of duration | Design the upload path (client-direct-to-storage) and the timeout budget as two independent constraints, not one |
| Anthropic SDK (RFP parsing) | Assuming a single non-streaming call can both extract structured fields from a full document AND classify/categorize it in one shot within existing route conventions, without checking the model's actual context/latency behavior for large documents | Test with realistic (not toy) document sizes early, and decide before implementation whether extraction and classification are one call or two |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Repository dedup using only `normName`/`domainOf` string normalization at read time on every lookup, with no index | Slow "have we seen this supplier" checks as the repository grows | Add a proper unique/lookup index on the normalized name+domain columns in the new table from day one, since this check runs on every new investigation across every org | Noticeable once the repository holds low tens of thousands of supplier identities and every wave does a lookup per candidate |
| Treating stale enrichment data (contact info, AI score) in the shared repository as always-current | A 2026 contact scrape silently presented as current in a 2028 investigation (explicitly flagged as a risk in the backlog itself) | Persist a `last_verified_at`/staleness field per enrichment fact and re-verify (or flag as stale) past a defined age threshold before showing/reusing it | Becomes visible within months of the repository going live, worse the longer it runs unaddressed |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Assuming green tests after the rename mean the security-relevant prompt content was correctly updated | Stale/inconsistent anti-impersonation brand reference ships silently (Pitfall 1) | Manual grep + read-through of `lib/agents.ts` post-rename, independent of test suite results |
| Single shared access-check function for the new repository table that isn't consistently used by every new route/query | Cross-tenant leak of org-private supplier notes/scores (Pitfall 4) | One reviewed helper (mirroring `orgOwnsEvent`/`orgOwnsSupplier`) that every repository read/write path must call; add a lint/review checklist item for new queries against this table |
| Reusing `organizations.plan` string values without validating against a canonical, current tier list before any code path trusts them | Type/runtime errors or incorrect entitlement resolution for legacy-tier customers post-pricing-change (Pitfall 2) | Explicit `getTier()` fallback/legacy-mapping logic, tested against every historical `plan` value found in production data |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|------------------|
| RFP upload silently fails or times out on a realistic-sized document with only a generic error | Buyer thinks the feature is broken, abandons the intake flow entirely | Clear, specific feedback for size/format/timeout failures, distinct from a generic 500; ideally a progress indicator if extraction takes more than a couple seconds |
| Existing paying customers see a checkout/billing page reflecting only the new 3+1 tiers with no visibility into their current (grandfathered or migrated) plan | Confusion/support tickets ("why don't I see my plan anymore?", "why did my price change without warning?") | Billing UI explicitly shows the customer's current plan/price alongside the new tier options, with a clear explanation if their plan differs from the new catalog |
| Star rating (#9) shipped before the repository (#10) scope is settled, then later needs to migrate ratings from a per-event column to a cross-event entry | Buyers' existing ratings appear to "reset" or move unexpectedly once the repository ships | Sequence #10's scope decision before #9's schema, per the backlog's own recommendation — don't ship #9 independently first |

## "Looks Done But Isn't" Checklist

- [ ] **Brand rename:** Tests passing on `tests/prompt-injection-defense.test.ts` — verify the actual prompt *content* inside `lib/agents.ts` (not just the test's structural placeholder assertion) reflects the new brand name in the anti-impersonation and non-disclosure clauses.
- [ ] **Pricing restructure:** New `TIERS` array ships and checkout works for new signups — verify every existing organization's stored `plan` value still resolves via `getTier()` without throwing, and that Stripe subscriptions for existing customers were actually migrated (not just the code's default price catalog).
- [ ] **RFP document upload:** Feature works with a small test PDF in dev — verify it also handles a realistic multi-page/scanned document near the actual size limit, within the actual (not `classify`'s reused) timeout budget, on the actual deployed serverless runtime (not just local dev).
- [ ] **Supplier repository:** Dedup/write path works for a single org's investigations — verify a second org encountering the same real-world supplier sees only shared identity fields and cannot see the first org's enrichment notes, score, or contact data through any query path.
- [ ] **SSO (Backlog #4):** SSO login button renders — verify the underlying Clerk plan actually supports Enterprise SAML connections (confirmed in the Clerk dashboard, not assumed from the UI rendering).

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|-----------------|
| Stale brand string left in a security-relevant prompt (Pitfall 1) | LOW | Grep and patch `lib/agents.ts` directly; no data migration needed, just a code/prompt fix and redeploy |
| Existing customers orphaned by pricing restructure (Pitfall 2) | MEDIUM | Backfill `organizations.plan` to a valid new-or-legacy tier key via a one-off migration script; add the legacy tier back into `getTier()`'s resolvable set until backfill completes; communicate any price/currency change to affected customers |
| RFP upload failing on real documents in production (Pitfall 3) | MEDIUM | Swap to a serverless-compatible parsing library and/or move to direct-to-storage upload + explicit `maxDuration`; may require a follow-up deploy but no data-model change |
| Cross-tenant data leak in the supplier repository (Pitfall 4) | HIGH | Requires an access-control incident response (identify what leaked, to whom, for how long), a schema fix splitting shared identity from org-private data, and re-auditing every query path against the table — treat as a security incident, not a routine bugfix, if it reaches production |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| Blind/overcautious brand rename in security-relevant prompts | Rename phase (Backlog #1) | Manual read-through of `lib/agents.ts` + `tests/prompt-injection-defense.test.ts` post-rename, independent of automated test pass/fail |
| Orphaned legacy tier keys / EUR-USD migration gap | Pricing-restructure phase (Backlog #2) | Query production-shaped data for every distinct `organizations.plan` value and confirm `getTier()` resolves all of them; confirm Stripe subscription migration plan executed, not just code merged |
| Serverless body-size/timeout mismatch for document upload | RFP Matching phase (Backlog #7) | Test with a realistic, near-size-limit multi-page/scanned document on the actual deployed runtime before considering the phase done |
| Cross-tenant leak via shared supplier repository | Persistent Supplier Repository phase (Backlog #10) | Explicit two-org test case asserting field-level visibility split (shared identity visible, org-private data not) is a required acceptance check, not optional |

## Sources

- [Migrate subscriptions to Stripe Billing (Stripe official docs)](https://docs.stripe.com/billing/subscriptions/migrate-subscriptions)
- [Change the price of existing subscriptions (Stripe official docs)](https://docs.stripe.com/billing/subscriptions/change-price)
- [Migrate your subscriptions to Stripe (Stripe official docs)](https://docs.stripe.com/get-started/subscription-migrations)
- [Pros and Cons of Grandfathering a User's Pricing](https://blog.tier.run/pros-and-cons-of-grandfathering-a-users-pricing)
- [Process PDFs on Vercel: Reliable Serverless Guide](https://www.buildwithmatija.com/blog/process-pdfs-on-vercel-serverless-guide)
- [How to upload and store files with Vercel (Vercel Knowledge Base, official)](https://vercel.com/kb/guide/how-to-upload-and-store-files-with-vercel)
- [unpdf vs pdf-parse: I Switched After a 2AM Vercel Crash](https://chudi.dev/blog/serverless-pdf-processing-unpdf-vs-pdfparse)
- [Bypassing Vercel Serverless Timeouts with a Decoupled Document Ingestion Pipeline](https://earezki.com/ai-news/2026-05-30-how-i-bypassed-vercel-serverless-timeouts-to-build-a-decoupled-document-ingestion-pipeline/)
- [Shipping multi-tenant SaaS using Postgres Row-Level Security](https://www.thenile.dev/blog/multi-tenant-rls)
- [Multi-Tenant Data Isolation and Row Level Security (DZone)](https://dzone.com/articles/multi-tenant-data-isolation-row-level-security)
- [AWS Database Blog: Multi-tenant data isolation with PostgreSQL Row Level Security](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security)
- Direct code inspection: `lib/agents.ts` (INJECTION_DEFENSE block, outreach non-disclosure rules), `tests/prompt-injection-defense.test.ts`, `lib/plans.ts` (TierKey/TIERS), `lib/tenant.ts` (org isolation helpers), `lib/dedup.ts` (normName/domainOf), `lib/billing.ts` — this repository, 2026-08-15

---
*Pitfalls research for: B2B AI supplier-sourcing SaaS (SourceIQ → SourceGPT rebrand milestone)*
*Researched: 2026-08-15*
