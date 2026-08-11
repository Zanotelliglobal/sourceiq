import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getOrgContext } from "@/lib/tenant";
import { requireActiveSubscription } from "@/lib/billing";
import { checkEventLimit } from "@/lib/usage";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { logAudit } from "@/lib/audit";
import { captureException, trackEvent } from "@/lib/observability";

// Safety cap on the list endpoint: the dashboard fetches this array in full
// and does all filtering/sorting/grouping client-side (see app/dashboard/
// page.tsx), so this isn't a real pagination boundary — it's a backstop
// against an unbounded query once an org has accumulated hundreds of
// historical events. Pinned events (surfaced first via ORDER BY) are never
// pushed out by the cap.
const MAX_EVENTS_RETURNED = 500;

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  // Effective status: a run only reaches its terminal status ('reviewing') on
  // clean completion. If discovery is interrupted (serverless timeout, tab
  // close, dropped connection) the row is left in a "working" state
  // ('scouting'/'outreach') forever, so the dashboard shows a live spinner that
  // never clears. Here we treat a working status with a stale `updated_at`
  // (> 5 min of no writes) as interrupted: fall back to 'reviewing' if any
  // suppliers were found, otherwise 'idle'. Genuinely-running events keep a
  // fresh `updated_at` and are unaffected.
  const events = await db
    .prepare(
      `SELECT se.*,
        COUNT(s.id)::int as supplier_count,
        COALESCE(SUM(CASE WHEN s.funnel_stage = 'shortlisted' THEN 1 ELSE 0 END),0)::int as shortlisted_count,
        CASE
          WHEN se.status IN ('scouting','outreach')
               AND se.updated_at < now() - interval '5 minutes'
          THEN CASE WHEN COUNT(s.id) > 0 THEN 'reviewing' ELSE 'idle' END
          ELSE se.status
        END as effective_status
       FROM sourcing_events se
       LEFT JOIN suppliers s ON s.event_id = se.id
       WHERE se.org_id = ?
       GROUP BY se.id
       ORDER BY se.pinned DESC, se.created_at DESC
       LIMIT ?`
    )
    .all(ctx.orgId, MAX_EVENTS_RETURNED) as Array<Record<string, unknown> & { effective_status: string }>;

  // Surface the derived status as `status` so the dashboard renders the honest
  // (interruption-aware) state; keep the stored value under `raw_status`.
  const normalized = events.map(({ effective_status, ...e }) => ({
    ...e,
    raw_status: e.status,
    status: effective_status,
  }));
  return NextResponse.json(normalized);
}

export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Billing gate: block new events unless the org has an active plan or trial.
  const gate = requireActiveSubscription(ctx.org);
  if (!gate.ok) return NextResponse.json({ error: gate.reason, code: "subscription_required" }, { status: 402 });

  // Anti-abuse: cap event creation per org and per source IP. The per-IP cap
  // blunts multi-account trial farming from a single machine.
  const [orgRl, ipRl] = await Promise.all([
    rateLimit("event-create", String(ctx.orgId), 20, 3600),
    rateLimit("event-create-ip", clientIp(), 30, 3600),
  ]);
  if (!orgRl.ok || !ipRl.ok) {
    const retryAfter = Math.max(orgRl.retryAfter, ipRl.retryAfter);
    return NextResponse.json(
      { error: "Too many events created recently. Please try again later.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  // Tier quota: block new events once the org exhausts its monthly allowance.
  const db = getDb();
  const quota = await checkEventLimit(db, ctx.org);
  if (!quota.ok) {
    return NextResponse.json(
      { error: `Monthly event limit reached (${quota.used}/${quota.limit}). Upgrade your plan for more.`, code: "event_limit_reached", limit: quota.limit, used: quota.used },
      { status: 402 }
    );
  }

  const body = await req.json();
  const { title, category, subcategory, description, requirements, annual_spend, target_countries,
    ship_to, outreach_anonymous, buyer_name, buyer_role, buyer_company } = body;

  if (!title || !category || !description || !requirements) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  const countries = Array.isArray(target_countries) ? target_countries.join(", ") : (target_countries || null);
  // Ship-to destination market suppliers must be able to deliver/export to.
  const shipTo = Array.isArray(ship_to) ? ship_to.join(", ") : (ship_to || null);

  // Outreach identity: default anonymous unless the buyer explicitly opts to disclose.
  const anonymous = !(outreach_anonymous === false || outreach_anonymous === "false");
  const bName = anonymous ? null : (buyer_name || null);
  const bRole = anonymous ? null : (buyer_role || null);
  const bCompany = anonymous ? null : (buyer_company || null);

  // Tenant scoping: the event belongs to the caller's resolved organization.
  const orgId = ctx.orgId;

  try {
    const result = await db
      .prepare(
        `INSERT INTO sourcing_events (org_id, title, category, subcategory, description, requirements, annual_spend, target_countries, ship_to, outreach_anonymous, buyer_name, buyer_role, buyer_company)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(orgId, title, category, subcategory || null, description, requirements, annual_spend ?? null, countries, shipTo, anonymous, bName, bRole, bCompany);

    const event = await db
      .prepare("SELECT * FROM sourcing_events WHERE id = ?")
      .get(result.lastInsertRowid);

    await logAudit({
      orgId, eventId: Number(result.lastInsertRowid), actorId: ctx.userId,
      action: "event.create", summary: `Created sourcing event "${title}"`,
      metadata: { category, anonymous },
    });

    trackEvent("event.created", { orgId, eventId: Number(result.lastInsertRowid), category, hasShipTo: Boolean(shipTo) });

    return NextResponse.json(event, { status: 201 });
  } catch (err) {
    captureException(err, { source: "sourcing-events.POST", orgId });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
