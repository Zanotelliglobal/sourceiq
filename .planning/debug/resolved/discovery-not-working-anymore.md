---
status: resolved
trigger: "DISCOVERY NOT WORKING ANYMORE, only quick scan . why? Fix it"
created: 2026-08-22
updated: 2026-08-22
---

## Symptoms

- **Expected behavior**: Clicking "Launch Discovery" (full multi-agent wave, `POST /api/orchestrate`) runs scouts, qualifies/enriches candidates, and populates the event's supplier list with newly discovered suppliers, same as before the latest production deploy.
- **Actual behavior**: The wave banner reports completion (e.g. "1 waves complete" / "2 waves complete"), all scout agents show `W{n} · 0` (zero suppliers found per agent), and the main panel falls back to the "Ready to initiate market intelligence" empty state as if discovery never ran. Zero suppliers are produced or displayed. Separately, "Quick Scan" (`POST /api/investigate-quick`) still works normally.
- **Error messages**: None visible to the user (no toast/error banner) — the wave silently "completes" with 0 results. DevTools console on the affected page shows only browser-extension noise (`Uncaught (in promise) Error: Could not establish connection. Receiving end does not exist.`, `"...message channel closed before a response was received"`, plus a Clerk dev-keys warning) — confirmed unrelated to the bug (classic `chrome.runtime.sendMessage` extension errors).
- **Timeline**: Worked before the just-completed deploy. This deploy was the FIRST-EVER push of a long-unpushed local `develop` branch (82 commits, spanning Phases 1-4 of GSD work plus dozens of previously-unmerged fix branches) to `origin/develop`, immediately fast-forward-merged into `origin/main`. So "before Phase 4" does not necessarily mean the regression is IN Phase 4's own code — the whole 82-commit batch shipped atomically in one deploy.
- **Reproduction**: Create/open a sourcing event, click "Launch Discovery". Reproduced on at least 2 different events for the reporting org ("Italian Fresh Apples" — Fresh Produce/Apples category, Italy geography; "Banana Leaf Plates" — Packaging & Container Solutions category).

## Evidence (gathered so far, pre-formal-session)

- Read `app/api/orchestrate/route.ts` (current production version) in full. Confirmed the SSE handler structure: gates (subscription, rate limit, wave limit, spend ceiling) → orchestrator planning → per-scout `runScout()` → `runScoutAgent()` (LLM call) → `claimIfNew` dedup (against THIS event's existing `suppliers` rows only) → per-event/per-wave caps → `makeProcessSupplier()` (qualify/enrich/persist).
  - `newSuppliers += fresh.length` is incremented from `fresh` (scout-returned candidates surviving dedup+cap), NOT from confirmed DB-persisted rows — so a wave reporting `new_suppliers: 0` most directly means `fresh.length === 0` for every scout, i.e. either (a) `runScoutAgent()` returned an empty list, or (b) every scout-returned candidate got caught by `claimIfNew`/cap truncation, or (c) `runScoutAgent()` threw and was caught by the per-agent try/catch (silently degrades to 0 found, agent status set to 'error', no user-visible error surfaced at the wave level).
- Ruled out `requireSpendableSubscription` (`lib/billing.ts` line 95) as sole cause: a failing gate returns an explicit `402` JSON response with `code: "subscription_required"` — this would surface as a visible error, not a silent "wave complete, 0 suppliers" outcome. Read the full function body; logic looks correct (spend-gated statuses set, past_due/trial-expired messaging).
- Ruled out Phase 3/4 identity-repository writes (`lib/process-supplier.ts` `upsertSupplierIdentity`/`upsertOrgSupplierData`/back-link `UPDATE suppliers SET identity_id`) as a cause of zero suppliers: confirmed via full read that these run AFTER the critical `INSERT INTO suppliers` + `supplier_found` SSE emit, wrapped in a try/catch that can never throw into the critical path.
- Ruled out `fix/qualify-stage-allowlist` (commit `63c007e`) as a cause: only adds allowlist validation to the manual `move_stage` action in `app/api/qualify/route.ts`, unrelated to discovery/scout dispatch.
- Read `lib/supplier-repository.ts` in full (`findKnownSuppliers`, `repositoryEntryMatchesEvent`, `normCategory`, `parseTargetCountries`). The REPO-05 pre-search `avoidNames` list (built from `relevantKnown`, i.e. org-wide known suppliers matching this event's category+geography) is passed only as a **prompt hint** into `runScoutAgent()` (see `route.ts` line ~371) — it does NOT feed `claimIfNew`'s programmatic dedup (`claimIfNew` only checks `seenNames`/`seenDomains` built from the CURRENT event's `existing` suppliers). So an over-broad `avoidNames` list could only make the scout LLM itself return fewer/no NEW candidates (a soft, prompt-level effect), not hard-zero results via a code bug — flagged as a live but unconfirmed hypothesis, not eliminated.
- Noted: `supplier_identities`/`org_supplier_data` are new tables (Phase 3, populate "going forward only", no backfill) — so immediately post-deploy the repository should be near-empty for any org, making the "avoidNames list is too broad" theory less likely to explain an IMMEDIATE, CONSISTENT (not intermittent) zero-suppliers result across 2 different events/categories right after deploy — this weakens (but does not eliminate) that hypothesis.
- **Not yet investigated / next candidates**:
  - `lib/agents.ts` `runScoutAgent()` / `runOrchestrator()` — have NOT yet read these. Since the 82-commit deploy bundled many previously-unmerged fix branches beyond just Phase 3/4, a change here (signature, prompt, model name, response parsing) is a live untested hypothesis and arguably the most direct explanation for "scouts run, all report 0."
  - `AGENT_MODELS` constant / model name strings — a typo'd or deprecated Anthropic model ID would make every scout call fail or return unparseable output, caught by the per-scout try/catch (agent shows W1·0, wave still "completes").
  - `lib/dedup.ts` `normName`/`domainOf` — used both in `claimIfNew` and in building `seenNames`/`seenDomains` from `existing`. A bug making `normName` collapse everything to the same normalized string (e.g. returning `""` for all input) would cause `claimIfNew` to reject every freshly-scouted candidate as a false "duplicate" of the FIRST accepted one — but this requires at least one true accept to seed the collision, and `existing` starts empty for a brand-new event, so this alone wouldn't zero out results unless normName() throws or the first scout's own candidates collide with each other within the same batch (plausible: e.g. `normName` always returning `""`, so `seenNames.has("")` becomes true after the very first candidate, silently rejecting every other candidate that wave — worth checking).
  - `checkWaveLimit`/`checkSpendCeiling` (`lib/usage.ts`) — confirmed these gate BEFORE the SSE stream even starts (would produce a 402, not a completed wave), so lower priority but not yet read in full.
  - Live network/console inspection via Claude-in-Chrome MCP was attempted 3+ times and failed to connect each time ("Claude in Chrome is not connected") — no live SSE payload has been captured; all evidence so far is static code reading.

## Eliminated

- hypothesis: `requireSpendableSubscription` billing gate blocks the request — eliminated: would return a visible 402 error, not a silently-completed zero-supplier wave.
- hypothesis: Phase 3/4 identity-repository upsert code throws and blocks supplier persistence — eliminated: runs after the critical INSERT+SSE-emit, wrapped in a non-propagating try/catch.
- hypothesis: `fix/qualify-stage-allowlist` (63c007e) blocks supplier creation — eliminated: only touches the unrelated manual `move_stage` action.
- hypothesis: `lib/agents.ts` (`runScoutAgent`/`AGENT_MODELS`/JSON-extraction) regressed as part of the deploy — eliminated: `git diff 2517443 HEAD -- lib/agents.ts` shows the ONLY changes are cosmetic "SourceIQ"→"SourceGPT" string replacements inside prompt text; `AGENT_MODELS`, the `web_search_20250305` tool call, and the `/\[[\s\S]*\]/` JSON-extraction regex are byte-for-byte unchanged.
- hypothesis: `lib/dedup.ts` (`normName`/`domainOf`) regressed — eliminated: `git diff 2517443 HEAD -- lib/dedup.ts` is empty (zero changes). Also read both functions in full directly: neither can collapse to an always-`""` output for realistic input, so the "first candidate falsely seeds a collision" theory doesn't hold even as a pre-existing bug.
- hypothesis: `lib/billing.ts`, `lib/plans.ts` (tier limits), `lib/usage.ts` (`checkSupplierLimit`/`checkQuickScanLimit`) regressions zero out the supplier cap — eliminated: diffed all three against 2517443. `requireSpendableSubscription` is a stricter but still visibly-erroring gate (402). No tier's `suppliersPerEvent` is 0 (Free=25, Basic=300, Growth=600, Premium/Enterprise=UNLIMITED). The cap-remaining computation in `orchestrate/route.ts` (`realExistingCount` excluding `is_quick_result` rows) is correct and starts at `supplierLimit` (non-zero) for a fresh event.

## Resolution

### Root cause

Two bugs compound to produce the reported symptom exactly as described (wave "completes," every scout shows `W{n} · 0`, zero visible errors):

1. **The real failure signal was already there but never reached the UI.** `app/api/orchestrate/route.ts`'s per-scout `try/catch` around `runScoutAgent()` (line ~375) correctly does two things on any thrown error (LLM/API error, timeout, malformed JSON from the model, a 429, etc.): it persists `agent_runs.status='error'` to the DB, and it sends an SSE event `{ type: "agent_error", agent_id, message }`. Neither of these previously resulted in anything visible:
   - **Client-side (live view):** `app/events/[id]/page.tsx`'s `handleStreamEvent()` — the function that processes every SSE event during a run — had `if` branches for `agent_start`, `agent_scouted`, `agent_complete`, `wave_complete`, `error`, etc., but **no branch for `type === "agent_error"` at all**. The event was received and silently dropped. Confirmed this was a wiring gap, not an intentional omission: the component's `AGENT_DOT` color map already had `error: "bg-red-500"` defined and unused — the visual affordance existed, but nothing ever set an agent's `status` to `"error"` to trigger it.
   - **Persisted/polled view (what a reloaded or "background-running" tab shows):** the error path's DB update (`UPDATE agent_runs SET status='error', message=? ...`) never sets `suppliers_found`, so that column keeps its `INSERT`-time default (0). The read-only fallback render (`agents.slice(0,6)` in the same file) displayed `W{n} · {a.suppliers_found}` with a plain slate dot for every non-`"complete"` status, including `"error"` — visually **identical** to a scout that legitimately found zero suppliers.
   
   Net effect: whatever is actually throwing inside `runScoutAgent()` for this org's waves has been completely invisible to the user since the moment this UI shipped — "0 found, no errors" is indistinguishable from "every scout failed." This fully explains the reported experience (silent completion, no toast, no error banner, W{n}·0 across every agent/wave/event).

2. **What is actually throwing inside `runScoutAgent()` could not be conclusively identified via static code review alone** (no production logs, Vercel env vars, or live Anthropic API access available in this environment). The scout call sets `maxRetries: 0` (no SDK-level retry) on an expensive Opus + `web_search` + adaptive-thinking call — a 429/5xx from Anthropic (plausible immediately post-deploy if the org burst-tested multiple features — Quick Scan, Deepen, Discovery — against the same API key in a short window) would throw straight through, uncaught by any retry, and land in the exact silently-degraded path described above. A secondary, weaker contributing factor: `lib/supplier-repository.ts`'s `repositoryEntryMatchesEvent()` treats a `null` `last_category` (which is what every Quick-Scan-sourced identity gets — see `makeProcessSupplierQuick`) as an "open match" against ANY category, so if this org exercised Quick Scan across multiple unrelated categories after the deploy (evidence confirms Quick Scan was used and works), those unrelated names leak into full Discovery's `avoidNames` prompt hint for every subsequent event, regardless of category/geography match. This is a real, documented-as-deliberate ("Claude's Discretion," Phase 3 REPO-05/D-04) design tradeoff, not touched by this fix — it is a soft, LLM-prompt-level effect and was already assessed as unlikely to fully explain a 100%-reproducible hard zero.

### Fix

Applied in `app/events/[id]/page.tsx` (client-side discovery SSE handling only — no server/pipeline logic changed):

- Added `liveAgentsRef` (mirrors the existing `addLogRef` pattern) so `handleStreamEvent` can read the current agent list without a stale-closure risk.
- Added a `type === "agent_error"` branch in `handleStreamEvent`: marks that agent's live status as `"error"`, logs it to the Activity Log, and — critically — calls `pushToast("error", ...)` so a scout failure now produces an actual, visible error banner during a live run, same as `type === "error"` already does for wave-level failures.
- Updated the live-agent card's border/background to a red tint for `status === "error"` (previously fell through to neutral slate).
- Updated the persisted/polled agent list (`agents.slice(0,6)`) to render a red dot and `"Error"` (with the DB-persisted error message as a tooltip) instead of a plain slate dot + `W{n} · 0`, for `status === "error"` rows.

This makes any future scout failure immediately visible (toast + red indicator + tooltip with the real error text) instead of silently rendering as a clean zero-result completion. Verified with `npx tsc --noEmit` (no new type errors) and `npx eslint "app/events/[id]/page.tsx"` (clean).

**Not fixed / flagged as follow-up, not applied in this session** (out of scope for a surgical fix; would need production log access or user confirmation to justify):
- Whatever is causing `runScoutAgent()` to actually throw on this org right now. The fix above will surface the real error message (rate limit, timeout, malformed response, etc.) the next time discovery is run — that message is the fastest path to a definitive follow-up fix if the problem persists.
- `repositoryEntryMatchesEvent()`'s null-category "open match" cross-category pollution of `avoidNames` — real but soft, and changes a documented intentional design decision (Phase 3 D-04); left untouched pending a decision on whether Quick-Scan-sourced identities should be scoped differently for the REPO-05 pre-search.
- No automated test added for the SSE-handling fix: `app/events/[id]/page.tsx` is a page component and the repo's Vitest setup targets Node-only `lib/` unit tests (no React/jsdom component-testing harness currently exists in this codebase).

### Verification requested from user

Re-run "Launch Discovery" on one of the affected events. If scouts still fail, the fix above will now show the ACTUAL error (toast + red W{n}-agent card + tooltip) instead of a silent zero — please share that exact message for a fast, conclusive follow-up fix.

## Follow-up: timeout root cause (same day)

The visibility fix above worked exactly as intended: the user re-ran "Launch Discovery" in production and every scout now showed a red `W1 · Error` indicator instead of a silent `W1 · 0`. Hovering the tooltip surfaced the actual underlying error, identical across every failing scout:

> "Request timed out."

### Root cause

`lib/agents.ts`'s scout loop bounds the WHOLE scout call (all resumes combined, up to 6) to a single wall-clock budget:

```
const scoutDeadlineMs = Math.max(30_000, Number(process.env.SCOUT_AGENT_TIMEOUT_MS) || 150_000);
```

The shrinking remainder of that budget is passed as the Anthropic SDK's own per-call `timeout` option with `maxRetries: 0`. When the budget is exhausted mid-call, the SDK throws `APIConnectionTimeoutError` whose message is literally "Request timed out." — exactly the observed error, now correctly surfaced by the visibility fix above instead of being swallowed.

The code's own comment immediately above that line (tagged `#94`) already acknowledges "a scout with adaptive thinking + web search can take 90-360s in a SINGLE call" — meaning the 150s *default* fallback was, by the original author's own admission, sometimes not enough for one call, let alone a multi-resume scout.

**Not a regression from today's deploy.** Confirmed via `git diff 2517443 HEAD -- lib/agents.ts app/api/orchestrate/route.ts` (`2517443` = `origin/main`'s exact tip immediately before today's develop→main sync) that this timeout logic, `AGENT_MODELS` values, and the scout/qualifier concurrency defaults (`scoutConcurrency`, `qualConcurrency`, `waveSupplierSoftCap`) are byte-identical apart from cosmetic SourceIQ→SourceGPT renames. The timing correlation with the deploy is very likely coincidental — real Anthropic API latency/throughput on `claude-opus-4-7` + adaptive thinking + web_search fluctuating, or increased genuine production concurrency now that a much larger, more-used branch is finally live — not a discrete logic bug introduced by the commits that shipped today. This is a latent, marginal timeout budget that is now consistently tripping under real production load, not new breakage.

### Fix

`lib/agents.ts` line 398 — raised the hardcoded fallback default from `150_000` to `220_000` (220s). Rationale: the route's `maxDuration` is 300s; orchestrator planning + registration happens before scouts start and qualify/enrich happens after, so 220s leaves ~80s of headroom for those phases while giving scouts materially more room to finish within the range the code's own comment says they need. `SCOUT_AGENT_TIMEOUT_MS` remains a supported override either way.

Deliberately did **not** add retry logic: a retry could push a scout call past the route's hard 300s `maxDuration` ceiling mid-stream, trading a clean, now-visible per-agent failure for an uncaught fatal stream error — worse than the status quo.

### Operational follow-up (user action, not code)

- Set `SCOUT_AGENT_TIMEOUT_MS` explicitly in the Vercel production environment (e.g. `220000`) as a belt-and-suspenders config that takes effect without waiting on a redeploy.
- Check the Anthropic Console's usage/rate-limit dashboard around the failure timestamps to rule out an account-level throughput ceiling that no code change here can fix.

### Verification requested from user

Re-run "Launch Discovery" in production again. Confirm scouts either succeed or, if they still time out, capture the new error/timing pattern to see whether it points to an external Anthropic rate limit rather than the budget itself.
