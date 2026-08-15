# Codebase Concerns

**Analysis Date:** 2026-08-15

## Tech Debt

**Missing Content-Security-Policy (CSP) header:**
- Issue: `next.config.mjs` explicitly documents that CSP is not yet implemented (lines 8-11), only baseline security headers are applied.
- Files: `next.config.mjs`
- Impact: No protection against inline script injection or third-party origin attacks. Risk increases with scale of user base. Clerk + Stripe integrations must operate under current permissive policy.
- Fix approach: Design a CSP scoped to Clerk + Stripe origins, validate against inline styles and script-src needs, test on a real build before shipping to production (tracked as issue #77).

**Hardcoded legacy Stripe price fallback:**
- Issue: `lib/billing.ts:42-43` falls back to legacy `STRIPE_PRICE_ID` env var for Pro/monthly tier only.
- Files: `lib/billing.ts`, `lib/billing.ts:39-46`
- Impact: Deployment that forgets new per-tier price env vars silently leaves those tiers unconfigured but the app still routes users through the billing gate. Billing UI hides unavailable tiers, but event-creation flow can trigger "Subscribe to Pro" modal without checking Pro's price is actually configured — opaque checkout error if missing.
- Fix approach: Validate all configured tiers have their price env vars set at startup; fail hard if deployment is incomplete rather than silently degrading.

**Npm peer dependency override via legacy flag:**
- Issue: `.npmrc` sets `legacy-peer-deps=true`, suppressing npm 7+ peer dependency validation.
- Files: `.npmrc`
- Impact: Bypasses peer dependency mismatch warnings. May hide incompatibilities between `@anthropic-ai/sdk`, Clerk, and React 19 (or other nested dependencies). Creates silent risk if a dependency is upgraded and peer constraints break.
- Fix approach: Audit peer dependencies; migrate to npm 8+ native overrides if conflicts exist, or resolve the conflicts. Flag the `.npmrc` setting in docs as a temporary workaround, not a permanent solution.

**Stale worktree state:**
- Issue: `.claude/worktrees/agent-a16a6edfdce251f3e` is a leftover detached git worktree from a previous agent run (last modified Aug 11).
- Files: `.claude/worktrees/agent-a16a6edfdce251f3e/`
- Impact: Clutters the codebase; unclear whether it contains uncommitted changes or if it's safe to delete. Blocks clean state and makes the repo harder to reason about.
- Fix approach: Clean up stale worktrees. Document when/how to prune them from `.claude/worktrees/`.

---

## Known Bugs

**[HIGH] Brief edit cannot change identity/routing fields despite full event-creation support:**
- Symptoms: Users cannot update `subcategory`, `ship_to`, `outreach_anonymous`, `buyer_name`, `buyer_role`, `buyer_company` after event creation via PATCH endpoint.
- Files: `app/api/sourcing-events/[id]/route.ts:72-76` (CONTENT_FIELDS allowlist)
- Trigger: User edits event settings or moves between anonymous/normal outreach — any attempt to PATCH these fields returns an "No updatable fields" error.
- Status: **FIXED in current main** — `CONTENT_FIELDS` now includes all six fields (verified in `app/api/sourcing-events/[id]/route.ts:72-76`). This resolves the underlying blocker for product-feedback-backlog item 3.

**[HIGH] Outreach concurrency guard uses different event-status logic than Quick Scan:**
- Symptoms: The client-side `busy` variable blocks outreach during Quick Scan (correct), but the server-side `run_in_progress` check only looks at event.status ∈ {scouting, outreach}. A Quick Scan never sets event.status, so a raced/scripted request to `/api/outreach` during an active Quick Scan will not get blocked server-side (only client-side enforcement exists).
- Files: `app/api/investigate-quick/route.ts` (no status change), `app/api/outreach/route.ts:67-76` (status check only)
- Trigger: Network race condition or direct API call bypassing client-side checks during active Quick Scan.
- Workaround: Quick Scan is fast (single cheap call); practical risk is low but semantic inconsistency is real.
- Fix approach: Either set event status to "scouting" during Quick Scan (with same `updated_at` heartbeat pattern), or track a lightweight per-org action-in-flight row to unify guard semantics.

**[MEDIUM] Unsupported "Send RFI" error — unconfirmed:**
- Symptoms: Report received: "error appears when clicking Send RFI" — no error message or screenshot captured.
- Files: Likely `app/api/outreach/route.ts` (RFI send), `lib/suppression.ts` (opt-out check), or Resend email integration.
- Trigger: Unknown (insufficient data).
- Workaround: None (insufficient reproduction steps).
- Status: Cannot triage without error details; flagged in product-feedback-backlog item 1.

---

## Security Considerations

**[MEDIUM] Event status not atomically protected during discovery/outreach transitions:**
- Risk: Multiple concurrent requests can observe stale `status` between read and write, potentially allowing race conditions if a wave and outreach campaign collide on the same event.
- Files: `app/api/orchestrate/route.ts`, `app/api/outreach/route.ts`, `app/api/investigate-quick/route.ts`
- Current mitigation: Staleness-window heuristic (`STALE_RUN_MS = 5 min`) downgrades stale runs to `reviewing`/`idle`; prevents permanent lockout from crashed/timed-out runs. Serializes updates via database `updated_at` heartbeat.
- Recommendations: Consider advisory locks (`SELECT ... FOR UPDATE`) on the event row during long-running waves if concurrent discovery + outreach on the same event becomes a real user workflow. For now, the staleness window provides adequate protection for the current 1-event-at-a-time usage pattern.

**[MEDIUM] Billing status webhook dependency not verified in test:**
- Risk: The Stripe webhook (source of truth for `subscription_status` and `plan`) is not tested against real Stripe test-mode card failures or multi-tier metadata payloads. `tests/billing.test.ts` tests the gates in isolation but assumes the webhook updates rows correctly.
- Files: `app/api/stripe/webhook/route.ts`, `tests/billing.test.ts`
- Current mitigation: Gates re-read from the database on every request; webhook failures delay state changes but don't cause silent access grants.
- Recommendations: Add e2e test that simulates a Stripe card decline → `past_due` webhook → verify `requireSpendableSubscription` blocks spend but `requireActiveSubscription` allows read access. Confirm `subscription_status` is set correctly for each tier/cadence combo.

**[LOW] Unsubscribe endpoint uses supplier-specific reply token with no validation timestamp:**
- Risk: A leaked/intercepted reply token grants permanent opt-out of that supplier's emails.
- Files: `middleware.ts:19-20`, `/api/unsubscribe` (not shown but referenced)
- Current mitigation: Token is per-supplier and unguessable (generated at outreach send time).
- Recommendations: Consider adding a request-signing mechanism or one-time-token expiration if the unsubscribe endpoint stores/verifies the token statefully.

---

## Performance Bottlenecks

**[MEDIUM] Per-event supplier count query runs on every tier-limit check:**
- Problem: `checkSupplierLimit` and `checkQuickScanLimit` execute `COUNT(*)` queries without indexes optimized for (event_id, is_quick_result) combos.
- Files: `lib/usage.ts:239-248` (checkSupplierLimit), `lib/usage.ts:259-269` (checkQuickScanLimit)
- Cause: These functions are called synchronously before every discovery wave and Quick Scan; no caching within a request.
- Improvement path: Index `suppliers(event_id, is_quick_result, id)` for fast filtered counts. Consider denormalizing supplier counts to the `sourcing_events` row (updated on every insert/delete) to avoid COUNT queries entirely.

**[MEDIUM] Event list endpoint may fetch large supplier arrays without pagination:**
- Problem: `app/api/sourcing-events/[id]/route.ts:21-23` fetches all suppliers for an event with no LIMIT. A buyer with 500+ suppliers on one event will receive a large JSON payload on every detail-page load.
- Files: `app/api/sourcing-events/[id]/route.ts:21-23`, `app/events/[id]/page.tsx` (client-side paginated display hides this)
- Cause: Detail endpoint returns full supplier list; client filters/paginates locally.
- Improvement path: Add `?limit=50&offset=0` params to the endpoint; client already handles pagination. Move sorting (`ORDER BY ai_score DESC`) to the database.

---

## Fragile Areas

**[MEDIUM] Event detail page is a large multipurpose component with multiple stateful subsystems:**
- Files: `app/events/[id]/page.tsx` (2500+ lines estimated from line numbers in e2e-audit-report.md)
- Why fragile: Manages discovery state (running/busy/quickScanning flags), outreach state (campaigning flag), UI state (modal/dropdown visibility), WebSocket stream parsing, periodic polling, and supplier list filtering all in one component. Changes to one subsystem easily break another.
- Safe modification: Use the existing feature-flag guards (`!loading && event && !running && ...`) as your blueprint when adding new conditional logic. Keep the guard conditions close to their usage sites; don't move them far from the components that depend on them.
- Test coverage: The e2e audit found no dedicated unit tests for event-detail state transitions (the tests in `tests/` are mostly helpers, not end-to-end flows). Adding a Playwright test for "discover → deepen → outreach → verify" flow would catch regressions.

**[MEDIUM] Quick Scan supplier-cap logic is scattered across two functions with different assumptions:**
- Files: `lib/usage.ts:239-248` (checkSupplierLimit excludes is_quick_result=true), `lib/usage.ts:259-269` (checkQuickScanLimit only counts is_quick_result=true)
- Why fragile: The separation is intentional (prevent quick-scan results from eating real-discovery headroom), but the logic is easy to break if someone changes one function without understanding the dual-cap pattern. The comment at `lib/usage.ts:250-257` explains this but could be more prominent.
- Safe modification: Before changing either limit function, update `checkSupplierLimit` test in `tests/supplier-updates.test.ts` to verify the is_quick_result filter is still in place. If you add a new filter (e.g. archived suppliers), add it to both functions.
- Test coverage: `tests/quick-scan.test.ts` and `tests/supplier-updates.test.ts` should cover this, but verify they test the interaction between the two limits.

**[MEDIUM] Concurrency guard staleness window is duplicated as separate constants:**
- Files: `app/api/orchestrate/route.ts:65-74` (hardcoded 5-min window), `app/api/outreach/route.ts:67-76` (same window hardcoded separately), `lib/tenant.ts` (STALE_RUN_MS constant)
- Why fragile: The literal `5 * 60_000` is hardcoded twice; one route could be tuned independently and drift from the other without anyone noticing.
- Safe modification: The constant is actually defined in `lib/tenant.ts:STALE_RUN_MS` and should be imported in both routes. If you see the hardcoded literal anywhere, replace it with an import of `STALE_RUN_MS`.
- Test coverage: No dedicated test for staleness-window consistency. Add a test that verifies both routes use the same window value.

---

## Scaling Limits

**[MEDIUM] Database connection pool exhaustion risk under high concurrency:**
- Current capacity: `@neondatabase/serverless` Neon pooled connection (default 10 concurrent connections on free tier; varies by plan).
- Limit: Hitting the pool limit causes new requests to queue; if demand is sustained, the app returns 503 errors.
- Scaling path: Monitor active connections on production dashboard. If p95 connection count approaches the pool limit, upgrade Neon pool size or switch to a higher tier.

**[MEDIUM] SSE (Server-Sent Events) stream cleanup on client disconnect not guaranteed:**
- Current capacity: Each active discovery wave or outreach campaign opens a long-lived SSE stream. Browsers cancel on navigation/reload; server-side cleanup depends on the `controller` being garbage-collected when the Response finalizes.
- Limit: A client that abruptly disconnects (network loss, browser crash) leaves the stream open on the server, consuming a database connection and continuing to run the agent until the heartbeat timeout (5 min) triggers staleness detection.
- Scaling path: Wrap stream handling in a try/finally to explicitly call `controller.close()` and clean up any in-flight agent work when the stream is abandoned. Monitor for zombie agent_runs rows that are never reaped.

---

## Dependencies at Risk

**[MEDIUM] @anthropic-ai/sdk pinned to 0.116.0 with peer-dependency override:**
- Risk: SDK updates may introduce breaking changes or incompatibilities with Clerk/React. The `legacy-peer-deps=true` flag in `.npmrc` suppresses warnings, hiding conflicts.
- Files: `package.json`, `.npmrc`
- Impact: Upgrading the SDK requires manual testing against all integration points (multi-agent orchestration, streaming, caching features).
- Migration plan: Before upgrading, audit the SDK changelog for breaking changes in `client.messages.stream()`, the `response.usage` shape, and tool definitions. Test against `runQuickScoutAgent`, `runQualifyAgent`, and `runDeepening` in a dev environment.

**[MEDIUM] Next.js 14.2.35 is not the latest minor version:**
- Risk: Security patches and bug fixes in 14.2.40+ are not available. If a critical Next.js vulnerability is discovered, the app must be upgraded.
- Files: `package.json`
- Impact: Any vulnerability in the App Router, middleware, or streaming SSR is exposed until `npm update next` is run and tested.
- Migration plan: Set up Dependabot or a similar tool to alert on Next.js patch releases; run `npm update next` quarterly or whenever a security advisory is published.

---

## Missing Critical Features

**[MEDIUM] No manual "move to Shortlist" action in supplier list:**
- Problem: Suppliers can only transition to the `shortlisted` funnel stage via the outreach/qualify flow. No direct UI control lets a buyer manually promote a supplier without sending outreach.
- Blocks: Buyers who want to shortlist a supplier for future reference without immediately reaching out (common in long sales cycles).
- Implementation reference: `app/api/qualify/route.ts:17` defines the FUNNEL_STAGES allowlist; needs a new endpoint or button that calls the same stage-update logic. Flagged in product-feedback-backlog item 2.

**[MEDIUM] No account-level profile fields (company name, role):**
- Problem: No account settings let a user set their company name and role globally. These fields exist per-event (`buyer_name`, `buyer_role`, `buyer_company`) but not at the account/org level.
- Blocks: Consistent sender identity in disclosed outreach; invoicing; organization display on dashboards.
- Implementation reference: `app/settings/page.tsx` should add org-level editable fields. Needs DB schema migration to add org columns, separate from the per-event fields. Flagged in product-feedback-backlog item 4.

---

## Test Coverage Gaps

**[MEDIUM] No end-to-end test for past_due billing state:**
- What's not tested: Full flow from active subscription → card decline → Stripe webhook updates subscription_status to "past_due" → requireSpendableSubscription blocks spend → requireActiveSubscription allows read/edit.
- Files: `tests/billing.test.ts`, `app/api/stripe/webhook/route.ts`
- Risk: The test mocks Stripe events but doesn't verify the webhook actually updates the database correctly. A webhook parsing bug would go unnoticed.
- Priority: HIGH — this is a pre-launch security gate. Add an integration test that mocks Stripe webhook delivery and verifies the org's subscription_status is updated.

**[MEDIUM] No test for concurrent discover + outreach race on same event:**
- What's not tested: Two simultaneous requests (one to `/api/orchestrate`, one to `/api/outreach`) on the same event_id to verify the concurrency guard prevents both from running.
- Files: `app/api/orchestrate/route.ts`, `app/api/outreach/route.ts`
- Risk: If the staleness window is reduced or the guard logic changes, a race condition could allow overlapping waves and outreach campaigns, both consuming LLM budget and potentially corrupting supplier state.
- Priority: MEDIUM — add a test that spawns two concurrent requests and verifies exactly one succeeds.

**[LOW] No test for Quick Scan limit + full discovery limit interaction:**
- What's not tested: A buyer who runs Quick Scans until the quick-scan cap (half the supplier limit) is filled, then runs full discovery and verifies the supplier cap excludes quick-result rows correctly.
- Files: `tests/quick-scan.test.ts`, `tests/supplier-updates.test.ts`
- Risk: If `checkSupplierLimit` and `checkQuickScanLimit` ever diverge, one could accidentally count quick-scan rows toward the real cap.
- Priority: LOW — the filters are separate and unlikely to drift, but a test would be defensible documentation of the intended behavior.

**[LOW] No test for tier-gating on outreach button visibility:**
- What's not tested: Free/Basic tier users should not see the "Auto-Outreach" button on the event detail page; only Growth+ should see it. Currently, the button appears for all tiers and throws a 402 error if clicked on Free/Basic.
- Files: `app/events/[id]/page.tsx:2189-2201`, e2e-audit-report.md item on auto-outreach UX
- Risk: Users on Free/Basic get a poor error experience instead of the "Upgrade for outreach" Link pattern used elsewhere (e.g., Export button).
- Priority: LOW — the error is user-facing but not a data corruption risk. Ticket in product-feedback-backlog item 3 (auto-outreach button).

---

## UX/Product Concerns (Non-Technical)

**[MEDIUM] Support email domain inconsistency:**
- Issue: `app/settings/page.tsx:94` hardcodes `mailto:support@sourceiq.app`, but docs and LAUNCH-PLAN use `sourceiq.org`.
- Files: `app/settings/page.tsx`
- Impact: Users who click the support link in settings are mailed to a possibly non-existent inbox, causing support requests to be lost.
- Fix approach: Confirm the correct domain, then update the hardcoded email to use an env var `SUPPORT_EMAIL` (default: `support@sourceiq.org`). Flagged as blocker B6 in product-feedback-backlog item 4.

**[MEDIUM] Onboarding checklist CTAs point back to /dashboard instead of the active event:**
- Issue: `components/OnboardingChecklist.tsx:32-37` — "Shortlist a supplier" and "Launch outreach" CTAs link to `/dashboard`, not to the user's first event.
- Files: `components/OnboardingChecklist.tsx`
- Impact: Brand-new users get a "Shortlist a supplier" CTA on the dashboard page that clicks to the same page (dead-end).
- Fix approach: Include the most recent `event_id` in the onboarding API response, use it to craft hrefs like `/events/[event_id]`. Flagged in e2e-audit-report item F7.

**[MEDIUM] Dashboard usage bar shows events/month but not the real constraining caps:**
- Issue: `app/dashboard/page.tsx:567-583` — the usage card shows `events_this_month / eventsPerMonth`, tokens, and cost, but not the per-event caps (`maxEventSpendUsd`, `suppliersPerEvent`) that actually gate day-to-day work.
- Files: `app/dashboard/page.tsx`
- Impact: Free-tier users see "0/10 events used" but have no warning before hitting the $5/event spend limit or 25 supplier cap.
- Fix approach: Add mini-progress rows on each event card showing "X/25 suppliers" and "USD X.XX / $5.00 spend" — the caps that actually constrain work. Flagged in e2e-audit-report item F10.

---

*Concerns audit: 2026-08-15*
