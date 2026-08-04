// ─── OBSERVABILITY ────────────────────────────────────────────────────────────
// A tiny, provider-agnostic layer for error tracking and product analytics.
// It has ZERO third-party dependencies so it never bloats the bundle or breaks
// the build. Two isomorphic entry points:
//
//   captureException(err, context?)  → error tracking
//   trackEvent(name, props?)         → product analytics
//
// Transport:
//   • Server: emit one structured JSON line to stdout/stderr. Hosts like Vercel
//     forward these to any log drain (Datadog, Better Stack, etc.), giving real
//     observability with no SDK. If SENTRY_DSN is set we also POST a minimal
//     event to Sentry's store endpoint (best-effort, fire-and-forget).
//   • Client: best-effort beacon to /api/observability, which re-emits the
//     record server-side with the authenticated org/user attached.
//
// This is intentionally a thin seam: swapping in @sentry/nextjs or PostHog later
// means changing only this file, not the dozens of call sites.

export type Level = "error" | "warning" | "info";

export type ObsContext = Record<string, unknown> & {
  level?: Level;
  source?: string;
};

const isServer = typeof window === "undefined";

// Serializable error shape — Error isn't JSON-friendly by default.
function serializeError(err: unknown): { message: string; stack?: string; name?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack, name: err.name };
  return { message: typeof err === "string" ? err : JSON.stringify(err) };
}

// Fire-and-forget POST to Sentry's Store API using the DSN, if configured.
// Implements just enough of the protocol to record an exception; failures are
// swallowed so telemetry never affects the request path.
async function forwardToSentry(payload: Record<string, unknown>): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    // DSN format: https://<publicKey>@<host>/<projectId>
    const m = /^https:\/\/([^@]+)@([^/]+)\/(.+)$/.exec(dsn);
    if (!m) return;
    const [, publicKey, host, projectId] = m;
    const url = `https://${host}/api/${projectId}/store/`;
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=sourceiq/1.0`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    /* telemetry must never throw */
  }
}

// Client → server beacon. sendBeacon survives page unload; fetch is the fallback.
function beacon(path: string, body: unknown): void {
  try {
    const json = JSON.stringify(body);
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(path, new Blob([json], { type: "application/json" }));
      return;
    }
    void fetch(path, { method: "POST", body: json, headers: { "Content-Type": "application/json" }, keepalive: true });
  } catch {
    /* best-effort */
  }
}

/** Record an exception with optional structured context. */
export function captureException(err: unknown, context: ObsContext = {}): void {
  const record = {
    type: "exception" as const,
    level: context.level ?? ("error" as Level),
    ...serializeError(err),
    context: { ...context },
    ts: new Date().toISOString(),
  };

  if (isServer) {
    // Structured line → picked up by the host's log pipeline.
    console.error(`[obs] ${JSON.stringify(record)}`);
    void forwardToSentry({
      message: record.message,
      level: record.level,
      platform: "javascript",
      exception: { values: [{ type: record.name ?? "Error", value: record.message, stacktrace: record.stack ? { frames: [] } : undefined }] },
      extra: record.context,
      timestamp: Date.now() / 1000,
    });
  } else {
    beacon("/api/observability", record);
  }
}

/** Record a product-analytics event (e.g. "event.created", "outreach.launched"). */
export function trackEvent(name: string, props: Record<string, unknown> = {}): void {
  const record = { type: "event" as const, name, props, ts: new Date().toISOString() };
  if (isServer) {
    console.log(`[obs] ${JSON.stringify(record)}`);
  } else {
    beacon("/api/observability", record);
  }
}
