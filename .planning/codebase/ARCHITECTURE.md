<!-- refreshed: 2026-08-15 -->
# Architecture

**Analysis Date:** 2026-08-15

## System Overview

SourceIQ is a Next.js-based AI supplier discovery platform that orchestrates a multi-agent pipeline to discover, qualify, and shortlist suppliers across global networks. The system centers on a streaming SSE (Server-Sent Events) discovery flow triggered from the UI through a central orchestrator agent that plans a wave of per-supplier processors, each running a tiered agent pipeline (scout → qualify → enrich → contact scrape) with background task scheduling.

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| **Orchestrator Route** | Entry point for discovery waves; manages event state, org rate limits, subscription gating, and SSE streaming | `app/api/orchestrate/route.ts` |
| **Orchestrator Agent** | Plans the search strategy (which agents to run, in what order, with what focus) | `lib/agents.ts` runOrchestrator() |
| **Scout Agent** | Discovers suppliers live via web search (Opus + adaptive thinking) | `lib/agents.ts` runScoutAgent() |
| **Classifier Agent** | Categorizes sourcing descriptions into commodity categories | `lib/agents.ts` runClassifierAgent() |
| **Qualifier Agent (2-tier)** | Fast JSON scoring (Haiku) with optional grounded verification (Sonnet + web_search) | `lib/agents.ts` runQualifierAgent() |
| **Enricher Agent** | Extracts business type, employee band, capabilities, certifications | `lib/agents.ts` runEnricherAgent() |
| **Contact Finder Agent** | Scrapes websites for contact email using Sonnet + web_search | `lib/agents.ts` runContactFinder() |
| **Process Supplier Factory** | Builds per-supplier processor: wraps agent calls, persists to DB, emits SSE events, schedules background tasks | `lib/process-supplier.ts` makeProcessSupplier() |
| **Database Layer** | Postgres via Neon; translates SQL dialects, manages schema, exposes async query interface | `lib/db.ts` |
| **Tenant Service** | Multi-tenant org context, event ownership validation, user isolation | `lib/tenant.ts` |
| **Billing Service** | Subscription checking, plan tier enforcement | `lib/billing.ts` |
| **Usage Tracking** | Token costs, wave/event/supplier quotas, spending ceilings | `lib/usage.ts` |
| **Contact Scraper** | HTTP fetch + heuristic parsing to find email & phone from supplier websites | `lib/contact.ts` |
| **Task Pool** | Manages concurrent background task scheduling (enrichment, contact scrape, follow-up) | `lib/task-pool.ts` |
| **Mail Service** | Constructs & sends transactional emails, handles unsubscribe tokens | `lib/mail.ts` |
| **Middleware** | Clerk-based auth, public route allowlist, referral cookie capture | `middleware.ts` |

## Pattern Overview

**Overall:** Multi-stage streaming pipeline with real-time agent-driven discovery, on-demand qualification, and background enrichment.

**Key Characteristics:**
- **Agent-centric:** Business logic delegated to Claude agents at different tiers (Haiku for cheap, Sonnet for balanced, Opus for reasoning)
- **Streaming-first:** SSE endpoint streams supplier discoveries in real-time as they're qualified (not waiting for enrichment)
- **Task-pool gated:** Background tasks run concurrently but capped to prevent LLM/network thundering
- **Tenant-isolated:** Every API route enforces org ownership of events/suppliers
- **Strongly gated:** All discovery/outreach enforces subscription checks, wave limits, spend ceilings, and per-org rate limits

## Layers

**Presentation Layer (React/Next.js Pages):**
- Purpose: UI surfaces for creating events, viewing supplier discoveries, managing outreach
- Location: `app/` (Next.js App Router structure)
- Contains: Page components, layouts, server-side redirects, client-side forms
- Depends on: API routes for data mutations; Clerk for auth; local storage for UI state

**API Routes Layer:**
- Purpose: HTTP handlers that enforce auth, billing, rate limits, then delegate to lib/ services
- Location: `app/api/`
- Contains: Next.js route handlers (POST/GET); request/response translation; error handling
- Depends on: `lib/` services, `lib/db.ts`, `lib/tenant.ts`, `lib/billing.ts`

**Business Logic Layer (lib/):**
- Purpose: Agent orchestration, supplier processing, data validation, external service integration
- Location: `lib/`
- Contains: `agents.ts` (agent definitions), `process-supplier.ts` (pipeline), domain services
- Depends on: Anthropic SDK, Neon Postgres driver, external APIs (Resend, Stripe, Svix)

**Data Access Layer:**
- Purpose: Postgres query abstraction and schema management
- Location: `lib/db.ts`
- Contains: SQL dialect translation, connection pooling, schema DDL, result wrapping
- Depends on: Neon serverless HTTP driver

## Data Flow

### Primary Request Path: Discovery Wave

1. Client sends wave request (`POST /api/orchestrate`) with `event_id`
2. Route validates auth & gates (subscription, wave limits, spend ceiling, rate limit)
3. Route loads event from DB, checks for stale runs (>5 min allows unlock)
4. Route runs Orchestrator Agent to plan the wave's search strategies
5. Route creates SSE stream and iterates through each agent focus:
   - Scout discovers candidates via web search (Opus + adaptive thinking)
   - Qualifier scores each candidate (Haiku fast or Sonnet grounded)
   - Insert & stream `supplier_found` event immediately on qualification
   - Background tasks: enrich (structured fields) and contact scrape (email)
   - Stream `supplier_updated` event when background tasks complete
6. Route awaits all background tasks before closing SSE stream
7. Client receives suppliers in real-time as they're qualified and enriched

### Category Classification Flow

1. Client types sourcing description in "New Event" form (debounced 900ms)
2. Route calls Classifier Agent to categorize description
3. Route returns category, subcategory, title, confidence
4. If confidence < 55, show selection prompt instead of auto-fill

### Supplier Outreach Flow

1. User clicks "Send Outreach" on a supplier card
2. Route enforces subscription + outreach-allowed check
3. Route acquires outreach lock (atomic claim via `lib/outreach-claim.ts`)
4. Outreach Agent drafts email in supplier's native language (Sonnet)
5. Email sent via Resend; supplier record updated with sent timestamp

**State Management:**
- **Event state:** `status` field (idle/scouting/outreach/reviewing) prevents concurrent waves; staleness check (>5 min) auto-unlocks crashed runs
- **Supplier state:** `funnel_stage` (long_list/contacted/responded/shortlisted/declined/engaged) plus enrichment and contact fields
- **Session state:** Clerk manages user auth; org context fetched per request via `lib/tenant.ts` getOrgContext()
- **Background tasks:** Pushed to Promise array, awaited at end of SSE stream (not polled)

## Entry Points

**Landing Page:**
- Location: `app/page.tsx`
- Triggers: Browser visit to `/`
- Responsibilities: Redirects signed-in users to `/dashboard`; shows marketing landing for anonymous visitors

**Dashboard:**
- Location: `app/dashboard/page.tsx`
- Triggers: Clerk session exists
- Responsibilities: Lists org's sourcing events, recent waves, referrals, onboarding checklist

**New Event Form:**
- Location: `app/events/new/page.tsx`
- Triggers: User clicks "New Event"
- Responsibilities: Captures sourcing description, geography, advanced filters, calls classifier, creates event

**Event Detail:**
- Location: `app/events/[id]/page.tsx`
- Triggers: User clicks event in list
- Responsibilities: Lists suppliers by funnel stage, launches waves, drafts outreach

**API: Orchestrate (Discovery Wave):**
- Location: `app/api/orchestrate/route.ts` (POST)
- Triggers: User clicks "Run Discovery" or "Deepen"
- Responsibilities: SSE endpoint; enforces gates; orchestrates full agent pipeline with streaming

**API: Classify:**
- Location: `app/api/classify/route.ts` (POST)
- Triggers: User pauses in description field (900ms debounce)
- Responsibilities: Returns category/subcategory/title suggestion

**API: Outreach:**
- Location: `app/api/outreach/route.ts` (POST)
- Triggers: User clicks "Send Outreach" or "Follow Up"
- Responsibilities: Drafts email in supplier's language, optionally sends via Resend

**Webhook: Stripe Events:**
- Location: `app/api/stripe/webhook/route.ts` (POST)
- Triggers: Stripe sends subscription events
- Responsibilities: Creates/updates org subscription, enforces billing state

**Webhook: Inbound Email Replies (Svix):**
- Location: `app/api/inbound/route.ts` (POST)
- Triggers: Supplier replies to SourceIQ outreach email
- Responsibilities: Logs reply, parses intent, updates supplier funnel stage

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop. LLM calls are async-awaited (non-blocking). Background tasks concurrent but capped by task pool.
- **Global state:** Neon connection singleton in `lib/db.ts` (initialized lazily). No mutable module-level singletons.
- **Circular imports:** None. Imports flow: routes → lib services → agents.ts, db.ts → external APIs.
- **Request timeouts:** Routes set `maxDuration` (60s for classify, 300s for orchestrate) because Vercel enforces 30s default.
- **Database transactions:** Neon HTTP driver does not support multi-statement transactions. Atomicity at single-statement level.
- **Supplier isolation:** Every supplier has `event_id`; every event has `org_id`. Queries always filter by both.
- **Prompt injection:** Agents ingesting `web_search` results or supplier-provided content include explicit INJECTION_DEFENSE (#61) in prompts.

## Anti-Patterns to Avoid

### Not Checking Subscription Before Expensive LLM Calls

**What happens:** Free-tier user could call expensive routes without subscription, costing hundreds in LLM.

**Why it's wrong:** Billing bypass; uncontrolled spend.

**Do this instead:** (Already implemented) `requireSpendableSubscription` gate at start of every expensive route.

### Allowing Concurrent Waves on Same Event

**What happens:** Overlapping POST /api/orchestrate requests race writes to suppliers table and event status.

**Why it's wrong:** Data corruption; duplicate suppliers; inconsistent state.

**Do this instead:** (Already implemented) Check event.status and staleness. Return 409 if run in progress and <5 min old.

### Trusting Client Wave Numbers for Quota Enforcement

**What happens:** Client-supplied wave number used for quota checking lets callers bypass limits.

**Why it's wrong:** Unenforceable plan limits.

**Do this instead:** (Already implemented) Compute wave count server-side from persisted event row.

## Error Handling

**Strategy:** Fail fast with clear, actionable error codes.

**Patterns:**
- **Auth errors:** 401 Unauthorized
- **Billing errors:** 402 Payment Required with specific code (subscription_required, wave_limit_exceeded)
- **Rate limits:** 429 Too Many Requests with Retry-After header
- **Not found:** 404 (org doesn't own resource)
- **Conflict:** 409 (run already in progress)
- **Bad request:** 400 (invalid input)

## Cross-Cutting Concerns

**Logging:** console.log + structured metadata to observability backend via `lib/observability.ts`.

**Validation:** Input validation at route level (required fields, type checks); business rule validation in lib/ services.

**Authentication:** Clerk middleware enforces session on all protected routes.

**Tenant isolation:** Every route starts with getOrgContext() or orgOwnsEvent/orgOwnsSupplier checks.

**Rate limiting:** IP + user ID dual limits on stateless routes (classify); org ID on stateful routes (orchestrate).

**Cost tracking:** Every agent call recorded via observability. Plan enforcement reads accumulated cost to prevent overspend.

---

*Architecture analysis: 2026-08-15*
