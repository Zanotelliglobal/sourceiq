import { NextRequest, NextResponse } from "next/server";
import { getOrgContext, orgOwnsSupplier } from "@/lib/tenant";
import { getOutreachLogForSupplier, summarizeOutreachThread } from "@/lib/outreach-log";

export const runtime = "nodejs";

// Read the outreach thread for one supplier: every outbound RFI/follow-up and
// inbound reply, oldest first. Org-scoped: callers can only read history for
// suppliers whose parent event their organization owns.
export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supplierId = Number(req.nextUrl.searchParams.get("supplier_id"));
  if (!supplierId) return NextResponse.json({ error: "supplier_id required" }, { status: 400 });
  if (!(await orgOwnsSupplier(ctx.orgId, supplierId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const entries = await getOutreachLogForSupplier(supplierId);

  return NextResponse.json({
    entries: entries.map(e => ({
      id: e.id,
      direction: e.direction,
      subject: e.subject,
      body: e.body,
      sent_at: e.sent_at,
    })),
    summary: summarizeOutreachThread(entries),
  });
}
