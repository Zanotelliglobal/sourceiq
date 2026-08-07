import { NextRequest, NextResponse } from "next/server";
import { runFilterMapperAgent } from "@/lib/agents";

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

  try {
    const filters = await runFilterMapperAgent(query.trim());
    return NextResponse.json(filters);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
