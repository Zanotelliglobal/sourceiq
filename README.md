# SourceIQ

AI-powered supplier discovery and procurement funnel. Multi-agent scouting,
qualification, enrichment, and outreach — built on Next.js 14 (App Router),
TypeScript, Tailwind, and the Anthropic SDK.

## Stack

- **Next.js 14** App Router + React 18
- **Anthropic Claude** — multi-agent orchestration (scout / qualifier / enricher / outreach)
- **Postgres** (hosted, e.g. [Neon](https://neon.tech)) via `@neondatabase/serverless`
- **Clerk** — authentication & organizations (multi-tenant)
- **Stripe** — flat-tier subscription billing
- **Resend** *(optional)* — live outreach email + inbound reply handling

## Architecture

- **Tenancy** — every request resolves to one `organizations` row (see `lib/tenant.ts`).
  A Clerk Organization maps to an org; a solo user gets a personal org keyed
  `user_<id>`. Orgs are provisioned lazily with a 14-day trial.
- **Billing gate** — `requireActiveSubscription` (`lib/billing.ts`) allows access
  when billing is unconfigured (dev), the subscription is active/trialing/past_due,
  or the org is still inside its trial. The **Stripe webhook is the source of truth**
  for subscription state.
- **Data access** — `lib/db.ts` exposes a small async, `better-sqlite3`-style
  wrapper over a Neon Postgres pool. Schema is created lazily on first query.

## Local setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment** — copy `.env.example` to `.env.local` and fill in:
   - `ANTHROPIC_API_KEY`
   - `DATABASE_URL` (Neon pooled connection string)
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY`
   - Stripe keys *(optional locally — leave unset to keep all features unlocked)*

3. **Run**
   ```bash
   npm run dev
   ```
   The database schema is created automatically on first request.

## Stripe billing

1. Create a **recurring product/price** in the Stripe dashboard; put the price id
   in `STRIPE_PRICE_ID`.
2. Set `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_APP_URL`.
3. **Webhook** — point a Stripe webhook at `POST /api/stripe/webhook` and subscribe to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

   Put the signing secret in `STRIPE_WEBHOOK_SECRET`. Locally:
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```
4. Users manage their plan at `/billing` (checkout → Stripe Checkout,
   manage/cancel → Stripe Billing Portal).

## Deploying to Vercel

1. Push to a Git repo and import into Vercel.
2. Add all env vars from `.env.example` to the Vercel project (Production + Preview).
   Set `NEXT_PUBLIC_APP_URL` to your production domain.
3. Provision Postgres (Neon) and set `DATABASE_URL` to the **pooled** connection string.
4. After the first deploy, register production webhooks:
   - **Stripe** → `https://<domain>/api/stripe/webhook`
   - **Resend inbound** *(if using live email)* → `https://<domain>/api/inbound`
5. In Clerk, add your production domain and set the publishable/secret keys.

## Public routes

The following are reachable without authentication (see `middleware.ts`):
`/`, `/sign-in`, `/sign-up`, `/api/inbound` (Resend), `/api/stripe/webhook` (Stripe).
Everything else requires a signed-in Clerk session.
