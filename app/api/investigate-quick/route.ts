import { NextRequest, NextResponse } from "next/server";
import { getDb, type Supplier } from "@/lib/db";
import { runQuickScoutAgent, AGENT_MODELS } from "@/lib/agents";
import { makeProcessSupplierQuick } from "@/lib/process-supplier";
import { recordUsage, effectiveTier, checkSpendCeiling } from "@/lib/usage";
import { getOrgContext, getOwnedEvent } from "@/lib/tenant";
import { requireActiveSubscription } from "@/lib/billing";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/ratelimit";
import { normName, domainOf } from "@/lib/dedup";

// ─── QUICK INVESTIGATION: fast, names-only supplier scan ──────────────────────
// A single, synchronous (no SSE) request: one no-tools/no-thinking Sonnet call
// against runQuickScoutAgent, returning up to 15 plausible-but-UNVERIFIED
// supplier names. Deliberately skips everything the full orchestrate route
// does to bound a real multi-agent discovery wave — concurrency guard,
// checkWaveLimit, supplier-per-event caps, wave_count increment — because
// this never touches wave_count and only ever inserts a small, bounded batch
// of is_quick_result=true rows. The hard per-event $ spend ceiling still
// applies. "Deepen into full investigation" (app/api/orchestrate/route.ts's
// `targeted` field) is how a candidate becomes a real, verified supplier.
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = requireActiveSubscription(ctx.org);
  if (!gate.ok) return NextResponse.json({ error: gate.reason, code: "subscription_required" }, { status: 402 });

  // A distinct, more generous bucket than the full wave's 10/60s (see
  // app/api/orchestrate/route.ts) — quick scan is a single cheap no-tools
  // call, not a multi-agent wave, so a buyer scanning several events
  // back-to-back shouldn't hit the same limiter a real discovery wave does.
  const orgRl = await rateLimit("investigate_quick", String(ctx.orgId), 20, 60);
  if (!orgRl.ok) {
    return NextResponse.json(
      { error: "Too many quick scans launched. Please slow down.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(orgRl.retryAfter) } },
    );
  }

  const { event_id } = await req.json() as { event_id: number };
  const db = getDb();

  const event = await getOwnedEvent(db, ctx, event_id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Hard per-event cost ceiling (#65) still applies — the only guard shared
  // with the full orchestrate route. Everything else (concurrency guard,
  // checkWaveLimit, supplier-per-event cap) is orchestrate-specific plan
  // enforcement that quick scan intentionally does not participate in.
  const tier = effectiveTier(ctx.org);
  const spendCheck = await checkSpendCeiling(db, tier, event.id);
  if (!spendCheck.ok) {
    return NextResponse.json({
      error: `This event has reached its $${spendCheck.limit} AI-spend ceiling (used $${spendCheck.used.toFixed(2)}). Contact support to raise the limit before running more discovery.`,
      code: spendCheck.reason,
    }, { status: 402 });
  }

  const categoryLabel = event.subcategory ? `${event.category} — ${event.subcategory}` : event.category;

  // Existing suppliers (name + website) to avoid duplicates — same dedup
  // logic as the full orchestrate route (lib/dedup.ts), applied once against
  // a flat candidate list rather than across several concurrent scouts.
  const existing = await db.prepare("SELECT name, website FROM suppliers WHERE event_id=?").all(event.id) as { name: string; website: string | null }[];
  const seenNames = new Set<string>();
  const seenDomains = new Set<string>();
  for (const s of existing) {
    const nn = normName(s.name);
    if (nn) seenNames.add(nn);
    const dom = domainOf(s.website);
    if (dom) seenDomains.add(dom);
  }
  const avoidNames = existing.map(s => s.name);

  let candidates;
  try {
    candidates = await runQuickScoutAgent(
      categoryLabel, event.description, event.requirements,
      event.target_countries || "", avoidNames,
      (u) => { void recordUsage(db, event.id, "quick_scout", u, AGENT_MODELS.quickScout); }
    );
  } catch (err) {
    return NextResponse.json({ error: `Quick scan failed: ${String(err)}` }, { status: 502 });
  }

  // Claim new candidates against the existing-supplier dedup sets built above.
  const fresh = candidates.filter(c => {
    const nn = normName(c.name);
    const dom = domainOf(c.website);
    if (nn && seenNames.has(nn)) return false;
    if (dom && seenDomains.has(dom)) return false;
    if (nn) seenNames.add(nn);
    if (dom) seenDomains.add(dom);
    return true;
  });

  const processQuick = makeProcessSupplierQuick({ db, eventId: event.id, send: () => {} });
  const inserted: Supplier[] = [];
  for (const c of fresh) {
    inserted.push(await processQuick(c));
  }

  await logAudit({
    orgId: ctx.orgId, eventId: event.id, actorId: ctx.userId,
    action: "discovery.quick_scan",
    summary: `Quick-scanned ${inserted.length} unverified candidate${inserted.length === 1 ? "" : "s"}`,
    metadata: { count: inserted.length },
  });

  return NextResponse.json({ candidates: inserted });
}
