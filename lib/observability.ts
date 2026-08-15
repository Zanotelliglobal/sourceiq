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
// Revision (review feedback on #84): pattern-matching alone is a DENYLIST —
// it only catches PII shapes it knows to look for (email/phone). It says
// nothing about a future call site that puts a supplier's name, address, or
// negotiated price into `context`, or an agent that puts raw model output
// into an error message — that free text sails through untouched because it
// doesn't match EMAIL_RE/PHONE_RE. Two structural fixes on top of the regex
// scrub, so the guarantee doesn't depend on every future caller remembering
// to scrub:
//
//   1. `context` is now ALLOWLISTED at the sink (see ALLOWED_CONTEXT_KEYS
//      below): only a short list of vetted, non-PII operational-metadata
//      keys are ever forwarded to forwardToSentry. Any other key — including
//      one a future agent call site adds without thinking about egress — is
//      dropped by default, not scrubbed-if-recognized.
//   2. `message`/`stack` are inherently freeform (an Error's .message can be
//      anything), so they can't be allowlisted by key — the email/phone
//      regex scrub stays as defense-in-depth for those two fields, now with
//      a length cap so a runaway raw-text dump (e.g. an agent embedding a
//      third party's full response in an error message) can't balloon the
//      third-party payload even after scrubbing.
//   3. Multi-tenant scoping: a single shared SENTRY_DSN across every org
//      means anyone with Sentry project access can see every tenant's
//      errors. We don't have per-tenant DSNs yet, so at minimum tag the
//      forwarded event with org_id (from context.orgId, itself an id, not
//      PII) so incidents can be filtered/scoped per tenant in Sentry.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Phone-ish: 7+ digits, optionally grouped with spaces/dashes/dots/parens, optional leading +.
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g;

// Cap on any single freeform string forwarded to Sentry (message/stack, or a
// string value inside an allowlisted context field). Defense-in-depth: even
// after scrubbing, we don't want an unbounded blob of third-party text
// (e.g. a raw model response accidentally embedded in an error message)
// leaving the process.
const MAX_FORWARDED_STRING_LEN = 2000;

function scrubString(s: string): string {
  const capped =
    s.length > MAX_FORWARDED_STRING_LEN ? `${s.slice(0, MAX_FORWARDED_STRING_LEN)}…[truncated]` : s;
  return capped.replace(EMAIL_RE, "[redacted-email]").replace(PHONE_RE, "[redacted-phone]");
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

// Vetted, non-PII operational-metadata keys — the ONLY `context` keys ever
// forwarded to the third-party Sentry sink. This is intentionally an
// allowlist rather than a denylist: an unrecognized key is dropped, not
// scrubbed-and-kept, so a future call site can't regress this by accident.
// Extend only with fields you've confirmed are ids/enums, never free text
// that could carry a supplier or user's PII.
const ALLOWED_CONTEXT_KEYS = new Set([
  "source", // which call site raised this, e.g. "sourcing-events.POST"
  "orgId", // tenant id — also used to tag the event for per-tenant scoping
  "userId", // acting user id (not an email/name)
  "origin", // "client" | "server" marker set by the beacon route
  "digest", // Next.js error-boundary digest, an opaque hash
  "eventId", // sourcing-event id
  "supplierId", // supplier id
  "waveId", // outreach wave id
]);

/** Drop every `context` key that isn't on the vetted allowlist above. */
function allowlistContext(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Iterate the (small) context object's own keys rather than the Set: this
  // repo's tsconfig has no explicit `target`, which defaults to ES3, and
  // `for...of` over a `Set` requires --downlevelIteration or an ES2015+
  // target. `Object.keys(...)` returns a plain array, which iterates fine.
  for (const key of Object.keys(context)) {
    if (ALLOWED_CONTEXT_KEYS.has(key)) out[key] = context[key];
  }
  return out;
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
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=sourcegpt/1.0`,
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
    // Structured line → picked up by the host's log pipeline. Full fidelity,
    // unscrubbed: this is an in-house, access-controlled log, not a
    // third-party egress.
    console.error(`[obs] ${JSON.stringify(record)}`);
    // Everything below this line is the payload actually leaving the
    // process for Sentry — allowlist first (structural), then scrub/cap the
    // two fields that can't be allowlisted by key (message/stack, which are
    // inherently freeform) as defense-in-depth.
    const scrubbedMessage = scrubString(record.message);
    const safeContext = scrubPii(allowlistContext(record.context));
    const orgId = record.context.orgId;
    void forwardToSentry({
      message: scrubbedMessage,
      level: record.level,
      platform: "javascript",
      exception: { values: [{ type: record.name ?? "Error", value: scrubbedMessage, stacktrace: record.stack ? { frames: [] } : undefined }] },
      extra: safeContext,
      // Per-tenant scoping for the shared SENTRY_DSN: we don't have
      // per-tenant DSNs, so at minimum tag the event with org_id so it can
      // be filtered/scoped to one tenant in Sentry.
      tags: orgId != null ? { org_id: String(orgId) } : undefined,
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
