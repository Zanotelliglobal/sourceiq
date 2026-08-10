import { NextRequest, NextResponse } from "next/server";
import { runFilterMapperAgent } from "@/lib/agents";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const maxDuration = 30;

// Maps a free-text "AI filter" query to the structured filter shape the
// filter panel uses (lib/supplier-filters.ts). Stateless — doesn't touch the
// DB or any tenant data, so no org-context check is needed (mirrors
// app/api/classify/route.ts).
export async function POST(req: NextRequest) {
  // #79: no org context available (stateless route, see comment above), so
  // IP is the only anti-abuse handle against a free/uncapped LLM call loop.
  const rl = await rateLimit("filter-suppliers-ip", clientIp(), 60, 3600);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const { query } = await req.json();

  if (!query || typeof query !== "string" || query.trim().length < 3) {
    return NextResponse.json({ error: "Query too short to map to filters" }, { status: 400 });
  }

  try {
    const filters = await runFilterMapperAgent(query.trim());
    return NextResponse.json(filters);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
