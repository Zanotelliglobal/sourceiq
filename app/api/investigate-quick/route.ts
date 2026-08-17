import { NextRequest, NextResponse } from "next/server";
import { getDb, type Supplier } from "@/lib/db";
import { runQuickScoutAgent, AGENT_MODELS } from "@/lib/agents";
import { makeProcessSupplierQuick } from "@/lib/process-supplier";
import { recordUsage, effectiveTier, checkSpendCeiling, checkQuickScanLimit } from "@/lib/usage";
import { getOrgContext, getOwnedEvent, STALE_RUN_MS } from "@/lib/tenant";
import { requireSpendableSubscription } from "@/lib/billing";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/ratelimit";
import { normName, domainOf } from "@/lib/dedup";
import { UNLIMITED } from "@/lib/plans";

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

  const gate = requireSpendableSubscription(ctx.org);
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

  // Concurrency guard: a Quick Scan didn't previously touch `status` at all,
  // so a full discovery wave or outreach campaign could race a concurrent
  // quick scan against the same event undetected by either side's own guard
  // (audit finding: outreach's `run_in_progress` check only ever looked at
  // `status`, and quick scan never set it). Mirror the same staleness window
  // orchestrate/outreach use so a crashed/timed-out quick scan doesn't lock
  // the event out forever.
  if (event.status === "scouting" || event.status === "outreach") {
    const updatedMs = event.updated_at ? new Date(event.updated_at).getTime() : 0;
    const stale = !updatedMs || Date.now() - updatedMs > STALE_RUN_MS;
    if (!stale) {
      return NextResponse.json(
        { error: "A run is already in progress for this event.", code: "run_in_progress" },
        { status: 409 },
      );
    }
  }

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

  // Independent quick-scan budget (separate from the real, verified-supplier
  // cap — see checkQuickScanLimit in lib/usage.ts). Without this, unverified
  // Quick Scan rows being excluded from checkSupplierLimit would otherwise
  // leave Quick Scan completely uncapped.
  const quickLimitCheck = await checkQuickScanLimit(db, tier, event.id);
  if (!quickLimitCheck.ok) {
    return NextResponse.json({
      error: `This event has reached its quick-scan limit (${quickLimitCheck.used}/${quickLimitCheck.limit} unverified candidates). Deepen or dismiss existing quick-scan results, or run a full discovery wave instead.`,
      code: quickLimitCheck.reason,
    }, { status: 402 });
  }
  // Remaining headroom under that same budget, so a single scan (which can
  // return up to 15 candidates) can't blow past the limit in one call —
  // mirrors the truncate-to-cap pattern in the full orchestrate route.
  const quickSupplierLimit = tier.limits.suppliersPerEvent;
  let quickScanHeadroom = Infinity;
  if (quickSupplierLimit !== UNLIMITED) {
    const quickCapLimit = Math.max(1, Math.ceil(quickSupplierLimit / 2));
    const quickCountRow = await db.prepare(
      "SELECT COUNT(*)::int AS c FROM suppliers WHERE event_id = ? AND is_quick_result = true"
    ).get(event.id) as { c: number } | undefined;
    quickScanHeadroom = Math.max(0, quickCapLimit - Number(quickCountRow?.c ?? 0));
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

  // Claim the concurrency lock before the (only real-latency) scout call, so
  // a concurrent orchestrate/outreach request sees `status='scouting'` for
  // the ~few seconds this takes — same signal a full wave sets, just held
  // for a much shorter window. Restored in `finally` below no matter how
  // this request ends.
  await db.prepare(`UPDATE sourcing_events SET status='scouting', updated_at=datetime('now') WHERE id=?`).run(event.id);

  let inserted: Supplier[] = [];
  try {
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
    let fresh = candidates.filter(c => {
      const nn = normName(c.name);
      const dom = domainOf(c.website);
      if (nn && seenNames.has(nn)) return false;
      if (dom && seenDomains.has(dom)) return false;
      if (nn) seenNames.add(nn);
      if (dom) seenDomains.add(dom);
      return true;
    });

    // Truncate to whatever headroom remains under the independent quick-scan
    // budget so a single scan (which can return up to 15 candidates) can't blow
    // past the cap in one call — mirrors the truncate-to-cap pattern in the
    // full orchestrate route.
    if (quickScanHeadroom !== Infinity && fresh.length > quickScanHeadroom) {
      fresh = fresh.slice(0, Math.max(0, quickScanHeadroom));
    }

    const processQuick = makeProcessSupplierQuick({ db, eventId: event.id, orgId: ctx.orgId, send: () => {} });
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
  } finally {
    // Release the lock: 'reviewing' if this event now has any suppliers at
    // all (pre-existing or just-inserted), else back to 'idle' — mirrors the
    // interruption-aware fallback the GET/list endpoints already apply.
    const hasAny = existing.length > 0 || inserted.length > 0;
    await db.prepare(`UPDATE sourcing_events SET status=?, updated_at=datetime('now') WHERE id=?`)
      .run(hasAny ? "reviewing" : "idle", event.id);
  }
}
