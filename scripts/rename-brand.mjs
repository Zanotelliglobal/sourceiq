#!/usr/bin/env node
// ─── RENAME BRAND (SourceIQ → SourceGPT) ───────────────────────────────────
// One-time, disposable tooling for Phase 1 (Rename & Brand Migration) of the
// SourceIQ→SourceGPT rebrand. NOT wired into package.json's scripts block and
// NOT meant to survive past this phase — delete it once the phase closes.
//
// Performs a case-aware, three-variant string replace (SourceIQ→SourceGPT,
// sourceiq→sourcegpt, SOURCEIQ→SOURCEGPT) across an explicit, hardcoded
// include allowlist (never a broad recursive glob over the whole repo), plus
// the 7 file-level renames documented in 01-01-PLAN.md (6 docs/brand/ brand
// assets + 1 competitive-comparison doc).
//
// Two modes:
//   node scripts/rename-brand.mjs             (default: --dry-run, writes nothing)
//   node scripts/rename-brand.mjs --dry-run    (explicit dry-run)
//   node scripts/rename-brand.mjs --write      (applies renames + content edits)
//
// Zero third-party dependencies, same rule as scripts/check-audit.mjs: this is
// disposable one-off tooling, not a place to add a new supply-chain surface.

import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

const WRITE = process.argv.includes("--write");

// ─── Case-aware replace variants ───────────────────────────────────────────
// Order doesn't matter: the three variants are distinct exact-case strings
// and applying them via split/join never overlaps.
const VARIANTS = [
  ["SourceIQ", "SourceGPT"],
  ["SOURCEIQ", "SOURCEGPT"],
  ["sourceiq", "sourcegpt"],
];

// ─── Include scope: directories walked recursively ─────────────────────────
// Every file inside these dirs is a content-replace target, minus the
// per-directory exclusions below.
const INCLUDE_DIRS = ["app", "lib", "components", "tests"];

// Files inside INCLUDE_DIRS that are excluded from this script's scope
// entirely — handled by manual passes in later plans (01-02/01-03), not here.
const EXCLUDE_FILES = new Set([
  "lib/agents.ts",
  "tests/prompt-injection-defense.test.ts",
  "app/legal/privacy/page.tsx",
  "app/legal/terms/page.tsx",
]);

// System/junk files never treated as content.
const SKIP_BASENAMES = new Set([".DS_Store"]);

// ─── Include scope: single files (repo-root-relative) ──────────────────────
const SINGLE_FILES = ["package.json", "start.sh", "README.md", "design-system/MASTER.md"];

// ─── Include scope: docs/*.md (top-level only, NOT recursive into docs/brand/) ──
// Excluded: change-request-backlog.md (manual pass, later plan) and the
// competitive-comparison doc (handled specially below via ALL_RENAMES, since
// it also needs a filename rename before its content pass).
const DOCS_MD_EXCLUDE = new Set([
  "change-request-backlog.md",
  "competitive-comparison-sourceiq-vs-sourceready.md",
]);

// ─── File-level renames (fs.renameSync) ─────────────────────────────────────
// All 6 docs/brand/ assets are untracked by git (confirmed via
// `git ls-files -- docs/brand/`), so no `git mv` is needed — a plain
// fs.renameSync is sufficient and git will pick up the new untracked names.
const BRAND_ASSET_RENAMES = [
  ["docs/brand/sourceiq-mark-square.svg", "docs/brand/sourcegpt-mark-square.svg"],
  ["docs/brand/sourceiq-mark-square.png", "docs/brand/sourcegpt-mark-square.png"],
  ["docs/brand/sourceiq-mark-square.jpg", "docs/brand/sourcegpt-mark-square.jpg"],
  ["docs/brand/sourceiq-wordmark.svg", "docs/brand/sourcegpt-wordmark.svg"],
  ["docs/brand/sourceiq-wordmark.png", "docs/brand/sourcegpt-wordmark.png"],
  ["docs/brand/sourceiq-wordmark.jpg", "docs/brand/sourcegpt-wordmark.jpg"],
];

const COMPETITIVE_DOC_RENAME = [
  "docs/competitive-comparison-sourceiq-vs-sourceready.md",
  "docs/competitive-comparison-sourcegpt-vs-sourceready.md",
];

const ALL_RENAMES = [...BRAND_ASSET_RENAMES, COMPETITIVE_DOC_RENAME];

// Of the 7 renames, only .svg and .md files also get a content-level pass
// (the 4 renamed .png/.jpg files are binary — filename changes only, pixel
// content is left completely untouched).
const RENAMED_CONTENT_TARGETS = ALL_RENAMES.filter(
  ([, to]) => to.endsWith(".svg") || to.endsWith(".md")
);

// Hard-excluded paths this script never walks or recurses into (defensive —
// the INCLUDE_DIRS/SINGLE_FILES/docs/*.md scope above never touches these
// anyway, since none of them live inside app/, lib/, components/, tests/, or
// docs/*.md, but documenting them here matches the plan's explicit list):
// sourceiq-ux-autoresearch/, procurement-app-autoresearch/, .planning/,
// sourceiq.db, sourceiq.db-shm, sourceiq.db-wal, .claude/worktrees/,
// node_modules/, .next/, .git/, package-lock.json, .claude/CLAUDE.md.

function walkDir(relDir, excludeFiles) {
  const results = [];
  function walk(absDir) {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (SKIP_BASENAMES.has(entry.name)) continue;
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        const rel = path.relative(REPO_ROOT, abs).split(path.sep).join("/");
        if (excludeFiles.has(rel)) continue;
        results.push(rel);
      }
    }
  }
  walk(path.join(REPO_ROOT, relDir));
  return results;
}

function listDocsMarkdown() {
  const docsDir = path.join(REPO_ROOT, "docs");
  const out = [];
  for (const entry of readdirSync(docsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue; // skip docs/brand/ subdirectory entirely
    if (!entry.name.endsWith(".md")) continue;
    if (DOCS_MD_EXCLUDE.has(entry.name)) continue;
    out.push(`docs/${entry.name}`);
  }
  return out;
}

function escapeForRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMatches(text) {
  let count = 0;
  for (const [from] of VARIANTS) {
    const re = new RegExp(escapeForRegex(from), "g");
    const m = text.match(re);
    if (m) count += m.length;
  }
  return count;
}

function applyReplacements(text) {
  let out = text;
  for (const [from, to] of VARIANTS) {
    out = out.split(from).join(to);
  }
  return out;
}

// The two renamed .svg files (mark-square, wordmark) each split "SourceIQ"
// across a <text>/<tspan> pair: "Source" in one node, the literal "IQ" in the
// next. The generic 3-variant replace above only matches the full-word
// strings and correctly renames the <title> tag, but never touches a
// standalone "IQ" text node (it isn't one of the 3 variants). To make both
// SVGs' rendered text actually read "SourceGPT" (not "SourceGPT" title +
// leftover "IQ" glyph), swap that literal ">IQ<" text-node content to
// ">GPT<" as an explicit special case, scoped only to these 2 known files.
//
// ASSUMPTION LOGGED (per UI-SPEC.md, per 01-01-PLAN.md acceptance criteria):
// swapping the 2-char "IQ" monogram to the 3-char "GPT" string at the same
// font-size does not re-fit the layout. Accepted as a low-severity
// visual-risk assumption, not silently resolved — these are disposable
// placeholder brand marks (no real logo provided this milestone), have no
// runtime/functional impact, and a human can manually adjust font-size/
// kerning later if the wider glyph overflows its viewBox. Not a blocker.
function applySvgMonogramSpecialCase(relPath, text) {
  const isSvgTarget =
    relPath === "docs/brand/sourcegpt-mark-square.svg" ||
    relPath === "docs/brand/sourceiq-mark-square.svg" ||
    relPath === "docs/brand/sourcegpt-wordmark.svg" ||
    relPath === "docs/brand/sourceiq-wordmark.svg";
  if (!isSvgTarget) return text;
  return text.split(">IQ<").join(">GPT<");
}

function main() {
  const renamesReport = [];
  const filesReport = [];

  // ── Step 1: file-level renames ──────────────────────────────────────────
  for (const [from, to] of ALL_RENAMES) {
    const fromAbs = path.join(REPO_ROOT, from);
    const exists = existsSync(fromAbs);
    renamesReport.push({ from, to, exists });
    if (WRITE) {
      if (!exists) {
        console.error(`[rename-brand] ERROR: rename source not found: ${from}`);
        process.exit(1);
      }
      renameSync(fromAbs, path.join(REPO_ROOT, to));
    }
  }

  // ── Step 2: build the full content-replace file list ───────────────────
  const files = [];

  for (const dir of INCLUDE_DIRS) {
    files.push(...walkDir(dir, EXCLUDE_FILES));
  }
  files.push(...SINGLE_FILES);
  files.push(...listDocsMarkdown());

  // The renamed .svg/.md targets: after --write they live at their new path;
  // before --write (dry-run) they still live at their original path. Either
  // way we read/report/write via whichever path currently exists on disk.
  for (const [from, to] of RENAMED_CONTENT_TARGETS) {
    files.push(WRITE ? to : from);
  }

  // ── Step 3: process each content file ───────────────────────────────────
  for (const relPath of files) {
    const abs = path.join(REPO_ROOT, relPath);
    if (!existsSync(abs)) {
      console.error(`[rename-brand] ERROR: expected file not found: ${relPath}`);
      process.exit(1);
    }
    const original = readFileSync(abs, "utf8");
    const count = countMatches(original);
    const hasSvgSpecialCase =
      relPath.endsWith("mark-square.svg") || relPath.endsWith("wordmark.svg")
        ? original.includes(">IQ<")
        : false;

    if (count > 0 || hasSvgSpecialCase) {
      filesReport.push({ file: relPath, count });
      if (WRITE) {
        let updated = applyReplacements(original);
        updated = applySvgMonogramSpecialCase(relPath, updated);
        writeFileSync(abs, updated, "utf8");
      }
    }
  }

  // ── Step 4: report ───────────────────────────────────────────────────────
  console.log(`[rename-brand] mode: ${WRITE ? "--write" : "--dry-run"}`);
  console.log(`\n[rename-brand] Planned file renames (${renamesReport.length}):`);
  for (const r of renamesReport) {
    const status = r.exists ? "OK" : "MISSING";
    console.log(`  [${status}] ${r.from} -> ${r.to}`);
  }

  console.log(`\n[rename-brand] Content files with matches (${filesReport.length}):`);
  for (const f of filesReport) {
    console.log(`  ${f.file}: ${f.count} match(es)`);
  }

  const totalMatches = filesReport.reduce((sum, f) => sum + f.count, 0);
  console.log(
    `\n[rename-brand] Summary: ${filesReport.length} file(s) with content changes, ${totalMatches} total case-variant match(es), ${renamesReport.length} file(s) renamed.`
  );

  const missingRenames = renamesReport.filter((r) => !r.exists);
  if (missingRenames.length > 0 && !WRITE) {
    console.error(
      `\n[rename-brand] ERROR: ${missingRenames.length} planned rename source(s) not found on disk (see MISSING above).`
    );
    process.exit(1);
  }

  if (!WRITE) {
    console.log("\n[rename-brand] Dry run only — no files were written or renamed.");
  } else {
    console.log("\n[rename-brand] --write complete.");
  }
}

main();
