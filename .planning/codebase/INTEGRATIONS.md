# External Integrations

**Analysis Date:** 2026-08-15

## APIs & External Services

**AI / Agent Orchestration:**
- Anthropic Claude API (multiple models) - Core supplier discovery, qualification, enrichment, and outreach agents
  - SDK/Client: `@anthropic-ai/sdk` 0.116.0
  - Auth: `ANTHROPIC_API_KEY` env var
  - Models used: Opus 4.7 (orchestration, discovery), Sonnet 4.6 (grounded web search, outreach), Haiku 4.5 (classification, enrichment)
  - Web search tool: Enabled on scout, grounded qualifier, contact finder, and targeted scout agents
  - Implementation: `lib/agents.ts` defines model assignments and agent implementations; routes in `app/api/orchestrate/`, `app/api/classify/`, `app/api/qualify/`, `app/api/outreach/`, etc.

**Email / Outreach:**
- Resend - Email service provider for sending RFIs and managing inbound supplier replies
  - SDK/Client: Native Node.js fetch via `RESEND_API_KEY`
  - Auth: `RESEND_API_KEY` env var
  - Webhook: Inbound reply handler at `app/api/inbound/route.ts` validates signatures via `RESEND_WEBHOOK_SECRET`
  - Configuration: `MAIL_PROVIDER=resend`, `MAIL_FROM` (verified sender), `OUTREACH_LIVE` (safety switch), `MAIL_INBOUND_DOMAIN`, `MAIL_POSTAL_ADDRESS`
  - Fall-back/demo mode: When not configured, sendEmail() returns draft mode (nothing is sent)
  - Implementation: `lib/mail.ts` handles send logic, compliance footers, opt-out headers, and unsubscribe threading

## Data Storage

**Databases:**
- PostgreSQL (Neon serverless in production)
  - Connection: `DATABASE_URL` / `POSTGRES_URL` / `NEON_DATABASE_URL` env var
  - Client: `@neondatabase/serverless` 1.1.0 (HTTP driver, not WebSocket)
  - ORM: None; direct SQL with a thin wrapper that mimics better-sqlite3 API
  - Wrapper: `lib/db.ts` provides `getDb().prepare().get/all/run()` interface, translates SQL dialect (? → $n params, datetime('now') → now())

**File Storage:**
- Local filesystem only - No cloud file storage integration detected
- Exports (CSV, XLSX, PDF) are generated client-side via jspdf/xlsx and downloaded directly

**Caching:**
- None detected - No Redis, Memcached, or explicit caching layer

## Authentication & Identity

**Auth Provider:**
- Clerk (via @clerk/nextjs 5.7.6) - User and organization management
  - Implementation: `lib/tenant.ts` uses `auth()` from @clerk/nextjs/server to resolve current user and org
  - Dev bypass: `DEV_AUTH_BYPASS=1` in non-production allows local testing without Clerk handshake (useful behind corporate proxies)
  - Organization mapping: Clerk orgs map directly to SourceIQ organizations; personal workspaces are keyed as `user_<id>`
  - Session resolution: Each request resolves user, org, and role via `getOrgContext()` in `lib/tenant.ts`

**Role-Based Access Control:**
- Clerk org roles mapped via `lib/roles.ts` to SourceIQ roles (owner/admin/member)
- Org context includes role; routes check permissions via `atLeast()` checks

## Monitoring & Observability

**Error Tracking:**
- Sentry (optional) - `SENTRY_DSN` env var for error reporting; integration not found in code (likely via Next.js auto-instrumentation or future work)

**Logs:**
- Audit logging: `lib/audit.ts` records user actions to database (stored in `audit_events` table)
- Standard logging: `console.log/warn/error` calls throughout (no structured logging library detected)

**Notifications:**
- Internal system: `lib/notifications.ts` sends in-app alerts to users via database (realtime delivery mechanism not visible from code exploration)

## CI/CD & Deployment

**Hosting:**
- Vercel (inferred from Next.js choice, security headers config, serverless nature)
- Can run on any Node.js serverless platform (AWS Lambda, Google Cloud Run, etc.)

**CI Pipeline:**
- None detected in codebase - Likely handled via GitHub Actions or Vercel's built-in CI

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` or `POSTGRES_URL` or `NEON_DATABASE_URL` - Database connection
- `ANTHROPIC_API_KEY` - Claude API access
- `CLERK_INSTANCE_ID`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` - Authentication (Clerk-managed)
- `STRIPE_SECRET_KEY` - Payment processing
- Optional but recommended:
  - `OUTREACH_LIVE=true` - Master safety switch for live email (defaults to false)
  - `MAIL_PROVIDER=resend` - Email provider selection
  - `RESEND_API_KEY` - Resend API authentication
  - `MAIL_FROM` - Verified sender email address
  - `MAIL_INBOUND_DOMAIN` - Domain for inbound reply threading
  - `MAIL_POSTAL_ADDRESS` - Compliance footer for commercial emails
  - `RESEND_WEBHOOK_SECRET` - Inbound webhook signature verification
  - `STRIPE_WEBHOOK_SECRET` - Stripe webhook signature verification
  - `SENTRY_DSN` - Error tracking
  - `SUPPORT_EMAIL`, `PRIVACY_EMAIL` - User-facing contact addresses

**Per-tier pricing env vars:**
- `STRIPE_PRICE_ID_<TIER>_<CADENCE>` (e.g., `STRIPE_PRICE_ID_PRO_MONTHLY`) - Stripe price IDs per plan level
- Legacy fallback: `STRIPE_PRICE_ID` for Pro/monthly

**Performance tuning:**
- `SCOUT_AGENT_TIMEOUT_MS` - Discovery wave timeout
- `SCOUT_CONCURRENCY`, `QUAL_CONCURRENCY`, `OUTREACH_CONCURRENCY`, `BACKGROUND_TASK_CONCURRENCY` - Parallel task limits
- `QUALIFIER_GROUNDING` - Enable/disable web search for qualification
- `UNLIMITED_TIER_WAVE_SUPPLIER_CAP` - Cap on suppliers per wave for unlimited tier

**Secrets location:**
- Environment variables (`.env.local` in development, Vercel/platform secrets in production)
- Never committed; `.env` is in `.gitignore`

## Webhooks & Callbacks

**Incoming:**
- Resend inbound reply webhook: `app/api/inbound/route.ts` - Receives supplier replies, verifies Svix signature, classifies replies via agent
- Stripe billing webhook: Not found in exploration; likely exists as `app/api/webhooks/stripe/route.ts` or similar (not scanned)

**Outgoing:**
- Stripe-initiated: Payment status webhooks configure org subscription_status and plan in database (via webhook handler)
- Resend-initiated: Email event tracking (bounces, unsubscribes) via webhook callback headers/metadata

## Web Search Integration

**Tool Usage:**
- Anthropic web_search tool used by three agents:
  1. Scout (`claude-opus-4-7`) - Discovers supplier names, websites, contacts during sourcing waves
  2. Grounded Qualifier (`claude-sonnet-4-6`) - Validates supplier info via live web search (optional, controlled by `QUALIFIER_GROUNDING`)
  3. Contact Finder (`claude-sonnet-4-6`) - Locates verified contact email addresses
  4. Targeted Scout (`claude-sonnet-4-6`) - Re-verifies quick-scan suppliers with adaptive thinking
- SECURITY: Injection defense wrapper (`INJECTION_DEFENSE` in `lib/agents.ts`) prevents prompt injection via web-scraped content
- Manual web scraping: `lib/contact.ts` fetches supplier websites directly, parses contact channels; includes SSRF guards (DNS validation, private IP rejection, no redirects to internal addresses)

---

*Integration audit: 2026-08-15*
