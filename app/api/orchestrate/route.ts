import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  runOrchestrator,
  runScoutAgent,
  runQualifierAgent,
  runQualifierAgentGrounded,
  runEnricherAgent,
  AGENT_MODELS,
} from "@/lib/agents";

type ScoutSupplier = Awaited<ReturnType<typeof runScoutAgent>>[number];
import { scrapeSupplierContact } from "@/lib/contact";
import { recordUsage, usageSummary } from "@/lib/usage";
import {
  normalizeBusinessType,
  normalizeEmployeeBand,
  parseFoundedYear,
  clampReviewScore,
  filterCapabilityTags,
} from "@/lib/taxonomy";
import { getOrgContext } from "@/lib/tenant";
import { requireActiveSubscription } from "@/lib/billing";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = requireActiveSubscription(ctx.org);
  if (!gate.ok) return NextResponse.json({ error: gate.reason, code: "subscription_required" }, { status: 402 });

  const { event_id, wave } = await req.json();
  const db = getDb();

  const event = await db.prepare("SELECT * FROM sourcing_events WHERE id = ?").get(event_id) as {
    id: number; org_id: number; title: string; category: string; subcategory: string | null; description: string;
    requirements: string; annual_spend: string; wave_count: number;
    target_countries: string | null; ship_to: string | null;
  } | undefined;

  if (!event || Number(event.org_id) !== ctx.orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const waveNumber = wave || event.wave_count + 1;
  // Give the agents the specific subcategory when available — sharper searches.
  const categoryLabel = event.subcategory ? `${event.category} — ${event.subcategory}` : event.category;

  // Ship-to serviceability: fold the destination market into the requirements
  // text the scouts and qualifiers see, so suppliers that cannot deliver/export
  // to it are penalised (a Chinese supplier that can't ship to Italy scores
  // lower on geographic risk). Kept in the requirements string to avoid changing
  // every agent signature.
  const effectiveRequirements = event.ship_to
    ? `${event.requirements}\n\nSHIP-TO REQUIREMENT: Suppliers MUST be able to deliver, ship, or export to: ${event.ship_to}. Strongly prefer suppliers with proven export capability and logistics to this destination. Penalise suppliers that only serve their domestic market and cannot serve ${event.ship_to}.`
    : event.requirements;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
      };

      // Defeat proxy/browser buffering so each supplier streams to the client
      // the instant it is found (rather than arriving in one burst at the end):
      //  1. an initial ~2KB comment padding forces the first flush, and
      //  2. a periodic keep-alive comment keeps the pipe flushing between events.
      controller.enqueue(encoder.encode(`: ${" ".repeat(2048)}\n\n`));
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: keep-alive\n\n`)); } catch {}
      }, 15000);
      // Record token usage per stage + the model that actually ran it, then
      // push a running cost total to the UI.
      const track = (stage: string, model: string) => (u: unknown) => {
        void (async () => {
          await recordUsage(db, event.id, stage, u as never, model);
          const s = await usageSummary(db, event.id);
          send({ type: "usage", cost_usd: s.cost_usd, total_tokens: s.total_tokens, web_searches: s.web_searches });
        })();
      };

      try {
        // Update event status
        await db.prepare(`UPDATE sourcing_events SET status='scouting', wave_count=?, updated_at=datetime('now') WHERE id=?`)
          .run(waveNumber, event.id);

        await logAudit({
          orgId: ctx.orgId, eventId: event.id, actorId: ctx.userId,
          action: "discovery.run", summary: `Launched discovery wave ${waveNumber}`,
          metadata: { wave: waveNumber },
        });

        send({ type: "wave_start", wave: waveNumber, message: `🧠 Orchestrator planning Wave ${waveNumber} strategy...` });

        // Run orchestrator to plan agents
        const plan = await runOrchestrator(
          categoryLabel, event.description,
          effectiveRequirements, event.annual_spend, waveNumber,
          event.target_countries || "",
          track("orchestrator", AGENT_MODELS.orchestrator)
        );

        send({ type: "strategy", wave: waveNumber, strategy: plan.strategy, agents: plan.agents });

        // Register agents in DB
        for (const agent of plan.agents) {
          await db.prepare(`INSERT INTO agent_runs (event_id, agent_id, agent_type, agent_label, wave, status, message)
                      VALUES (?, ?, ?, ?, ?, 'queued', 'Waiting to deploy...')`)
            .run(event.id, agent.id, agent.type, agent.label, waveNumber);
        }

        send({ type: "agents_registered", agents: plan.agents });

        // Get existing suppliers (name + website) to avoid duplicates across waves.
        const existing = await db.prepare("SELECT name, website FROM suppliers WHERE event_id=?").all(event.id) as { name: string; website: string | null }[];

        // Dedup on BOTH a normalized company name and a website domain, so
        // "Acme Manufacturing Inc." and "Acme Mfg" (or two listings that share a
        // domain) collapse to one. Exact-string matching leaked obvious dupes.
        const normName = (n: string) =>
          (n || "")
            .toLowerCase()
            .replace(/\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|company|srl|spa|sa|ag|kg|bv|plc|pvt|pte|group|holding|holdings|industries|manufacturing|mfg)\b/g, "")
            .replace(/[^a-z0-9]/g, "");
        const domainOf = (url: string | null | undefined) => {
          if (!url) return "";
          return url
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/^www\./, "")
            .split("/")[0]
            .trim();
        };

        const seenNames = new Set<string>();
        const seenDomains = new Set<string>();
        for (const s of existing) {
          const nn = normName(s.name);
          if (nn) seenNames.add(nn);
          const dom = domainOf(s.website);
          if (dom) seenDomains.add(dom);
        }
        // Synchronous check-and-claim so concurrent scouts never race in on a dupe.
        const claimIfNew = (name: string, website?: string | null): boolean => {
          const nn = normName(name);
          const dom = domainOf(website);
          if (nn && seenNames.has(nn)) return false;
          if (dom && seenDomains.has(dom)) return false;
          if (nn) seenNames.add(nn);
          if (dom) seenDomains.add(dom);
          return true;
        };
        // Avoid-list passed to scouts: the human-readable names we already have.
        const avoidNames: string[] = existing.map(s => s.name);

        const groundingOn = process.env.QUALIFIER_GROUNDING !== "0";
        let newSuppliers = 0;

        // Process one deduped supplier: qualify (cheap → grounded for the risky
        // band) → enrich → contact scrape → insert → stream.
        const makeProcessSupplier = (agent: (typeof plan.agents)[number]) => async (s: ScoutSupplier) => {
          send({ type: "qualifying", agent_id: agent.id, supplier_name: s.name });

          let score;
          try {
            score = await runQualifierAgent(s, categoryLabel, effectiveRequirements, event.annual_spend, track("qualifier", AGENT_MODELS.qualifier));
          } catch {
            score = { overall_score: 60, rationale: "Limited qualification data.", breakdown: { capability_fit:60, quality_signals:60, geographic_risk:60, financial_stability:60, compliance_readiness:60 } };
          }

          // Escalate to the grounded (web-verified) qualifier when the cheap pass
          // is untrustworthy: thin evidence, or a borderline score where a false
          // positive is most costly. Keeps cost down by grounding only the risky band.
          const thinEvidence = (s.data_sources || []).length === 0;
          const borderline = score.overall_score >= 60 && score.overall_score <= 82;
          if (groundingOn && (thinEvidence || borderline)) {
            try {
              score = await runQualifierAgentGrounded(s, categoryLabel, effectiveRequirements, event.annual_spend, track("qualifier", AGENT_MODELS.qualifierGrounded));
            } catch { /* keep the cheap-pass score on failure */ }
          }

          let enrichment;
          try {
            enrichment = await runEnricherAgent(s, score, categoryLabel, track("enricher", AGENT_MODELS.enricher));
          } catch {
            enrichment = { market_position: "Unknown", key_risks: [], key_strengths: [], recommended_action: "monitor" };
          }

          // Contact mapping DURING sourcing: cheaply scrape the supplier's own
          // site for a real email / contact page / phone / LinkedIn. This is a
          // deterministic HTTP scrape (no LLM); the heavier web-search fallback
          // runs later at outreach time only for suppliers still missing an email.
          let contactEmail = s.contact_email || "";
          let contactUrl = "", contactPhone = "", contactLinkedin = "";
          if (!contactEmail && s.website) {
            try {
              // Tight budget during bulk discovery: homepage + 2 contact pages, 5s each.
              const c = await scrapeSupplierContact(s.website, { timeoutMs: 5000, maxPages: 2 });
              contactEmail = c.contact_email || contactEmail;
              contactUrl = c.contact_url;
              contactPhone = c.phone;
              contactLinkedin = c.linkedin;
            } catch { /* best-effort — supplier still saved without a channel */ }
          }

          // Every discovered supplier enters the Long List. Progression through
          // Contacted → Responded → Short List is driven by the outreach campaign.
          const funnel_stage = "long_list";

          // Structured supplier record (Epic 1): normalize the scout's output to
          // the controlled vocabularies before insert, so stored values are always
          // in-set. employee_count/founded_year fall back to parsing the legacy
          // free-text employees/founded fields when the model didn't emit the
          // structured version.
          const business_type = normalizeBusinessType(s.business_type);
          const employee_count = normalizeEmployeeBand(s.employee_count) ?? normalizeEmployeeBand(s.employees);
          const founded_year = parseFoundedYear(s.founded_year) ?? parseFoundedYear(s.founded);
          const review_score = clampReviewScore(s.review_score);
          const capability_tags = JSON.stringify(filterCapabilityTags(s.capability_tags));

          const result = await db.prepare(`
            INSERT INTO suppliers
              (event_id, name, country, city, description, capabilities, certifications,
               employees, annual_revenue, founded, website, contact_email, contact_url, contact_phone, contact_linkedin, data_sources, scout_agent, wave,
               ai_score, score_rationale, score_breakdown, enrichment, funnel_stage,
               business_type, employee_count, founded_year, review_score, capability_tags)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(
              event.id, s.name, s.country, s.city, s.description,
              JSON.stringify(s.capabilities), JSON.stringify(s.certifications),
              s.employees, s.annual_revenue, s.founded, s.website,
              contactEmail || null, contactUrl || null, contactPhone || null, contactLinkedin || null,
              JSON.stringify(s.data_sources), agent.label, waveNumber,
              score.overall_score, score.rationale, JSON.stringify(score.breakdown),
              JSON.stringify(enrichment), funnel_stage,
              business_type, employee_count, founded_year, review_score, capability_tags
            );

          const saved = await db.prepare("SELECT * FROM suppliers WHERE id=?").get(result.lastInsertRowid);
          send({ type: "supplier_found", supplier: saved, agent_id: agent.id, agent_label: agent.label });
          newSuppliers++;
        };

        // Run one scout end-to-end: scout → dedup claim → qualify/enrich pool.
        const runScout = async (agent: (typeof plan.agents)[number]) => {
          await db.prepare(`UPDATE agent_runs SET status='running', message=?, started_at=datetime('now')
                      WHERE event_id=? AND agent_id=? AND wave=?`)
            .run(`Scouting ${event.category} suppliers...`, event.id, agent.id, waveNumber);

          send({ type: "agent_start", agent_id: agent.id, agent_label: agent.label, wave: waveNumber });

          let found: ScoutSupplier[] = [];
          try {
            found = await runScoutAgent(
              agent.type, agent.focus,
              categoryLabel, event.description,
              effectiveRequirements, event.annual_spend,
              waveNumber, avoidNames,
              event.target_countries || "",
              track("scout", AGENT_MODELS.scout)
            );
          } catch (err) {
            await db.prepare(`UPDATE agent_runs SET status='error', message=?, completed_at=datetime('now')
                        WHERE event_id=? AND agent_id=? AND wave=?`)
              .run(String(err), event.id, agent.id, waveNumber);
            send({ type: "agent_error", agent_id: agent.id, message: String(err) });
            return;
          }

          // Claim new suppliers synchronously so parallel scouts can't double-insert.
          const fresh = found.filter(s => claimIfNew(s.name, s.website));

          send({ type: "agent_scouted", agent_id: agent.id, count: fresh.length, message: `Found ${fresh.length} suppliers, qualifying...` });
          await db.prepare(`UPDATE agent_runs SET status='qualifying', message=?, suppliers_found=?
                      WHERE event_id=? AND agent_id=? AND wave=?`)
            .run(`Qualifying ${fresh.length} suppliers...`, fresh.length, event.id, agent.id, waveNumber);

          // Qualify + enrich concurrently with a bounded pool per scout.
          const processSupplier = makeProcessSupplier(agent);
          const qualConcurrency = Math.max(1, Number(process.env.QUAL_CONCURRENCY) || 4);
          let qCursor = 0;
          const qWorker = async () => {
            while (qCursor < fresh.length) {
              const idx = qCursor++;
              await processSupplier(fresh[idx]);
            }
          };
          await Promise.all(Array.from({ length: Math.min(qualConcurrency, fresh.length) }, qWorker));

          await db.prepare(`UPDATE agent_runs SET status='complete', message=?, completed_at=datetime('now')
                      WHERE event_id=? AND agent_id=? AND wave=?`)
            .run(`Delivered ${fresh.length} qualified leads`, event.id, agent.id, waveNumber);
          send({ type: "agent_complete", agent_id: agent.id, agent_label: agent.label, suppliers_found: fresh.length });
        };

        // Run scouts in a bounded pool — the big wall-clock win over sequential.
        const scoutConcurrency = Math.max(1, Number(process.env.SCOUT_CONCURRENCY) || 3);
        let sCursor = 0;
        const sWorker = async () => {
          while (sCursor < plan.agents.length) {
            const idx = sCursor++;
            await runScout(plan.agents[idx]);
          }
        };
        await Promise.all(Array.from({ length: Math.min(scoutConcurrency, plan.agents.length) }, sWorker));

        await db.prepare(`UPDATE sourcing_events SET status='reviewing', updated_at=datetime('now') WHERE id=?`)
          .run(event.id);

        const totalSuppliers = Number((await db.prepare("SELECT COUNT(*)::int as c FROM suppliers WHERE event_id=?").get(event.id) as {c:number}).c);
        const finalUsage = await usageSummary(db, event.id);
        send({ type: "wave_complete", wave: waveNumber, new_suppliers: newSuppliers, total_suppliers: totalSuppliers, usage: finalUsage });

        // Notify: discovery wave finished. In-app for the org + optional email to
        // the user who launched it (best-effort — never blocks the response).
        await notify({
          orgId: ctx.orgId,
          type: "discovery_complete",
          title: `Discovery complete — ${event.title}`,
          body: `Wave ${waveNumber} found ${newSuppliers} new supplier${newSuppliers === 1 ? "" : "s"} (${totalSuppliers} total). Ready to review.`,
          url: `/events/${event.id}`,
          eventId: event.id,
          emailUserId: ctx.userId,
        });

      } catch (err) {
        send({ type: "error", message: String(err) });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    }
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (Vercel/nginx) so events flush to the client
      // as they are produced rather than being held until the stream closes.
      "X-Accel-Buffering": "no",
    }
  });
}
