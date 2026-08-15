# Codebase Structure

**Analysis Date:** 2026-08-15

## Directory Layout

```
sourceiq/
├── app/                          # Next.js App Router pages & API routes
│   ├── page.tsx                  # Public landing page
│   ├── layout.tsx                # Root layout (Clerk provider, fonts, metadata)
│   ├── globals.css               # Tailwind + custom styles
│   ├── error.tsx                 # Global error boundary
│   ├── not-found.tsx             # 404 page
│   ├── global-error.tsx          # Fallback error page
│   ├── dashboard/                # Signed-in user dashboard
│   │   └── page.tsx              # Events list, referrals, onboarding checklist
│   ├── events/                   # Sourcing event management
│   │   ├── new/page.tsx          # Create event form (description, geography, filters)
│   │   ├── [id]/page.tsx         # Event detail (suppliers by funnel stage, wave launch)
│   │   └── [id]/layout.tsx       # Event layout wrapper
│   ├── settings/                 # User settings
│   │   └── page.tsx              # Team, plan, integrations, notifications
│   ├── billing/                  # Billing & subscription
│   │   └── page.tsx              # Plan selection, upgrade
│   ├── supplier/                 # Supplier-facing pages (no Clerk session required)
│   │   └── rfi/page.tsx          # RFI response form (token-authorized)
│   ├── sign-in/                  # Clerk sign-in page
│   ├── sign-up/                  # Clerk sign-up page
│   ├── legal/                    # Legal pages
│   │   ├── terms/page.tsx        # Terms of service
│   │   └── privacy/page.tsx      # Privacy policy
│   ├── api/                      # Next.js API routes
│   │   ├── orchestrate/route.ts  # Main discovery wave SSE endpoint (POST)
│   │   ├── classify/route.ts     # Category classification (POST)
│   │   ├── qualify/route.ts      # Individual supplier qualification (POST)
│   │   ├── investigate-quick/route.ts  # Fast names-only scan (POST)
│   │   ├── outreach/route.ts     # Email drafting & sending (POST)
│   │   ├── outreach/mark-sent/route.ts # Mark outreach sent (POST)
│   │   ├── outreach-log/route.ts # Outreach history (GET)
│   │   ├── search/route.ts       # Supplier search (GET)
│   │   ├── sourcing-events/route.ts   # Event CRUD (GET, POST)
│   │   ├── sourcing-events/[id]/route.ts  # Event detail (GET, PATCH, DELETE)
│   │   ├── supplier-response/route.ts    # Inbound email reply (POST)
│   │   ├── inbound/route.ts      # Svix webhook (POST)
│   │   ├── audit/route.ts        # Audit logs (GET)
│   │   ├── usage/route.ts        # Usage reporting (GET)
│   │   ├── team/route.ts         # Team management (POST)
│   │   ├── billing/route.ts      # Billing info (GET, POST)
│   │   ├── billing/cancel-impact/route.ts  # Downgrade impact (POST)
│   │   ├── billing/status/route.ts         # Subscription status (GET)
│   │   ├── filter-suppliers/route.ts  # Free-text filter parsing (POST)
│   │   ├── stripe/checkout/route.ts  # Stripe checkout (POST)
│   │   ├── stripe/portal/route.ts    # Stripe customer portal (POST)
│   │   ├── stripe/webhook/route.ts   # Stripe webhooks (POST)
│   │   ├── referrals/route.ts    # Referral tracking (GET, POST)
│   │   ├── onboarding/route.ts   # Onboarding state (GET, POST)
│   │   ├── notifications/route.ts    # Notification settings (GET, POST)
│   │   ├── observability/route.ts    # LLM cost reporting (POST)
│   │   ├── gdpr/erasure/route.ts     # Right to be forgotten (POST)
│   │   ├── unsubscribe/route.ts  # Supplier email opt-out (GET)
│   │   ├── discover/route.ts     # (Deprecated or alternate discovery endpoint)
│   │   ├── approve/route.ts      # Supplier approval action (POST)
│   ├── robots.ts                 # robots.txt generation
│   ├── sitemap.ts                # Sitemap generation
│   ├── icon.tsx                  # Favicon
│   ├── apple-icon.tsx            # Apple touch icon
│   └── opengraph-image.tsx       # OpenGraph image
│
├── lib/                          # Business logic, agents, data access
│   ├── agents.ts                 # Multi-agent definitions & orchestration (63KB)
│   │                            # AGENT_MODELS, runOrchestrator, runScoutAgent, etc.
│   ├── process-supplier.ts       # Per-supplier pipeline factory (22KB)
│   │                            # makeProcessSupplier, makeProcessSupplierQuick, makeProcessSupplierDeepen
│   ├── db.ts                     # Postgres/Neon abstraction (26KB)
│   │                            # Supplier, Event, User, Org schemas; getDb(), query wrappers
│   ├── tenant.ts                 # Multi-tenant isolation (7KB)
│   │                            # getOrgContext, orgOwnsEvent, orgOwnsSupplier
│   ├── billing.ts                # Subscription enforcement (5KB)
│   │                            # requireSpendableSubscription, plan tier checks
│   ├── usage.ts                  # Token tracking & quota enforcement (15KB)
│   │                            # recordUsage, checkWaveLimit, checkSpendCeiling
│   ├── contact.ts                # Website scraping for contact info (14KB)
│   │                            # scrapeSupplierContact, checkWebsiteLive
│   ├── task-pool.ts              # Concurrent background task scheduling (2KB)
│   │                            # createTaskPool, Schedule interface
│   ├── mail.ts                   # Email composition & sending (7KB)
│   │                            # sendEmail, withComplianceFooter, replyToAddress
│   ├── ratelimit.ts              # IP & user-based rate limiting (2KB)
│   │                            # rateLimit, clientIp
│   ├── audit.ts                  # Action logging for compliance (3KB)
│   │                            # logAudit (org/event/user action tracking)
│   ├── observability.ts          # LLM usage & cost reporting (10KB)
│   │                            # recordLLMUsage, costPerModel
│   ├── outreach-claim.ts         # Outreach state machine (3KB)
│   │                            # claimOutreachSend, releaseOutreachClaim (atomic locks)
│   ├── suppression.ts            # Supplier opt-out management (2KB)
│   │                            # isSuppressed, addToSuppression
│   ├── plans.ts                  # Plan definitions & features (5KB)
│   │                            # Plan interface, PLANS, effectiveTier
│   ├── taxonomy.ts               # Controlled vocabularies (6KB)
│   │                            # BUSINESS_TYPES, EMPLOYEE_BANDS, CAPABILITY_TAGS, CERTIFICATIONS
│   ├── supplier-filters.ts       # Free-text → structured conversion (5KB)
│   │                            # sanitizeFilterQuery, type SupplierFilters
│   ├── roles.ts                  # User role definitions (2KB)
│   │                            # Role enum, isAdmin, canManageTeam
│   ├── notifications.ts          # User event delivery (3KB)
│   │                            # notify, NotificationPreferences
│   ├── referrals.ts              # Referral tracking (7KB)
│   │                            # getReferralCode, trackReferral, payoutCalc
│   ├── search.ts                 # Supplier search filtering (1KB)
│   ├── outreach-log.ts           # Outreach history queries (2KB)
│   ├── seats.ts                  # Team seat management (2KB)
│   ├── legal.ts                  # Legal metadata (COMPANY, URLs) (1KB)
│   ├── dedup.ts                  # Supplier name normalization (1KB)
│   │                            # normName, domainOf (duplicate detection)
│   ├── event-list.ts             # Event list queries (2KB)
│   ├── onboarding.ts             # Onboarding flow state (9KB)
│   │                            # checklistItems, completeStep
│   ├── agent-runs-reaper.ts      # Cleanup stale agent runs (2KB)
│   ├── supplier-updates.ts       # Supplier update notifications (2KB)
│   └── i18n/                     # Internationalization
│       ├── de.ts                 # German translations
│       └── [other languages]/    # Additional language files
│
├── components/                   # React components (shared UI)
│   ├── AppShell.tsx              # Main app layout container
│   ├── TopNav.tsx                # Navigation bar (logo, menu, auth)
│   ├── SiteFooter.tsx            # Footer (links, copyright)
│   ├── LandingContent.tsx         # Public landing page content
│   ├── EventSwitcher.tsx          # Event/org dropdown selector
│   ├── LanguageProvider.tsx       # i18n context provider
│   ├── LanguageSwitcher.tsx       # Language selection UI
│   ├── MobileMenu.tsx             # Mobile navigation drawer
│   ├── NotificationBell.tsx       # Notification indicator
│   ├── NotificationSettings.tsx   # Notification preferences form
│   ├── OnboardingChecklist.tsx    # Onboarding progress display
│   ├── ReferralCard.tsx           # Referral link display
│   ├── RfiForm.tsx                # RFI response form (for suppliers)
│   ├── ConfirmDialog.tsx          # Confirmation modal
│   ├── Toast.tsx                  # Toast notification component
│   ├── CookieConsent.tsx          # Cookie banner
│   ├── FunnelExplainer.tsx        # Supplier funnel explanation
│   └── legal/                     # Legal page components
│       ├── TermsContent.tsx
│       └── PrivacyContent.tsx
│
├── middleware.ts                 # Clerk auth middleware, referral capture
├── next.config.mjs               # Next.js config (redirects, rewrites)
├── tsconfig.json                 # TypeScript config
├── package.json                  # Dependencies (Next.js 14, React 19, Claude SDK, Clerk, Stripe, Neon)
├── postcss.config.mjs            # PostCSS config (Tailwind)
├── .eslintrc.json                # ESLint config
├── .env.example                  # Environment variables template
├── .env.local                    # Local dev environment variables (git-ignored)
├── .npmrc                        # npm config (registry, auth)
├── README.md                     # Project documentation
├── public/                       # Static assets (favicon, fonts, images)
├── design-system/                # Design tokens (colors, spacing, typography)
├── docs/                         # Additional documentation
├── scripts/                      # Build/deployment scripts
└── sourceiq.db*                  # SQLite database (legacy; now uses Neon Postgres)
```

## Directory Purposes

**app/:**
- Purpose: Next.js App Router (pages and API routes)
- Contains: Page components, layouts, API handlers, auth pages, legal pages
- Key files: `page.tsx` (landing), `dashboard/page.tsx` (main UI), `events/[id]/page.tsx` (event detail)

**app/api/:**
- Purpose: RESTful API endpoints for client & webhook consumption
- Contains: 25+ route handlers for discovery, outreach, webhooks, billing, admin
- Key files: `orchestrate/route.ts` (main endpoint), `classify/route.ts` (category), `outreach/route.ts` (email)

**lib/:**
- Purpose: Shared business logic, agent definitions, data access, external service integration
- Contains: 30+ modules totaling ~5KB of code
- Key files: `agents.ts` (63KB, all agent definitions), `db.ts` (26KB, Postgres schema + queries), `process-supplier.ts` (22KB, pipeline factory)

**lib/agents.ts:**
- AGENT_MODELS: Maps agent types to Claude model + reasoning strategy
  - classifier: Haiku (cheap category classification)
  - orchestrator: Opus (reasoning for search strategy)
  - scout: Opus (live discovery with adaptive thinking)
  - qualifier: Haiku or Sonnet (scoring; grounded version needs web_search)
  - enricher: Haiku (structured field extraction)
  - contactFinder: Sonnet (email scraping + web_search)
  - outreach: Sonnet (localized email drafting)
- INJECTION_DEFENSE: Explicit preamble for agents consuming untrusted data (web_search results, supplier emails)
- Functions: runOrchestrator, runScoutAgent, runQualifierAgent, runEnricherAgent, runOutreachAgent, etc.

**lib/db.ts:**
- SQL dialect translation (SQLite `?` → Postgres `$n`, `datetime('now')` → `now()`)
- Schema: users, orgs, events, suppliers, agent_runs, audit_logs, usage_tracking
- Async query interface mirroring better-sqlite3 `prepare().get/all/run()` shape
- Connection pooling via Neon HTTP driver (stateless, each call is HTTPS)

**lib/process-supplier.ts:**
- makeProcessSupplier(deps, agent): Factory returns async (supplier: ScoutSupplier) => Promise<void>
- Pipeline: qualify(Haiku/Sonnet) → normalize → insert with enrichment=null → stream `supplier_found` → background enrich + contact scrape → stream `supplier_updated`
- makeProcessSupplierQuick(deps): Fast path for Quick Investigation (names-only, no web_search)
- makeProcessSupplierDeepen(deps, agent): Re-process a quick-scan supplier through the full pipeline

**lib/tenant.ts:**
- getOrgContext(): Fetch org + user from Clerk + DB; return { orgId, userId, org }
- orgOwnsEvent(orgId, eventId): Check if event belongs to org before mutation
- orgOwnsSupplier(orgId, supplierId): Check if supplier belongs to org
- Prevents cross-org data leakage

**lib/billing.ts:**
- requireSpendableSubscription(org): Gate preventing free/unpaid tiers from expensive routes
- Subscription states: active, past_due, expired, free, basic, pro, enterprise
- Integration with Stripe for payment status

**lib/usage.ts:**
- recordUsage(orgId, eventId, tokens, cost): Log per-agent LLM cost
- effectiveTier(org): Map subscription to plan features (wave limits, event limits, outreach)
- checkWaveLimit(tier, waveNumber): Enforce N waves per event for tier
- checkSpendCeiling(db, tier, eventId): Enforce $X max spend per event (prevents runaway LLM cost)

**lib/contact.ts:**
- scrapeSupplierContact(website): HTTP fetch + heuristic HTML parsing to find email/phone
- checkWebsiteLive(domain): HEAD request to verify domain is accessible

**lib/task-pool.ts:**
- createTaskPool(maxConcurrent): Returns Schedule for task enqueueing
- Background enrichment & contact scrape enqueued here, auto-executed up to max concurrent
- Prevents LLM/network thundering on large waves

**lib/mail.ts:**
- sendEmail(to, subject, html, headers): Send via Resend
- withComplianceFooter(html): Append unsubscribe token & opt-out link
- replyToAddress(supplierId): Generate unique reply address for inbound tracking

**components/:**
- Purpose: Reusable React components (presentational)
- Key components: AppShell (layout), TopNav (navigation), EventSwitcher (org/event dropdown), LanguageProvider (i18n)
- No API calls in components; all data flows through page-level fetches or client-side queries

**middleware.ts:**
- Clerk authentication enforcement
- Public routes allowlist (landing, auth pages, webhooks, supplier-facing RFI form)
- Referral cookie capture (30-day persistence)
- DEV_AUTH_BYPASS for offline development (inert in production)

## Key File Locations

**Entry Points:**
- `app/page.tsx`: Public landing page (redirects to `/dashboard` if signed-in)
- `app/dashboard/page.tsx`: Main app entry (event list, recent activity)
- `app/events/new/page.tsx`: Create sourcing event UI
- `app/events/[id]/page.tsx`: Event detail (supplier cards, wave launch, outreach)

**Configuration:**
- `package.json`: Dependencies, scripts (dev, build, test, lint)
- `next.config.mjs`: Next.js build/runtime config
- `tsconfig.json`: TypeScript compiler options
- `middleware.ts`: Clerk auth, public routes, referral capture
- `.env.example`: Environment variable template

**Core Logic:**
- `lib/agents.ts`: All 12 agent definitions and AGENT_MODELS mapping
- `lib/db.ts`: Postgres schema (DDL) and query wrappers
- `lib/process-supplier.ts`: Per-supplier discovery pipeline
- `app/api/orchestrate/route.ts`: Main discovery wave SSE endpoint

**Testing:**
- `tests/`: Vitest test files (co-located with source or separate)
- `vitest.config.ts`: Vitest configuration
- No mocking framework (dependency injection preferred)

## Naming Conventions

**Files:**
- Routes: `/route.ts` (Next.js convention)
- Page components: `/page.tsx` (Next.js convention)
- Layouts: `/layout.tsx` (Next.js convention)
- Special files: `/robots.ts`, `/sitemap.ts` (Next.js convention)
- Utilities & services: camelCase (e.g., `agents.ts`, `tenant.ts`, `process-supplier.ts`)

**Directories:**
- API routes: `app/api/[feature]/route.ts` (kebab-case feature names)
- Page groups: `app/[feature]/page.tsx` (kebab-case feature names)
- Feature folders: `app/events/`, `app/settings/`, `app/supplier/` (singular when referring to a domain)

**Functions:**
- Snake_case for database columns/fields (SQL convention): `event_id`, `funnel_stage`, `buyer_approved_at`
- camelCase for JavaScript variables/functions: `makeProcessSupplier`, `getDb`, `recordUsage`
- PascalCase for React components: `AppShell`, `TopNav`, `LandingContent`
- camelCase for type names (when not exported as default): `agentPlanEntry`, `supplierFilters`
- PascalCase for exported types/interfaces: `Supplier`, `Event`, `ScoutResult`, `QualificationResult`

## Where to Add New Code

**New Feature (End-to-End):**
- **Page:** `app/[feature]/page.tsx` or `app/[feature]/[id]/page.tsx`
- **API route:** `app/api/[feature]/route.ts`
- **Business logic:** `lib/[feature].ts` (new service module)
- **Components:** `components/[FeatureName].tsx` or `components/[feature]/[Component].tsx`
- **Tests:** `tests/[feature].test.ts` or co-located `__tests__/[feature].test.ts`

**New Agent:**
- Add to `AGENT_MODELS` in `lib/agents.ts` with model assignment and reasoning strategy
- Implement `run[AgentName]Agent()` function in `lib/agents.ts` with full prompt + schema
- Reference in `lib/process-supplier.ts` if it's part of the per-supplier pipeline
- Call from API route (e.g., `/api/classify`, `/api/qualify`, `/api/orchestrate`)

**New API Endpoint:**
- Create `app/api/[feature]/route.ts`
- Start with auth check: `const ctx = await getOrgContext()` or `const { userId } = auth()`
- If expensive (LLM or external service): add `requireSpendableSubscription(ctx.org)` gate
- If rate-limited: add `rateLimit(keyType, keyValue, limit, window)` check
- If multi-tenant: add `orgOwnsEvent()` or `orgOwnsSupplier()` validation
- Return NextResponse with appropriate status code and error messages
- Set `maxDuration` if longer than 30s (e.g., `export const maxDuration = 60`)

**New Database Table:**
- Add DDL to `lib/db.ts` in the `initSchema()` function (as individual SQL statements split by `;`)
- Export TypeScript interface for the row type (e.g., `export type Event = { id: number; org_id: number; ... }`)
- Add query wrapper in same file or dedicated service module

**New Webhook Endpoint:**
- Create `app/api/[webhook-source]/route.ts`
- Add to public routes allowlist in `middleware.ts`
- Verify signature (Stripe: HMAC, Svix: provided signature header)
- Parse event type and payload
- Delegate business logic to `lib/` service module

**New Component:**
- If reusable across pages: create `components/[ComponentName].tsx`
- If page-specific: create `app/[feature]/components/[ComponentName].tsx` or keep in page file if small
- Use TypeScript for props (no `any`); prefer named exports over defaults
- No API calls in components; pass data via props or fetch at page level

**New Utility/Helper:**
- Small, domain-agnostic helpers: `lib/[name].ts`
- Domain-specific helpers: in the service module that uses them (e.g., formatting helpers in `lib/mail.ts`)
- Avoid circular dependencies; import chain should flow toward external APIs, not back toward routes

## Special Directories

**design-system/:**
- Purpose: Design tokens and style system
- Generated: No (hand-written, imported by Tailwind/components)
- Committed: Yes

**.next/:**
- Purpose: Next.js build artifacts
- Generated: Yes (by `next build`)
- Committed: No (in .gitignore)

**node_modules/:**
- Purpose: Package dependencies
- Generated: Yes (by `npm install`)
- Committed: No (in .gitignore)

**docs/:**
- Purpose: Additional documentation (guides, API specs, architecture notes)
- Generated: No (hand-written markdown)
- Committed: Yes

**.env.local:**
- Purpose: Local development environment variables (secrets, API keys)
- Generated: No (manually created per developer)
- Committed: No (in .gitignore)

---

*Structure analysis: 2026-08-15*
