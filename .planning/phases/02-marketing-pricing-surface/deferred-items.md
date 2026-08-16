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
