# Phase 1: Rename & Brand Migration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-15
**Phase:** 1-Rename & Brand Migration
**Areas discussed:** Rename mechanics, Security-relevant prompt text, Contact/support
email addresses, Legal pages, Verification

**Mode:** `--auto` (config `mode: "yolo"`) — all gray areas auto-resolved to the
recommended option in a single pass, no AskUserQuestion prompts presented, per
`workflows/discuss-phase/modes/auto.md`.

---

## Rename mechanics

| Option | Description | Selected |
|--------|-------------|----------|
| Scripted case-aware find/replace across app/lib/components/tests/docs, excluding `-autoresearch` dirs | Matches backlog item #1's own "Recommended approach" | ✓ |
| Manual file-by-file rename | Slower, higher labor cost, no accuracy benefit for a mechanical text swap | |

**Selected:** Scripted case-aware find/replace (recommended default).
**Notes:** `package.json` name field included in the scripted pass (D-03).

---

## Security-relevant prompt text (`lib/agents.ts`)

| Option | Description | Selected |
|--------|-------------|----------|
| Manual, one-at-a-time rename of each "SourceIQ" mention in agent system prompts, with guard behavior re-verified after each swap | Required by BRAND-03; blind replace risks silently weakening the anti-impersonation/non-disclosure clause | ✓ |
| Include `lib/agents.ts` in the bulk scripted replace | Faster but explicitly disallowed by BRAND-03 — flagged as highest-severity rename risk in research (PITFALLS.md) | |

**Selected:** Manual, verified rename (per explicit requirement, not a preference).
**Notes:** ~10 call sites confirmed via grep (classifier, filter-mapper, orchestrator,
quick-scan, targeted-verification, qualifier ×2, enricher, contact-discovery,
outreach ×2, reply-classifier). The outreach non-disclosure clause (~line 1008-1010:
"Do NOT mention SourceIQ or any intermediary" / "Do NOT reveal the buyer's identity
(SourceIQ acts as intermediary)") is the single highest-risk clause — flagged for a
planner `checkpoint:decision` before the task that edits this file.

---

## Contact/support email addresses

| Option | Description | Selected |
|--------|-------------|----------|
| Swap brand word only within existing `sourceiq.org` domain structure (`support@sourceiq.org` → `support@sourcegpt.org`, etc.) | Domain/DNS ownership of `sourcegpt.org` is an out-of-scope external/business action for this phase; code should stay internally consistent | ✓ |
| Block the rename pending a confirmed new live domain | Backlog flagged this as an open question, but PROJECT.md already scopes domain migration out of this milestone's code changes | |

**Selected:** Swap brand word only, same domain shape.
**Notes:** Confirmed via grep: `support@sourceiq.org` (`app/settings/page.tsx`,
`components/AppShell.tsx`), `hello@sourceiq.org`, `privacy@sourceiq.org`
(`lib/legal.ts`).

---

## Legal pages

| Option | Description | Selected |
|--------|-------------|----------|
| Scripted swap + manual read-through pass on Privacy/Terms | Legal text carries meaning beyond branding; backlog's own recommended approach calls this out specifically | ✓ |
| Scripted swap only, no manual read | Faster but risks corrupting legal meaning on a mechanical replace | |

**Selected:** Scripted swap + manual read-through.

---

## Verification

| Option | Description | Selected |
|--------|-------------|----------|
| `npm run typecheck && npm run lint && npm test && npm run build` | Matches this repo's existing standing verification pattern (used for prior feature work) | ✓ |
| Partial verification (e.g. typecheck only) | Insufficient given the wide blast radius (~162 occurrences/~40 files) | |

**Selected:** Full verification suite.

---

## Claude's Discretion

- Exact internal variable/identifier renames beyond `package.json`'s name field
  (BRAND-02's "where reasonable to change") — left to planner/executor judgment.
- Whether the OG image / brand asset gets a new visual logo vs. a text-only swap — no
  asset was provided this session; text-only placeholder deemed acceptable.

## Deferred Ideas

- Trademark/naming-risk review of "SourceGPT" — legal/business call, explicitly out of
  scope per PROJECT.md.
- DNS/domain registration, Stripe/Clerk dashboard display-name edits, legal entity name
  changes — external actions, not this phase's code responsibility.
- New visual logo/wordmark design — deferred pending real brand assets.
