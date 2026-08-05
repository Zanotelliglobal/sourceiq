// ─── PER-SUPPLIER DISCOVERY PIPELINE ──────────────────────────────────────────
// Extracted from app/api/orchestrate/route.ts (Issue #30) so the
// qualify → enrich → insert → stream → (background) contact-scrape → patch
// pipeline is unit-testable in isolation, without spinning up the whole SSE
// route or hitting real LLM/network calls.
//
// Why: the deterministic contact scrape (lib/contact.ts) was the last thing
// left on the critical path between "supplier qualified" and "card appears in
// the UI" — up to ~10s per supplier (homepage + 2 contact pages, 5s each).
// Now a supplier is inserted and streamed via `supplier_found` the instant
// it's qualified+enriched, with empty contact_* fields. The scrape then runs
// in the background; if it finds anything, it UPDATEs the row and emits a
// `supplier_updated` event so the client can patch the card in place.

import { getDb } from "@/lib/db";
import type { Supplier } from "@/lib/db";
import {
  runScoutAgent,
  runQualifierAgent,
  runQualifierAgentGrounded,
  runEnricherAgent,
  AGENT_MODELS,
} from "@/lib/agents";
import { scrapeSupplierContact } from "@/lib/contact";
import {
  normalizeBusinessType,
  normalizeEmployeeBand,
  parseFoundedYear,
  clampReviewScore,
  filterCapabilityTags,
} from "@/lib/taxonomy";

export type ScoutSupplier = Awaited<ReturnType<typeof runScoutAgent>>[number];

type Db = ReturnType<typeof getDb>;

// The subset of an orchestrator-planned agent that per-supplier processing needs.
export type AgentPlanEntry = { id: string; type: string; label: string; focus?: string };

export type ProcessSupplierDeps = {
  db: Db;
  eventId: number;
  waveNumber: number;
  categoryLabel: string;
  effectiveRequirements: string;
  annualSpend: string;
  groundingOn: boolean;
  send: (data: Record<string, unknown>) => void;
  track: (stage: string, model: string) => (u: unknown) => void;
  // Background contact-scrape tasks are pushed here instead of being awaited
  // inline, so the route can `await Promise.allSettled(backgroundTasks)`
  // before closing the SSE stream — nothing is lost, but nothing blocks the
  // critical path (insert + supplier_found) either.
  backgroundTasks: Promise<void>[];
  // Overrides for testing — default to the real agent/scrape implementations.
  // Injected rather than mocked, matching this repo's no-mocking-framework
  // testing convention (see tests/usage.test.ts).
  runQualifierAgent?: typeof runQualifierAgent;
  runQualifierAgentGrounded?: typeof runQualifierAgentGrounded;
  runEnricherAgent?: typeof runEnricherAgent;
  scrapeSupplierContact?: typeof scrapeSupplierContact;
};

/**
 * Build the per-supplier processor for one scout agent: qualify (cheap →
 * grounded for the risky band) → enrich → insert (contact fields empty except
 * any email the scout already surfaced) → stream `supplier_found` → background
 * contact scrape → `supplier_updated` on resolution.
 */
export function makeProcessSupplier(deps: ProcessSupplierDeps, agent: AgentPlanEntry) {
  const qualifierAgent = deps.runQualifierAgent ?? runQualifierAgent;
  const qualifierAgentGrounded = deps.runQualifierAgentGrounded ?? runQualifierAgentGrounded;
  const enricherAgent = deps.runEnricherAgent ?? runEnricherAgent;
  const scrapeContact = deps.scrapeSupplierContact ?? scrapeSupplierContact;

  return async (s: ScoutSupplier): Promise<void> => {
    deps.send({ type: "qualifying", agent_id: agent.id, supplier_name: s.name });

    let score;
    try {
      score = await qualifierAgent(s, deps.categoryLabel, deps.effectiveRequirements, deps.annualSpend, deps.track("qualifier", AGENT_MODELS.qualifier));
    } catch {
      score = { overall_score: 60, rationale: "Limited qualification data.", breakdown: { capability_fit: 60, quality_signals: 60, geographic_risk: 60, financial_stability: 60, compliance_readiness: 60 } };
    }

    // Escalate to the grounded (web-verified) qualifier when the cheap pass is
    // untrustworthy: thin evidence, or a borderline score where a false
    // positive is most costly. Keeps cost down by grounding only the risky band.
    const thinEvidence = (s.data_sources || []).length === 0;
    const borderline = score.overall_score >= 60 && score.overall_score <= 82;
    if (deps.groundingOn && (thinEvidence || borderline)) {
      try {
        score = await qualifierAgentGrounded(s, deps.categoryLabel, deps.effectiveRequirements, deps.annualSpend, deps.track("qualifier", AGENT_MODELS.qualifierGrounded));
      } catch { /* keep the cheap-pass score on failure */ }
    }

    let enrichment;
    try {
      enrichment = await enricherAgent(s, score, deps.categoryLabel, deps.track("enricher", AGENT_MODELS.enricher));
    } catch {
      enrichment = { market_position: "Unknown", key_risks: [], key_strengths: [], recommended_action: "monitor" };
    }

    // Every discovered supplier enters the Long List. Progression through
    // Contacted → Responded → Short List is driven by the outreach campaign.
    const funnel_stage = "long_list";

    // Structured supplier record (Epic 1): normalize the scout's output to the
    // controlled vocabularies before insert, so stored values are always
    // in-set. employee_count/founded_year fall back to parsing the legacy
    // free-text employees/founded fields when the model didn't emit the
    // structured version.
    const business_type = normalizeBusinessType(s.business_type);
    const employee_count = normalizeEmployeeBand(s.employee_count) ?? normalizeEmployeeBand(s.employees);
    const founded_year = parseFoundedYear(s.founded_year) ?? parseFoundedYear(s.founded);
    const review_score = clampReviewScore(s.review_score);
    const capability_tags = JSON.stringify(filterCapabilityTags(s.capability_tags));

    // Insert immediately and stream — contact_url/phone/linkedin always start
    // empty (they can only come from the scrape below); contact_email is
    // filled in now ONLY if the scout already surfaced one directly (a
    // synchronous, zero-latency value — no reason to withhold it).
    const result = await deps.db.prepare(`
      INSERT INTO suppliers
        (event_id, name, country, city, description, capabilities, certifications,
         employees, annual_revenue, founded, website, contact_email, contact_url, contact_phone, contact_linkedin, data_sources, scout_agent, wave,
         ai_score, score_rationale, score_breakdown, enrichment, funnel_stage,
         business_type, employee_count, founded_year, review_score, capability_tags)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        deps.eventId, s.name, s.country, s.city, s.description,
        JSON.stringify(s.capabilities), JSON.stringify(s.certifications),
        s.employees, s.annual_revenue, s.founded, s.website,
        s.contact_email || null, null, null, null,
        JSON.stringify(s.data_sources), agent.label, deps.waveNumber,
        score.overall_score, score.rationale, JSON.stringify(score.breakdown),
        JSON.stringify(enrichment), funnel_stage,
        business_type, employee_count, founded_year, review_score, capability_tags
      );

    const supplierId = result.lastInsertRowid;
    const saved = await deps.db.prepare("SELECT * FROM suppliers WHERE id=?").get(supplierId) as Supplier;
    deps.send({ type: "supplier_found", supplier: saved, agent_id: agent.id, agent_label: agent.label });

    // Contact scrape runs OFF the critical path — the card is already
    // streamed. Fire-and-forget, but tracked in backgroundTasks so the route
    // can await completion before closing the SSE stream. Only attempted when
    // the scout didn't already surface an email (mirrors prior behavior).
    if (!s.contact_email && s.website) {
      const website = s.website;
      const scrapeTask = (async () => {
        try {
          // Tight budget during bulk discovery: homepage + 2 contact pages, 5s each.
          const c = await scrapeContact(website, { timeoutMs: 5000, maxPages: 2 });
          const contact_email = c.contact_email || "";
          const contact_url = c.contact_url || "";
          const contact_phone = c.phone || "";
          const contact_linkedin = c.linkedin || "";
          if (!contact_email && !contact_url && !contact_phone && !contact_linkedin) return;

          await deps.db.prepare(
            `UPDATE suppliers SET contact_email=?, contact_url=?, contact_phone=?, contact_linkedin=? WHERE id=?`
          ).run(contact_email || null, contact_url || null, contact_phone || null, contact_linkedin || null, supplierId);

          deps.send({
            type: "supplier_updated", id: supplierId,
            contact_email, contact_url, contact_phone, contact_linkedin,
          });
        } catch {
          // Best-effort — the supplier simply stays without a contact channel.
          // Never throws: this runs unawaited, and an unhandled rejection here
          // would surface as a process-level warning for no benefit.
        }
      })();
      deps.backgroundTasks.push(scrapeTask);
    }
  };
}
