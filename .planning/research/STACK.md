# Stack Research

**Domain:** New-work additions to a live Next.js 14 / React 19 / TypeScript / Neon Postgres / Clerk / Stripe / Anthropic SaaS (SourceIQ → SourceGPT rebrand milestone)
**Researched:** 2026-08-15
**Confidence:** MEDIUM-HIGH (mix of official vendor docs — HIGH — and third-party synthesis/aggregator sources — MEDIUM; flagged per item below)

This document covers **only the four backlog items with open stack questions**: (7) RFP document intake parsing, (5) support chatbot build-vs-buy, (4) Clerk SSO/SAML, (10) persistent deduped supplier repository. Items #1, #2, #3, #6, #8, #9 need no new stack — they use the existing Next.js/Stripe/Clerk/Postgres primitives already in place.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Claude native PDF document blocks (existing `@anthropic-ai/sdk`) | SDK already at 0.116.0 — no upgrade needed; PDF support is GA, not beta | Extract structured RFP fields directly from an uploaded PDF | Anthropic's Messages API accepts inline base64 PDF (`type: "document"`, `media_type: "application/pdf"`) as a **generally-available** feature (no beta header required) — it rasterizes each page to an image *and* extracts the text layer, so Claude reads tables, headers, and scanned/low-text-layer pages natively. This reuses the exact SDK the pipeline already calls for classify/scout/qualify — no new provider, no separate OCR step. Confidence: HIGH (Claude Platform Docs, official). |
| `mammoth` | 1.12.1 | Extract raw text from `.docx` RFP uploads before sending to Claude | Claude's document understanding is **PDF-only** — DOCX is not a supported native media type on the Messages/Files API. `mammoth.extractRawText()` is the standard, actively-maintained (updated within days of this research) pure-JS way to pull text out of a `.docx` on Node without native/canvas dependencies, so it runs cleanly in Vercel's serverless functions. Feed the extracted text into the same Claude extraction prompt as a `text` content block, keeping one downstream extraction code path for both file types. Confidence: HIGH (npm listing + maintained GitHub repo). |
| Clerk **Enterprise Connections** (built into existing `@clerk/nextjs` 5.7.6) | No new package — dashboard configuration + `authenticateWithRedirect({ strategy: "enterprise_sso" })` in sign-in UI | SSO/SAML login alongside email/password | This is a Clerk Dashboard/API feature of the SDK version already installed, not a new library. Clerk's Enterprise SSO supports both SAML 2.0 and OIDC through one unified "Enterprise Connections" abstraction — you configure the IdP per organization/domain in the Dashboard (ACS URL + Entity ID for SAML, Client ID/secret + discovery URL for OIDC) and expose a "Continue with SSO" option in the existing `<SignIn/>` flow. Confidence: HIGH (Clerk official docs). |
| `pg_trgm` (built-in Postgres extension, available on Neon) | Postgres core contrib, no npm package | Fuzzy-match supplier/company names for the cross-investigation dedup repository | Trigram similarity scoring (`similarity()`, `%` operator) is the standard first-line approach for name-based entity dedup in Postgres — real-world benchmarks cited find it resolves ~99% of duplicates at ~99% precision when combined with a hard key (domain), and it's index-backed (GIN) so it stays fast at scale. Needs zero new infra since it ships with Postgres and Neon already exposes `CREATE EXTENSION`. Confidence: MEDIUM-HIGH (multiple independent practitioner sources + is genuinely a documented Postgres contrib module, not exotic). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `unpdf` | 1.8.0 | Lightweight PDF text/metadata extraction (no Claude call) | Only if you need a **cheap pre-check** before spending a Claude call — e.g. validating page count/size limits (Claude's document API caps at 100 pages / 32MB), detecting empty/corrupt uploads, or extracting a quick preview snippet for the UI while the real extraction call runs async. It is a maintained, zero-native-dependency wrapper around `pdf.js` built specifically for serverless/edge runtimes (Vercel, Lambda, Workers) — unlike `pdf-parse`, which is unmaintained and pulls in `pdfjs-dist`'s optional native `canvas` dependency that silently breaks in Vercel's build environment. Do not use it for the actual field extraction — that's Claude's job, since it understands layout/tables better than raw text dumps. |
| `office-text-extractor` | 4.x | Alternative single-package wrapper for docx/pptx/xlsx/pdf text extraction | Only consider if the RFP intake scope later expands to `.pptx`/`.xlsx` briefs too. For the current PDF+DOCX-only scope, prefer the native-Claude-PDF + `mammoth`-DOCX split above — it's simpler to reason about and gives PDFs the benefit of Claude's vision-assisted layout understanding, which a text-only extractor throws away. |
| `ai` (Vercel AI SDK) + `@ai-sdk/anthropic` | `ai` 6.x / `@ai-sdk/anthropic` latest | Optional streaming-chat scaffolding for the support widget, if you want a prebuilt `useChat` hook UI | Only pull this in if you want to move fast on chat UI ergonomics (built-in streaming state, message history, retry/stop controls) and are fine adding a second AI-call abstraction alongside the existing raw `@anthropic-ai/sdk` usage in `lib/agents.ts`. See "Alternatives Considered" below — the recommended default is to **not** add this and instead reuse the existing SSE-streaming pattern already built for the discovery pipeline. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Neon `pg_trgm` GIN index | Speed up fuzzy supplier-name lookups | `CREATE EXTENSION IF NOT EXISTS pg_trgm;` then `CREATE INDEX ... USING gin (normalized_name gin_trgm_ops);` — run as its own migration; Neon supports standard Postgres contrib extensions. |
| Clerk Dashboard "Enterprise Connections" panel | Configure SAML/OIDC per customer | No code changes needed to add a connection — the code change is only in exposing the SSO entry point in the sign-in UI and (optionally) auto-redirecting known-SSO email domains. |

## Installation

```bash
# RFP intake (item 7)
npm install mammoth unpdf

# Support widget — only if building in-house streaming UI with the AI SDK
# (skip entirely if reusing existing @anthropic-ai/sdk SSE pattern, see below)
npm install ai @ai-sdk/anthropic

# SSO (item 4) — no install; feature of already-installed @clerk/nextjs 5.7.6
# Supplier repository dedup (item 10) — no npm install; Postgres extension via SQL migration
```

## Alternatives Considered

### (a) RFP/brief document parsing

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| Claude native PDF document block (inline base64, GA) | Anthropic **Files API** (`client.beta.files.upload()`, beta header `files-api-2025-04-14`) | Use Files API instead of inline base64 only if the *same* uploaded RFP will be referenced across multiple separate Claude calls (e.g. re-extract, then later re-summarize) and you want to avoid re-uploading/re-encoding the file each time. For a single intake-and-extract flow (this milestone's actual use case), inline base64 is simpler and avoids depending on a still-beta endpoint. |
| Claude native PDF for the PDF path | Dedicated OCR/parsing service (AWS Textract, Google Document AI, LlamaParse, Unstructured.io) | Only worth the added vendor/infra if RFPs are frequently low-quality scans where Claude's vision-assisted reading still under-extracts, or if you need bounding-box/coordinate-level extraction (e.g. for a visual PDF annotation UI). Not justified for a first-cut "extract fields to pre-fill a form" use case — adds a second vendor bill and integration surface for marginal gain. |
| `mammoth` for DOCX text extraction | `docx` npm package | `docx` is a *generation* library (build .docx from scratch), not an extraction library — don't reach for it here; it solves the opposite problem. |
| `mammoth` for DOCX text extraction | `pdf-parse` for either format | Avoid `pdf-parse` — it's unmaintained and its `pdfjs-dist` dependency chain has an optional native `canvas` binding that breaks silently in Vercel's serverless build. Confirmed by multiple independent 2025/2026 postmortems of exactly this failure mode. |

### (b) Support/help chatbot: build vs. buy

**Buy (vendor) options, ranked by fit:**

| Vendor | Pricing (as researched, 2026) | Fit for this product |
|--------|-------------------------------|------------------------|
| **Crisp** | Flat per-workspace pricing from ~$45/mo, genuinely usable free tier | Best "buy" fit if the goal is a real shared inbox + human-in-the-loop support (not just an FAQ bot) and you want predictable flat pricing rather than per-seat/per-resolution billing. Has an AI chatbot add-on. |
| **Chatwoot** | Cloud from $19/agent/mo, or self-host (~$25-95/mo infra + ongoing maintenance) | Open-source, MIT-licensed, can be self-hosted to avoid recurring vendor cost — but AI capabilities are less mature than Intercom's Fin, and self-hosting adds real operational overhead (setup ~4-16 hrs, ~2-4 hrs/mo maintenance) that isn't justified unless you specifically want to own the data/infra. |
| **Intercom (Fin AI)** | Seats $29-132/mo/seat **plus** $0.99 per AI-resolved conversation (outcome-based) | Powerful but pricing is compounding and hard to forecast at scale — a poor fit for an early-stage SaaS wanting predictable support cost, and seat pricing assumes a human support team, which this product may not yet have. |
| **Zendesk** | Full suite (chat included) starts at $115/mo/agent; the $19/agent tier has no chat widget | Enterprise-grade ticketing suite — significant overkill and cost for a "help widget," not recommended at this stage. |

**Build (in-house) recommendation — primary recommendation for this milestone:**

Build a lightweight widget reusing the **existing `@anthropic-ai/sdk` client and the SSE-streaming pattern already implemented for the discovery pipeline** (per `PROJECT.md`: "Streaming (SSE) discovery wave with real-time supplier results" already exists). Concretely:
- A small API route (e.g. `app/api/support-chat/route.ts`) that streams a Claude response the same way the orchestrator streams discovery events — same SDK, same SSE infrastructure, no new provider or billing surface.
- A system prompt seeded with static product-FAQ/help content (README-style docs, pricing-tier descriptions, common troubleshooting) — no vector DB or RAG needed at this scope; a well-curated system prompt is sufficient for a help widget answering "what does X do" / "how do I do Y" questions.
- Gate the in-app instance behind Clerk (personalize with org/plan context); keep the public-site instance anonymous with a narrower system prompt (no account-specific data).

This is the recommended default because it (1) avoids a second vendor bill and a second AI-integration surface at a time the org is also mid-pricing-restructure, (2) reuses proven patterns/infra already in the codebase (satisfies the project's own constraint: "new features should follow existing patterns... rather than introducing a parallel stack"), and (3) is scoped correctly for "answer product questions," which is what the backlog item actually asks for — not full ticketing/shared-inbox functionality.

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| Raw `@anthropic-ai/sdk` + existing SSE pattern for in-house build | Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) `useChat` hook | Use the AI SDK instead if the team wants faster time-to-ship on chat *UI* ergonomics (built-in message-list state, stop/retry, multi-provider portability) and is comfortable running two parallel AI-call abstractions in the codebase. Not recommended as the default here purely for consistency with the existing codebase pattern, but it's a reasonable, well-supported alternative if UI velocity matters more than stack minimalism. |
| In-house build (any vendor deferred) | Crisp (buy) | Switch to "buy" if/when actual human support ticket volume grows enough that a shared inbox, canned responses, and multi-channel (email/WhatsApp) routing become necessary — that's a genuine product need an LLM widget doesn't solve, and Crisp's flat pricing keeps the switch-over cost bounded. |

### (c) Clerk SSO/SAML enterprise connections

**Plan requirement (directly resolves the open question flagged in PROJECT.md):** Enterprise SSO is **not** gated behind a separate "Enterprise" SKU — it is available starting on Clerk's **Pro plan** ($20/mo base), which includes **one free Enterprise Connection**. Additional connections are metered: $75/mo each for connections 2-15, with volume discounts at higher counts ($60 for 16-100, $30 for 101-500, $15 for 500+). Confidence: HIGH (Clerk's own pricing/articles pages, cross-checked across two independent Clerk-published sources).

**Technical requirements:**
- Protocol support: both **SAML 2.0** and **OIDC** through one unified "Enterprise Connections" feature — same Dashboard workflow for either.
- Setup is Dashboard-driven, not code-driven: for SAML, you retrieve the ACS URL + Entity ID from Clerk's Service Provider config and hand them to the customer's IdP admin (Google Workspace and Microsoft Entra ID have documented step-by-steps); for OIDC, you configure Client ID/secret + discovery URL.
- Domain matching: the authenticating user's email domain must exactly match the domain configured on the SSO connection; **subdomains are not matched by default** — enabling "Allow subdomains" requires the connection domain to be an eTLD+1 (i.e., a proper base domain, not e.g. `app.customer.com`).
- Constraint to flag for planning: a domain used for an Enterprise SSO connection **cannot simultaneously be a Verified Domain** on the same organization, and domain ownership cannot overlap between an SSO connection and a plain verified-domain enrollment — this affects how existing org domain-verification (if any) interacts with SSO rollout and should be checked against current Clerk org config before implementation.
- Code-side change is comparatively small: expose an SSO entry point in the sign-in flow (`authenticateWithRedirect({ strategy: "enterprise_sso" })` or Clerk's built-in `<SignIn/>` component, which already supports rendering an SSO option once a connection exists) — most of the actual work is per-customer IdP configuration, not application code.

### (d) Durable, deduped "known entities" data store on Postgres

**Pattern recommendation for the cross-investigation supplier repository:**

1. **Canonical entity table** (`suppliers` or similar): one row per real-world supplier, keyed primarily by a **normalized domain** (lowercased, stripped of protocol/`www.`) — domain is a far more reliable dedup key than company name, since names vary (legal suffixes, abbreviations, rebrands) while a company's primary domain is comparatively stable.
2. **Fuzzy fallback for name-only matches**: for suppliers discovered without a clean domain, use `pg_trgm` trigram similarity (`similarity(name, existing_name) > threshold`) as a secondary matching pass. Recommend a similarity threshold around **0.4-0.5** rather than pg_trgm's default 0.3 — the default is tuned for general fuzzy search, not entity resolution, and a higher bar reduces false-positive merges of genuinely different companies with similar names.
3. **Atomic upsert, not check-then-insert**: use a single `INSERT ... ON CONFLICT (normalized_domain) DO UPDATE ... RETURNING id` statement to find-or-create the canonical record. This is both (a) the standard best practice for dedup tables generally (avoids TOCTOU races under concurrent writers) and (b) **required** by this codebase's existing constraint that Neon's HTTP driver has no multi-statement transactions — a separate `SELECT` then conditional `INSERT` across two round-trips cannot be made atomic here, so the single-statement upsert is the only safe pattern available.
4. **Separate join/sighting table** (`supplier_sightings` or `supplier_event_links`): links canonical supplier rows to the events/investigations that discovered or referenced them (quick-scan, full investigation, future RFP-matching), preserving per-event enrichment context (verification status, contact details found in that run) without duplicating or overwriting the canonical record's core identity fields. This is what makes the store genuinely "cross-investigation" rather than a rename of the existing per-event supplier table.
5. Star ratings (backlog #9) attach naturally to the canonical entity row (or a `supplier_ratings` table keyed to it) once this repository exists — confirming the backlog's own stated dependency of #9 on #10.

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| `pg_trgm` + domain-key upsert (built into Postgres) | `pgvector` + embedding similarity for company-name matching | Consider as a v2 enhancement only if trigram matching proves insufficient in practice (e.g. heavy abbreviation/rebrand variance not caught by character-level trigrams) — adds a new extension, an embedding-generation step (cost + latency per new supplier), and index-maintenance overhead not justified for a first cut at platform scale (likely thousands, not millions, of supplier rows). |
| In-database dedup (pg_trgm) | Standalone entity-resolution service/library (Dedupe.io, Splink) | These are Python-first tools built for large-scale offline dedup batch jobs — wrong runtime for this Next.js/TypeScript serverless stack and unjustified operational complexity at this data scale. Don't introduce a second language/runtime for this. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `pdf-parse` | Unmaintained; depends on `pdfjs-dist`'s optional native `canvas` binding, which fails to compile in Vercel's serverless build environment (multiple 2025/2026 postmortems confirm this exact failure mode) | Claude native PDF document blocks for extraction; `unpdf` if a separate lightweight text-only pre-check is needed |
| A dedicated OCR/document-AI vendor (Textract, Document AI, LlamaParse) for the first cut of RFP intake | Adds a second vendor bill and integration surface before it's established that Claude's native PDF reading is insufficient for real RFP documents | Ship with Claude native PDF blocks first; revisit only if extraction accuracy on real customer RFPs proves inadequate |
| Intercom Fin's outcome-based pricing as the default "buy" choice | Per-resolution billing ($0.99/conversation) compounds unpredictably with usage and assumes a seat-based human support team model this product doesn't yet have | Crisp (flat, predictable) if buying; in-house Claude-backed widget (recommended) if not |
| Standalone Python entity-resolution tooling (Dedupe.io, Splink, Zingg) for the supplier repository | Wrong runtime for this all-TypeScript/Next.js stack; introduces a second language and batch-job infrastructure not justified at this data scale | `pg_trgm` + domain-key upsert, entirely inside existing Postgres/Neon |
| Anthropic **Files API** as the default path for one-shot RFP extraction | Still beta (`files-api-2025-04-14` header), and its main benefit — avoiding re-upload for repeat reference to the same file — doesn't apply to a single extract-once-and-discard intake flow | Inline base64 PDF document block on the standard (GA) Messages API |

## Stack Patterns by Variant

**If the uploaded RFP is a PDF:**
- Send it directly to Claude as an inline base64 `document` content block in the same extraction call already used for classify/scout-style structured extraction elsewhere in the pipeline.
- Optionally pre-validate with `unpdf` (page count ≤ 100, size ≤ 32MB after encoding) before the Claude call, to fail fast with a clear UI error rather than a rejected API call.

**If the uploaded RFP is a DOCX:**
- Extract raw text with `mammoth.extractRawText()`, then send that text as a plain `text` content block into the identical extraction prompt used for the PDF path — keep one prompt/one output schema regardless of source file type.

**If the support widget needs account/plan context (in-app instance):**
- Gate the API route with existing Clerk session/org middleware (same pattern as other authenticated API routes) and inject org/plan-tier context into the system prompt; keep the public-site instance's system prompt free of any customer-specific data.

**If dedup false-positives become a real problem (name+domain matching a different real company):**
- Add a `pgvector` embedding-similarity pass as a secondary signal before promoting a record to auto-merge — but only after confirming trigram+domain matching alone is producing measurable bad merges in practice, not preemptively.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@anthropic-ai/sdk@0.116.0` (existing) | Claude PDF document blocks (GA) | No SDK upgrade required — inline base64 PDF support is part of the standard Messages API surface, not a beta-gated SDK feature. |
| `@anthropic-ai/sdk@0.116.0` (existing) | Files API (`client.beta.files`) | Available if needed later, but requires the `anthropic-beta: files-api-2025-04-14` header and is still beta — treat as optional, not default. |
| `mammoth@1.12.1` | Node.js (any current LTS), Vercel serverless functions | Pure JS, no native dependencies — safe in the same runtime the rest of this app already runs in. |
| `@clerk/nextjs@5.7.6` (existing) | Enterprise Connections (SSO/SAML/OIDC) | Feature of the Clerk platform/plan, not gated by the installed SDK's minor version — no SDK upgrade implied by enabling SSO, only Dashboard configuration + a small sign-in UI change. |
| `pg_trgm` | Neon serverless Postgres | Standard Postgres contrib extension; Neon supports `CREATE EXTENSION` for common contrib modules including `pg_trgm` — verify availability on the specific Neon plan/branch before relying on it, as a fast pre-implementation check. |

## Sources

- [PDF support - Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/pdf-support) — HIGH confidence, official; verified GA status and page/size limits for inline PDF document blocks.
- [Files API - Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/files) — HIGH confidence, official; verified beta status and header requirement.
- [mammoth npm listing](https://www.npmjs.com/package/mammoth) — HIGH confidence; verified current version (1.12.1) and `extractRawText` API.
- [unpdf on npm / GitHub (unjs/unpdf)](https://www.npmjs.com/package/unpdf) — HIGH confidence; verified current version (1.8.0), zero-native-dependency serverless design.
- ["Using pdf-parse on Vercel Is Wrong" — DEV Community](https://dev.to/chudi_nnorukam/serverless-pdf-processing-why-unpdf-beats-pdf-parse-2jji) — MEDIUM confidence (practitioner blog, but corroborated by a second independent postmortem); used to confirm the `pdf-parse` serverless failure mode.
- [Clerk Pricing](https://clerk.com/pricing) and [The real cost of enterprise SSO: per-connection vs per-MAU pricing (Clerk articles)](https://clerk.com/articles/the-real-cost-of-enterprise-sso-per-connection-vs-per-mau-p-3) — HIGH confidence, official Clerk sources; verified Pro-plan inclusion of 1 free Enterprise Connection and per-connection overage pricing/volume discounts.
- [Enterprise Single Sign-On (SSO) - Enterprise connections | Clerk Docs](https://clerk.com/docs/guides/configure/auth-strategies/enterprise-connections/overview) and [SAML custom-provider / Google / Azure guides (Clerk Docs)](https://clerk.com/docs/guides/configure/auth-strategies/enterprise-connections/saml/custom-provider) — HIGH confidence, official; verified SAML+OIDC unified handling, ACS URL/Entity ID exchange, domain-matching and subdomain/eTLD+1 rules.
- [Intercom, Zendesk, Crisp, Chatwoot pricing comparisons — crisp.chat, featurebase.app, easychatdesk.com, chatwoot.com](https://crisp.chat/en/comparisons/intercom-vs-zendesk/) — MEDIUM confidence (vendor-adjacent/comparison-site sources, cross-checked across 3+ independent pages for consistent pricing figures as of 2026).
- [Fuzzy Matching in PostgreSQL: Taming Messy Text With pg_trgm — Medium](https://medium.com/@techybob/fuzzy-matching-in-postgresql-taming-messy-text-with-pg-trgm-bc3af9335f2f) and [Entity Resolution in Postgres: Trigrams vs Embeddings](https://concepttocloud.com/news/entity-resolution-in-postgres-trigrams-vs-embeddings) — MEDIUM confidence (practitioner sources, internally consistent with official Postgres `pg_trgm` documentation behavior); used for real-world precision/recall figures and threshold guidance.
- [Vercel AI SDK 6.0 coverage — dev.to, tech-insider.org](https://dev.to/bean_bean/the-ultimate-guide-to-building-ai-powered-web-apps-with-the-vercel-ai-sdk-in-2026-1c6a) — MEDIUM confidence (aggregator/tutorial sources); used only to characterize the AI SDK as an alternative, not the recommended default.

---
*Stack research for: SourceGPT milestone — RFP intake parsing, support chatbot build-vs-buy, Clerk SSO/SAML, supplier-repository dedup*
*Researched: 2026-08-15*
