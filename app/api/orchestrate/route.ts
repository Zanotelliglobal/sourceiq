import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  runOrchestrator,
  runScoutAgent,
  runQualifierAgent,
  runEnricherAgent,
} from "@/lib/agents";
import { recordUsage, usageSummary } from "@/lib/usage";
import { getOrgContext } from "@/lib/tenant";
import { requireActiveSubscription } from "@/lib/billing";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = requireActiveSubscription(ctx.org);
  if (!gate.ok) return NextResponse.json({ error: gate.reason, code: "subscription_required" }, { status: 402 });

  const { event_id, wave } = await req.json();
  const db = getDb();

  const event = await db.prepare("SELECT * FROM sourcing_events WHERE id = ?").get(event_id) as {
    id: number; org_id: number; category: string; subcategory: string | null; description: string;
    requirements: string; annual_spend: string; wave_count: number;
    target_countries: string | null;
  } | undefined;

  if (!event || Number(event.org_id) !== ctx.orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const waveNumber = wave || event.wave_count + 1;
  // Give the agents the specific subcategory when available — sharper searches.
  const categoryLabel = event.subcategory ? `${event.category} — ${event.subcategory}` : event.category;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
      };
      // Record token usage per stage, then push a running cost total to the UI.
      const track = (stage: string) => (u: unknown) => {
        void (async () => {
          await recordUsage(db, event.id, stage, u as never);
          const s = await usageSummary(db, event.id);
          send({ type: "usage", cost_usd: s.cost_usd, total_tokens: s.total_tokens, web_searches: s.web_searches });
        })();
      };

      try {
        // Update event status
        await db.prepare(`UPDATE sourcing_events SET status='scouting', wave_count=?, updated_at=datetime('now') WHERE id=?`)
          .run(waveNumber, event.id);

        send({ type: "wave_start", wave: waveNumber, message: `🧠 Orchestrator planning Wave ${waveNumber} strategy...` });

        // Run orchestrator to plan agents
        const plan = await runOrchestrator(
          categoryLabel, event.description,
          event.requirements, event.annual_spend, waveNumber,
          event.target_countries || "",
          track("orchestrator")
        );

        send({ type: "strategy", wave: waveNumber, strategy: plan.strategy, agents: plan.agents });

        // Register agents in DB
        for (const agent of plan.agents) {
          await db.prepare(`INSERT INTO agent_runs (event_id, agent_id, agent_type, agent_label, wave, status, message)
                      VALUES (?, ?, ?, ?, ?, 'queued', 'Waiting to deploy...')`)
            .run(event.id, agent.id, agent.type, agent.label, waveNumber);
        }

        send({ type: "agents_registered", agents: plan.agents });

        // Get existing supplier names to avoid duplicates
        const existing = await db.prepare("SELECT name FROM suppliers WHERE event_id=?").all(event.id) as { name: string }[];
        const existingNames = existing.map(s => s.name);

        // Run each scout agent sequentially (streaming results as they come)
        let newSuppliers = 0;
        for (const agent of plan.agents) {
          // Mark agent as running
          await db.prepare(`UPDATE agent_runs SET status='running', message=?, started_at=datetime('now')
                      WHERE event_id=? AND agent_id=? AND wave=?`)
            .run(`Scouting ${event.category} suppliers...`, event.id, agent.id, waveNumber);

          send({ type: "agent_start", agent_id: agent.id, agent_label: agent.label, wave: waveNumber });

          let found: Awaited<ReturnType<typeof runScoutAgent>> = [];
          try {
            found = await runScoutAgent(
              agent.type, agent.focus,
              categoryLabel, event.description,
              event.requirements, event.annual_spend,
              waveNumber, existingNames,
              event.target_countries || "",
              track("scout")
            );
          } catch (err) {
            await db.prepare(`UPDATE agent_runs SET status='error', message=?, completed_at=datetime('now')
                        WHERE event_id=? AND agent_id=? AND wave=?`)
              .run(String(err), event.id, agent.id, waveNumber);
            send({ type: "agent_error", agent_id: agent.id, message: String(err) });
            continue;
          }

          // Dedup up-front (synchronously) so concurrent workers never race on names.
          const fresh = found.filter(s => {
            if (existingNames.includes(s.name)) return false;
            existingNames.push(s.name);
            return true;
          });

          send({ type: "agent_scouted", agent_id: agent.id, count: fresh.length, message: `Found ${fresh.length} suppliers, qualifying...` });
          await db.prepare(`UPDATE agent_runs SET status='qualifying', message=?, suppliers_found=?
                      WHERE event_id=? AND agent_id=? AND wave=?`)
            .run(`Qualifying ${fresh.length} suppliers...`, fresh.length, event.id, agent.id, waveNumber);

          // Qualify + enrich concurrently with a bounded pool. This keeps the live
          // SSE streaming UX (results stream in as they finish) while running up to
          // QUAL_CONCURRENCY suppliers in flight at once — a large wall-clock win.
          const processSupplier = async (s: (typeof fresh)[number]) => {
            send({ type: "qualifying", agent_id: agent.id, supplier_name: s.name });

            let score;
            try {
              score = await runQualifierAgent(s, categoryLabel, event.requirements, event.annual_spend, track("qualifier"));
            } catch {
              score = { overall_score: 60, rationale: "Limited qualification data.", breakdown: { capability_fit:60, quality_signals:60, geographic_risk:60, financial_stability:60, compliance_readiness:60 } };
            }

            let enrichment;
            try {
              enrichment = await runEnricherAgent(s, score, categoryLabel, track("enricher"));
            } catch {
              enrichment = { market_position: "Unknown", key_risks: [], key_strengths: [], recommended_action: "monitor" };
            }

            // Every discovered supplier enters the Long List. Progression through
            // Contacted → Responded → Short List is driven by the outreach campaign.
            const funnel_stage = "long_list";

            const result = await db.prepare(`
              INSERT INTO suppliers
                (event_id, name, country, city, description, capabilities, certifications,
                 employees, annual_revenue, founded, website, contact_email, data_sources, scout_agent, wave,
                 ai_score, score_rationale, score_breakdown, enrichment, funnel_stage)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
              .run(
                event.id, s.name, s.country, s.city, s.description,
                JSON.stringify(s.capabilities), JSON.stringify(s.certifications),
                s.employees, s.annual_revenue, s.founded, s.website,
                s.contact_email || null,
                JSON.stringify(s.data_sources), agent.label, waveNumber,
                score.overall_score, score.rationale, JSON.stringify(score.breakdown),
                JSON.stringify(enrichment), funnel_stage
              );

            const saved = await db.prepare("SELECT * FROM suppliers WHERE id=?").get(result.lastInsertRowid);
            send({ type: "supplier_found", supplier: saved, agent_id: agent.id, agent_label: agent.label });
            newSuppliers++;
          };

          const concurrency = Math.max(1, Number(process.env.QUAL_CONCURRENCY) || 4);
          let cursor = 0;
          const worker = async () => {
            while (cursor < fresh.length) {
              const idx = cursor++;
              await processSupplier(fresh[idx]);
            }
          };
          await Promise.all(Array.from({ length: Math.min(concurrency, fresh.length) }, worker));

          // Mark agent complete
          await db.prepare(`UPDATE agent_runs SET status='complete', message=?, completed_at=datetime('now')
                      WHERE event_id=? AND agent_id=? AND wave=?`)
            .run(`Delivered ${found.length} qualified leads`, event.id, agent.id, waveNumber);
          send({ type: "agent_complete", agent_id: agent.id, agent_label: agent.label, suppliers_found: found.length });
        }

        await db.prepare(`UPDATE sourcing_events SET status='reviewing', updated_at=datetime('now') WHERE id=?`)
          .run(event.id);

        const totalSuppliers = Number((await db.prepare("SELECT COUNT(*)::int as c FROM suppliers WHERE event_id=?").get(event.id) as {c:number}).c);
        const finalUsage = await usageSummary(db, event.id);
        send({ type: "wave_complete", wave: waveNumber, new_suppliers: newSuppliers, total_suppliers: totalSuppliers, usage: finalUsage });

      } catch (err) {
        send({ type: "error", message: String(err) });
      } finally {
        controller.close();
      }
    }
  });

  return new NextResponse(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }
  });
}
