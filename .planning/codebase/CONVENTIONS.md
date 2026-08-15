# Coding Conventions

**Analysis Date:** 2026-08-15

## Naming Patterns

**Files:**
- Kebab-case for file names: `lib/process-supplier.ts`, `lib/outreach-claim.ts`, `components/ConfirmDialog.tsx`
- React/Next.js files use PascalCase for component exports: `RfiForm.tsx`, `AppShell.tsx`, `LanguageProvider.tsx`
- Utilities and modules use camelCase or kebab-case: `lib/search.ts`, `lib/billing.ts`
- API route files follow Next.js convention: `app/api/[feature]/route.ts` (e.g., `app/api/qualify/route.ts`, `app/api/outreach/route.ts`)

**Functions:**
- camelCase for all functions and async functions: `getStripe()`, `isBillingConfigured()`, `requireActiveSubscription()`, `likeEscape()`, `buildChecklistState()`
- Getter functions use `get` prefix: `getDb()`, `getStripe()`, `getOrgContext()`
- Factory/maker functions use `make` prefix: `makeProcessSupplier()`
- Predicate functions use `is`/`check`/`require` prefix: `isBillingConfigured()`, `isExplicitlyCompletable()`, `requireActiveSubscription()`, `checkOutreachAllowed()`
- Utility converters/transformers use descriptive names: `likeEscape()`, `likeContains()`, `toPg()`, `priceIdFor()`

**Variables:**
- camelCase for local variables and parameters: `connectionString`, `lastInsertRowid`, `organizationId`
- UPPER_SNAKE_CASE for module-level constants: `UNLIMITED`, `ACTIVE_STATUSES`, `SPEND_GATED_STATUSES`, `ENV_KEYS`, `FUNNEL_STAGES`, `CHECKLIST_TASKS`
- Private fields in classes use underscore prefix: `private text: string` (no double underscore; TypeScript's private visibility used instead)
- Destructured variables match source: `{ ok, reason }` from result objects, `{ id, name, ...overrides }` from params

**Types:**
- PascalCase for all type/interface names: `Organization`, `Tier`, `GateResult`, `ChecklistState`, `ConfirmDialogProps`, `ProcessSupplierDeps`
- Type exports use explicit `export type` keyword: `export type TierKey = "free" | "basic" | ...`
- Union types are inline when simple: `"active" | "trialing" | "past_due"`
- Complex object types use interfaces or named types: `type Db = ReturnType<typeof getDb>`

## Code Style

**Formatting:**
- No Prettier config in repo; style is enforced via ESLint
- 2-space indentation (Next.js/React convention)
- Semicolons required at end of statements (TypeScript strict mode)
- Lines break after `{` in function bodies, not before

**Linting:**
- ESLint configuration: `.eslintrc.json`
- Extends `next/core-web-vitals` config
- Plugins: `@typescript-eslint`
- Rule: `@typescript-eslint/no-explicit-any` set to `warn` (discouraged but not blocked)
- Run with: `npm run lint`

**TypeScript:**
- Strict mode enabled in `tsconfig.json`
- Path alias `@/*` maps to project root (allows `import { x } from "@/lib/..."` instead of relative paths)
- No `allowJs` in strict paths; all source is `.ts`/`.tsx`
- Module resolution: `bundler` (Next.js 14+ config)

## Import Organization

**Order:**
1. External library imports from node stdlib or npm packages (builtin first, then third-party): `import Stripe from "stripe"`, `import { neon } from "@neondatabase/serverless"`, `import { NextRequest, NextResponse } from "next/server"`
2. Same-module type imports: `import type { Organization } from "@/lib/db"`, `import type { Db } from "@/lib/..."` (use `import type` for types only)
3. Local module imports: `import { getDb } from "@/lib/db"`, `import { useT } from "@/components/LanguageProvider"`
4. (Optional) Re-export collections as barrel files

**Path Aliases:**
- `@/*` maps to project root `/`
- Used consistently throughout: `@/lib/...`, `@/app/...`, `@/components/...`, `@/hooks/...`
- Prefer aliases over relative paths even for nearby modules

**Import example from codebase** (`app/api/qualify/route.ts`):
```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runOutreachAgent, runFollowUpAgent, resolveSupplierContact } from "@/lib/agents";
import { sendEmail, isMailLive, replyToAddress } from "@/lib/mail";
import { randomBytes } from "crypto";
import { recordUsage, effectiveTier, checkOutreachAllowed } from "@/lib/usage";
import { getOrgContext, orgOwnsEvent } from "@/lib/tenant";
import { requireSpendableSubscription } from "@/lib/billing";
import type { Organization } from "@/lib/db";
```

## Error Handling

**Patterns:**
- Explicit result objects for optional/fallible operations: `{ ok: true } | { ok: false; reason: string }` (see `lib/billing.ts` `GateResult`)
- Check `.ok` flag before accessing reason/payload: `if (!gate.ok) return ... gate.reason`
- Async functions that fail throw native `Error`: used in routes and at service boundaries
- Database operations wrapped to normalize SQLite → Postgres: `db.prepare(sql).get/all/run(...params)` returns typed rows or `{ changes, lastInsertRowid }`
- Next.js routes return `NextResponse.json({ error: "message" }, { status: 4xx })` for errors
- No generic `try-catch` swallowing; errors bubble up or are explicitly logged
- Null/undefined checks use truthiness where safe (`if (!org.trial_ends_at)`) or explicit comparisons (`=== null`)

**Example from codebase** (`lib/billing.ts`):
```typescript
export type GateResult = { ok: true } | { ok: false; reason: string };

export function requireActiveSubscription(org: Organization): GateResult {
  if (!isBillingConfigured()) return { ok: true }; // dev/not-yet-monetized
  if (ACTIVE_STATUSES.has(org.subscription_status)) return { ok: true };
  if (org.trial_ends_at && new Date(org.trial_ends_at).getTime() > Date.now()) {
    return { ok: true };
  }
  return { ok: false, reason: "Your trial has ended" };
}
```

## Logging

**Framework:** `console` (no structured logging library)

**Patterns:**
- Used sparingly; primarily for observability in background tasks
- `console.log()` for info/debug: seen in agent runs, webhook handlers
- `console.error()` for actual errors: thrown errors and unhandled promise rejections
- No explicit logging in routes; errors are returned as JSON responses with descriptive messages
- Background tasks (enrichment, contact scrape, website checks) emit events via `send()` callback instead of logging

## Comments

**When to Comment:**
- Complex business logic: subscription statuses, pricing tiers, funnel stages (see `lib/billing.ts`, `lib/plans.ts`)
- Workarounds and rationale: "Postgres HTTP driver doesn't support multi-statement SQL — see #40" (`lib/db.ts`)
- Safety nets and guards: "Hard per-event ceiling — this is a runaway-cost safety net, not a monetization gate" (`lib/plans.ts`)
- Non-obvious parsing: comment above regex patterns or SQL parsing (see `lib/db.ts` split-statements)
- Do NOT comment obvious code: `const total = a + b;` needs no comment

**JSDoc/TSDoc:**
- Used for exported functions and type definitions
- One-line summary followed by optional explanation and examples
- Examples from codebase:

```typescript
/**
 * Escapes LIKE/ILIKE wildcard characters in user input so a literal "%" or "_"
 * typed by the user isn't treated as a pattern wildcard.
 */
export function likeEscape(s: string): string { ... }

/**
 * Whether an org may perform paid actions (create events, run agents).
 * Access is granted when:
 *   • billing is not configured yet (local/dev), OR
 *   • the Stripe subscription is active/trialing/past_due, OR
 *   • the org is still inside its free-trial window.
 */
export function requireActiveSubscription(org: Organization): GateResult { ... }
```

## Function Design

**Size:** 
- Functions kept focused and reasonably sized (most <50 lines)
- Large route handlers delegated to helper functions in `lib/` (see `app/api/qualify/route.ts` extracting checks into `billing.ts`, `usage.ts`, `tenant.ts`)

**Parameters:**
- Destructured from objects where >2 params: `{ ok, reason }`, `{ action, supplier_id, event_id }`
- Single objects for dependency injection (see `ProcessSupplierDeps` with 10+ params)
- Type signature always explicit (no implicit `any`): `async function claimOutreachSend(db: Db, id: number): Promise<Result>`

**Return Values:**
- Explicit return types on all exported functions
- Results use discriminated unions when multiple outcomes: `{ ok: true } | { ok: false; reason: string }`
- Async functions always return a `Promise<T>`
- Single values returned directly: `export function getTier(key: string): Tier | undefined`

## Module Design

**Exports:**
- Named exports preferred: `export function requireActiveSubscription(...)`
- Default exports used only for React components: `export default function ConfirmDialog(...)`
- Type exports separated: `export type GateResult = ...` on its own line
- Barrel files used at directory boundaries (e.g., `components/index.ts` may re-export common component types)

**Barrel Files:**
- Used in `lib/` for groups of related utilities: tests import from `@/lib/search` not `@/lib/search/utils`
- Not used for large modules; each feature gets its own file

## Section Dividers

Module organization uses visual separators for major sections:

```typescript
// ─── BILLING (Stripe) ─────────────────────────────────────────────────────────
// Description of what this section handles
```

This pattern appears in:
- `lib/billing.ts` — subscription gates and billing logic
- `lib/db.ts` — Postgres wrapper and SQL normalization
- `lib/search.ts` — LIKE/ILIKE escape helpers
- `lib/plans.ts` — pricing tiers and limits
- `lib/onboarding.ts` — checklist tracking
- `components/ConfirmDialog.tsx` — modal component logic

Use consistent formatting with em-dashes (`─`) and a short descriptive title.

---

*Convention analysis: 2026-08-15*
