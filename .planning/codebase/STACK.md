# Technology Stack

**Analysis Date:** 2026-08-15

## Languages

**Primary:**
- TypeScript 5 - All server and client code
- JSX/TSX - React components

**Secondary:**
- JavaScript - Build configuration (next.config.mjs, postcss.config.mjs, tailwind.config.ts uses tsx)

## Runtime

**Environment:**
- Node.js (version requirement inferred from typescript package)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` (standard npm lockfile, not committed to version control per Next.js conventions)

## Frameworks

**Core:**
- Next.js 14.2.35 - Full-stack React framework with API routes, SSR, and edge functions
- React 19 - UI library
- React DOM 19 - DOM rendering

**Testing:**
- Vitest 2.1.9 - Unit test runner configured for Node environment, tests in `tests/` directory

**Build/Dev:**
- TypeScript 5 - Compiler and type checking
- ESLint 8 with @typescript-eslint/eslint-plugin 8.66.0 - Code linting
- Tailwind CSS 3.3.0 - Utility-first CSS framework
- PostCSS 8 - CSS transformations (autoprefixer 10.5.4)

## Key Dependencies

**Critical:**
- @anthropic-ai/sdk 0.116.0 - Claude API client for agentic sourcing workflows
- @clerk/nextjs 5.7.6 - Authentication and user/org management
- @neondatabase/serverless 1.1.0 - Serverless Postgres driver (HTTP-based, avoids WebSocket issues in serverless)

**Infrastructure:**
- stripe 22.4.0 - Payment processing and subscription billing
- ws 8.21.3 - WebSocket support (for client-side or fallback connections)
- @types/ws 8.18.1 - Type definitions for WebSocket

**Data & Export:**
- xlsx 0.18.5 - Excel spreadsheet generation and parsing
- jspdf 4.2.1 - PDF document generation
- jspdf-autotable 5.0.8 - Table plugin for jsPDF

**UI:**
- lucide-react 1.30.0 - Icon library

## Configuration

**Environment:**
- Next.js configuration: `next.config.mjs` - Security headers setup (SAMEORIGIN, CSP headers noted as future work)
- TypeScript: `tsconfig.json` - Strict mode enabled, path alias `@/*` maps to repository root
- Linting: `.eslintrc.json` - Extends Next.js core-web-vitals with @typescript-eslint rules

**Build:**
- Tailwind CSS: `tailwind.config.ts` - Utility styling
- PostCSS: `postcss.config.mjs` - CSS processing pipeline

**Environment Variables (see INTEGRATIONS.md for secrets):**
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

**Development:**
- Node.js with npm
- Postgres database (local sqlite3 during development, Neon serverless in production)
- No WebSocket support in bundled packages (uses @neondatabase/serverless HTTP driver instead)

**Production:**
- Vercel (or any Node.js-compatible serverless platform)
- Neon PostgreSQL (serverless, HTTP-based)
- Anthropic API (Claude models)
- Clerk authentication infrastructure
- Stripe for billing
- Resend for email delivery (optional, app degrades gracefully if not configured)

---

*Stack analysis: 2026-08-15*
