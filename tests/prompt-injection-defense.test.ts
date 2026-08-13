import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// #61 — prompt-injection isolation.
//
// lib/agents.ts has several agents that ingest content SourceIQ does not
// control: live web_search results (scout, the grounded qualifier, the
// enricher, the contact finder) or a real inbound email reply from a supplier
// (the reply classifier). A malicious/compromised page or the supplier
// themselves can plant text designed to look like instructions to the model.
// Every one of those agents' prompts must include the shared
// INJECTION_DEFENSE block instructing the model to treat that content as
// data, never as instructions.
//
// There's no existing harness for unit-testing lib/agents.ts's prompt text
// (every exported function makes a real Anthropic API call with no seam to
// intercept), so this is a plain static/text check on the source rather than
// a behavioral test — its job is to catch someone adding a new
// web-search/reply-consuming agent (or refactoring an existing one) without
// carrying the defense block along, not to prove the defense actually defeats
// a live injection attempt.
const SOURCE = readFileSync(join(__dirname, "..", "lib", "agents.ts"), "utf8");

// Slice out an exported function's body by name, up to (but not including)
// the next top-level `export async function` / `export function`.
function functionBody(name: string): string {
  const start = SOURCE.indexOf(`export async function ${name}(`);
  const startIdx = start !== -1 ? start : SOURCE.indexOf(`export function ${name}(`);
  if (startIdx === -1) throw new Error(`function ${name} not found in lib/agents.ts`);
  const nextExportFn = SOURCE.slice(startIdx + 1).search(/export (async )?function /);
  const endIdx = nextExportFn === -1 ? SOURCE.length : startIdx + 1 + nextExportFn;
  return SOURCE.slice(startIdx, endIdx);
}

describe("prompt-injection defense (#61)", () => {
  it("defines a single shared INJECTION_DEFENSE block", () => {
    expect(SOURCE.match(/const INJECTION_DEFENSE = `/g)?.length).toBe(1);
  });

  it.each([
    "runScoutAgent",              // ingests live web_search results
    "runQualifierAgent",          // reads the scout's web-derived description/capabilities
    "runQualifierAgentGrounded",  // ingests live web_search results
    "runEnricherAgent",           // reads the scout's web-derived description/capabilities
    "runContactFinderAgent",      // ingests live web_search results
    "runReplyClassifierAgent",    // reads a real inbound supplier email, verbatim
    "runTargetedScoutAgent",      // Quick Investigation "Deepen": ingests live web_search results
  ])("%s's prompt includes the injection-defense block", (fnName) => {
    expect(functionBody(fnName)).toContain("${INJECTION_DEFENSE}");
  });

  // Agents that only ever see buyer-authored or SourceIQ-generated text (no
  // third-party web content, no inbound supplier messages) are intentionally
  // out of scope — flagging them here (rather than silently) so scope stays a
  // deliberate choice, not an oversight, if one of them starts ingesting
  // external content later.
  it.each([
    "runClassifierAgent",  // buyer's own free-text sourcing description
    "runFilterMapperAgent", // buyer's own free-text filter query
    "runOrchestrator",      // buyer's event fields only, no third-party content
    "runOutreachAgent",     // drafts from buyer/event fields only
    "runFollowUpAgent",     // drafts from buyer/event fields + our own prior subject
    "runSupplierResponseAgent", // simulates a reply, doesn't ingest one
    "runQuickScoutAgent",   // Quick Investigation: model's own knowledge only, no web_search
  ])("%s is out of scope (no third-party content ingested)", (fnName) => {
    expect(() => functionBody(fnName)).not.toThrow();
  });
});
