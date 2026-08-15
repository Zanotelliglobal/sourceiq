# Product Feedback Backlog — live bug/feature reports (2026-08-12)

Raw feedback from manual testing, captured here because `gh` cannot reach GitHub from
this sandbox right now (`tls: failed to verify certificate` on `api.github.com` — same
persistent cert-chain issue noted elsewhere this session). Each item below is drafted
as a ready-to-file GitHub issue. Run the `gh issue create` block at the bottom from a
terminal that has working network access to actually file them; this doc is the
durable record in the meantime.

Two items are missing content the reporter intended to include — flagged individually,
not filed yet.

---

## 1. [NEEDS REPRO] Error appears when clicking "Send RFI"

**Type:** Bug · **Severity:** unknown until reproduced (RFI send is a launch-critical
outreach action, so treat as high until ruled out)

Report: "when clicking on send RFI now, this appears" — no screenshot or error text
came through with the report. Cannot diagnose or file a real bug yet.

**Blocked on:** the actual error message/screenshot. Likely candidates worth checking
once we have it: `app/api/outreach/route.ts` (RFI send path), `lib/suppression.ts`
(opt-out check), Resend send errors, or a client-side validation error.

---

## 2. No manual way to move a supplier into Shortlist

**Type:** Feature gap · **Severity:** medium-high (core workflow gap)

There's no UI control to manually move a supplier into the `shortlisted` funnel stage.
Stage changes currently only happen through the outreach/qualify flow — nothing lets a
buyer just decide "shortlist this one" directly from the supplier list/detail panel.

**Where:** `app/events/[id]/page.tsx` (supplier row/detail panel), guarded by the
`FUNNEL_STAGES` allow-set in `app/api/qualify/route.ts:17`. Needs a manual stage-change
action (dropdown or button) that calls the existing qualify/stage-update endpoint with
`funnel_stage: 'shortlisted'`.

---

## 3. Can't switch outreach between anonymous and normal; normal outreach needs editable sender identity

**Type:** Feature gap · **Severity:** medium-high

No way to toggle `sourcing_events.outreach_anonymous` after event creation. When
switching to normal (non-anonymous) outreach, the buyer should be able to edit the
company name and the sender's role/title used in the outreach message.

**Where:** `sourcing_events` already has `buyer_name`/`buyer_role`/`buyer_company`
columns — the data model supports this, the UI surface doesn't exist yet. Needs a
toggle + editable fields, likely in the event settings area of
`app/events/[id]/page.tsx`.

---

## 4. Missing full user/org profile ("anagraphics") — need at least company name + role

**Type:** Feature gap · **Severity:** medium

No settings screen exposes a full account-level profile. At minimum need editable
"Company name" and "Role/title" fields at the account/org level (distinct from
per-event `buyer_name`/`buyer_role`, which are scoped to a single event's outreach).
This is the identity that should show up consistently across outreach signatures,
exports, and (eventually) invoices.

**Where:** `app/settings/page.tsx`. Related but separate from the pre-launch audit's
Blocker B6 (domain-consistency issue on the same page) — that's a "wrong domain"
problem, this is a "missing fields" problem.

---

## 5. [RESOLVED — not a bug] Trial account reportedly exceeded the 25-supplier Free-tier cap

**Type:** Bug (investigated, closed as not-a-bug) · **Severity:** n/a

Report: "Even if in trial version, more than 25 suppliers scouted." User's initial
follow-up asserted "it was free tier."

Investigated the enforcement code before filing this as a confirmed bug:
`app/api/orchestrate/route.ts` lines ~238-261 computes
`supplierCapRemaining = tier.limits.suppliersPerEvent - existing.length` and decrements
it synchronously (no `await` between read/write) specifically to prevent concurrent
scouts from racing past the cap. `lib/plans.ts` caps the Free tier at 25. This looks
correctly implemented for a single event on the actual Free tier.

**Root cause found:** `effectiveTier(org)` in `lib/usage.ts` (lines ~145-153) grants any
`subscription_status === "trialing"` org **Basic-tier limits (150 suppliers/event)**, not
Free-tier limits (25) — this is intentional (trials are cardless and capped at
Basic-equivalent spend rather than uncapped Premium, per the code comment), but it means
"trial" and "Free tier" are not the same thing in this codebase.

**Confirmed via dashboard screenshot:** the account's plan badge reads "Basic," not
"Free." 67 suppliers found is within Basic's 150-supplier cap — expected behavior, not a
bug. This contradicts the "it was free tier" follow-up; flagged back to the user to
double-check their billing/plan page. Closing this item unless the user can point to an
account that is confirmed Free-tier (not trialing-on-a-paid-plan) and still exceeds 25.

---

## 6. [ESCALATED] Remove the sourcing-event stats section

**Type:** Feature/design change · **Severity:** medium (explicit imperative, not just feedback)

Original feedback ("the stats block on the event detail page isn't adding value") was
escalated to an explicit instruction: "ELIMINATE the stats on the sourcing events,"
accompanied by a screenshot of the **Dashboard** page (`app.sourcegpt.org/dashboard`),
not the per-event detail page screenshot that accompanied the earlier, softer feedback.

**Scope ambiguity — needs confirmation before cutting anything:**
- Per-event detail page (`app/events/[id]/page.tsx`) stats bar: TOTAL FOUND / AVG SCORE
  / SHORT LISTED / AI COST — the original target of the softer feedback.
- Dashboard page stats cards: Active Events / Suppliers Identified / Short Listed /
  Total Events + the Basic-plan usage bar — the target of the screenshot accompanying
  the escalated "ELIMINATE" instruction.
- Possibly both.

**Blocked on execution, not on decision:** `app/events/[id]/page.tsx` is the exact file
a background agent is actively editing to finish the Quick Investigation feature (Quick
Scan button, unverified badge, Deepen action, progress-abstraction UI). Editing it
concurrently risks clobbering that in-flight work. This item will be actioned as a
follow-up edit the moment that agent's work lands, scoped to whichever of the two (or
both) stats surfaces the user confirms.

---

## 7. Agentic chat for customer support

**Type:** New feature · **Severity:** larger scope, needs its own design pass

Add an AI agent-powered support chat for end users (distinct from the internal
scout/qualifier/enricher agents that do supplier discovery). Needs a scoping pass
before implementation: what it's allowed to answer, whether it's FAQ/doc-grounded or
has account-data access, escalation path to a human, and cost/model tier — this is a
"design it first" item, not a quick add.

---

## [RESOLVED — folded into Epic 6] "For managing credits, copy this."

Content arrived: 4 screenshots of SourceReady's (competitor) credit-management UI on
their subscription settings page. Folded into `docs/competitive-sourceready-backlog.md`
under Epic 6 as a new "Design reference: SourceReady credit-management UI" subsection —
tri-category credits widget (Paid/Free/Daily, each with a progress bar), daily-reset
messaging, "Earn extra credit" CTA, Usage overview/Activity log tabs, plan badge +
Upgrade button, and a persistent sidebar credits-left widget.

**Not an implementation trigger** — this is a design reference only. Issue L (#45),
which owns the actual credit-currency decision, stays on hold pending the PR #120
business call on final tier pricing/credit allocations, exactly as before.

---

## Ready-to-file `gh issue create` commands

Run from a terminal with working GitHub access (this sandbox's `gh`/`git` network
calls are blocked by a local cert-chain issue — same one affecting pushes all session):

```bash
gh issue create --title "Error appears when clicking Send RFI" \
  --body "Reported during manual testing, no screenshot/error text captured yet. Needs repro details before triage. See docs/product-feedback-backlog.md item 1." \
  --label bug

gh issue create --title "Add manual 'move to Shortlist' action on suppliers" \
  --body "No UI control to manually move a supplier into the shortlisted funnel stage. See docs/product-feedback-backlog.md item 2." \
  --label enhancement

gh issue create --title "Outreach: anonymous/normal toggle + editable sender identity" \
  --body "No way to switch outreach_anonymous after event creation; normal outreach needs editable company name + sender role. See docs/product-feedback-backlog.md item 3." \
  --label enhancement

gh issue create --title "Add account-level profile fields (company name, role)" \
  --body "No settings screen exposes company name / role at the account level. See docs/product-feedback-backlog.md item 4." \
  --label enhancement

gh issue create --title "Investigate: trial account allegedly exceeded 25-supplier Free-tier cap" \
  --body "Unconfirmed — likely explained by trial being on a higher paid tier, not Free. Needs confirmation of which plan before further investigation. See docs/product-feedback-backlog.md item 5." \
  --label bug,question

gh issue create --title "Reconsider/remove sourcing-event stats section" \
  --body "Feedback that the stats block on the event page isn't useful. Design decision, not yet implemented. See docs/product-feedback-backlog.md item 6." \
  --label enhancement

gh issue create --title "Add agentic customer-support chat" \
  --body "New feature, needs a scoping/design pass before implementation. See docs/product-feedback-backlog.md item 7." \
  --label enhancement
```
