import { getDb } from "@/lib/db";
import { headers } from "next/headers";

// ─── RATE LIMITING ─────────────────────────────────────────────────────────────
// A DB-backed fixed-window limiter. Serverless instances don't share memory, so
// counters live in Postgres (rate_limits table). Each (bucket, window) row is
// upserted and incremented atomically; callers get {ok, remaining, retryAfter}.

export type RateLimitResult = { ok: boolean; remaining: number; retryAfter: number };

/**
 * Increment and check a fixed-window counter.
 * @param key    Logical bucket name (e.g. "checkout", "signup").
 * @param id     Caller identity (IP, org id, user id).
 * @param limit  Max requests allowed within the window.
 * @param windowSec Window length in seconds.
 */
export async function rateLimit(
  key: string,
  id: string,
  limit: number,
  windowSec: number
): Promise<RateLimitResult> {
  const db = getDb();
  // Align to the start of the current window so all callers share one row.
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSec * 1000)) * windowSec * 1000);
  const bucket = `${key}:${id}`;

  const row = (await db
    .prepare(
      `INSERT INTO rate_limits (bucket, window_start, count)
       VALUES (?, ?, 1)
       ON CONFLICT (bucket, window_start)
       DO UPDATE SET count = rate_limits.count + 1
       RETURNING count`
    )
    .get(bucket, windowStart.toISOString())) as { count?: number } | undefined;

  const count = Number(row?.count ?? 1);
  const remaining = Math.max(0, limit - count);
  const retryAfter = count > limit
    ? Math.ceil((windowStart.getTime() + windowSec * 1000 - now) / 1000)
    : 0;
  return { ok: count <= limit, remaining, retryAfter };
}

/** Best-effort client IP from proxy headers (Vercel/Cloudflare/standard). */
export function clientIp(): string {
  const h = headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") || h.get("cf-connecting-ip") || "unknown";
}
