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

// ─── PII SCRUBBING (#84) ───────────────────────────────────────────────────
// captureException's `context` is a grab-bag: call sites pass whatever was in
// scope at the point of failure (raw errors from sendEmail, supplier
// contact-scrape failures, client-side beacon payloads with page state), and
// any of those can carry a supplier or user email/phone straight into the
// message, stack, or context values. That's fine for the server console.error
// line (an in-house, access-controlled log), but forwardToSentry ships the
// record to a third party — so scrub PII from exactly the payload that
// leaves the process, not the local log.
//
// Deliberately narrow (email + phone patterns) rather than a generic
// allow/deny-list scrubber: broader heuristics risk mangling legitimate
// diagnostic text (supplier names, URLs, error codes) for marginal benefit.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Phone-ish: 7+ digits, optionally grouped with spaces/dashes/dots/parens, optional leading +.
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g;

function scrubString(s: string): string {
  return s.replace(EMAIL_RE, "[redacted-email]").replace(PHONE_RE, "[redacted-phone]");
}

/** Recursively redact email/phone-shaped substrings from a value bound for a third party. */
export function scrubPii<T>(value: T, depth = 0): T {
  if (depth > 6) return value; // guard against pathological/circular shapes
  if (typeof value === "string") return scrubString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => scrubPii(v, depth + 1)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubPii(v, depth + 1);
    }
    return out as T;
  }
  return value;
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
    // Scrub PII only for the payload actually leaving the process — the
    // console.error line above stays at full fidelity for our own debugging.
    const scrubbedMessage = scrubString(record.message);
    void forwardToSentry({
      message: scrubbedMessage,
      level: record.level,
      platform: "javascript",
      exception: { values: [{ type: record.name ?? "Error", value: scrubbedMessage, stacktrace: record.stack ? { frames: [] } : undefined }] },
      extra: scrubPii(record.context),
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
