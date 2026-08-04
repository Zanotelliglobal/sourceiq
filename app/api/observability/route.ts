import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/tenant";
import { captureException, trackEvent } from "@/lib/observability";

// Ingest endpoint for client-side telemetry beacons (errors + analytics events).
// Re-emits each record server-side with the authenticated org/user attached, so
// browser errors reach the same structured log pipeline as server errors.
// Best-effort and never trusted: unauthenticated beacons are dropped, payloads
// are size-capped, and any parse failure returns 204 (beacons ignore the body).
export async function POST(req: NextRequest) {
  try {
    const ctx = await getOrgContext();
    // Drop anonymous telemetry — nothing to attribute it to, and it's a spam vector.
    if (!ctx) return new NextResponse(null, { status: 204 });

    const raw = await req.text();
    if (raw.length > 16_000) return new NextResponse(null, { status: 204 });
    const record = JSON.parse(raw) as { type?: string; name?: string; message?: string; props?: Record<string, unknown>; context?: Record<string, unknown> };

    const identity = { orgId: ctx.orgId, userId: ctx.userId, origin: "client" as const };

    if (record.type === "event" && typeof record.name === "string") {
      trackEvent(record.name, { ...record.props, ...identity });
    } else {
      captureException(record.message || "client_error", { ...record.context, ...identity, source: "client" });
    }
  } catch {
    /* telemetry must never surface an error to the client */
  }
  return new NextResponse(null, { status: 204 });
}
