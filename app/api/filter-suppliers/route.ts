import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { runFilterMapperAgent } from "@/lib/agents";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const maxDuration = 30;

// Maps a free-text "AI filter" query to the structured filter shape the
// filter panel uses (lib/supplier-filters.ts). Stateless — doesn't touch the
// DB or any tenant data, so no org-context check is needed (mirrors
// app/api/classify/route.ts).
export async function POST(req: NextRequest) {
  const { query } = await req.json();

  if (!query || typeof query !== "string" || query.trim().length < 3) {
    return NextResponse.json({ error: "Query too short to map to filters" }, { status: 400 });
  }

  // Same rationale as app/api/classify/route.ts: no tenant DB lookup here, so
  // rate-limit on the raw Clerk userId (this route still sits behind Clerk's
  // middleware) plus a per-IP backstop, rather than an unbounded LLM call.
  const { userId } = auth();
  const [userRl, ipRl] = await Promise.all([
    rateLimit("filter-suppliers", userId ?? "anon", 30, 60),
    rateLimit("filter-suppliers-ip", clientIp(), 60, 60),
  ]);
  if (!userRl.ok || !ipRl.ok) {
    const retryAfter = Math.max(userRl.retryAfter, ipRl.retryAfter);
    return NextResponse.json(
      { error: "Too many requests. Please slow down.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  try {
    const filters = await runFilterMapperAgent(query.trim());
    return NextResponse.json(filters);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
