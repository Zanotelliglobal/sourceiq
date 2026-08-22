// ─── PER-SUPPLIER DISCOVERY PIPELINE ──────────────────────────────────────────
// Extracted from app/api/orchestrate/route.ts (Issue #30) so the
// qualify → insert → stream → (background) enrich + contact-scrape → patch
// pipeline is unit-testable in isolation, without spinning up the whole SSE
// route or hitting real LLM/network calls.
//
// Why: enrichment (an LLM call) and the deterministic contact scrape
// (lib/contact.ts) were the last things left on the critical path between
// "supplier qualified" and "card appears in the UI" — tens of seconds per
// supplier. Now a supplier is inserted and streamed via `supplier_found` the
// instant it's qualified, with enrichment=null and empty contact_* fields.
// Enrichment and the contact scrape then run in the background, each
// independently; whichever finds something UPDATEs the row and emits a
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
import { scrapeSupplierContact, checkWebsiteLive } from "@/lib/contact";
import {
  upsertSupplierIdentity,
  upsertOrgSupplierData,
  updateOrgSupplierDataEnrichment,
} from "@/lib/supplier-repository";
import type { Schedule } from "@/lib/task-pool";
import {
  normalizeBusinessType,
  normalizeEmployeeBand,
  parseFoundedYear,
  clampReviewScore,
  filterCapabilityTags,
  sanitizeStringList,
} from "@/lib/taxonomy";

export type ScoutSupplier = Awaited<ReturnType<typeof runScoutAgent>>[number];

type Db = ReturnType<typeof getDb>;

// The subset of an orchestrator-planned agent that per-supplier processing needs.
export type AgentPlanEntry = { id: string; type: string; label: string; focus?: string };

export type ProcessSupplierDeps = {
  db: Db;
  eventId: number;
  // Persistent Supplier Repository (Phase 3, REPO-01/02/03/04): the org this
  // discovery belongs to. Repository upserts inside makeProcessSupplier() are
  // scoped to this org — mandatory, non-optional, mirroring lib/tenant.ts's
  // existing tenancy conventions.
  orgId: number;
  waveNumber: number;
  categoryLabel: string;
  effectiveRequirements: string;
  annualSpend: string;
  groundingOn: boolean;
  send: (data: Record<string, unknown>) => void;
  track: (stage: string, model: string) => (u: unknown) => void;
  // Background enrichment/contact-scrape tasks are pushed here instead of
  // being awaited inline, so the route can `await Promise.allSettled(backgroundTasks)`
  // before closing the SSE stream — nothing is lost, but nothing blocks the
  // critical path (insert + supplier_found) either.
  backgroundTasks: Promise<void>[];
  // #96: bounds how many of the 3 background tasks below actually run at
  // once across the whole wave (not just per-supplier) — without this, a
  // wave with many suppliers fires hundreds of concurrent LLM/fetch calls.
  // Optional and defaults to unbounded (immediate execution) so existing
  // callers/tests that don't care about the cap keep working unchanged.
  schedule?: Schedule;
  // Overrides for testing — default to the real agent/scrape implementations.
  // Injected rather than mocked, matching this repo's no-mocking-framework
  // testing convention (see tests/usage.test.ts).
  runQualifierAgent?: typeof runQualifierAgent;
  runQualifierAgentGrounded?: typeof runQualifierAgentGrounded;
  runEnricherAgent?: typeof runEnricherAgent;
  scrapeSupplierContact?: typeof scrapeSupplierContact;
  checkWebsiteLive?: typeof checkWebsiteLive;
};

/**
 * Build the per-supplier processor for one scout agent: qualify (cheap →
 * grounded for the risky band) → insert (enrichment null, contact fields empty
 * except any email the scout already surfaced) → stream `supplier_found` →
 * background enrich + contact scrape → `supplier_updated` on each resolution.
 */
export function makeProcessSupplier(deps: ProcessSupplierDeps, agent: AgentPlanEntry) {
  const qualifierAgent = deps.runQualifierAgent ?? runQualifierAgent;
  const qualifierAgentGrounded = deps.runQualifierAgentGrounded ?? runQualifierAgentGrounded;
  const enricherAgent = deps.runEnricherAgent ?? runEnricherAgent;
  const scrapeContact = deps.scrapeSupplierContact ?? scrapeSupplierContact;
  const websiteLiveCheck = deps.checkWebsiteLive ?? checkWebsiteLive;
  const schedule: Schedule = deps.schedule ?? (<T>(fn: () => Promise<T>) => fn());

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

    // Trust-signal fields (Epic 1 continuation, issue #39): free text, so no
    // controlled-vocabulary normalization — just drop blanks/duplicates so a
    // sloppy model response never stores garbage. partnered_customer_count is
    // derived, not model-emitted, and left null (not 0) when none were named.
    const partneredCustomers = sanitizeStringList(s.partnered_customers);
    const partnered_customers = JSON.stringify(partneredCustomers);
    const partnered_customer_count = partneredCustomers.length > 0 ? partneredCustomers.length : null;
    const key_export_markets = JSON.stringify(sanitizeStringList(s.key_export_markets));

    // Insert immediately and stream — enrichment starts null (it can only
    // come from the background enrich task below); contact_url/phone/linkedin
    // always start empty too (they can only come from the scrape below).
    // contact_email is filled in now ONLY if the scout already surfaced one
    // directly (a synchronous, zero-latency value — no reason to withhold it).
    const result = await deps.db.prepare(`
      INSERT INTO suppliers
        (event_id, name, country, city, description, capabilities, certifications,
         employees, annual_revenue, founded, website, contact_email, contact_url, contact_phone, contact_linkedin, data_sources, scout_agent, wave,
         ai_score, score_rationale, score_breakdown, enrichment, funnel_stage,
         business_type, employee_count, founded_year, review_score, capability_tags,
         partnered_customers, partnered_customer_count, key_export_markets, verification_badges)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        deps.eventId, s.name, s.country, s.city, s.description,
        JSON.stringify(s.capabilities), JSON.stringify(s.certifications),
        s.employees, s.annual_revenue, s.founded, s.website,
        s.contact_email || null, null, null, null,
        JSON.stringify(s.data_sources), agent.label, deps.waveNumber,
        score.overall_score, score.rationale, JSON.stringify(score.breakdown),
        null, funnel_stage,
        business_type, employee_count, founded_year, review_score, capability_tags,
        partnered_customers, partnered_customer_count, key_export_markets, null
      );

    const supplierId = result.lastInsertRowid;
    const saved = await deps.db.prepare("SELECT * FROM suppliers WHERE id=?").get(supplierId) as Supplier;
    deps.send({ type: "supplier_found", supplier: saved, agent_id: agent.id, agent_label: agent.label });

    // Repository upsert (Phase 3 REPO-01/02/03/04). Best-effort, non-blocking:
    // failure here must NEVER throw into the per-event suppliers.INSERT
    // critical path above. Neon HTTP driver forbids multi-statement
    // transactions, so identity + org-private are two independent round trips
    // — self-healing on retry (next discovery of same supplier will re-upsert).
    let identityId: number | null = null;
    try {
      identityId = await upsertSupplierIdentity(deps.db, {
        orgId: deps.orgId,
        name: s.name,
        website: s.website,
        country: s.country,
        categoryLabel: deps.categoryLabel,
      });
      await upsertOrgSupplierData(deps.db, {
        identityId,
        orgId: deps.orgId,
        aiScore: score.overall_score,
      });
      if (identityId !== null) {
        try {
          await deps.db.prepare("UPDATE suppliers SET identity_id=? WHERE id=?").run(identityId, supplierId);
        } catch { /* best-effort — back-link failure never blocks per-event flow */ }
      }
    } catch { /* best-effort — repository write failure never blocks per-event flow */ }

    // Enrichment runs OFF the critical path — the card is already streamed.
    // Fire-and-forget, but tracked in backgroundTasks so the route can await
    // completion before closing the SSE stream. On failure, fall back to a
    // neutral placeholder (mirrors the prior inline behavior) rather than
    // leaving the card without a recommendation indefinitely.
    const enrichTask = schedule(async () => {
      let enrichment;
      try {
        enrichment = await enricherAgent(s, score, deps.categoryLabel, deps.track("enricher", AGENT_MODELS.enricher));
      } catch {
        enrichment = { market_position: "Unknown", key_risks: [], key_strengths: [], recommended_action: "monitor" };
      }
      const enrichmentJson = JSON.stringify(enrichment);
      await deps.db.prepare(`UPDATE suppliers SET enrichment=? WHERE id=?`).run(enrichmentJson, supplierId);
      deps.send({ type: "supplier_updated", id: supplierId, enrichment: enrichmentJson });

      if (identityId !== null) {
        try {
          await updateOrgSupplierDataEnrichment(deps.db, { identityId, enrichmentJson });
        } catch { /* best-effort */ }
      }
    });
    deps.backgroundTasks.push(enrichTask);

    // Contact scrape runs OFF the critical path — the card is already
    // streamed. Fire-and-forget, but tracked in backgroundTasks so the route
    // can await completion before closing the SSE stream. Only attempted when
    // the scout didn't already surface an email (mirrors prior behavior).
    if (!s.contact_email && s.website) {
      const website = s.website;
      const scrapeTask = schedule(async () => {
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
      });
      deps.backgroundTasks.push(scrapeTask);
    }

    // Website-live verification badge (issue #39) runs OFF the critical path,
    // independent of whether a contact email was already found — it's a pure
    // reachability probe, not a contact lookup. Only patches the row when the
    // site actually answers; a dead/unreachable site just stays unbadged
    // rather than storing a negative result.
    if (s.website) {
      const website = s.website;
      const badgeTask = schedule(async () => {
        try {
          const live = await websiteLiveCheck(website);
          if (!live) return;
          const verification_badges = JSON.stringify(["website-live"]);
          await deps.db.prepare(`UPDATE suppliers SET verification_badges=? WHERE id=?`).run(verification_badges, supplierId);
          deps.send({ type: "supplier_updated", id: supplierId, verification_badges });
        } catch {
          // Best-effort — never throws into the caller's unawaited task.
        }
      });
      deps.backgroundTasks.push(badgeTask);
    }
  };
}

// ─── QUICK SCAN INSERT (Quick Investigation) ──────────────────────────────────
// Deliberately NOT a branch inside makeProcessSupplier above — a sibling with
// a much smaller footprint. A quick-scan candidate is a bare {name, country,
// website} guess from runQuickScoutAgent's own knowledge (no web_search, no
// qualification), so there is nothing here to qualify, enrich, or scrape:
// no qualifier call, no grounded escalation, no enrichment, no contact-scrape,
// nothing scheduled via lib/task-pool.ts. The row is inserted with
// is_quick_result=true, wave=0 (never counted against wave_count — see
// app/api/investigate-quick/route.ts, which never touches wave_count), and
// ai_score/enrichment left null so the UI can render it as clearly unverified.
export type QuickScoutCandidate = { name: string; country: string; website: string };

export type ProcessSupplierQuickDeps = {
  db: Db;
  eventId: number;
  // Persistent Supplier Repository (Phase 3, REPO-02): the org this quick
  // scan belongs to. Mirrors `ProcessSupplierDeps.orgId` above — mandatory,
  // non-optional, filters repository writes to this org only.
  orgId: number;
  send: (data: Record<string, unknown>) => void;
};

export function makeProcessSupplierQuick(deps: ProcessSupplierQuickDeps) {
  return async (candidate: QuickScoutCandidate): Promise<Supplier> => {
    const result = await deps.db.prepare(`
      INSERT INTO suppliers
        (event_id, name, country, city, description, capabilities, certifications,
         employees, annual_revenue, founded, website, contact_email, contact_url, contact_phone, contact_linkedin, data_sources, scout_agent, wave,
         ai_score, score_rationale, score_breakdown, enrichment, funnel_stage, is_quick_result)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        deps.eventId, candidate.name, candidate.country || "", null, "",
        JSON.stringify([]), null,
        null, null, null, candidate.website || null,
        null, null, null, null,
        null, "quick-scan", 0,
        null, null, null,
        null, "long_list", true
      );

    const supplierId = result.lastInsertRowid;
    const saved = await deps.db.prepare("SELECT * FROM suppliers WHERE id=?").get(supplierId) as Supplier;
    deps.send({ type: "supplier_found", supplier: saved });

    // Repository upsert (Phase 3 REPO-02). Quick-scan has no qualifier score
    // and no categoryLabel yet, so ai_score and last_category are null. Same
    // best-effort semantics as makeProcessSupplier — failure never blocks the
    // per-event INSERT above.
    try {
      const identityId = await upsertSupplierIdentity(deps.db, {
        orgId: deps.orgId,
        name: candidate.name,
        website: candidate.website,
        country: candidate.country,
        categoryLabel: null,
      });
      await upsertOrgSupplierData(deps.db, {
        identityId,
        orgId: deps.orgId,
        aiScore: null,
      });
    } catch { /* best-effort */ }

    return saved;
  };
}

// ─── DEEPEN: UPDATE-EXISTING-ROW PROCESSING (Quick Investigation) ────────────
// "Deepen into full investigation" re-runs a quick-scan candidate through the
// real scout→qualify→enrich→contact pipeline, but against the ALREADY-EXISTING
// supplier row (by id) instead of inserting a new one — otherwise the buyer
// would end up with a duplicate card. Qualify/grounded-escalate logic mirrors
// makeProcessSupplier exactly (same thin-evidence/borderline escalation
// rule); the only structural difference is UPDATE-by-id instead of INSERT,
// and flipping is_quick_result back to false once the row holds real,
// verified data. Enrichment/contact-scrape/website-live badge continue to run
// off the critical path exactly as they do for a normal wave.
export function makeProcessSupplierDeepen(deps: ProcessSupplierDeps, agent: AgentPlanEntry) {
  const qualifierAgent = deps.runQualifierAgent ?? runQualifierAgent;
  const qualifierAgentGrounded = deps.runQualifierAgentGrounded ?? runQualifierAgentGrounded;
  const enricherAgent = deps.runEnricherAgent ?? runEnricherAgent;
  const scrapeContact = deps.scrapeSupplierContact ?? scrapeSupplierContact;
  const websiteLiveCheck = deps.checkWebsiteLive ?? checkWebsiteLive;
  const schedule: Schedule = deps.schedule ?? (<T>(fn: () => Promise<T>) => fn());

  return async (supplierId: number, s: ScoutSupplier): Promise<void> => {
    deps.send({ type: "qualifying", agent_id: agent.id, supplier_name: s.name });

    let score;
    try {
      score = await qualifierAgent(s, deps.categoryLabel, deps.effectiveRequirements, deps.annualSpend, deps.track("qualifier", AGENT_MODELS.qualifier));
    } catch {
      score = { overall_score: 60, rationale: "Limited qualification data.", breakdown: { capability_fit: 60, quality_signals: 60, geographic_risk: 60, financial_stability: 60, compliance_readiness: 60 } };
    }

    const thinEvidence = (s.data_sources || []).length === 0;
    const borderline = score.overall_score >= 60 && score.overall_score <= 82;
    if (deps.groundingOn && (thinEvidence || borderline)) {
      try {
        score = await qualifierAgentGrounded(s, deps.categoryLabel, deps.effectiveRequirements, deps.annualSpend, deps.track("qualifier", AGENT_MODELS.qualifierGrounded));
      } catch { /* keep the cheap-pass score on failure */ }
    }

    const business_type = normalizeBusinessType(s.business_type);
    const employee_count = normalizeEmployeeBand(s.employee_count) ?? normalizeEmployeeBand(s.employees);
    const founded_year = parseFoundedYear(s.founded_year) ?? parseFoundedYear(s.founded);
    const review_score = clampReviewScore(s.review_score);
    const capability_tags = JSON.stringify(filterCapabilityTags(s.capability_tags));
    const partneredCustomers = sanitizeStringList(s.partnered_customers);
    const partnered_customers = JSON.stringify(partneredCustomers);
    const partnered_customer_count = partneredCustomers.length > 0 ? partneredCustomers.length : null;
    const key_export_markets = JSON.stringify(sanitizeStringList(s.key_export_markets));

    await deps.db.prepare(`
      UPDATE suppliers SET
        name=?, country=?, city=?, description=?, capabilities=?, certifications=?,
        employees=?, annual_revenue=?, founded=?, website=?, contact_email=?, data_sources=?,
        scout_agent=?, wave=?, ai_score=?, score_rationale=?, score_breakdown=?, enrichment=?,
        business_type=?, employee_count=?, founded_year=?, review_score=?, capability_tags=?,
        partnered_customers=?, partnered_customer_count=?, key_export_markets=?, is_quick_result=?
      WHERE id=?`)
      .run(
        s.name, s.country, s.city, s.description,
        JSON.stringify(s.capabilities), JSON.stringify(s.certifications),
        s.employees, s.annual_revenue, s.founded, s.website,
        s.contact_email || null,
        JSON.stringify(s.data_sources), agent.label, deps.waveNumber,
        score.overall_score, score.rationale, JSON.stringify(score.breakdown), null,
        business_type, employee_count, founded_year, review_score, capability_tags,
        partnered_customers, partnered_customer_count, key_export_markets, false,
        supplierId
      );

    const saved = await deps.db.prepare("SELECT * FROM suppliers WHERE id=?").get(supplierId) as Supplier;
    deps.send({ type: "supplier_updated", id: supplierId, supplier: saved, agent_id: agent.id, agent_label: agent.label });

    // Repository upsert (Phase 3 REPO-02, deepen path). Idempotent with any
    // prior quick-scan repository write for the same supplier — ON CONFLICT
    // (org_id, norm_name) DO UPDATE means the quick-scan's null ai_score is
    // overwritten with the real deepen score here.
    let identityIdDeepen: number | null = null;
    try {
      identityIdDeepen = await upsertSupplierIdentity(deps.db, {
        orgId: deps.orgId,
        name: s.name,
        website: s.website,
        country: s.country,
        categoryLabel: deps.categoryLabel,
      });
      await upsertOrgSupplierData(deps.db, {
        identityId: identityIdDeepen,
        orgId: deps.orgId,
        aiScore: score.overall_score,
      });
    } catch { /* best-effort */ }

    // Enrichment runs OFF the critical path — mirrors makeProcessSupplier.
    const enrichTask = schedule(async () => {
      let enrichment;
      try {
        enrichment = await enricherAgent(s, score, deps.categoryLabel, deps.track("enricher", AGENT_MODELS.enricher));
      } catch {
        enrichment = { market_position: "Unknown", key_risks: [], key_strengths: [], recommended_action: "monitor" };
      }
      const enrichmentJson = JSON.stringify(enrichment);
      await deps.db.prepare(`UPDATE suppliers SET enrichment=? WHERE id=?`).run(enrichmentJson, supplierId);
      deps.send({ type: "supplier_updated", id: supplierId, enrichment: enrichmentJson });

      if (identityIdDeepen !== null) {
        try {
          await updateOrgSupplierDataEnrichment(deps.db, { identityId: identityIdDeepen, enrichmentJson });
        } catch { /* best-effort */ }
      }
    });
    deps.backgroundTasks.push(enrichTask);

    // Contact scrape runs OFF the critical path — only attempted when the
    // targeted scout didn't already surface an email.
    if (!s.contact_email && s.website) {
      const website = s.website;
      const scrapeTask = schedule(async () => {
        try {
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
        }
      });
      deps.backgroundTasks.push(scrapeTask);
    }

    // Website-live verification badge — mirrors makeProcessSupplier.
    if (s.website) {
      const website = s.website;
      const badgeTask = schedule(async () => {
        try {
          const live = await websiteLiveCheck(website);
          if (!live) return;
          const verification_badges = JSON.stringify(["website-live"]);
          await deps.db.prepare(`UPDATE suppliers SET verification_badges=? WHERE id=?`).run(verification_badges, supplierId);
          deps.send({ type: "supplier_updated", id: supplierId, verification_badges });
        } catch {
          // Best-effort — never throws into the caller's unawaited task.
        }
      });
      deps.backgroundTasks.push(badgeTask);
    }
  };
}
