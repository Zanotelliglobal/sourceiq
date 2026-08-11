import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { runClassifierAgent } from "@/lib/agents";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const maxDuration = 60;

// Classifies a free-text sourcing description into a commodity category +
// subcategory. Called from the New Event form as the buyer writes the scope.
export async function POST(req: NextRequest) {
  const { description, categories } = await req.json();

  if (!description || typeof description !== "string" || description.trim().length < 12) {
    return NextResponse.json({ error: "Description too short to classify" }, { status: 400 });
  }
  if (!Array.isArray(categories) || categories.length === 0) {
    return NextResponse.json({ error: "categories list required" }, { status: 400 });
  }

  // Behind Clerk's middleware but stateless (no org/tenant DB lookup — see
  // module comment pattern in filter-suppliers/route.ts), so rate-limit on
  // the raw Clerk userId instead of pulling full org context. Debounced
  // client-side at 900ms, but an LLM call per pause is still real cost — cap
  // per-user plus a per-IP backstop against a scripted/looping client.
  const { userId } = auth();
  const [userRl, ipRl] = await Promise.all([
    rateLimit("classify", userId ?? "anon", 30, 60),
    rateLimit("classify-ip", clientIp(), 60, 60),
  ]);
  if (!userRl.ok || !ipRl.ok) {
    const retryAfter = Math.max(userRl.retryAfter, ipRl.retryAfter);
    return NextResponse.json(
      { error: "Too many requests. Please slow down.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  try {
    const result = await runClassifierAgent(description.trim(), categories);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
