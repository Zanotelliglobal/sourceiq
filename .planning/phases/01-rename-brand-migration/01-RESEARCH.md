# Phase 1: Rename & Brand Migration - Research

**Researched:** 2026-08-15
**Domain:** Repo-wide brand string substitution (text/content rename), with one security-relevant prompt-text subtree
**Confidence:** HIGH (every finding below is grounded in a direct `grep`/`Read` of this repo done in this session, not training-data assumptions)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use a scripted, case-aware find/replace (`SourceIQ`→`SourceGPT`, `sourceiq`→`sourcegpt`, `SOURCEIQ`→`SOURCEGPT`) across `app/`, `lib/`, `components/`, `tests/`, i18n locale files, and `docs/`, as the bulk mechanism for the ~162 occurrences across ~40 files identified by the backlog's grep — **Reversibility:** reversible — a rename script run in the other direction undoes it; nothing here is a published external contract. [auto] (recommended default per backlog item #1's own "Recommended approach.")
- **D-02:** Exclude `sourceiq-ux-autoresearch/` and `procurement-app-autoresearch/` directories entirely from the scripted replace — these are historical research/planning artifacts, not shipped product, per BRAND-05's explicit documented exception. [auto]
- **D-03:** `package.json`'s `"name"` field bumps from `"sourceiq"` to `"sourcegpt"` as part of the scripted pass — **Reversibility:** reversible (no published npm package; internal identifier only). [auto]
- **D-04:** The INJECTION_DEFENSE anti-impersonation clause and outreach non-disclosure rules (confirmed present at lines ~1008-1010 — "Do NOT mention SourceIQ or any intermediary" / "Do NOT reveal the buyer's identity (SourceIQ acts as intermediary)") and every other literal "SourceIQ" brand mention inside agent system prompts (confirmed at ~10 call sites: classifier, filter-mapper, orchestrator, quick-scan, targeted-verification, qualifier ×2, enricher, contact-discovery, outreach ×2, reply-classifier) get renamed **manually, one at a time**, with each clause's guard behavior (i.e., the model still refuses to reveal the brand/intermediary identity) explicitly re-verified after the swap — not a blind scripted replace, per BRAND-03. — **Reversibility:** one-way if verification is skipped and a broken guard ships — a weakened anti-impersonation/non-disclosure clause could leak buyer identity or platform identity to a supplier in a live outreach email before anyone notices. [auto, but flagged high-severity per research SUMMARY.md — planner should carry this into a `checkpoint:decision` before the task that edits `lib/agents.ts`]
- **D-05:** `tests/prompt-injection-defense.test.ts` gets a manual read-through (not just "tests still pass") to confirm its brand-string usage is incidental fixture data rather than load-bearing for the guard logic, per BRAND-04, before and after the rename touches that file. [auto]
- **D-06:** Confirmed via grep: all "SourceIQ" email addresses in code (`support@sourceiq.org` in `app/settings/page.tsx` and `components/AppShell.tsx`; `hello@sourceiq.org` and `privacy@sourceiq.org` in `lib/legal.ts`) share the same `sourceiq.org` domain. Auto-selected default: the scripted rename swaps the brand word only (`sourceiq.org` → `sourcegpt.org`), keeping the existing address structure — since actual domain/DNS ownership of `sourcegpt.org` is a business/external action out of scope for this phase (per PROJECT.md Out of Scope), not a code decision. — **Reversibility:** reversible in code; the external domain registration is a separate, out-of-scope concern already flagged in `docs/change-request-backlog.md` item #1's open questions. [auto]
- **D-07:** Privacy and Terms pages (`app/legal/privacy/page.tsx`, `app/legal/terms/page.tsx`) get the scripted brand swap plus a manual read-through pass (per the backlog's own recommended approach) since they're user-facing legal text, not just UI chrome — a bad mechanical replace could corrupt legal meaning (e.g. mid-sentence capitalization or a company-name clause). [auto]
- **D-08:** Full verification suite (`npm run typecheck && npm run lint && npm test && npm run build`) runs after the rename, matching the project's existing pattern. [auto]

### Claude's Discretion
- Exact internal variable/identifier renames beyond `package.json`'s name field (e.g. whether any internal function/type names literally contain "SourceIQ" and whether renaming them is "reasonable" per BRAND-02) are left to the planner/executor to judge case-by-case during implementation — no user preference was expressed beyond "where reasonable to change." **Research finding: this discretion area is empty in practice — see "Internal Identifier Scan" below; there are zero TypeScript identifiers to rename.**
- Whether the design-system/wordmark asset (`design-system/MASTER.md`, `app/opengraph-image.tsx`) needs a new visual logo (not just text) vs. a plain text-only OG image swap is left to implementation — no brand asset was provided in this session; a text-based placeholder swap is acceptable.

### Deferred Ideas (OUT OF SCOPE)
- Trademark/naming-risk review of "SourceGPT" (flagged in the backlog as a legal/business call) — explicitly out of scope for this milestone's code changes, per PROJECT.md.
- DNS/domain registration of `sourcegpt.org`, Stripe/Clerk dashboard display-name edits, legal entity name changes — external/business actions, not this phase's responsibility.
- New visual logo/wordmark design for "SourceGPT" — no asset provided; deferred to whenever real brand assets exist.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BRAND-01 | Every user-facing surface (UI copy, page titles, OG image, emails, legal pages, i18n locales de/es/fr/it) reads "SourceGPT" | Full enumeration below (Section 1); i18n key/value structural risk documented (Section 6); UI-SPEC.md's layout-risk table already confirms zero layout breakage from the 1-char length delta |
| BRAND-02 | `package.json` name and internal code identifiers reflect the new name where reasonable | Verified `package.json`/`package-lock.json` are the only "identifier" surface — see "Internal Identifier Scan," zero TS identifiers found |
| BRAND-03 | `lib/agents.ts`'s INJECTION_DEFENSE/outreach non-disclosure string manually reviewed and renamed, guard behavior re-verified | Exact line numbers, full context, and the manual-review task boundary given in Section 2 |
| BRAND-04 | `tests/prompt-injection-defense.test.ts` manually reviewed to confirm brand string is incidental, not load-bearing | Definitively answered in Section 5 — both mentions are prose comments, zero assertions touch the literal string |
| BRAND-05 | Repo-wide case-insensitive grep for old name returns zero unintended hits, except the two `-autoresearch` dirs | Full enumeration + a third, previously-undocumented exclusion category discovered this session (`.planning/`, stray local artifacts, one orphaned SQLite file) — see Sections 1, 3, and Runtime State Inventory |
</phase_requirements>

## Summary

This phase is a text-substitution task, not new engineering — but the backlog's own scoping data (~162 occurrences / ~40 files) is **partially stale**. Re-running the identical `.ts`/`.tsx`-only grep this session reproduces the occurrence count exactly (162, verified) but the file count is **32, not ~40** `[VERIFIED: repo grep, this session]`. Widening the grep to every file type (docs, SVGs, config, lockfile) the phase's own D-01 scope already includes surfaces **353 occurrences across 66 files** `[VERIFIED: repo grep, this session]` — none of which change the mechanical approach, but several of which change *what should be excluded*.

Three findings materially extend what CONTEXT.md's exclusion list (`sourceiq-ux-autoresearch/`, `procurement-app-autoresearch/`) already covers, and the planner needs an explicit decision on each:

1. **`.planning/` itself matches the grep** (ROADMAP.md, REQUIREMENTS.md, PROJECT.md, this very CONTEXT.md/RESEARCH.md/UI-SPEC.md, codebase docs) because these are GSD workflow documents *about* the rename, written in before/after narrative form ("Roadmap: SourceIQ → SourceGPT"). A blind scripted replace over `.planning/` would corrupt these documents' own meaning (see Pitfall 1). Recommend treating `.planning/` as excluded from the scripted pass, same as the two `-autoresearch` dirs, and documenting it explicitly as a third exception in BRAND-05's acceptance check.
2. **A tracked, unused, 3.9MB SQLite file (`sourceiq.db`)** sits at the repo root, added in the initial commit and never touched since, containing real generated outreach-email content with the brand string embedded in prose (`[VERIFIED: sourceiq.db binary strings scan, this session]`). It is not referenced by any current source file and the app now requires `DATABASE_URL`/Neon Postgres with no sqlite fallback path in code — this is dead weight from before the Postgres migration, already flagged as "legacy" in `.planning/codebase/STRUCTURE.md:162` `[VERIFIED: .planning/codebase/STRUCTURE.md:162]`. Its filename alone will trip a naive `grep -r sourceiq` check; its binary content must never be touched by a text-substitution script (see Pitfall 2).
3. **Untracked local scratch artifacts** (`.file_issues.tmp.py`, `finish-backlog.sh`, `finish-backlog2.sh`, `.claude/worktrees/`, `.claude/plans/`, `.claude/session-agents/`) also match the grep but are not part of the committed/shipped repo (`git status --short` shows them as `??`) and one of them has a hardcoded absolute path containing the literal string `sourceiq` that refers to *this actual on-disk folder name* — not the product brand — which must never be touched by the rename script.

**Primary recommendation:** Build a small, dependency-free Node.js script (not a shell `sed` one-liner) that operates only over `git ls-files`-tracked paths within an explicit allowlist of directories, applies the three case variants, supports `--dry-run` (prints a unified diff, writes nothing), and handles the two brand SVGs' *filenames* as an explicit `git mv` step separate from their text content. Run the scripted pass first over the safe bulk category, then handle `lib/agents.ts`, the legal pages, and `tests/prompt-injection-defense.test.ts` as separate, manually-reviewed edits per CONTEXT.md's D-04/D-05/D-07.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| UI copy / page titles / OG image brand string | Frontend Server (SSR) / Browser | — | Rendered by Next.js page/layout/component files; no client-only state involved |
| Agent system-prompt brand string (`lib/agents.ts`) | API / Backend | — | Prompt construction happens server-side inside route handlers before the Anthropic SDK call; never reaches the browser as source |
| i18n locale dictionaries | Frontend Server (SSR) / Browser | — | `lib/i18n/*.ts` dictionaries are imported into client components; the lookup key is the English string itself (see Section 6) |
| Contact-scraper User-Agent header | API / Backend | — | `lib/contact.ts` sends this as an outbound HTTP header when the app itself fetches supplier websites |
| `package.json`/`package-lock.json` name field | Build / Tooling | — | Read by npm at install/build time; not runtime application behavior |
| Legacy `sourceiq.db` SQLite file | Database / Storage (dead) | — | Not connected to by any current code path; Neon/Postgres is the only active data tier (`lib/db.ts` requires `DATABASE_URL`) |

## Standard Stack

No new libraries are needed for this phase — it is a text substitution over an existing, unchanged stack. There is no "Standard Stack" table in the conventional sense; the only tooling decision is the rename mechanism itself, covered under **Architecture Patterns** below.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| A dependency-free Node.js script (recommended) | Shell one-liner with `sed -i` / `perl -pi -e` looped over `grep -rl` | GNU vs BSD `sed -i` flag incompatibility is a known footgun on macOS (this machine is Darwin); a shell loop also has no built-in dry-run/diff step, and mixing three case variants in one `sed` invocation is error-prone with word-boundary edge cases. A Node script gets safe multi-pattern replace, JSON-safe handling, and a diff preview with zero new dependencies. |
| A dependency-free Node.js script (recommended) | A third-party CLI rename tool (e.g. `sd`) | Introduces a new binary dependency that must be installed on the machine running the rename, and isn't used anywhere else in this repo — unnecessary given the task is finite and one-off. |
| Hand-editing `package-lock.json`'s two `"name"` fields | Running `npm install` after `package.json`'s name changes, to regenerate the lockfile | Manual lockfile edits are technically safe here (plain JSON, no other name-derived fields observed), but regenerating via `npm install` is the standard, self-consistent approach and avoids leaving other stale lockfile-internal name references unaddressed. |

**Installation:** None — no new packages.

## Package Legitimacy Audit

**N/A — this phase installs no external packages.** It is a pure content/text substitution across existing files; no new `npm install` occurs. This section is intentionally empty; skip the Package Legitimacy Gate for this phase.

## Architecture Patterns

### System Architecture Diagram

```
git ls-files (tracked paths only)
        │
        ▼
 ┌─────────────────────────────┐
 │ Rename script (Node, one-off)│
 │  1. Load allowlist of dirs   │──▶ app/, lib/, components/, tests/,
 │     (from D-01 + gaps found  │    lib/i18n/*, docs/, package.json,
 │     this session)            │    package-lock.json, start.sh, README.md
 │  2. Exclude blocklist        │──▶ sourceiq-ux-autoresearch/,
 │     (D-02 + 3 new findings)  │    procurement-app-autoresearch/,
 │                              │    .planning/, sourceiq.db,
 │                              │    .claude/worktrees|plans|session-agents,
 │                              │    finish-backlog*.sh, .file_issues.tmp.py
 │  3. For each remaining file: │
 │     - skip lib/agents.ts,    │──▶ routed to MANUAL pass (D-04)
 │       tests/prompt-injection-│
 │       defense.test.ts (D-05),│
 │       legal pages (D-07)     │──▶ routed to scripted PLUS manual read
 │     - apply 3 case variants  │
 │       (SourceIQ/sourceiq/    │
 │       SOURCEIQ)               │
 │  4. --dry-run: print diff,   │
 │     write nothing            │
 │  5. Real run: write files,   │
 │     `git mv` the two brand   │
 │     SVG filenames separately │
 └─────────────────────────────┘
        │
        ▼
 Manual pass (lib/agents.ts, tests/prompt-injection-defense.test.ts, legal pages)
        │
        ▼
 npm run typecheck && npm run lint && npm test && npm run build   (D-08)
        │
        ▼
 Final grep sweep: `grep -rio sourceiq` over tracked files,
 excluding the 3 documented exception categories → must return zero
```

### Recommended Project Structure
No new directories. The rename script itself is disposable — recommend placing it at `scripts/rename-brand.mjs` (there is already a `scripts/` directory per `.planning/codebase/STRUCTURE.md:161`, "Build/deployment scripts") and deleting it after the phase completes (its job is one-off, not a permanent tool).

### Pattern 1: Allowlist-and-blocklist scripted replace with dry-run
**What:** A Node script that (a) enumerates candidate files via `git ls-files` scoped to an explicit directory allowlist, (b) subtracts an explicit blocklist, (c) applies the three case-paired replacements, (d) defaults to printing a diff and exits without writing unless `--write` is passed.
**When to use:** Any wide-blast-radius, mechanically-uniform text substitution over a git-tracked codebase where the git history itself provides the audit trail (a real, committed diff) once applied for real.
**Example:**
```javascript
// Source: no external reference — this is a standard, minimal pattern for
// auditable bulk find/replace; no framework/library involved.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const ALLOW_DIRS = ["app/", "lib/", "components/", "tests/", "docs/"];
const ALLOW_FILES = ["package.json", "package-lock.json", "start.sh", "README.md"];
const BLOCK_PATHS = [
  "lib/agents.ts",                       // manual pass, D-04
  "tests/prompt-injection-defense.test.ts", // manual pass, D-05
  "app/legal/privacy/page.tsx",           // scripted + manual read, D-07
  "app/legal/terms/page.tsx",             // scripted + manual read, D-07
];
const PAIRS = [
  ["SourceIQ", "SourceGPT"],
  ["sourceiq", "sourcegpt"],
  ["SOURCEIQ", "SOURCEGPT"],
];

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((p) => ALLOW_DIRS.some((d) => p.startsWith(d)) || ALLOW_FILES.includes(p))
  .filter((p) => !BLOCK_PATHS.includes(p));

const write = process.argv.includes("--write");
for (const path of tracked) {
  const before = readFileSync(path, "utf8");
  let after = before;
  for (const [from, to] of PAIRS) after = after.split(from).join(to);
  if (after !== before) {
    if (write) writeFileSync(path, after);
    else console.log(`--- would change: ${path}`);
  }
}
```
**Note:** `.split(from).join(to)` is used deliberately instead of a regex — it needs no escaping and has no catastrophic-backtracking risk, and the three patterns are plain literals, not regex-special characters.

### Anti-Patterns to Avoid
- **Running the scripted pass over the entire working directory (not `git ls-files`-scoped):** would touch `node_modules/`, `.next/`, and any untracked scratch files (see Runtime State Inventory) that must not be part of this rename.
- **Treating "docs/" as one uniform bucket:** some docs are narrative descriptions of the migration itself (`docs/change-request-backlog.md`) and read `renaming from SourceIQ to SourceGPT` — a blind replace turns this into `renaming from SourceGPT to SourceGPT`, erasing the sentence's meaning (see Pitfall 1). These need a manual read-through, same tier as the legal pages, not blind script treatment.
- **Editing `sourceiq.db` (or any binary file) with a text-based find/replace:** SQLite's on-disk format is not safe to string-replace byte-for-byte (page offsets, varint-encoded record lengths, and checksums would break) even though the two brand words differ by only one character. If this file's data is ever judged worth updating, that requires an actual `UPDATE` SQL statement via a SQLite client, never a text patch. Given it's dead/unused code (see Summary), the simpler and recommended resolution is to leave its content untouched and treat the file itself as an explicit BRAND-05 exception (or delete it from tracking as an unrelated cleanup — a judgment call for the planner, not decided by this research).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-platform case-aware find/replace | A `sed -i` shell loop | The Node script pattern above | Avoids GNU/BSD `sed -i` flag incompatibility (this machine is Darwin/BSD sed) and gives a free, zero-dependency dry-run/diff mode |
| Verifying "no unintended hits remain" | A manual visual scan of the diff | `git ls-files -z | xargs -0 grep -rio sourceiq` (scoped, minus documented exceptions) run as an explicit final CI-style check, ideally as a one-line addition to the verification command in D-08 | A programmatic grep is exhaustive and repeatable; a manual scan of a 66-file, 353-occurrence diff will miss things |

**Key insight:** This phase has no genuine "hand-roll vs. library" tradeoff — its only real risk is *scope precision* (what's in vs. out of the scripted pass), not tooling sophistication.

## Runtime State Inventory

> Included because this is a rename phase (Step 2.5 trigger).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **`sourceiq.db`** (repo root, tracked, 3.9MB, SQLite 3.x, last committed 2026-07-04 in the initial commit, never modified since — `git log -1`: `db29c83 Initial commit: SourceIQ AI supplier sourcing tool`). Binary content-scan (`strings`) confirms it contains real generated outreach-email text with the brand string embedded in email bodies (e.g. "SourceIQ Outreach Team", "I represent SourceIQ and am acting as an intermediary..."). `[VERIFIED: sourceiq.db strings scan + git log, this session]` | **No code edit and no data migration** — this file is not read by any current code path (`lib/db.ts` requires `DATABASE_URL`/Neon Postgres and has no local-sqlite fallback branch; `package.json` has no `better-sqlite3` dependency). Recommend documenting it as a third BRAND-05 exception (leave untouched, same as the `-autoresearch` dirs) OR, as an out-of-band cleanup decision for the planner/human, remove it from git tracking entirely since `.planning/codebase/STRUCTURE.md:162` already calls it "legacy." Either way: **never** run the text-substitution script against this file. |
| Live service config | None found requiring code-level action. Stripe/Clerk dashboard display names and any Stripe product/price display names are explicitly out of scope per PROJECT.md (external dashboard edits, not code) — already correctly excluded by CONTEXT.md's own Phase Boundary. `SENTRY_DSN`-adjacent code (`lib/observability.ts:148`) sends a `sentry_client=sourceiq/1.0` string as an HTTP header value to Sentry's ingest API — this is an arbitrary client-name label Sentry does not validate against a pre-registered name, so it's a safe, in-scope, cosmetic scripted-pass edit, not a "live service config" risk. | Include `lib/observability.ts` in the scripted pass (already covered by the `lib/` allowlist); no external action needed. |
| OS-registered state | None found. This is a Next.js web app with no OS-level task scheduler, `pm2`, `launchd`, or `systemd` registration anywhere in the repo. `[VERIFIED: repo search, this session — no matching files/patterns found]` | None. |
| Secrets/env vars | Confirmed via source grep: **zero** `process.env.SOURCEIQ_*`-prefixed variable names anywhere in `.ts`/`.tsx` source `[VERIFIED: grep -rin "process\.env\..*sourceiq" across repo, this session — zero hits]`. All env var names used are domain-neutral (`SUPPORT_EMAIL`, `PRIVACY_EMAIL`, `NEXT_PUBLIC_APP_URL`, `MAIL_PROVIDER`, `STRIPE_*`, `ANTHROPIC_API_KEY`, etc.) — only their *fallback default values* contain `sourceiq.org` as a literal string (`lib/legal.ts:14,16,17`), which is exactly D-06's already-agreed scripted swap. **Caveat:** `.env.local` and `.env.example` exist in this repo but this research session's sandbox permissions explicitly deny reading `.env*` files (confirmed: both `Read` and `Bash` tool calls against `.env.example` returned `Operation not permitted`) — their contents were not inspected. This is a acceptable gap because the decision-relevant fact is env var *names* referenced by code (verified clean above), not the values a human may have put in a local, gitignored file; recommend the executor re-confirm with a quick `grep -i sourceiq .env.local .env.example` from their own unrestricted shell before considering BRAND-05 fully closed. | None required in code; one quick manual confirmation recommended (see caveat) before final BRAND-05 sign-off. |
| Build artifacts | `package-lock.json` (tracked — contrary to `.claude/CLAUDE.md`'s claim that it's "not committed to version control per Next.js conventions"; `git ls-files -- package-lock.json` confirms it **is** tracked `[VERIFIED: git ls-files, this session]`) has 2 occurrences of `"name": "sourceiq"`. No other build artifact (`.next/`, dist output) is tracked — both are gitignored per `.gitignore`. | Regenerate `package-lock.json` via `npm install` after `package.json`'s name field changes, rather than hand-editing it, to keep the lockfile self-consistent (standard practice, not a hard requirement here since only the `name` field is affected). |

## Common Pitfalls

### Pitfall 1: Blind scripted replace corrupts narrative "before → after" prose describing the rename itself
**What goes wrong:** Several documents describe the migration using the old name as a historical reference point inside an otherwise-uniform sentence — e.g. `docs/change-request-backlog.md`: *"The startup is renaming from SourceIQ to SourceGPT"* `[VERIFIED: docs/change-request-backlog.md:16, this session — quoted verbatim]`. A blind `sourceiq→sourcegpt` substitution only matches the "SourceIQ" token (the word "SourceGPT" doesn't itself contain "sourceiq"), turning the sentence into *"renaming from SourceGPT to SourceGPT"* — mechanically correct per the substitution rule, but semantically nonsensical; it erases the fact that a rename happened at all.
**Why it happens:** The substitution is purely lexical (does the substring match), but "does this sentence describe the change itself" is a semantic property invisible to a text-matching script.
**How to avoid:** Treat any file whose *purpose* is to narrate the before/after transition (not just mention the brand in passing) as requiring a manual read-through before/instead of the blind script, same tier as the legal pages (D-07). Concretely: `docs/change-request-backlog.md` (the canonical backlog source itself, already a **canonical reference** per CONTEXT.md — do not silently rewrite its own historical narrative), `README.md` (currently just `# SourceIQ` as a title — safe for blind swap, low risk), `.claude/CLAUDE.md` (`SourceIQ (renaming to SourceGPT)` — same narrative-corruption risk as the backlog doc), and the entire `.planning/` tree (ROADMAP.md, REQUIREMENTS.md, PROJECT.md, and this phase's own CONTEXT.md/RESEARCH.md/UI-SPEC.md — all titled things like "Roadmap: SourceIQ → SourceGPT").
**Warning signs:** Post-rename grep of `docs/` or `.planning/` shows sentences reading "renaming from SourceGPT to SourceGPT" or "SourceGPT (renaming to SourceGPT)".

### Pitfall 2: Treating `sourceiq.db`'s filename hit the same as a text-content hit
**What goes wrong:** BRAND-05's "repo-wide grep returns zero unintended hits" is naturally checked with a content grep (`grep -rio sourceiq`), but this misses filename-level hits (a file literally named `sourceiq.db`, `sourceiq-wordmark.svg`, `sourceiq-mark-square.svg`) unless the check also runs `git ls-files | grep -i sourceiq`. Separately, if someone *does* notice the `.db` filename and reflexively runs the same text-substitution script against its contents (rather than just considering a rename/exclusion), the binary file will corrupt — SQLite's page format is not safe for arbitrary-length string substitution.
**Why it happens:** "Grep for the brand string" is conventionally a content check; filenames are a distinct, easy-to-forget surface, and a script that walks `git ls-files` for content substitution can trivially be extended to also try to open every matched byte range — including inside a binary file — if the substitution logic isn't filtered to text files first.
**How to avoid:** Run the filename check explicitly (`git ls-files | grep -i sourceiq`) as a distinct step from the content grep. For the two brand SVGs (which ARE plain-text XML and safe for content substitution), do a `git mv` for the filename rename as a separate, explicit step — the recommended Node script example above already excludes `sourceiq.db` via the directory allowlist (it's neither in `docs/` nor any other allowed directory), so the binary-corruption risk doesn't arise if the allowlist is followed strictly.
**Warning signs:** A rename script log shows it opened `sourceiq.db` at all; `git diff --stat` after the "real run" shows a huge binary diff for that file (a sign a text tool touched it and corrupted the format — SQLite files show as fully-changed binary blobs under `git diff`, not a clean line-level diff).

### Pitfall 3: i18n dictionary keys and their calling components silently fall out of sync
**What goes wrong:** This codebase's i18n system is gettext-style: the calling component's literal English string doubles as the dictionary lookup key (`lib/i18n/config.ts:3-4`: *"English is the source language: strings in the code are written in English and used directly as translation keys... so English never needs a dictionary"* `[VERIFIED: lib/i18n/config.ts:1-4, this session — quoted verbatim]`). Concretely: `components/OnboardingChecklist.tsx:108` calls `t("Welcome to SourceIQ")`, and `lib/i18n/de.ts:91` has the exact-match key `"Welcome to SourceIQ": "Willkommen bei SourceIQ"` `[VERIFIED: components/OnboardingChecklist.tsx:108 and lib/i18n/de.ts:91, this session]`. **If the scripted pass renames the dictionary key in `de.ts`/`es.ts`/`fr.ts`/`it.ts` to `"Welcome to SourceGPT"` in the same run as it renames the call site's literal in `OnboardingChecklist.tsx` to `t("Welcome to SourceGPT")`, the lookup stays in sync automatically** (both sides are touched by the identical string-literal substitution in one pass). The risk is only if these are edited **out of sync** — e.g. a partial/staged rollout that updates `components/` in one commit and `lib/i18n/` in a later one, or any manual touch-up to one side without the other. A key miss for this framework's likely fallback behavior would silently revert that string to the raw (post-rename) English key text for non-English users, not throw an error.
**Why it happens:** The key-as-literal-string pattern has no structural/compile-time link between the call site and the dictionary — TypeScript sees both as plain strings, so nothing catches a mismatch except a runtime miss.
**How to avoid:** Apply the scripted pass to `app/`, `lib/`, `components/`, and `lib/i18n/*` **atomically, in one script invocation** (per D-01's own directory list — do not split this into separate PRs/commits per directory). After the pass, spot-check a handful of `t("...")` call sites in `components/`/`app/` against their corresponding key in each locale file to confirm exact-string match (not just "the file compiles").
**Warning signs:** A non-English locale user sees an English string bleed through in an otherwise-translated screen post-rename — this is the one regression class that automated typecheck/lint/build (D-08) would not catch, since both sides are valid, non-crashing strings; only a manual locale spot-check catches this.

### Pitfall 4: Assuming the 32-file `.ts`/.tsx` list is the whole scripted-pass scope
**What goes wrong:** The backlog's own scoping data (~40 files) undercounts the *directory-scoped* file set once `docs/`, i18n, `package.json`, and the two SVGs are folded in per D-01's actual scope statement (app/, lib/, components/, tests/, i18n, docs/) — and additionally misses `start.sh` (a tracked, real launch script with 2 brand mentions in its header comment, not currently listed in any scope document) and `README.md` (tracked, title-only mention). Both are legitimate, shipped, git-tracked project files that a scripted pass restricted only to the literally-named directories in D-01 would skip.
**Why it happens:** D-01's directory list (`app/`, `lib/`, `components/`, `tests/`, i18n, `docs/`) was written against the backlog's original `.ts`/`.tsx`/`docs/` grep, which doesn't include root-level `.sh`/`.md` files outside those directories.
**How to avoid:** Add `start.sh`, `README.md`, and `package-lock.json` (via `npm install` regeneration, see Runtime State Inventory) as explicit additional scripted-pass targets alongside D-01's directory list; the planner should treat this as a small, low-risk scope addition, not a new decision requiring user sign-off (both files are cosmetic-only mentions, per Section 1 below).
**Warning signs:** Post-rename `git ls-files | xargs grep -i sourceiq` (unrestricted, not directory-scoped) still returns `start.sh` or `README.md`.

## Code Examples

### 1. Final BRAND-05 verification sweep (recommended addition to D-08's verification suite)
```bash
# Source: no external reference — derived directly from this session's grep methodology.
# Run from repo root after both the scripted pass and the manual lib/agents.ts pass.
git ls-files -z | xargs -0 grep -Zlio sourceiq \
  | grep -zv -E '^(sourceiq-ux-autoresearch/|procurement-app-autoresearch/|\.planning/|sourceiq\.db$)' \
  | tr '\0' '\n'
# Expect: empty output. Anything printed is an unintended hit.

# Separate filename-only check (content grep above will not catch a hit that's
# only in the path, e.g. a renamed-content-but-not-filename SVG):
git ls-files | grep -i sourceiq | grep -v -E '^(sourceiq-ux-autoresearch/|procurement-app-autoresearch/|sourceiq\.db$)'
# Expect: empty output.
```

### 2. Manual re-verification of `lib/agents.ts`'s guard behavior after the D-04 manual pass
```bash
# Source: derived directly from PITFALLS.md's own recommendation, cross-checked
# against tests/prompt-injection-defense.test.ts's actual assertions this session.
grep -i sourceiq lib/agents.ts   # must return zero lines
npm test -- tests/prompt-injection-defense.test.ts   # structural check only — see Section 5, does NOT prove the rename was done
# The test asserts `${INJECTION_DEFENSE}` placeholder presence and function
# existence, never the literal brand string — a human must additionally read
# lib/agents.ts lines 48-60 (INJECTION_DEFENSE body) and 1000-1010 (outreach
# non-disclosure clause) to confirm the *replaced* string still reads coherently
# as a guard instruction, not just "contains SourceGPT somewhere."
```

## State of the Art

N/A — this is a mechanical content-substitution task with no meaningfully "outdated approach" to modernize; the recommended pattern (git-ls-files-scoped Node script with dry-run) is a general best practice, not a version-dated framework capability.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `.planning/` should be treated as a third documented BRAND-05 exception (not scripted or manually renamed this phase) | Summary, Pitfall 1 | If the planner instead decides `.planning/` should be renamed, every phase-history doc referencing "SourceIQ → SourceGPT" as a before/after pair needs its own manual read-through (same treatment as legal pages), not a blind pass — this is a scope decision this research recommends but does not have explicit user sign-off for, since CONTEXT.md's D-02 exclusion list only names the two `-autoresearch` dirs |
| A2 | `sourceiq.db` should be left untouched and documented as a fourth exception, rather than deleted from git tracking or renamed | Summary, Runtime State Inventory, Pitfall 2 | If a human later discovers this file *is* still relied on by some out-of-repo tooling or a demo script this research didn't find, leaving stale "SourceIQ"-branded content inside it is a low-severity but real inconsistency; conversely, deleting it from tracking is an assumption this research does not have authority to make unilaterally (it's a "clean up dead weight" judgment call, not a rename requirement) |
| A3 | `start.sh` and `README.md` should be added to the scripted pass's target list even though D-01 doesn't name them explicitly | Pitfall 4 | Low risk either way — both are cosmetic-only comment/title mentions; omitting them just leaves 2-3 stray "sourceiq" hits that a careful final BRAND-05 grep sweep (Code Example 1) would catch anyway |
| A4 | `.claude/CLAUDE.md`'s project-description line ("SourceIQ (renaming to SourceGPT)") should be updated to reflect the new name once this phase ships, rather than left as a historical note | Pitfall 1 | If left unchanged, the project's own living instructions file continues describing a rename that has already completed, which will read as stale/confusing to future sessions — but this is a CLAUDE.md content decision outside this repo's shipped product, so it's flagged as discretionary, not a hard requirement |

**All four assumptions above stem from gaps this research found in CONTEXT.md's exclusion list (which only documents the two `-autoresearch` dirs) — none contradict a locked decision; they extend the same reasoning CONTEXT.md already applied to the `-autoresearch` dirs to three more cases this session surfaced.**

## Open Questions

1. **Should `.planning/` be excluded from the scripted pass, and should BRAND-05's acceptance grep exclude it explicitly?**
   - What we know: `.planning/` contains 6+ files matching the grep, all of them GSD workflow/history documents narrating the rename itself.
   - What's unclear: whether the user/planner wants these updated for consistency anyway (treating `.planning/` as "any other doc") or preserved as historical record (this research's recommendation).
   - Recommendation: Exclude, document as a third exception alongside the two `-autoresearch` dirs — consistent with how CONTEXT.md already treats other historical-record directories.

2. **Should `sourceiq.db` be deleted from git tracking as part of this phase, or merely documented as an exception and left alone?**
   - What we know: it's dead, unused, legacy, already labeled as such in `.planning/codebase/STRUCTURE.md`.
   - What's unclear: whether removing a 3.9MB tracked binary is considered in-scope "cleanup" for a rename phase, or scope creep belonging to a separate housekeeping task.
   - Recommendation: Document as an exception this phase (lowest-risk path); flag deletion as an optional follow-up, not a blocker for BRAND-05.

3. **`.env.local`/`.env.example` were not directly inspected this session (sandbox permission denial) — is a human-run `grep -i sourceiq` against them still needed before BRAND-05 is signed off?**
   - What we know: no `SOURCEIQ`-prefixed env var *names* exist anywhere in source code (verified).
   - What's unclear: whether either file's *values* (not names) contain a literal `sourceiq` string that a human should also update (e.g., a locally-set `NEXT_PUBLIC_APP_URL=https://app.sourceiq.org` override) — this doesn't affect BRAND-05's code-level acceptance criterion, but is worth a 10-second manual check.
   - Recommendation: Add as a `checkpoint:human-verify` note in the plan, not a blocking task.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Rename script execution | ✓ | v24.17.0 | — |
| npm | `npm install` (lockfile regen), verification suite | ✓ | 11.13.0 | — |
| git | `git ls-files`-scoped rename script, `git mv` for SVG renames, final grep sweep | ✓ | 2.50.1 | — |

No missing dependencies. This phase requires nothing beyond what's already installed and used by the existing project.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.9 (confirmed in `package.json` dependencies and `vitest.config.ts`) |
| Config file | `vitest.config.ts` — `include: ["tests/**/*.test.ts"]` `[VERIFIED: vitest.config.ts:16, this session]` |
| Quick run command | `npx vitest run tests/prompt-injection-defense.test.ts` |
| Full suite command | `npm test` (→ `vitest run`, per `package.json` `scripts.test`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BRAND-01 | No stray "SourceIQ" strings remain in user-facing surfaces | scripted grep (not a vitest test) | `git ls-files -z \| xargs -0 grep -Zlio sourceiq \| ...` (Code Example 1) | ✅ — add as a manual/CI step, not a new test file |
| BRAND-02 | `package.json` name is `sourcegpt`; no stray TS identifiers named after the old brand | manual + one grep | `grep -n '"name"' package.json`; `grep -rn "sourceiq[A-Z]" --include=*.ts*` (already run this session, zero hits) | ✅ N/A — verified zero identifiers exist; no new test needed |
| BRAND-03 | `lib/agents.ts` guard behavior unchanged after manual rename | manual read-through (not automatable — no seam to intercept live Anthropic calls, per the existing test file's own comment) | `npm test -- tests/prompt-injection-defense.test.ts` (structural only) + human read of lines 48-60, 1000-1010 | ✅ existing file; human step is the actual verification |
| BRAND-04 | `tests/prompt-injection-defense.test.ts`'s brand-string usage confirmed incidental | already done this research session — see Section 5 (definitive answer below) | N/A (research-time verification, not a runtime test) | ✅ |
| BRAND-05 | Zero unintended repo-wide hits | scripted grep sweep | Code Example 1 above | ✅ — recommend adding as a literal step appended to D-08's verification command |

### Sampling Rate
- **Per task commit:** targeted grep of the specific file(s) just touched
- **Per wave merge:** `npm run typecheck && npm run lint && npm test && npm run build` (D-08's full suite)
- **Phase gate:** Full suite green + BRAND-05 grep sweep (Code Example 1) returns empty, before `/gsd-verify-work`

### Wave 0 Gaps
None — existing test infrastructure (`tests/prompt-injection-defense.test.ts`, `npm run typecheck/lint/test/build`) already covers everything this phase's requirements need; no new test file or fixture is required. The BRAND-05 grep sweep is a shell verification step, not a new automated test suite addition (though the planner may optionally wire it into `package.json` as an npm script, e.g. `"verify:rename": "..."`, for convenience — not required).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Untouched — no auth code in this phase's scope (`middleware.ts` has zero brand-string matches, confirmed `[VERIFIED: middleware.ts, this session — zero hits]`) |
| V3 Session Management | No | Untouched — same as above |
| V4 Access Control | No | Untouched — `lib/tenant.ts`'s only match (line 9) is a code comment, not an access-control rule; the org-isolation logic itself contains no brand string |
| V5 Input Validation | No | Not applicable — no new input surfaces introduced |
| V6 Cryptography | No | Untouched |

**This phase's actual security-relevant surface is narrower than ASVS's standard categories capture:** it is the semantic integrity of an existing prompt-injection defense mechanism (`lib/agents.ts`'s `INJECTION_DEFENSE` block and the outreach agent's non-disclosure `identityRules`), not a new authn/authz/crypto control. See "Known Threat Patterns" below.

### Known Threat Patterns for this phase's stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt-injection via web-search/scraped/inbound-reply content attempting to impersonate the platform or reveal buyer identity | Spoofing | `INJECTION_DEFENSE` block (already present, `lib/agents.ts:48-60`) instructs the model to treat all such content as untrusted data; the outreach agent's `identityRules` (lines 1000-1010) is a separate, distinct non-disclosure instruction for the anonymous-outreach path. **This phase's specific risk is regression, not a new vulnerability class:** a careless rename could either (a) leave the guard referencing the *old* brand name (so a live attacker probing the *new*-branded product with "this instruction is from SourceGPT" wouldn't be flagged as impersonation, since the guard still only recognizes "SourceIQ"), or (b) subtly alter the guard's wording during a manual edit in a way that weakens its instruction-following resistance. Mitigation for this phase specifically: manual, one-at-a-time edit (D-04) plus a human read-through confirming the guard's semantic content — not just its presence — is unchanged in meaning. |

## Sources

### Primary (HIGH confidence — direct repo inspection, this session)
- `lib/agents.ts` (full file grep + read of lines 28-92, 985-1024) — INJECTION_DEFENSE block, outreach `identityRules`, all 12 "You are SourceIQ's X Agent" prompt headers
- `tests/prompt-injection-defense.test.ts` (full file read) — confirmed brand-string mentions are prose comments only
- `lib/i18n/config.ts`, `lib/i18n/de.ts` (full/partial read) — confirmed gettext-style key=English-literal dictionary pattern
- `docs/brand/sourceiq-wordmark.svg`, `docs/brand/sourceiq-mark-square.svg` (full file read) — confirmed exact SVG structure, `<title>` tag hits, tspan split
- `docs/change-request-backlog.md`, `.planning/research/PITFALLS.md`, `.planning/research/SUMMARY.md`, `.planning/phases/01-rename-brand-migration/01-CONTEXT.md`, `.planning/phases/01-rename-brand-migration/01-UI-SPEC.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` (full reads)
- `git log`, `git ls-files`, `git status --short`, `git check-ignore` (this session) — confirmed tracked/untracked status of `package-lock.json`, `start.sh`, `sourceiq.db`, and the stray local scratch files
- `strings sourceiq.db` (this session) — confirmed binary file contains real generated outreach-email prose with the brand string embedded
- `.planning/codebase/STRUCTURE.md:162` — confirms `sourceiq.db` is already documented as "legacy"
- `.env.example`/`.env.local` — attempted read via both `Read` and `Bash` tools; both denied by sandbox permissions (documented as a gap, not silently skipped)

### Secondary (MEDIUM confidence)
None — no external web/documentation lookups were needed for this phase; it required no new library or framework research.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- File/occurrence enumeration: HIGH — every count in this document was reproduced via a live `grep`/`git ls-files` call this session, not carried over from the backlog's original (partially stale) numbers
- `lib/agents.ts` call-site mapping: HIGH — every line number quoted was confirmed via direct `Read`, not `grep` alone
- i18n key/value structural risk: HIGH — confirmed via direct read of both the calling component and the matching dictionary entry
- `sourceiq.db` disposition: HIGH confidence on "it's dead and unused" (multiple independent confirmations: no code reference, no `better-sqlite3` dependency, single-commit history, explicit "legacy" label in existing docs); MEDIUM confidence on "the correct action is to exclude rather than delete" (a judgment call, flagged as Open Question 2, not asserted as fact)
- Env var name cleanliness: HIGH for code-level names (verified via grep); explicitly flagged LOW/unverified for `.env.local`/`.env.example` *values* due to sandbox read denial (see Assumptions Log / Open Question 3)

**Research date:** 2026-08-15
**Valid until:** Effectively indefinite for the enumeration/pitfall findings (this is a point-in-time text-content snapshot of an unchanging problem domain) — but re-run the grep counts immediately before planning if any other work lands on this repo between now and plan creation, since any new file touching the brand string would silently invalidate the file/occurrence counts above.
