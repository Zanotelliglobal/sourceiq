<!-- GSD:project-start source:PROJECT.md -->

## Project

**SourceGPT**

SourceGPT is a Next.js-based, multi-tenant AI supplier-discovery platform: buyers
describe a sourcing need, a multi-agent pipeline (scout → qualify → enrich → contact
scrape) discovers, verifies, and shortlists real-world suppliers via live web search,
and buyers can then run outreach campaigns to the shortlist directly from the app.
A faster, unverified "Quick Investigation" mode also exists alongside the full,
verified pipeline. The product was renamed from SourceIQ to **SourceGPT**.

**Core Value:** Buyers get a vetted, real supplier shortlist for a sourcing need faster than manual
research would produce — and can act on it (outreach) without leaving the app.

### Constraints

- **Rename sequencing**: the product was renamed from SourceIQ to SourceGPT
  (backlog #1) before other backlog items landed, so new copy/code lands under the
  final name instead of being renamed twice — explicit sequencing decision from the
  source document.

- **Tech stack**: Next.js/TypeScript/Neon Postgres/Clerk/Stripe/Anthropic SDK — new
  features should follow existing patterns (agent tiers in `lib/agents.ts`, gated API
  routes, `lib/tenant.ts` org isolation) rather than introducing a parallel stack.

- **Serverless request timeouts**: Vercel enforces short defaults (60s classify, 300s
  orchestrate `maxDuration`) — any new long-running work (e.g. RFP document parsing)
  must fit within or route around this.

- **No multi-statement DB transactions**: Neon's HTTP driver limits atomicity to
  single statements — new schema/write-path work (e.g. the supplier repository) must
  design around this.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- TypeScript 5 - All server and client code
- JSX/TSX - React components
- JavaScript - Build configuration (next.config.mjs, postcss.config.mjs, tailwind.config.ts uses tsx)

## Runtime

- Node.js (version requirement inferred from typescript package)
- npm
- Lockfile: `package-lock.json` (standard npm lockfile, not committed to version control per Next.js conventions)

## Frameworks

- Next.js 14.2.35 - Full-stack React framework with API routes, SSR, and edge functions
- React 19 - UI library
- React DOM 19 - DOM rendering
- Vitest 2.1.9 - Unit test runner configured for Node environment, tests in `tests/` directory
- TypeScript 5 - Compiler and type checking
- ESLint 8 with @typescript-eslint/eslint-plugin 8.66.0 - Code linting
- Tailwind CSS 3.3.0 - Utility-first CSS framework
- PostCSS 8 - CSS transformations (autoprefixer 10.5.4)

## Key Dependencies

- @anthropic-ai/sdk 0.116.0 - Claude API client for agentic sourcing workflows
- @clerk/nextjs 5.7.6 - Authentication and user/org management
- @neondatabase/serverless 1.1.0 - Serverless Postgres driver (HTTP-based, avoids WebSocket issues in serverless)
- stripe 22.4.0 - Payment processing and subscription billing
- ws 8.21.3 - WebSocket support (for client-side or fallback connections)
- @types/ws 8.18.1 - Type definitions for WebSocket
- xlsx 0.18.5 - Excel spreadsheet generation and parsing
- jspdf 4.2.1 - PDF document generation
- jspdf-autotable 5.0.8 - Table plugin for jsPDF
- lucide-react 1.30.0 - Icon library

## Configuration

- Next.js configuration: `next.config.mjs` - Security headers setup (SAMEORIGIN, CSP headers noted as future work)
- TypeScript: `tsconfig.json` - Strict mode enabled, path alias `@/*` maps to repository root
- Linting: `.eslintrc.json` - Extends Next.js core-web-vitals with @typescript-eslint rules
- Tailwind CSS: `tailwind.config.ts` - Utility styling
- PostCSS: `postcss.config.mjs` - CSS processing pipeline
- `DATABASE_URL` / `POSTGRES_URL` / `NEON_DATABASE_URL` - Postgres connection string
- `ANTHROPIC_API_KEY` - Claude API authentication
- `STRIPE_SECRET_KEY` - Stripe billing API key
- `CLERK_INSTANCE_ID` / Clerk environment variables - Authentication
- `OUTREACH_LIVE` - Master safety switch for live email sending
- `MAIL_PROVIDER` - Email provider selection
- `MAIL_FROM`, `MAIL_INBOUND_DOMAIN`, `MAIL_POSTAL_ADDRESS` - Email configuration
- `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` - Resend email provider
- `SENTRY_DSN` - Error tracking
- Performance/feature flags: `QUALIFIER_GROUNDING`, `SCOUT_AGENT_TIMEOUT_MS`, `SCOUT_CONCURRENCY`, `OUTREACH_CONCURRENCY`, `QUAL_CONCURRENCY`, `BACKGROUND_TASK_CONCURRENCY`, `UNLIMITED_TIER_WAVE_SUPPLIER_CAP`

## Platform Requirements

- Node.js with npm
- Postgres database (local sqlite3 during development, Neon serverless in production)
- No WebSocket support in bundled packages (uses @neondatabase/serverless HTTP driver instead)
- Vercel (or any Node.js-compatible serverless platform)
- Neon PostgreSQL (serverless, HTTP-based)
- Anthropic API (Claude models)
- Clerk authentication infrastructure
- Stripe for billing
- Resend for email delivery (optional, app degrades gracefully if not configured)

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- Kebab-case for file names: `lib/process-supplier.ts`, `lib/outreach-claim.ts`, `components/ConfirmDialog.tsx`
- React/Next.js files use PascalCase for component exports: `RfiForm.tsx`, `AppShell.tsx`, `LanguageProvider.tsx`
- Utilities and modules use camelCase or kebab-case: `lib/search.ts`, `lib/billing.ts`
- API route files follow Next.js convention: `app/api/[feature]/route.ts` (e.g., `app/api/qualify/route.ts`, `app/api/outreach/route.ts`)
- camelCase for all functions and async functions: `getStripe()`, `isBillingConfigured()`, `requireActiveSubscription()`, `likeEscape()`, `buildChecklistState()`
- Getter functions use `get` prefix: `getDb()`, `getStripe()`, `getOrgContext()`
- Factory/maker functions use `make` prefix: `makeProcessSupplier()`
- Predicate functions use `is`/`check`/`require` prefix: `isBillingConfigured()`, `isExplicitlyCompletable()`, `requireActiveSubscription()`, `checkOutreachAllowed()`
- Utility converters/transformers use descriptive names: `likeEscape()`, `likeContains()`, `toPg()`, `priceIdFor()`
- camelCase for local variables and parameters: `connectionString`, `lastInsertRowid`, `organizationId`
- UPPER_SNAKE_CASE for module-level constants: `UNLIMITED`, `ACTIVE_STATUSES`, `SPEND_GATED_STATUSES`, `ENV_KEYS`, `FUNNEL_STAGES`, `CHECKLIST_TASKS`
- Private fields in classes use underscore prefix: `private text: string` (no double underscore; TypeScript's private visibility used instead)
- Destructured variables match source: `{ ok, reason }` from result objects, `{ id, name, ...overrides }` from params
- PascalCase for all type/interface names: `Organization`, `Tier`, `GateResult`, `ChecklistState`, `ConfirmDialogProps`, `ProcessSupplierDeps`
- Type exports use explicit `export type` keyword: `export type TierKey = "free" | "basic" | ...`
- Union types are inline when simple: `"active" | "trialing" | "past_due"`
- Complex object types use interfaces or named types: `type Db = ReturnType<typeof getDb>`

## Code Style

- No Prettier config in repo; style is enforced via ESLint
- 2-space indentation (Next.js/React convention)
- Semicolons required at end of statements (TypeScript strict mode)
- Lines break after `{` in function bodies, not before
- ESLint configuration: `.eslintrc.json`
- Extends `next/core-web-vitals` config
- Plugins: `@typescript-eslint`
- Rule: `@typescript-eslint/no-explicit-any` set to `warn` (discouraged but not blocked)
- Run with: `npm run lint`
- Strict mode enabled in `tsconfig.json`
- Path alias `@/*` maps to project root (allows `import { x } from "@/lib/..."` instead of relative paths)
- No `allowJs` in strict paths; all source is `.ts`/`.tsx`
- Module resolution: `bundler` (Next.js 14+ config)

## Import Organization

- `@/*` maps to project root `/`
- Used consistently throughout: `@/lib/...`, `@/app/...`, `@/components/...`, `@/hooks/...`
- Prefer aliases over relative paths even for nearby modules

## Error Handling

- Explicit result objects for optional/fallible operations: `{ ok: true } | { ok: false; reason: string }` (see `lib/billing.ts` `GateResult`)
- Check `.ok` flag before accessing reason/payload: `if (!gate.ok) return ... gate.reason`
- Async functions that fail throw native `Error`: used in routes and at service boundaries
- Database operations wrapped to normalize SQLite → Postgres: `db.prepare(sql).get/all/run(...params)` returns typed rows or `{ changes, lastInsertRowid }`
- Next.js routes return `NextResponse.json({ error: "message" }, { status: 4xx })` for errors
- No generic `try-catch` swallowing; errors bubble up or are explicitly logged
- Null/undefined checks use truthiness where safe (`if (!org.trial_ends_at)`) or explicit comparisons (`=== null`)

## Logging

- Used sparingly; primarily for observability in background tasks
- `console.log()` for info/debug: seen in agent runs, webhook handlers
- `console.error()` for actual errors: thrown errors and unhandled promise rejections
- No explicit logging in routes; errors are returned as JSON responses with descriptive messages
- Background tasks (enrichment, contact scrape, website checks) emit events via `send()` callback instead of logging

## Comments

- Complex business logic: subscription statuses, pricing tiers, funnel stages (see `lib/billing.ts`, `lib/plans.ts`)
- Workarounds and rationale: "Postgres HTTP driver doesn't support multi-statement SQL — see #40" (`lib/db.ts`)
- Safety nets and guards: "Hard per-event ceiling — this is a runaway-cost safety net, not a monetization gate" (`lib/plans.ts`)
- Non-obvious parsing: comment above regex patterns or SQL parsing (see `lib/db.ts` split-statements)
- Do NOT comment obvious code: `const total = a + b;` needs no comment
- Used for exported functions and type definitions
- One-line summary followed by optional explanation and examples
- Examples from codebase:

## Function Design

- Functions kept focused and reasonably sized (most <50 lines)
- Large route handlers delegated to helper functions in `lib/` (see `app/api/qualify/route.ts` extracting checks into `billing.ts`, `usage.ts`, `tenant.ts`)
- Destructured from objects where >2 params: `{ ok, reason }`, `{ action, supplier_id, event_id }`
- Single objects for dependency injection (see `ProcessSupplierDeps` with 10+ params)
- Type signature always explicit (no implicit `any`): `async function claimOutreachSend(db: Db, id: number): Promise<Result>`
- Explicit return types on all exported functions
- Results use discriminated unions when multiple outcomes: `{ ok: true } | { ok: false; reason: string }`
- Async functions always return a `Promise<T>`
- Single values returned directly: `export function getTier(key: string): Tier | undefined`

## Module Design

- Named exports preferred: `export function requireActiveSubscription(...)`
- Default exports used only for React components: `export default function ConfirmDialog(...)`
- Type exports separated: `export type GateResult = ...` on its own line
- Barrel files used at directory boundaries (e.g., `components/index.ts` may re-export common component types)
- Used in `lib/` for groups of related utilities: tests import from `@/lib/search` not `@/lib/search/utils`
- Not used for large modules; each feature gets its own file

## Section Dividers

- `lib/billing.ts` — subscription gates and billing logic
- `lib/db.ts` — Postgres wrapper and SQL normalization
- `lib/search.ts` — LIKE/ILIKE escape helpers
- `lib/plans.ts` — pricing tiers and limits
- `lib/onboarding.ts` — checklist tracking
- `components/ConfirmDialog.tsx` — modal component logic

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

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

- **Agent-centric:** Business logic delegated to Claude agents at different tiers (Haiku for cheap, Sonnet for balanced, Opus for reasoning)
- **Streaming-first:** SSE endpoint streams supplier discoveries in real-time as they're qualified (not waiting for enrichment)
- **Task-pool gated:** Background tasks run concurrently but capped to prevent LLM/network thundering
- **Tenant-isolated:** Every API route enforces org ownership of events/suppliers
- **Strongly gated:** All discovery/outreach enforces subscription checks, wave limits, spend ceilings, and per-org rate limits

## Layers

- Purpose: UI surfaces for creating events, viewing supplier discoveries, managing outreach
- Location: `app/` (Next.js App Router structure)
- Contains: Page components, layouts, server-side redirects, client-side forms
- Depends on: API routes for data mutations; Clerk for auth; local storage for UI state
- Purpose: HTTP handlers that enforce auth, billing, rate limits, then delegate to lib/ services
- Location: `app/api/`
- Contains: Next.js route handlers (POST/GET); request/response translation; error handling
- Depends on: `lib/` services, `lib/db.ts`, `lib/tenant.ts`, `lib/billing.ts`
- Purpose: Agent orchestration, supplier processing, data validation, external service integration
- Location: `lib/`
- Contains: `agents.ts` (agent definitions), `process-supplier.ts` (pipeline), domain services
- Depends on: Anthropic SDK, Neon Postgres driver, external APIs (Resend, Stripe, Svix)
- Purpose: Postgres query abstraction and schema management
- Location: `lib/db.ts`
- Contains: SQL dialect translation, connection pooling, schema DDL, result wrapping
- Depends on: Neon serverless HTTP driver

## Data Flow

### Primary Request Path: Discovery Wave

### Category Classification Flow

### Supplier Outreach Flow

- **Event state:** `status` field (idle/scouting/outreach/reviewing) prevents concurrent waves; staleness check (>5 min) auto-unlocks crashed runs
- **Supplier state:** `funnel_stage` (long_list/contacted/responded/shortlisted/declined/engaged) plus enrichment and contact fields
- **Session state:** Clerk manages user auth; org context fetched per request via `lib/tenant.ts` getOrgContext()
- **Background tasks:** Pushed to Promise array, awaited at end of SSE stream (not polled)

## Entry Points

- Location: `app/page.tsx`
- Triggers: Browser visit to `/`
- Responsibilities: Redirects signed-in users to `/dashboard`; shows marketing landing for anonymous visitors
- Location: `app/dashboard/page.tsx`
- Triggers: Clerk session exists
- Responsibilities: Lists org's sourcing events, recent waves, referrals, onboarding checklist
- Location: `app/events/new/page.tsx`
- Triggers: User clicks "New Event"
- Responsibilities: Captures sourcing description, geography, advanced filters, calls classifier, creates event
- Location: `app/events/[id]/page.tsx`
- Triggers: User clicks event in list
- Responsibilities: Lists suppliers by funnel stage, launches waves, drafts outreach
- Location: `app/api/orchestrate/route.ts` (POST)
- Triggers: User clicks "Run Discovery" or "Deepen"
- Responsibilities: SSE endpoint; enforces gates; orchestrates full agent pipeline with streaming
- Location: `app/api/classify/route.ts` (POST)
- Triggers: User pauses in description field (900ms debounce)
- Responsibilities: Returns category/subcategory/title suggestion
- Location: `app/api/outreach/route.ts` (POST)
- Triggers: User clicks "Send Outreach" or "Follow Up"
- Responsibilities: Drafts email in supplier's language, optionally sends via Resend
- Location: `app/api/stripe/webhook/route.ts` (POST)
- Triggers: Stripe sends subscription events
- Responsibilities: Creates/updates org subscription, enforces billing state
- Location: `app/api/inbound/route.ts` (POST)
- Triggers: Supplier replies to SourceGPT outreach email
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

### Allowing Concurrent Waves on Same Event

### Trusting Client Wave Numbers for Quota Enforcement

## Error Handling

- **Auth errors:** 401 Unauthorized
- **Billing errors:** 402 Payment Required with specific code (subscription_required, wave_limit_exceeded)
- **Rate limits:** 429 Too Many Requests with Retry-After header
- **Not found:** 404 (org doesn't own resource)
- **Conflict:** 409 (run already in progress)
- **Bad request:** 400 (invalid input)

## Cross-Cutting Concerns

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
