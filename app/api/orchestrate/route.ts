import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runOrchestrator, runScoutAgent, AGENT_MODELS } from "@/lib/agents";
import { makeProcessSupplier, type ScoutSupplier } from "@/lib/process-supplier";
import { recordUsage, usageSummary, effectiveTier, checkWaveLimit } from "@/lib/usage";
import { UNLIMITED } from "@/lib/plans";
import { getOrgContext } from "@/lib/tenant";
import { requireActiveSubscription } from "@/lib/billing";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { rateLimit } from "@/lib/ratelimit";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = requireActiveSubscription(ctx.org);
  if (!gate.ok) return NextResponse.json({ error: gate.reason, code: "subscription_required" }, { status: 402 });

  // A discovery wave is an expensive multi-agent LLM run (see SSE loop below),
  // not a cheap CRUD call — cap launches per org so a scripted/looping client
  // (or a buggy retry) can't fan out unbounded concurrent orchestrator runs.
  // Distinct `code` from the 402 plan-limit responses above so the client can
  // tell "you're out of waves" apart from "you're launching too fast."
  const orgRl = await rateLimit("orchestrate", String(ctx.orgId), 10, 60);
  if (!orgRl.ok) {
    return NextResponse.json(
      { error: "Too many discovery runs launched. Please slow down.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(orgRl.retryAfter) } },
    );
  }

  // The client only ever sends `wave` as its own best-effort read of
  // event.wave_count + 1 for display/logging purposes — the count that
  // actually matters for plan enforcement must be computed here, server-side,
  // from the persisted row. Trusting a client-supplied wave number would let
  // a caller always send `wave: 1` to dodge a wave-count-based plan cap.
  const { event_id } = await req.json();
  const db = getDb();

  const event = await db.prepare("SELECT * FROM sourcing_events WHERE id = ?").get(event_id) as {
    id: number; org_id: number; title: string; category: string; subcategory: string | null; description: string;
    requirements: string; annual_spend: string; wave_count: number; status: string | null; updated_at: string | null;
    target_countries: string | null; ship_to: string | null;
  } | undefined;

  if (!event || Number(event.org_id) !== ctx.orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Concurrency guard: the UI already disables the launch control while a run
  // is active, but nothing server-side stopped a second request (double-click,
  // replayed request, second tab) from starting an overlapping wave against
  // the same event — which would race writes to agent_runs/suppliers/status.
  // Mirror the GET endpoints' interruption staleness window (>5 min since the
  // last write) so a crashed/timed-out run doesn't lock the event out of new
  // runs forever — the DB row's status is never written back to 'reviewing'/
  // 'idle' on that path, only downgraded in-memory for the read response.
  if (event.status === "scouting" || event.status === "outreach") {
    const updatedMs = event.updated_at ? new Date(event.updated_at).getTime() : 0;
    const stale = !updatedMs || Date.now() - updatedMs > 5 * 60_000;
    if (!stale) {
      return NextResponse.json(
        { error: "A run is already in progress for this event.", code: "run_in_progress" },
        { status: 409 },
      );
    }
  }

  const tier = effectiveTier(ctx.org);
  const waveNumber = event.wave_count + 1;
  const waveCheck = checkWaveLimit(tier, waveNumber);
  if (!waveCheck.ok) {
    return NextResponse.json({
      error: `Your ${tier.name} plan includes ${waveCheck.limit} discovery wave${waveCheck.limit === 1 ? "" : "s"} per event — you've already used ${waveCheck.used}. Upgrade for more waves.`,
      code: waveCheck.reason,
    }, { status: 402 });
  }

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
        // Also touch updated_at so the GET list/detail endpoints' "interrupted
        // run" staleness heuristic (>5 min since updated_at while status is
        // scouting/outreach) doesn't false-positive on a healthy long-running
        // wave — updated_at was previously only written at wave start/end.
        void db.prepare(`UPDATE sourcing_events SET updated_at=datetime('now') WHERE id=?`).run(event.id).catch(() => {});
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

        // Plan cap on suppliers-per-event: scouts run concurrently, so track
        // remaining headroom in a closure variable and decrement it
        // synchronously (no `await` between read and write) right alongside
        // claimIfNew's dedup claim, so parallel scouts can't race past the cap.
        const supplierLimit = tier.limits.suppliersPerEvent;
        let supplierCapRemaining = supplierLimit === UNLIMITED ? Infinity : Math.max(0, supplierLimit - existing.length);
        let capNoticeSent = false;

        // #94: the per-event cap above is what the tier pays for, but on
        // unlimited tiers it's Infinity — nothing bounds how many suppliers a
        // SINGLE wave tries to qualify/enrich within this one request's 300s
        // serverless budget. Each qualifier call is 30-150s once the grounded
        // escalation band (score.overall_score 60-82, or thin evidence) kicks
        // in, so an uncapped wave's critical path can comfortably exceed 300s
        // before background enrichment/contact-scrape even runs. Soft-cap
        // suppliers PROCESSED per wave — not stored — so one wave always
        // finishes inside the budget; buyers on unlimited tiers can simply
        // launch another wave for more depth. No-op on capped tiers, where the
        // per-event cap (usually well under this soft cap) already bounds it.
        const waveSupplierSoftCap = supplierLimit === UNLIMITED
          ? Math.max(1, Number(process.env.UNLIMITED_TIER_WAVE_SUPPLIER_CAP) || 70)
          : Infinity;
        let waveCapRemaining = waveSupplierSoftCap;
        let waveCapNoticeSent = false;

        const groundingOn = process.env.QUALIFIER_GROUNDING !== "0";
        let newSuppliers = 0;
        // Contact scraping runs off the critical path (lib/process-supplier.ts):
        // each supplier's background scrape task lands here so we can drain them
        // all before the stream closes, instead of awaiting them inline.
        const backgroundTasks: Promise<void>[] = [];

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
          let fresh = found.filter(s => claimIfNew(s.name, s.website));

          // Enforce the plan's suppliers-per-event cap: truncate this batch to
          // whatever headroom remains, so a run never overshoots the tier limit.
          if (supplierCapRemaining !== Infinity && fresh.length > supplierCapRemaining) {
            fresh = fresh.slice(0, Math.max(0, supplierCapRemaining));
            if (!capNoticeSent) {
              capNoticeSent = true;
              send({
                type: "supplier_cap_reached", limit: supplierLimit,
                message: `Reached your plan's ${supplierLimit}-supplier limit for this event — remaining candidates were skipped. Upgrade for a higher cap.`,
              });
            }
          }
          if (supplierCapRemaining !== Infinity) supplierCapRemaining -= fresh.length;

          // Soft per-wave cap (#94) — only ever active on unlimited-supplier
          // tiers (see waveSupplierSoftCap above). Applied after the per-event
          // cap so the two never fight over which "remaining" number is right.
          if (waveCapRemaining !== Infinity && fresh.length > waveCapRemaining) {
            fresh = fresh.slice(0, Math.max(0, waveCapRemaining));
            if (!waveCapNoticeSent) {
              waveCapNoticeSent = true;
              send({
                type: "wave_supplier_cap_reached", limit: waveSupplierSoftCap,
                message: `This wave processed its ${waveSupplierSoftCap}-supplier soft cap to stay within time limits — run another wave for more depth.`,
              });
            }
          }
          if (waveCapRemaining !== Infinity) waveCapRemaining -= fresh.length;

          send({ type: "agent_scouted", agent_id: agent.id, count: fresh.length, message: `Found ${fresh.length} suppliers, qualifying...` });
          await db.prepare(`UPDATE agent_runs SET status='qualifying', message=?, suppliers_found=?
                      WHERE event_id=? AND agent_id=? AND wave=?`)
            .run(`Qualifying ${fresh.length} suppliers...`, fresh.length, event.id, agent.id, waveNumber);

          // Qualify + enrich concurrently with a bounded pool per scout. Contact
          // scraping is handled inside processSupplier, off the critical path —
          // see lib/process-supplier.ts.
          const processSupplier = makeProcessSupplier({
            db, eventId: event.id, waveNumber, categoryLabel, effectiveRequirements,
            annualSpend: event.annual_spend, groundingOn, send, track, backgroundTasks,
          }, agent);
          // #41 (Epic 8.5): default raised 4->6. Most qualifier calls are Haiku
          // (cheap, high rate limits); only the thin-evidence band escalates to
          // the Sonnet-tier grounded qualifier, so headroom here is dominated by
          // Haiku's limits, not Sonnet's. Still env-overridable per deployment.
          const qualConcurrency = Math.max(1, Number(process.env.QUAL_CONCURRENCY) || 6);
          let qCursor = 0;
          const qWorker = async () => {
            while (qCursor < fresh.length) {
              const idx = qCursor++;
              await processSupplier(fresh[idx]);
            }
          };
          await Promise.all(Array.from({ length: Math.min(qualConcurrency, fresh.length) }, qWorker));
          newSuppliers += fresh.length;

          await db.prepare(`UPDATE agent_runs SET status='complete', message=?, completed_at=datetime('now')
                      WHERE event_id=? AND agent_id=? AND wave=?`)
            .run(`Delivered ${fresh.length} qualified leads`, event.id, agent.id, waveNumber);
          send({ type: "agent_complete", agent_id: agent.id, agent_label: agent.label, suppliers_found: fresh.length });
        };

        // Run scouts in a bounded pool — the big wall-clock win over sequential.
        // #41 (Epic 8.5): default raised 3->4. Each scout is an Opus call with
        // web_search, then fans out into its own qualConcurrency pool once it
        // finishes scouting — so worst-case simultaneous model calls rises from
        // ~3x4=12 to ~4x6=24. That's the new ceiling to watch for 429s against;
        // still env-overridable per deployment if a given account's limits are
        // tighter.
        const scoutConcurrency = Math.max(1, Number(process.env.SCOUT_CONCURRENCY) || 4);
        let sCursor = 0;
        const sWorker = async () => {
          while (sCursor < plan.agents.length) {
            const idx = sCursor++;
            await runScout(plan.agents[idx]);
          }
        };
        await Promise.all(Array.from({ length: Math.min(scoutConcurrency, plan.agents.length) }, sWorker));

        // Drain any still-pending background contact scrapes before finishing the
        // wave, so wave_complete's usage totals reflect them and the SSE stream
        // doesn't close mid-scrape.
        await Promise.allSettled(backgroundTasks);

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
