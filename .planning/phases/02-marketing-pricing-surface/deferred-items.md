# Deferred Items — Phase 02 Marketing & Pricing Surface

## 02-01: Pre-existing, out-of-scope test-suite failures

`npm test` (full suite) shows 2 failed suites unrelated to this plan's files:

- `tests/process-supplier.test.ts`
- `tests/quick-scan.test.ts`

Both fail at module-collection time with:

```
Error: Cannot find module '.../node_modules/@anthropic-ai/sdk/core/credentials.mjs'
imported from '.../node_modules/@anthropic-ai/sdk/lib/credentials/credential-chain.mjs'
```

This is a pre-existing `@anthropic-ai/sdk` package installation/module-resolution issue
(both failing test files transitively import `lib/agents.ts`, which imports the
Anthropic SDK) — not caused by this plan's changes to `lib/plans.ts`,
`app/api/stripe/checkout/route.ts`, `app/billing/page.tsx`, or `tests/plans.test.ts`.
A stray `anthropic-ai-sdk-0.116.0.tgz` tarball was already present at the repo root
before this plan's work began, suggesting an unrelated in-progress SDK
reinstall/version issue.

Per the executor's Scope Boundary rule, this is out of scope for plan 02-01 and was
not fixed. All 208 individual tests that did collect ran green, including the full
`tests/plans.test.ts` suite (24/24).

**Resolved/reclassified 2026-08-16 (plan 02-04 verification):** the user ran the full
standing suite (`npm run typecheck && npm run lint && npm test && npm run build`) on
their own machine, outside the execution sandbox. Result: 100% green — typecheck
clean, lint clean, all test suites passed including `tests/process-supplier.test.ts`
and `tests/quick-scan.test.ts` (the two that failed to even load in-sandbox), and
`npm run build` succeeded cleanly with `/legal/ccpa` present in the route output. This
confirms the `@anthropic-ai/sdk` module-resolution failure was an artifact of this
session's sandboxed `node_modules` (consistent with the stray
`anthropic-ai-sdk-0.116.0.tgz` tarball found at repo root during 02-01), not a real
defect in the shipped code. No fix was needed in the repo itself.

## 02-04: Stripe Price object creation deferred to user's own time

Plan 02-04 Task 2 (blocking human checkpoint) requires creating 9 live Stripe Price
objects (Basic/Growth/Premium × weekly/monthly/yearly, USD) and setting the matching
`STRIPE_PRICE_<TIER>_<CADENCE>` env vars — this needs live Stripe Dashboard access
that only the account holder has. The user has explicitly chosen to defer this and do
it later rather than now.

Shipped `monthlyUsd` values from 02-01 for reference when creating the prices:

| Tier | Weekly | Monthly | Yearly |
|---|---|---|---|
| Basic | $419 (41900¢) | $1450 (145000¢) | $13920 (1392000¢) |
| Growth | $722 (72200¢) | $2500 (250000¢) | $24000 (2400000¢) |
| Premium | $1299 (129900¢) | $4500 (450000¢) | $43200 (4320000¢) |

Until this is done: `/billing` self-serve checkout buttons for Basic/Growth/Premium
show the existing "Coming soon" missing-price fallback (per RESEARCH Environment
Availability) rather than a live Stripe Checkout Session. This is expected, not a bug.

Also required at the same time (T-02-02 mitigation): unset/repoint any pre-existing
`STRIPE_PRICE_*` env vars still pointing at the old EUR-priced Price objects, so
there's no window where a stale EUR price could be charged.

**Status: open, deferred by user request 2026-08-16.** This blocks PRICE-04 and the
full checkout flow acceptance criteria in plan 02-04 Task 2/3 from being marked
verified — Phase 2 closes with this one item still outstanding until the user returns
to it.
