import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getOrgContext } from "@/lib/tenant";
import { getChecklistState, completeChecklistTask, isExplicitlyCompletable } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

// GET /api/onboarding
// Returns the org's quick-start checklist state, auto-detecting (and
// rewarding) any newly-completed activation tasks along the way.
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const state = await getChecklistState(db, ctx.org);
  return NextResponse.json(state);
}

// POST /api/onboarding  { task: string }
// Explicitly marks a client-reported checklist task complete (currently just
// "share_referral", fired when the user copies their referral link). Tasks
// the server auto-detects (create_event, shortlist_supplier, launch_outreach)
// cannot be completed this way — they're derived from real data on GET.
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { task } = (await req.json().catch(() => ({}))) as { task?: string };
  if (!task || !isExplicitlyCompletable(task)) {
    return NextResponse.json({ error: "Unknown or non-manual task" }, { status: 400 });
  }

  const db = getDb();
  const state = await completeChecklistTask(db, ctx.org, task);
  return NextResponse.json(state);
}
