#!/usr/bin/env node
// ─── AUDIT GATE ────────────────────────────────────────────────────────────
// CI runs this instead of a bare `npm audit --audit-level=high`. A bare gate
// like that sounds right but is a trap the moment even one high/critical
// advisory in the tree has no fix published yet (or needs a major-version
// migration nobody's scheduled) — which, in practice, is *always* true for
// some transitive dependency somewhere. A gate that's permanently red stops
// meaning anything; people start merging past it out of habit.
//
// So: fail the build only on a high/critical advisory that ISN'T on the
// reviewed allowlist below (.github/audit-allowlist.json). Anything newly
// introduced, or an existing advisory escalating past what's been reviewed,
// still blocks. Dependabot (.github/dependabot.yml) opens a PR the moment a
// real fix ships for an allowlisted advisory — when that PR lands, delete
// the entry so the allowlist doesn't quietly grow stale.
//
// Zero third-party dependencies, same rule as lib/observability.ts: this is
// CI-critical plumbing, not a place to add a new supply-chain surface.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALLOWLIST_PATH = path.join(__dirname, "..", ".github", "audit-allowlist.json");
const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

function loadAllowlist() {
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  const map = new Map();
  for (const entry of raw.accepted ?? []) map.set(entry.id, entry);
  return map;
}

function ghsaId(url) {
  return (url ?? "").split("/").pop() ?? "";
}

function runAudit() {
  try {
    const out = execFileSync("npm", ["audit", "--json"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 64,
    });
    return JSON.parse(out);
  } catch (err) {
    // npm audit exits non-zero the moment it finds ANY vulnerability at all —
    // that's the expected path almost every run. stdout still carries the
    // full JSON report we need; only re-throw if there's no report to parse.
    if (err.stdout) return JSON.parse(err.stdout);
    throw err;
  }
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((item) => {
    const key = `${item.id}:${item.pkg}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const allowlist = loadAllowlist();
const report = runAudit();
const vulns = report.vulnerabilities ?? {};

const blocking = [];
const accepted = [];

for (const [pkg, vuln] of Object.entries(vulns)) {
  for (const via of vuln.via ?? []) {
    // String entries just mean "this package is vulnerable because it
    // depends on <name>" — the actual advisory is the object entry attached
    // to that other package's own vulnerability record.
    if (typeof via !== "object" || via === null) continue;
    if (!BLOCKING_SEVERITIES.has(via.severity)) continue;

    const id = ghsaId(via.url);
    const entry = allowlist.get(id);
    if (entry) {
      accepted.push({ id, pkg, title: via.title, severity: via.severity, reason: entry.reason });
    } else {
      blocking.push({ id, pkg, title: via.title, severity: via.severity, url: via.url });
    }
  }
}

const acceptedUnique = dedupe(accepted);
const blockingUnique = dedupe(blocking);

if (acceptedUnique.length) {
  console.log(
    `[audit-gate] ${acceptedUnique.length} high/critical advisor${acceptedUnique.length === 1 ? "y" : "ies"} accepted as known risk (see .github/audit-allowlist.json):`
  );
  for (const item of acceptedUnique) {
    console.log(`  - ${item.id} (${item.pkg}, ${item.severity}): ${item.reason}`);
  }
}

if (blockingUnique.length) {
  console.error(
    `\n[audit-gate] ${blockingUnique.length} high/critical advisor${blockingUnique.length === 1 ? "y" : "ies"} NOT on the allowlist:`
  );
  for (const item of blockingUnique) {
    console.error(`  - ${item.id} (${item.pkg}, ${item.severity}): ${item.title}\n    ${item.url}`);
  }
  console.error(
    "\nEither upgrade the dependency to close the advisory, or — if it truly has no fix " +
      "available yet and the risk is acceptable for now — add it to " +
      ".github/audit-allowlist.json with a reason and today's date."
  );
  process.exit(1);
}

console.log("[audit-gate] no un-reviewed high/critical advisories. Pass.");
