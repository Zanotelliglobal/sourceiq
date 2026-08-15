# Phase 1: Rename & Brand Migration - Context

**Gathered:** 2026-08-15 (auto mode — single-pass, all gray areas auto-resolved to
recommended defaults; no interactive prompts were presented, per `workflow.mode: yolo`)
**Status:** Ready for planning

<domain>
## Phase Boundary

Every user-facing and internal-code occurrence of "SourceIQ" becomes "SourceGPT" —
UI copy, page titles, OG image, emails, legal pages, i18n locales (de/es/fr/it),
`package.json` name, and internal code identifiers where reasonable. The two
security-relevant prompt clauses in `lib/agents.ts` (INJECTION_DEFENSE
anti-impersonation clause, outreach non-disclosure rules) get a manual, human-verified
rename rather than blind find/replace, and `tests/prompt-injection-defense.test.ts` gets
a manual review to confirm its brand-string usage is incidental fixture data. A
repo-wide case-insensitive grep for "SourceIQ" after the rename returns zero
unintended hits, except the two `-autoresearch` history directories (explicit,
documented exception). Out of scope: DNS/domain migration, Stripe/Clerk dashboard
display-name edits, legal entity-name changes, and trademark/naming-risk review of
"SourceGPT" — all external/business actions outside this repo's code (per
PROJECT.md Out of Scope).

</domain>

<decisions>
## Implementation Decisions

### Rename mechanics
- **D-01:** Use a scripted, case-aware find/replace (`SourceIQ`→`SourceGPT`,
  `sourceiq`→`sourcegpt`, `SOURCEIQ`→`SOURCEGPT`) across `app/`, `lib/`, `components/`,
  `tests/`, i18n locale files, and `docs/`, as the bulk mechanism for the ~162
  occurrences across ~40 files identified by the backlog's grep — **Reversibility:**
  reversible — a rename script run in the other direction undoes it; nothing here is a
  published external contract. [auto] (recommended default per backlog item #1's own
  "Recommended approach.")
- **D-02:** Exclude `sourceiq-ux-autoresearch/` and `procurement-app-autoresearch/`
  directories entirely from the scripted replace — these are historical
  research/planning artifacts, not shipped product, per BRAND-05's explicit documented
  exception. [auto]
- **D-03:** `package.json`'s `"name"` field bumps from `"sourceiq"` to `"sourcegpt"` as
  part of the scripted pass — **Reversibility:** reversible (no published npm package;
  internal identifier only). [auto]

### Security-relevant prompt text (`lib/agents.ts`)
- **D-04:** The INJECTION_DEFENSE anti-impersonation clause and outreach
  non-disclosure rules (confirmed present at lines ~1008-1010 — "Do NOT mention
  SourceIQ or any intermediary" / "Do NOT reveal the buyer's identity (SourceIQ acts as
  intermediary)") and every other literal "SourceIQ" brand mention inside agent system
  prompts (confirmed at ~10 call sites: classifier, filter-mapper, orchestrator,
  quick-scan, targeted-verification, qualifier ×2, enricher, contact-discovery,
  outreach ×2, reply-classifier) get renamed **manually, one at a time**, with each
  clause's guard behavior (i.e., the model still refuses to reveal the brand/
  intermediary identity) explicitly re-verified after the swap — not a blind
  scripted replace, per BRAND-03. — **Reversibility:** one-way if verification is
  skipped and a broken guard ships — a weakened anti-impersonation/non-disclosure
  clause could leak buyer identity or platform identity to a supplier in a live
  outreach email before anyone notices. [auto, but flagged high-severity per research
  SUMMARY.md — planner should carry this into a `checkpoint:decision` before the task
  that edits `lib/agents.ts`]
- **D-05:** `tests/prompt-injection-defense.test.ts` gets a manual read-through (not
  just "tests still pass") to confirm its brand-string usage is incidental fixture
  data rather than load-bearing for the guard logic, per BRAND-04, before and after the
  rename touches that file. [auto]

### Contact/support email addresses
- **D-06:** Confirmed via grep: all "SourceIQ" email addresses in code
  (`support@sourceiq.org` in `app/settings/page.tsx` and `components/AppShell.tsx`;
  `hello@sourceiq.org` and `privacy@sourceiq.org` in `lib/legal.ts`) share the same
  `sourceiq.org` domain. Auto-selected default: the scripted rename swaps the brand
  word only (`sourceiq.org` → `sourcegpt.org`), keeping the existing address
  structure — since actual domain/DNS ownership of `sourcegpt.org` is a business/
  external action out of scope for this phase (per PROJECT.md Out of Scope), not a
  code decision. — **Reversibility:** reversible in code; the external domain
  registration is a separate, out-of-scope concern already flagged in
  `docs/change-request-backlog.md` item #1's open questions. [auto]

### Legal pages
- **D-07:** Privacy and Terms pages (`app/legal/privacy/page.tsx`,
  `app/legal/terms/page.tsx`) get the scripted brand swap plus a manual read-through
  pass (per the backlog's own recommended approach) since they're user-facing legal
  text, not just UI chrome — a bad mechanical replace could corrupt legal meaning
  (e.g. mid-sentence capitalization or a company-name clause). [auto]

### Verification
- **D-08:** Full verification suite (`npm run typecheck && npm run lint && npm test &&
  npm run build`) runs after the rename, matching the project's existing pattern (this
  is exactly what backlog item #1 itself specifies, and matches how the prior
  Quick-Investigation feature work in this repo was verified). [auto]

### Claude's Discretion
- Exact internal variable/identifier renames beyond `package.json`'s name field (e.g.
  whether any internal function/type names literally contain "SourceIQ" and whether
  renaming them is "reasonable" per BRAND-02) are left to the planner/executor to
  judge case-by-case during implementation — no user preference was expressed beyond
  "where reasonable to change."
- Whether the design-system/wordmark asset (`design-system/MASTER.md`,
  `app/opengraph-image.tsx`) needs a new visual logo (not just text) vs. a plain
  text-only OG image swap is left to implementation — no brand asset was provided in
  this session; a text-based placeholder swap is acceptable (matches MKT-05's
  "placeholder acceptable if real assets aren't ready" precedent elsewhere in this
  milestone).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Backlog source
- `docs/change-request-backlog.md` §1 (lines 10-64) — full rename scope, grep counts,
  open questions, and the recommended scripted-replace approach.

### Requirements
- `.planning/REQUIREMENTS.md` — BRAND-01 through BRAND-05 (full acceptance criteria for
  this phase).

### Roadmap
- `.planning/ROADMAP.md` — Phase 1 goal and success criteria (lines 32-43).

### Research
- `.planning/research/PITFALLS.md` — critical-pitfall #1 (embedded brand string in
  `lib/agents.ts`'s INJECTION_DEFENSE clause; false-confidence risk from
  `tests/prompt-injection-defense.test.ts` passing without checking the literal brand
  word).
- `.planning/research/SUMMARY.md` — Key Findings / Critical Pitfalls section,
  Phase 1 rationale.

### Project context
- `.planning/PROJECT.md` — Out of Scope section (DNS/domain migration, Stripe/Clerk
  dashboard display-name edits, trademark review — none of these are this phase's
  code-change responsibility).

No external specs — requirements fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None specific to this phase — this is a repo-wide text substitution, not new
  functionality.

### Established Patterns
- Verification pattern: `npm run typecheck && npm run lint && npm test && npm run
  build` is the project's standing full-verification command (confirmed used for the
  prior Quick-Investigation feature work), and should gate this phase's completion
  too.
- ALTER-pattern schema changes (`lib/db.ts`) are NOT relevant to this phase — no schema
  touches text/branding only.

### Integration Points
- `lib/agents.ts` — ~10 agent system-prompt call sites reference "SourceIQ" by name
  (classifier, filter-mapper, orchestrator, quick-scan, targeted-verification,
  qualifier ×2, enricher, contact-discovery, outreach ×2, reply-classifier); two of
  these (outreach non-disclosure, line ~1008-1010) are the security-critical
  anti-impersonation guard requiring manual review (D-04).
- `tests/prompt-injection-defense.test.ts` — must be manually read, not just re-run,
  per D-05.
- `app/legal/privacy/page.tsx`, `app/legal/terms/page.tsx` — user-facing legal text
  requiring a manual read-through pass, per D-07.
- `lib/legal.ts`, `app/settings/page.tsx`, `components/AppShell.tsx` — contact email
  addresses (`support@sourceiq.org`, `hello@sourceiq.org`, `privacy@sourceiq.org`) that
  the scripted replace will touch (D-06).
- `package.json` — `"name": "sourceiq"` (D-03).
- i18n locale files (`lib/i18n/de.ts`, `es.ts`, `fr.ts`, `it.ts`, `config.ts`) — in
  scope per BRAND-01's explicit locale list.
- `app/opengraph-image.tsx`, `design-system/MASTER.md` — OG image / brand asset
  references (text-level swap only, per Claude's Discretion above).
- `sourceiq-ux-autoresearch/`, `procurement-app-autoresearch/` — excluded directories
  (D-02).

</code_context>

<specifics>
## Specific Ideas

No specific visual/asset references were provided in this session (no logo file, no
new domain confirmed). The scripted case-aware find/replace approach and exclusion
list come directly from the backlog document's own "Recommended approach," which this
context adopts as-is rather than inventing a different mechanism.

</specifics>

<deferred>
## Deferred Ideas

- Trademark/naming-risk review of "SourceGPT" (flagged in the backlog as a legal/
  business call) — explicitly out of scope for this milestone's code changes, per
  PROJECT.md.
- DNS/domain registration of `sourcegpt.org`, Stripe/Clerk dashboard display-name
  edits, legal entity name changes — external/business actions, not this phase's
  responsibility.
- New visual logo/wordmark design for "SourceGPT" — no asset provided; deferred to
  whenever real brand assets exist (matches the placeholder-acceptable precedent used
  for MKT-05's demo video/screenshot slot elsewhere in this milestone).

### Reviewed Todos (not folded)
None — no pre-existing todo backlog items were found relevant to this phase's scope
during this pass.

</deferred>

---

*Phase: 1-Rename & Brand Migration*
*Context gathered: 2026-08-15*
