# Phase 1: Rename & Brand Migration - Pattern Map

**Mapped:** 2026-08-15
**Files analyzed:** ~66 files touched (scripted pass) + 3 manually-reviewed files (`lib/agents.ts`, `tests/prompt-injection-defense.test.ts`, legal pages) + 1 new disposable script
**Analogs found:** 4 / 4 pattern categories (script convention, verification command, i18n key convention, agent-prompt/test convention)

This phase is not new-feature work — it is a repo-wide text substitution plus a few
manually-reviewed security-sensitive edits. There are no "controller/component/service"
files being created. Pattern mapping here is about **conventions the rename script and
manual edits must follow**, not feature-code analogs.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `scripts/rename-brand.mjs` (new, disposable) | utility (one-off CLI script) | batch/transform | `scripts/check-audit.mjs` | exact — same directory, same "zero-dependency Node script with `node:` builtins only" convention |
| `package.json` (`scripts` block, optional `verify:rename` addition) | config | batch | existing `scripts` block (`typecheck`, `lint`, `test`, `build`) | exact |
| `lib/i18n/de.ts`, `es.ts`, `fr.ts`, `it.ts` (scripted edits to keys+values) | config/data (i18n dictionary) | CRUD (key lookup) | `lib/i18n/de.ts` itself (self-consistent — all 4 locale files share identical structure) | exact |
| `lib/i18n/config.ts` (`STORAGE_KEY = "sourceiq.lang"`) | config | — | n/a — flagged below as a discretion point, not a straightforward analog | partial |
| `lib/agents.ts` (manual edits, ~10 call sites + INJECTION_DEFENSE/identityRules) | service (agent prompt construction) | request-response (prompt text passed to Anthropic SDK) | itself — internally consistent prompt-header convention (`"You are SourceIQ's X Agent"`) repeated ~10x | exact (self-referential; no external analog needed, pattern is already uniform within the file) |
| `tests/prompt-injection-defense.test.ts` (manual read-through, D-05) | test | transform (static source-text assertions) | itself | exact |
| `app/legal/privacy/page.tsx`, `app/legal/terms/page.tsx` (scripted + manual read) | component (page) | request-response (SSR page) | each other (same page-component shape) | exact |
| `docs/brand/sourceiq-wordmark.svg`, `sourceiq-mark-square.svg` (content edit + `git mv` rename) | asset | transform | each other | exact |

## Pattern Assignments

### `scripts/rename-brand.mjs` (new utility script)

**Analog:** `scripts/check-audit.mjs` (the only existing file in `scripts/`)

**Repo convention confirmed by this file** (read in full this session):
- Shebang: `#!/usr/bin/env node`
- Zero third-party dependencies — only `node:child_process`, `node:fs`, `node:url`, `node:path` imports. Comment at lines 17-18 explicitly states this as a deliberate rule: *"Zero third-party dependencies, same rule as lib/observability.ts: this is CI-critical plumbing, not a place to add a new supply-chain surface."* — the rename script should follow the same zero-dependency rule (RESEARCH.md's own recommended script already does this, using only `node:child_process`/`node:fs`).
- Top-of-file banner comment block explaining *why* the script exists and what tradeoff it encodes (lines 2-18), not just *what* it does — matches CLAUDE.md's "Workarounds and rationale" comment convention.
- `__dirname` resolved via `path.dirname(fileURLToPath(import.meta.url))` since this is an ESM `.mjs` file — the rename script should use the same idiom if it needs a repo-root-relative path (its own recommended example in RESEARCH.md instead uses `execFileSync("git", ["ls-files"])` relative to cwd, which is also fine and avoids needing `__dirname` at all).
- Small, focused top-level functions (`loadAllowlist`, `ghsaId`, `runAudit`, `dedupe`) rather than one large monolithic script body — follow this decomposition style (e.g. separate `loadTrackedFiles()`, `applyReplacements(text)`, `main()` functions) instead of one flat script.
- Exits non-zero on failure condition (`process.exit(1)`) with a clear final message — the rename script's `--dry-run` mode should mirror this: print a summary and exit 0 if diff-only, but a "verify zero remaining hits" mode (BRAND-05 final grep sweep) should exit 1 on any unexpected match, consistent with this repo's existing CI-gate-script convention.
- **Placement:** put the new script at `scripts/rename-brand.mjs`, next to `check-audit.mjs` — this is the only existing precedent directory for one-off Node scripts in this repo, confirmed by `.planning/codebase/STRUCTURE.md:161` ("Build/deployment scripts"). Delete it after the phase per RESEARCH.md's own recommendation (it's disposable, not a permanent tool like `check-audit.mjs`).

**Do NOT** add `scripts/rename-brand.mjs` to `package.json`'s `scripts` block as a permanent npm script (unlike `check-audit.mjs`, which likely IS wired into CI/`package.json` — confirm before assuming, but the rename script's one-off/disposable nature per RESEARCH.md means it should be run via `node scripts/rename-brand.mjs [--write]` directly, not `npm run rename`).

---

### Verification command (D-08)

**Analog:** `package.json` `scripts` block (read in full this session):
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit"
}
```

The exact verification command the planner must reference (confirmed, not inferred) is:
```bash
npm run typecheck && npm run lint && npm test && npm run build
```
— every one of these four scripts exists verbatim in `package.json` today; no new script needs to be added for D-08's baseline. `npm run lint` runs `next lint` (ESLint, `next/core-web-vitals` + `@typescript-eslint`), `npm test` runs `vitest run` (not `vitest` watch mode — important for a non-interactive CI-style verification pass), `npm run typecheck` runs `tsc --noEmit`.

**Optional addition (per RESEARCH.md's own suggestion, Wave 0 Gaps section):** the planner MAY wire the BRAND-05 final grep sweep into `package.json` as a fifth script, e.g.:
```json
"verify:rename": "git ls-files -z | xargs -0 grep -Zlio sourceiq | grep -zv -E '^(sourceiq-ux-autoresearch/|procurement-app-autoresearch/|\\.planning/|sourceiq\\.db$)' | tr '\\0' '\\n'"
```
This is not required — RESEARCH.md explicitly says "not required" — but if added, it should live in the same `scripts` block, following the existing flat key-value convention (no nested config), and should be removed after the phase alongside `scripts/rename-brand.mjs` since neither is meant to be a permanent addition.

---

### i18n locale files (`lib/i18n/de.ts`, `es.ts`, `fr.ts`, `it.ts`, `config.ts`)

**Analog:** `lib/i18n/de.ts` itself (self-consistent structure across all 4 locale files) and `lib/i18n/config.ts` (read in full this session).

**Confirmed structure** (`lib/i18n/config.ts` lines 1-20):
```typescript
// ─── I18N CONFIG ──────────────────────────────────────────────────────────────
// Supported UI languages. English is the source language: strings in the code are
// written in English and used directly as translation keys (gettext-style), so
// English never needs a dictionary and there are no "missing key" gaps.

export type Lang = "en" | "it" | "de" | "fr" | "es";

export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: "en", label: "English",  flag: "🇬🇧" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "de", label: "Deutsch",  flag: "🇩🇪" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "es", label: "Español",  flag: "🇪🇸" },
];

export const DEFAULT_LANG: Lang = "en";
export const STORAGE_KEY = "sourceiq.lang";
```

**Confirmed dictionary entry structure** (`lib/i18n/de.ts`, read this session):
```typescript
"Welcome to SourceIQ": "Willkommen bei SourceIQ",
```
— a flat `{ [englishLiteral: string]: string }` object; the key is the exact English string literal used at the call site (e.g. `t("Welcome to SourceIQ")` in `components/OnboardingChecklist.tsx:108`), not a namespaced/nested key path.

**Rename-relevant convention implication (already flagged in RESEARCH.md Pitfall 3, reconfirmed here):** because key == English literal, the rename script MUST rewrite the dictionary KEY string and the calling component's literal in the SAME atomic pass (both are plain `"SourceIQ"` substring occurrences that the identical case-aware replace touches automatically) — do not split `components/`/`app/` and `lib/i18n/` into separate commits/tasks. Follow this existing key-as-literal convention exactly; do not introduce a new namespaced key scheme as part of this rename (that would be scope creep beyond BRAND-01/02).

**Discretion point — `STORAGE_KEY = "sourceiq.lang"` (`lib/i18n/config.ts:16`):** this is a `localStorage` key, not a translation string or code identifier under BRAND-02's TS-identifier scan (which found zero identifiers). It's a borderline case: renaming it to `"sourcegpt.lang"` is "reasonable" per BRAND-02's language and consistent with the rename's spirit, but doing so will silently reset every existing user's saved language preference on next visit (a one-time, low-severity UX regression, not a data-loss risk). No existing repo convention resolves this either way — flag it to the planner as a discretion call, not a hard requirement; recommend renaming it for consistency (low risk, matches "internal code identifiers where reasonable" per BRAND-02) but note the behavior change explicitly in the plan.

---

### `lib/agents.ts` manual prompt edits (D-04) and `tests/prompt-injection-defense.test.ts` (D-05)

**Analog:** the file's own internally-consistent pattern (read: full-file grep + targeted reads of lines 1-15, 28-92, 985-1024 this session).

**Confirmed imports/header pattern** (`lib/agents.ts` lines 1-9):
```typescript
import Anthropic from "@anthropic-ai/sdk";
import { scrapeSupplierContact } from "./contact";
import { BUSINESS_TYPES, EMPLOYEE_BANDS, CAPABILITY_TAGS } from "./taxonomy";
import { sanitizeFilterQuery, type SupplierFilters } from "./supplier-filters";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
```
No new imports are needed for this phase — the manual edits are pure string-literal changes inside existing prompt-construction code, not structural changes. Do not touch this import block.

**Confirmed test-file pattern** (`tests/prompt-injection-defense.test.ts`, read in full this session):
```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const SOURCE = readFileSync(join(__dirname, "..", "lib", "agents.ts"), "utf8");

function functionBody(name: string): string {
  const start = SOURCE.indexOf(`export async function ${name}(`);
  const startIdx = start !== -1 ? start : SOURCE.indexOf(`export function ${name}(`);
  if (startIdx === -1) throw new Error(`function ${name} not found in lib/agents.ts`);
  ...
}
```
**Critical confirmed finding for D-05:** this test does a **static/text check on the raw source** of `lib/agents.ts` (reads the file as a string, slices out named exported functions' bodies, and asserts on their text content) — it is NOT a behavioral/mocked-API test (the file's own comment block explicitly states: *"There's no existing harness for unit-testing lib/agents.ts's prompt text ... so this is a plain static/text check on the source rather than a behavioral test"*). Its assertions check for the **presence of the `INJECTION_DEFENSE` block/placeholder and function existence**, never the literal brand string "SourceIQ" — so the rename does NOT require editing any assertion in this test file itself. The manual read-through (D-05) is confirming that any brand-string *mentions* within the test file (e.g. in its own header comment, which itself literally reads "SourceIQ" at line 6 in the excerpt above) are incidental prose, not load-bearing — which this session's read confirms is exactly true (the only brand mentions found are in the explanatory comment block, not in any `expect(...)` assertion).

**Consequence for the planner:** `lib/agents.ts`'s manual edits should follow the file's existing header-comment style (`// ─── SECTION NAME ──...` banner dividers, per CLAUDE.md's "Section Dividers" convention) if any new comment is added near the renamed clauses, but the core task is a plain string literal swap inside ~10 existing prompt template strings plus the two guard clauses (~lines 1008-1010) — no new function signatures, no new test assertions required. `tests/prompt-injection-defense.test.ts`'s own header comment (lines 5-19) also contains "SourceIQ" mentions that fall under the same scripted-or-manual rename scope as any other prose — since D-05 requires reading this file anyway, do the comment's brand-string swap during that same manual pass rather than via the bulk script (keeps the manual-review boundary clean and matches BLOCK_PATHS in RESEARCH.md's example script, which already excludes this file from the scripted pass).

---

### Legal pages (`app/legal/privacy/page.tsx`, `app/legal/terms/page.tsx`)

**Analog:** each other — both are Next.js page components with no shared "legal-page" wrapper component found; each is a standalone SSR page rendering static prose. No further pattern extraction needed beyond D-07's scripted-swap-plus-manual-read-through requirement — there is no legal-content templating system in this repo to preserve or diverge from.

---

## Shared Patterns

### Rename mechanics (applies to the scripted pass as a whole)
**Source:** RESEARCH.md's own recommended pattern (Section "Pattern 1: Allowlist-and-blocklist scripted replace with dry-run") — no existing repo file does exactly this today (this is genuinely new, one-off tooling), but it must follow `scripts/check-audit.mjs`'s conventions (zero dependencies, `node:` builtins only, banner comment, small top-level functions, non-zero exit on failure condition — see above).
**Apply to:** the single new `scripts/rename-brand.mjs` file.

### Verification command
**Source:** `package.json` `scripts` block (`typecheck`, `lint`, `test`, `build` — all pre-existing, confirmed exact names).
**Apply to:** every task/wave in this phase's plan as the standing gate, per D-08 — always reference these four exact script names, not paraphrased equivalents.

### i18n key=literal convention
**Source:** `lib/i18n/config.ts:1-4` (documented in the file's own header comment) + `lib/i18n/de.ts` (concrete key example).
**Apply to:** any task touching `app/`, `lib/`, `components/` call sites AND `lib/i18n/*.ts` dictionaries — must be one atomic scripted pass, never split across separate tasks/commits (per RESEARCH.md Pitfall 3).

### Path alias convention (general repo convention, applies if the new script or any manual edit needs to reference project files)
**Source:** CLAUDE.md `.claude/CLAUDE.md` "Import Organization" section — `@/*` maps to project root, preferred over relative paths in application code. Note: `scripts/rename-brand.mjs` is a standalone Node ESM script run outside the Next.js/TypeScript compilation pipeline, so it should use plain relative/`node:path`-resolved paths (matching `scripts/check-audit.mjs`'s own convention: `path.join(__dirname, "..", ".github", "audit-allowlist.json")`), NOT the `@/*` alias (which only resolves inside the TS/Next.js build, not a raw `node scripts/x.mjs` invocation).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `scripts/rename-brand.mjs`'s specific "case-aware find/replace with dry-run" logic | utility | batch | No existing repo script performs a bulk text substitution; `check-audit.mjs` only provides the *stylistic* convention (dependency-free Node script, banner comment, small functions), not a substitution-logic analog. Use RESEARCH.md's own provided code example (Section "Architecture Patterns > Pattern 1") as the substantive logic template instead — it's already been written and reviewed as HIGH confidence in this session's research pass. |
| `STORAGE_KEY` rename discretion | config | — | No existing repo precedent for renaming a `localStorage` key mid-lifecycle; flagged above as a discretion call, not a pattern gap needing further analog search. |

## Metadata

**Analog search scope:** `scripts/`, `package.json`, `lib/i18n/`, `lib/agents.ts`, `tests/prompt-injection-defense.test.ts`, `app/legal/`, `.claude/CLAUDE.md`, `.planning/codebase/*.md`
**Files scanned:** `scripts/check-audit.mjs` (full), `package.json` (scripts block), `lib/i18n/config.ts` (full), `lib/i18n/de.ts` (targeted excerpt), `lib/agents.ts` (targeted excerpt, lines 1-15), `tests/prompt-injection-defense.test.ts` (targeted excerpt, lines 1-30), `lib/legal.ts` (grep), plus a repo-wide `grep -ril sourcegpt` confirming zero pre-existing "SourceGPT" code/product work (only planning-doc and CLAUDE.md mentions of the *intent* to rename exist — no partial implementation to reconcile with)
**Pattern extraction date:** 2026-08-15
