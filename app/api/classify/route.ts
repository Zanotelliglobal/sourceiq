import { NextRequest, NextResponse } from "next/server";
import { runClassifierAgent } from "@/lib/agents";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const maxDuration = 60;

// Classifies a free-text sourcing description into a commodity category +
// subcategory. Called from the New Event form as the buyer writes the scope.
export async function POST(req: NextRequest) {
  // #79: this route is intentionally stateless/unauthenticated (see
  // filter-suppliers' comment) — no org context to key a limit off, so IP is
  // the only anti-abuse handle. Without it, anyone can hammer an LLM call for
  // free/at the app's expense with a trivial curl loop.
  const rl = await rateLimit("classify-ip", clientIp(), 60, 3600);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const { description, categories } = await req.json();

  if (!description || typeof description !== "string" || description.trim().length < 12) {
    return NextResponse.json({ error: "Description too short to classify" }, { status: 400 });
  }
  if (!Array.isArray(categories) || categories.length === 0) {
    return NextResponse.json({ error: "categories list required" }, { status: 400 });
  }

  try {
    const result = await runClassifierAgent(description.trim(), categories);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
