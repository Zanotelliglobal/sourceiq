# Architecture Research

**Domain:** Brownfield extension — multi-tenant AI supplier-sourcing SaaS (Next.js/TypeScript/Neon/Clerk/Stripe/Anthropic SDK)
**Scope:** Backlog items #7 (RFP Matching intake), #9 (supplier star rating), #10 (persistent cross-investigation supplier repository)
**Researched:** 2026-08-15
**Confidence:** HIGH (grounded directly in `.planning/codebase/ARCHITECTURE.md` and primary source: `lib/process-supplier.ts`, `lib/dedup.ts`, `lib/db.ts`, `app/api/classify/route.ts`, `lib/plans.ts`, `app/api/qualify/route.ts`) — one external fact (Vercel function duration limits) verified via web search, cited below.

## Executive Take

\#10 is the foundational item. It introduces the one genuinely new architectural layer this milestone needs (a durable, cross-event supplier identity store) and must land before #9, because #9's own backlog text says ratings should attach to the repository entry, not a per-event column. #7 is architecturally the simplest of the three despite being "large effort" — it is a new *intake* path (upload → parse → pre-fill), not a new execution engine, and should not be squeezed into the existing `/api/classify` route's 60s budget. Build order: **#10 → #9 → #7**, with a note that #7 benefits from #10 already existing (RFP-sourced suppliers should flow through the same repository write path from day one).

One existing fact changes the shape of #9: `suppliers.feedback_signal` (SMALLINT, thumbs up/-1/0/1) **already ships** today (`app/api/qualify/route.ts`, `app/events/[id]/page.tsx`). That is a different, already-built, per-event feedback mechanism. #9's 1-5 star rating is additive, not a replacement — the two will coexist with a clear boundary (below).

## Standard Architecture (as extended by #7/#9/#10)

```
┌───────────────────────────────────────────────────────────────────────────┐
│                         Presentation Layer (app/)                          │
│  ┌────────────────┐  ┌──────────────────────┐  ┌────────────────────────┐ │
│  │ events/new/     │  │ events/[id]/          │  │ [NEW] RFP upload      │ │
│  │ page.tsx        │  │ page.tsx (star rating │  │ widget in events/new/ │ │
│  │ (pre-fill from  │  │  + existing thumbs-   │  │                       │ │
│  │  classify OR    │  │  up/down feedback)    │  │                       │ │
│  │  [NEW] rfp)     │  │                       │  │                       │ │
│  └────────┬────────┘  └──────────┬────────────┘  └───────────┬────────────┘│
├───────────┼──────────────────────┼───────────────────────────┼─────────────┤
│           │           API Routes Layer (app/api/)            │             │
│  ┌────────▼────────┐  ┌──────────▼────────┐  ┌───────────────▼──────────┐ │
│  │ /api/classify    │  │ [NEW]              │  │ [NEW]                    │ │
│  │ (existing,       │  │ /api/rfp-intake    │  │ /api/supplier-ratings    │ │
│  │  60s, unchanged) │  │ (own maxDuration)  │  │ (small, fast CRUD)        │ │
│  └──────────────────┘  └──────────┬─────────┘  └───────────┬───────────────┘│
│  ┌──────────────────┐  ┌──────────▼─────────┐               │               │
│  │ /api/orchestrate │  │ /api/investigate-  │               │               │
│  │ (existing, 300s, │  │ quick (existing,   │               │               │
│  │  unchanged)      │  │  unchanged)        │               │               │
│  └────────┬─────────┘  └──────────┬─────────┘               │               │
├───────────┼───────────────────────┼───────────────────────────┼─────────────┤
│           │        Business Logic Layer (lib/)                │             │
│  ┌────────▼───────────────────────▼─────────┐  ┌──────────────▼───────────┐│
│  │ lib/process-supplier.ts                   │  │ [NEW] lib/supplier-      ││
│  │ makeProcessSupplier / …Quick / …Deepen     │  │ ratings.ts               ││
│  │  (unchanged critical path; adds ONE       │  └──────────────┬───────────┘│
│  │  fire-and-forget call at the end)         │                 │            │
│  └────────────────┬───────────────────────────┘                 │            │
│                    │                                             │            │
│  ┌─────────────────▼─────────────────┐  ┌──────────────────────▼──────────┐│
│  │ [NEW] lib/supplier-repository.ts   │  │ lib/dedup.ts (normName/domainOf │││
│  │ upsertRepositoryEntry(),           │◄─┤  — REUSED, not reimplemented)   ││
│  │ findRepositoryMatches()            │  └──────────────────────────────────┘│
│  └─────────────────┬───────────────────┘                                     │
│  ┌─────────────────▼─────────────────┐                                      │
│  │ [NEW] lib/agents.ts:               │                                      │
│  │ runRfpExtractionAgent()            │                                      │
│  │ (Anthropic SDK document input)     │                                      │
│  └─────────────────────────────────────┘                                      │
├───────────────────────────────────────────────────────────────────────────┤
│                         Data Access Layer (lib/db.ts)                       │
│  ┌───────────┐ ┌────────────┐ ┌──────────────────┐ ┌───────────────────┐  │
│  │ suppliers │ │ sourcing_  │ │ [NEW]             │ │ [NEW]             │  │
│  │ (per-event│ │ events     │ │ supplier_         │ │ supplier_ratings  │  │
│  │  scoped,  │ │            │ │ repository        │ │ (repo-entry-      │  │
│  │  unchanged│ │            │ │ (org-scoped,      │ │  scoped)          │  │
│  │  schema)  │ │            │ │  cross-event)     │ │                   │  │
│  └───────────┘ └────────────┘ └──────────────────┘ └───────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `lib/supplier-repository.ts` (NEW) | Cross-event, org-scoped supplier identity store: find-or-create by normalized identity, upsert latest known snapshot, expose lookup for future read-path use | New service, sibling to `lib/dedup.ts`; single-statement Postgres `INSERT … ON CONFLICT … DO UPDATE … RETURNING` (no multi-statement transaction needed) |
| `lib/process-supplier.ts` (EXTENDED) | Unchanged per-event insert/stream critical path; adds one fire-and-forget background call to the repository after each supplier insert/update | Same `schedule()`/`backgroundTasks` pattern already used for enrichment/contact-scrape/website-live-badge |
| `lib/supplier-ratings.ts` (NEW) | Create/update a rater's 1-5 rating against a repository entry; compute aggregate (avg + count) | New service; small, no LLM involvement, fast CRUD |
| `app/api/supplier-ratings/route.ts` (NEW) | Authenticated, org-scoped POST (upsert own rating) + GET (aggregate for a supplier) | Mirrors existing route conventions: `getOrgContext()`, org-ownership check, no billing gate needed (cheap, no LLM cost) |
| `lib/agents.ts: runRfpExtractionAgent()` (NEW) | Extracts `{category, subcategory, title, confidence, description, requirements, target_countries, annual_spend}` from an uploaded document | New agent tier alongside `runClassifierAgent()`; uses Anthropic SDK's native PDF/document content-block support — no separate parsing library for PDF |
| `app/api/rfp-intake/route.ts` (NEW) | Accepts document upload, validates type/size, calls extraction agent, returns pre-fill payload | New route with its **own** `maxDuration`, own auth/rate-limit posture — see below |
| `app/events/new/page.tsx` (EXTENDED) | Adds a third intake path (upload) alongside free-text + classify; pre-fills the same form fields regardless of intake method | Existing component; extend, don't fork |
| `app/events/[id]/page.tsx` (EXTENDED) | Renders new star-rating widget (repository-scoped) alongside existing `feedback_signal` thumbs-up/down (event-scoped) — two distinct, coexisting signals | Existing component; new widget calls new route |

## Component Boundaries and Data Flow — Item by Item

### #10: Persistent cross-investigation supplier repository

**Boundary decision — new layer, not a change to `process-supplier.ts`'s own job.** `lib/process-supplier.ts` exists specifically to keep the SSE critical path (qualify → insert → stream) fast; the repository write is auxiliary, best-effort, cross-cutting data. It must **never** block or slow that critical path. Concretely:

- New service `lib/supplier-repository.ts` owns all repository reads/writes. `process-supplier.ts` calls exactly one new function — `upsertRepositoryEntry(orgId, supplierRow)` — scheduled through the *same* `schedule()`/`backgroundTasks` mechanism already used for enrichment/contact-scrape/website-live badge (`lib/task-pool.ts`). This is the natural hook point named in the backlog (`makeProcessSupplier`/`makeProcessSupplierQuick`/`makeProcessSupplierDeepen`), and it costs nothing new architecturally — it's a fourth background task alongside the three that already exist.
- **Data flow:** scout/qualify produces a candidate → per-event `suppliers` row INSERT (existing, unchanged, still the source of truth for the SSE stream) → `supplier_found` streamed to client (existing, unchanged) → **[NEW, background, after the insert]** `upsertRepositoryEntry()` computes `identity_key = normName(name) + '|' + domainOf(website)` (reusing `lib/dedup.ts` exactly — no new fuzzy-matching library) and issues a single-statement upsert against `supplier_repository`, keyed on `(org_id, identity_key)`.
- **Schema shape (recommended, opinionated):**
  ```sql
  CREATE TABLE supplier_repository (
    id              BIGSERIAL PRIMARY KEY,
    org_id          BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    identity_key    TEXT NOT NULL,          -- normName(name) + '|' + domainOf(website)
    name            TEXT NOT NULL,
    website         TEXT,
    country         TEXT,
    business_type   TEXT,
    employee_count  TEXT,
    review_score    DOUBLE PRECISION,
    capability_tags TEXT,                   -- latest-known snapshot, overwrite-wins
    verification_badges TEXT,
    times_seen      INTEGER NOT NULL DEFAULT 1,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, identity_key)
  );
  CREATE INDEX idx_supplier_repository_org ON supplier_repository(org_id);
  ```
  Plus a `suppliers.repository_id BIGINT REFERENCES supplier_repository(id)` FK column added to the existing per-event table, populated at the same write time — this is what lets #9's ratings (and any future cross-event UI) join from an event-scoped supplier card back to its repository identity without a second lookup.
- **Scope (per-org vs platform-wide) — recommend per-org for v1.** This is the single biggest open question in the backlog and it has architectural consequences: platform-wide sharing means supplier identity resolution can no longer assume `org_id` scoping, which breaks the codebase's own documented invariant ("every supplier has `event_id`; every event has `org_id`; queries always filter by both" — `.planning/codebase/ARCHITECTURE.md`, Architectural Constraints). Per-org keeps that invariant intact (`supplier_repository` just adds one more `org_id`-scoped table, same pattern as everything else), ships the core value ("has *this org* already found this supplier") without a cross-tenant data-governance decision, and is upgradable later — a platform-wide layer can be added afterward as a separate anonymized-identity index without a rewrite, because the per-org table's `identity_key` computation is already tenant-agnostic.
- **What gets persisted — recommend latest-snapshot only, not versioned history.** Matches the existing `suppliers` table's own "current state" philosophy (enrichment is overwritten in place via `UPDATE … WHERE id=?`, not appended). Avoids a staleness-policy design problem at v1 (no need to reason about "is this 2026 contact scrape still valid in 2028" if there's only ever one row per identity, refreshed on every re-encounter). A `last_seen_at`/`times_seen` pair is enough signal for now; a full history table can be layered on later if staleness becomes a real product problem.
- **Concurrency without multi-statement transactions:** Neon's HTTP driver constraint (documented in `.planning/codebase/ARCHITECTURE.md`) is a non-issue here specifically *because* Postgres native `INSERT … ON CONFLICT (org_id, identity_key) DO UPDATE SET last_seen_at = now(), times_seen = times_seen + 1 … RETURNING id` is one atomic statement. This is the pattern to standardize on — don't do a SELECT-then-INSERT-or-UPDATE round trip (race-prone across concurrent waves), do the upsert in one call.
- **Backfill — recommend yes, but async and idempotent, not part of the migration itself.** The value proposition is meaningfully weaker starting from zero. Run a one-time background script that iterates existing `suppliers` rows in batches, computing the same `identity_key` and upserting into `supplier_repository` — each batch's upserts are already single-statement-safe, so no new transaction-handling code is needed; just don't block deploy on it.
- **Read path (repository informing scout/qualify) — explicitly deferred out of v1.** Backlog #10 only asks for a durable write-side store; using it to skip re-discovery or seed scout candidates is a materially riskier change (touches agent prompts / the actual discovery critical path) and should be its own follow-up phase once the write path and schema have proven out in production, not bundled into the same phase as schema design.

### #9: Supplier star rating

**Depends on #10 being built first** — confirmed by the backlog's own text ("if #10 ships, ratings should attach to the shared repository entry... recommend sequencing #10 before #9"). Architecturally this dependency is concrete, not just sequencing preference: a rating needs a stable cross-event identity to attach to (`supplier_repository.id`), which only exists once #10's schema and write path (including the `suppliers.repository_id` FK) are live.

- **New table**, not a column on `supplier_repository` directly, because ratings are per-rater, not a single scalar: 
  ```sql
  CREATE TABLE supplier_ratings (
    id              BIGSERIAL PRIMARY KEY,
    repository_id   BIGINT NOT NULL REFERENCES supplier_repository(id) ON DELETE CASCADE,
    org_id          BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    rater_user_id   TEXT NOT NULL,          -- Clerk user id, mirrors created_by pattern on sourcing_events
    rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (repository_id, rater_user_id)
  );
  ```
  One rating per (repository entry, rater) — re-rating is an UPDATE via `ON CONFLICT DO UPDATE`, same single-statement-upsert pattern as #10.
- **Explicit coexistence boundary with the already-shipped `feedback_signal`:** `suppliers.feedback_signal` (thumbs up/down, `-1|0|1`) stays exactly where it is — it's a lightweight, per-event, in-the-moment UX signal already wired through `app/api/qualify/route.ts` and the supplier card. The new star rating is a **separate, cross-event quality signal** on the repository entry. Do not merge or migrate one into the other; they answer different questions ("was this specific result useful in this event" vs "how good is this supplier, cumulatively, across every org encounter"). This distinction should be made explicit in the UI (two visually distinct controls) to avoid buyer confusion.
- **Component:** `lib/supplier-ratings.ts` (upsert + aggregate query) + `app/api/supplier-ratings/route.ts` (POST upsert own rating, GET aggregate for a `repository_id`) + a new star-widget in `app/events/[id]/page.tsx`'s supplier card, next to (not replacing) the existing thumbs-up/down control.
- **Legacy-row handling:** suppliers created before #10 ships will have `repository_id IS NULL` until the backfill runs or the row is re-encountered. The ratings UI/route must handle this gracefully — either disable rating on unlinked rows until backfill completes, or lazily create a repository entry on first rating attempt (simplest: reuse `upsertRepositoryEntry()` on-demand from the ratings route if `repository_id` is null).

### #7: RFP Matching intake

**Architecturally the most independent of the three** — a pure intake/parsing addition that produces the same pre-fill payload shape the existing classify flow already produces, then hands off to the **unchanged** existing flow. It does not touch `process-supplier.ts`, `lib/dedup.ts`, the orchestrator, or (initially) the repository.

- **Data flow:** buyer uploads file in `app/events/new/page.tsx` → `POST /api/rfp-intake` (multipart) → validate file type/size → `runRfpExtractionAgent(fileBuffer)` in `lib/agents.ts` → returns `{category, subcategory, title, confidence, description, requirements, target_countries, annual_spend}` (a superset of what `/api/classify` already returns) → client pre-fills the same form state `app/events/new/page.tsx` already manages → buyer reviews/edits → buyer picks Quick or Full investigation, exactly as today → existing `POST /api/sourcing-events` create → existing `/api/orchestrate` or `/api/investigate-quick` flow, **fully unchanged**.
- **Does NOT belong in `/api/classify` or reuse its 60s budget — needs its own route and its own `maxDuration`.** Reasoning:
  1. `/api/classify` is tuned for a fundamentally different workload: a single short free-text prompt fired on a 900ms debounce, expected to feel near-instant. Document upload + parsing + extraction is a heavier, slower, one-shot operation with a completely different latency budget and UX (a spinner after an explicit "Upload" click, not a debounced as-you-type call).
  2. Following this codebase's own existing convention — every route sets its own `maxDuration` tuned to its worst case (`classify` = 60s, `orchestrate` = 300s) — the correct move is a **new route with its own budget**, not bending an existing one.
  3. Recommend `export const maxDuration = 120` (or up to 180) for `/api/rfp-intake`: enough headroom for a multi-page PDF + a document-understanding LLM call, comfortably under the platform's demonstrated ceiling — this project's own `/api/orchestrate` already runs at `maxDuration = 300`, confirming the deployed Vercel plan already supports durations well beyond Hobby's tighter limits, so a 120-180s route is not a new infrastructure ask, just a new per-route config value in the same pattern already in use.
- **Parsing approach — recommend Anthropic SDK native document input for PDF, no new parsing library.** The Anthropic SDK (`@anthropic-ai/sdk@^0.116.0`, already a dependency) supports sending PDF documents as a native content block directly to Claude — this avoids adding a PDF-text-extraction library (and its failure modes: scanned/image-only PDFs, broken text layers) as a new dependency, and keeps the extraction step architecturally identical to every other agent in `lib/agents.ts` (a single `client.messages.create()` call, same client, same tiering conventions). DOCX is **not** natively supported by Claude's document blocks — recommend scoping v1 to **PDF-only** upload (reject DOCX with a clear error, or require the buyer to export to PDF) rather than adding a DOCX-to-text conversion library (e.g. `mammoth`) as new infra for a first version; this can be revisited if DOCX turns out to be a common real-world RFP format for this customer base.
- **Auth/rate-limit posture differs from classify:** `/api/classify` is deliberately stateless/anonymous, IP-rate-limited (no org context to key off). `/api/rfp-intake` should require full authenticated org context (`getOrgContext()`, same as `/api/orchestrate`) given the materially higher cost and abuse surface of a document-parsing LLM call — gate with an org-scoped rate limit, not the anonymous IP limiter classify uses. It does not need a billing/spend-ceiling gate as strict as `/api/orchestrate`'s (`requireSpendableSubscription`) since it's a one-shot, bounded-cost call, but should still be counted in `lib/usage.ts` cost tracking for observability, consistent with "every agent call recorded" (documented cross-cutting concern).
- **File persistence — recommend transient (parse then discard) for v1.** Storing the original uploaded document would introduce a new infra dependency (blob storage — S3/Vercel Blob — none exists in this stack today) purely for an audit/reference nicety. Parse in-memory, return the extracted payload, discard the buffer. Flag "let buyers re-view the original RFP later" as a deferred enhancement requiring blob storage, not a v1 requirement.
- **Interaction with #10 (repository):** out of scope for #7's own build, but worth designing the extraction agent's output with an eye toward it — if a future iteration extracts *named candidate suppliers* directly from the RFP text (not just category/requirements), those should flow through the exact same `upsertRepositoryEntry()` path as scout-discovered suppliers, not a parallel one-off insert. Not needed for v1 (v1 only extracts category/requirements/geography, no supplier names), but worth a one-line comment in the new agent's code noting the seam for later.

## Suggested Build Order (with dependency rationale)

1. **#10 — repository schema + write-path hookup.** Foundational: new table, `lib/supplier-repository.ts`, one new call wired into `makeProcessSupplier`/`makeProcessSupplierQuick`/`makeProcessSupplierDeepen`, plus the `suppliers.repository_id` FK and the async backfill script. Nothing else in this trio can be correctly scoped without this landing first.
2. **#9 — ratings.** New `supplier_ratings` table + `lib/supplier-ratings.ts` + route + UI widget, built directly against #10's `repository_id`. Small, self-contained, fast to ship once #10 exists (this matches the backlog's own note that #9 is "self-contained" — the *only* thing gating it is the schema decision #10 resolves).
3. **#7 — RFP intake.** Largest single item, but the least architecturally coupled to the other two — genuinely could be built in parallel with #9 by a separate workstream. Sequenced last here for two reasons: (a) the backlog's own stated rationale — let the new-event intake surface settle from any other changes first — still holds; (b) building it after #10 exists means if/when a future iteration extracts candidate supplier names from RFP text, it can write through the already-proven repository path from day one instead of needing a retrofit.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Writing the repository upsert inline, on the critical path

**What people do:** Add the `supplier_repository` INSERT directly into the same `await` chain as the per-event `suppliers` INSERT inside `makeProcessSupplier`, before streaming `supplier_found`.
**Why it's wrong:** Slows down the exact latency this codebase has already optimized hard for (enrichment and contact-scrape were deliberately moved off the critical path for this reason — see the module comment at the top of `lib/process-supplier.ts`). A repository write is auxiliary data, not required for the buyer-facing result.
**Do this instead:** Schedule it through the existing `schedule()`/`backgroundTasks` mechanism, exactly like enrichment/contact-scrape/website-live-badge — fire-and-forget, awaited only before the SSE stream closes.

### Anti-Pattern 2: Reusing `/api/classify`'s 60s budget for RFP parsing

**What people do:** Add an `if (formData) { …parse document… }` branch inside the existing classify route to avoid "duplicating" a route.
**Why it's wrong:** Couples two workloads with incompatible latency profiles (900ms-debounced free text vs. one-shot document parsing) under one timeout and one rate-limit posture (anonymous IP vs. authenticated org), and risks the free-text path inheriting a timeout/behavior tuned for the heavier case.
**Do this instead:** A new route, its own `maxDuration`, its own auth/rate-limit gate — following the existing convention that every route tunes its own budget.

### Anti-Pattern 3: Building #9 as a column on the per-event `suppliers` table

**What people do:** Ship a quick `buyer_rating INT` column on `suppliers` now, "since #10 isn't built yet," planning to migrate later.
**Why it's wrong:** This is the exact trap the backlog text explicitly warns against — ratings would then need a migration (per-event column → cross-event table) the moment #10 ships, and any ratings collected in the interim would need to be reconciled against repository identities retroactively.
**Do this instead:** Sequence #10 before #9, per the build order above — a few days' delay on #9 is cheaper than a schema migration plus data-reconciliation problem shortly after.

## Sources

- `.planning/codebase/ARCHITECTURE.md` (primary — component responsibilities, data flow, architectural constraints, anti-patterns)
- `.planning/PROJECT.md` (backlog context, constraints, open questions)
- `docs/change-request-backlog.md` (items #7, #9, #10 full text and their stated dependency)
- `lib/process-supplier.ts` (read directly — critical-path/background-task pattern, insertion points)
- `lib/dedup.ts` (read directly — `normName`/`domainOf` identity logic to reuse)
- `lib/db.ts` (read directly — existing schema, `suppliers`/`sourcing_events`/`organizations` tables, Neon upsert-friendly single-statement conventions)
- `app/api/classify/route.ts`, `app/api/qualify/route.ts` (read directly — existing route conventions, `feedback_signal` already-shipped feature)
- `lib/plans.ts` (read directly — tier/limits pattern, unrelated to this trio but confirms conventions)
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) — confirms Pro-plan/fluid-compute duration ceilings (300s default extendable to 800s), supporting the recommendation that a new `/api/rfp-intake` route with `maxDuration` ~120-180s fits within the plan this codebase already uses (orchestrate already runs at 300s)
- [Vercel Functions for Hobby can now run up to 60 seconds](https://vercel.com/changelog/vercel-functions-for-hobby-can-now-run-up-to-60-seconds) — background confirming plan-tier duration differences

---
*Architecture research for: SourceIQ/SourceGPT — backlog items #7, #9, #10*
*Researched: 2026-08-15*
