# SourceIQ — Critical Stakeholder UX Assessment & Optimization Plan
_Converged artifact (v4). Grounded in codebase audit, 2026-07-12._

## Verdict
The **buyer happy-path is genuinely strong** — auto-classification, autostart discovery, live SSE agent theatre, a clean funnel, and context-aware actions. The product breaks down at the **edges that decide production-readiness**: the supplier experience, approver/governance controls, irreversible actions without confirmation, trial→paywall dead-ends, and accessibility. Those are where trust and money leak.

Priorities below are ordered by business impact, not code effort.

---

## P0 — Ship-blockers (trust, money, legal)

### 1. Irreversible bulk outreach has no confirmation (Buyer + Owner + Supplier)
`Auto-Outreach ({n})` (`events/[id]/page.tsx:1088`) calls `runCampaign()` → `/api/outreach` and immediately emails every long-list supplier. In **live mode this sends real cold emails to real companies** with one click, no "You're about to email N suppliers — Send?" step, no dry-run preview.
- **Fix:** Confirmation modal showing recipient count, anonymous/disclosed mode, and a 3-supplier email preview before send. Add a per-event "test send to myself" button. This is the single highest-risk action in the app.

### 2. Trial-ended is a dead-end, not a conversion moment (Owner + Buyer)
Expired trial → `/api/sourcing-events POST` returns a bare **402** (`route.ts:31-32`); the new-event form has no handler to surface it. User hits an opaque failure with no path to `/billing`, which isn't in the main nav either.
- **Fix:** Intercept 402 client-side → upgrade modal with direct "Subscribe to Pro" CTA. Add a persistent trial-countdown badge on the dashboard ("3 days left") and a `Billing` nav link (already exists in `TopNav` for SignedIn — verify it renders). Owner loses revenue at the exact moment of intent.

### 3. Supplier experience is email-only and reads like spam (Supplier — HIGH)
Suppliers receive mail from `reply+<token>@resend.example.com` (a non-brand domain), with **no landing page** to view the RFI, verify SourceIQ is legitimate, or reply with structure. Reply is free-text email only, classified by AI. For a cold anonymous RFI, this fails the legitimacy test and depresses response rates — which directly starves the buyer's funnel.
- **Fix (staged):** (a) Send from a branded verified domain, not `resend.example.com`. (b) Add a minimal public `/rfi/[token]` landing page: shows who's asking (or "a verified buyer via SourceIQ"), the request, and a structured "Interested / Not a fit / Request details" response form. (c) Keep email reply as fallback. This is the biggest lever on the whole funnel and currently the most neglected stakeholder.

### 4. Accessibility is effectively absent (all stakeholders — legal/enterprise blocker)
Near-zero `aria-*`, no `role=`, no visible focus rings, modals not `Esc`-dismissible, status conveyed by color alone, activity log has no `aria-live`, no `prefers-reduced-motion`. Enterprise procurement buyers routinely require WCAG/VPAT; this blocks deals.
- **Fix:** `Esc`-to-close + focus-trap on all three modals (Detail, Outreach, Brief); visible focus rings; `aria-live="polite"` on the activity log; text label beside every color status dot; `prefers-reduced-motion` guard on `animate-slide-in`.

---

## P1 — Governance & control gaps (Approver — the most under-served stakeholder)

The app is built for a solo buyer; the **approver/manager persona has essentially no surface**.
- **No approval gate:** any buyer can launch discovery and send live outreach unilaterally. There's no "submit brief for approval," no spend threshold, no maker-checker on outreach. Enterprise procurement requires this.
- **No audit trail:** `created_by`/`modified_by` are absent; `agent_runs` exist in DB but aren't surfaced. Who launched what, who edited the brief, who contacted whom — invisible.
- **Edit Brief has no consequence warning:** `BriefModal` silently notes "Changes apply to the next wave" (`:749`) but doesn't warn that re-running discovery against changed criteria may re-score/reshuffle an already-reviewed list.
- **Fix:** Add an optional approval step (org setting) gating live outreach; surface an event-level activity/audit timeline (reuse `agent_runs` + add actor stamps); make Edit Brief show a diff + "this will affect scoring on the next wave" confirmation.

## P1 — No undo / no stop (Buyer)
- Discovery wave can't be paused/stopped once launched (`runWave()` runs to completion).
- Moving suppliers between funnel stages has **no undo** — mis-clicking "Decline" means manually restoring one by one.
- **Fix:** "Stop wave" button (abort the SSE stream + mark wave cancelled); a toast with "Undo" after every stage change.

---

## P2 — Polish that compounds trust

- **Errors hide in the log:** wave/stream failures only append an `ERR` line to the activity log (`:836`); a new user won't notice. → Surface a dismissible error banner/toast.
- **Onboarding is implicit:** first-run is just an empty dashboard card. → A 3-step "how it works" strip on first event, and inline guidance on how to structure the `requirements` field (it drives scoring but gets only a generic hint).
- **Mobile detail panel** overlays the table with no obvious close on `<lg`. → Add a sticky close bar + `Esc`.
- **CSV export** only exports the filtered view with no "export all" option. → Add scope toggle.
- **Owner cost visibility** stops at per-event token/cost in the header (`:1184`). No trends, no most-expensive-events, no spend forecast. → A lightweight admin usage view over the existing `usage.ts` aggregates.
- **No email deliverability signal:** bounces/opens aren't tracked; buyer can't tell a "contacted" supplier never received the mail (live-send failures degrade to a silent warning, `qualify:104`). → Track bounce/delivery status and badge it on the supplier row.

---

## Suggested sequencing
1. **Week 1 (P0 trust):** outreach confirmation modal + test-send; 402→upgrade modal + trial badge; modal `Esc`/focus/`aria-live` pass.
2. **Week 2 (P0 funnel):** branded sending domain + `/rfi/[token]` supplier landing/response page.
3. **Week 3 (P1 governance):** audit timeline + optional outreach-approval gate; stage-change undo + stop-wave.
4. **Week 4 (P2):** error toasts, onboarding strip, deliverability badges, owner usage view.

---

## Panel scores (converged)
| Dimension | Buyer | Approver | Supplier | Owner |
|---|---|---|---|---|
| Grounded (code-tied) | 9 | 9 | 8 | 8 |
| Severity-true | 9 | 9 | 9 | 8 |
| Actionable | 9 | 8 | 8 | 8 |
| Stakeholder-complete | 8 | 9 | 9 | 8 |

**FINAL SCORE 8.5/10 · KEEP.** Weakest element resolved across iterations: supplier + approver coverage (v0 under-weighted both). **Direction that stuck:** rank by revenue/trust impact and give the two neglected stakeholders first-class treatment. **What didn't move the score:** adding more P2 cosmetic items — reviewers penalized breadth-over-depth.
