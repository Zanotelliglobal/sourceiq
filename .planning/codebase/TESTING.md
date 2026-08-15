# Testing Patterns

**Analysis Date:** 2026-08-15

## Test Framework

**Runner:**
- Vitest 2.1.9
- Config: `vitest.config.ts`
- Environment: Node.js (not jsdom or browser)
- Purpose: Unit testing pure application logic (billing tiers, supplier processing, usage metering)

**Assertion Library:**
- Vitest's built-in `expect()` (compatible with Jest syntax)
- Imported directly: `import { describe, it, expect, beforeEach, afterEach } from "vitest"`

**Run Commands:**
```bash
npm run test              # Run all tests once
npm run test:watch       # Run tests in watch mode
npm run typecheck        # Verify TypeScript compilation
```

## Test File Organization

**Location:**
- Co-located in `tests/` directory at repo root
- Path: `/tests/**/*.test.ts`
- One test file per feature/module

**Naming:**
- kebab-case matching the module being tested: `billing.test.ts`, `process-supplier.test.ts`, `outreach-claim.test.ts`, `search.test.ts`, `plans.test.ts`, `onboarding.test.ts`
- All test files use `.test.ts` extension (no `.spec.ts`)

**Structure:**
```
tests/
├── billing.test.ts              # lib/billing gates and subscription logic
├── process-supplier.test.ts     # lib/process-supplier pipeline
├── outreach-claim.test.ts       # lib/outreach-claim concurrency
├── search.test.ts               # lib/search LIKE helpers
├── plans.test.ts                # lib/plans pricing/tier logic
├── onboarding.test.ts           # lib/onboarding checklist state
├── roles.test.ts                # lib/roles access control
├── spend-ceiling.test.ts        # lib/usage spend gating
├── supplier-filters.test.ts     # lib/supplier-filters
├── event-list.test.ts           # lib/event-list
├── referrals.test.ts            # lib/referral reward logic
├── agent-runs-reaper.test.ts    # lib/agent-runs-reaper cleanup
├── prompt-injection-defense.test.ts
└── [15+ more test files]
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { functionUnderTest } from "@/lib/module";

describe("functionUnderTest", () => {
  it("does something when condition X is true", () => {
    expect(functionUnderTest(input)).toBe(expected);
  });

  it("handles edge case: empty input", () => {
    expect(functionUnderTest("")).toBe(fallback);
  });
});
```

**Patterns:**
- One `describe()` block per exported function or logical unit
- Multiple `it()` blocks for behavior variants and edge cases
- Descriptive test names starting with verb: "does X", "returns Y", "blocks Z", "tolerates", "handles", "raises", "never overwrites"
- Assertion messages are in the test name, not in comments

**Setup/Teardown:**
- `beforeEach()` runs before each test: environment setup, fixture initialization
- `afterEach()` runs after each test: cleanup, teardown
- Used for state that must reset between tests (example: `lib/billing.test.ts` saves/restores env vars per test)

**Example from `tests/billing.test.ts`:**
```typescript
const ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_ID"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});
```

## Mocking

**Framework:** None (intentional design decision)

**Approach:**
- No mocking library used (no Vitest mock/spy API in tests)
- Hand-written stubs and fakes instead: see comments in tests

**Comment from tests:**
```typescript
// No mocking framework in this repo (see tests/usage.test.ts, tests/process-supplier.test.ts)
// — build a minimal typed stubs directly instead.
```

**Reason:** Hand-written fakes are:
1. More explicit and readable
2. Force real understanding of the contract being tested
3. Avoid mocking pitfalls (mocked code can behave differently than real code)
4. Easier to test in Node.js environment without DOM/browser APIs

**What to Mock:**
- Database operations: hand-write `fakeDb()` that understands SQL shapes
- External APIs: implement minimal stubs (e.g., `fakeQualifier`, `fakeEnricher`, `fakeCheckWebsiteLive`)
- Async dependencies: wrap in Promises that resolve/reject as needed

**What NOT to Mock:**
- Pure logic functions (testing them directly is the point)
- Core library functions (test with real implementations)
- Built-in operations (Date, JSON, regex)

**Example fake from `tests/process-supplier.test.ts`:**
```typescript
function fakeDb() {
  const rows: Record<string, unknown>[] = [];
  let nextId = 1;

  const db = {
    rows,
    prepare(sql: string) {
      return {
        async run(...params: unknown[]) {
          if (/^\s*insert/i.test(sql)) {
            const cols = insertColumns(sql);
            const row: Record<string, unknown> = { id: nextId++ };
            cols.forEach((c, i) => { row[c] = params[i]; });
            rows.push(row);
            return { changes: 1, lastInsertRowid: row.id as number };
          }
          // ... more SQL pattern handlers
          return { changes: 0, lastInsertRowid: undefined };
        },
        async get(...params: unknown[]) {
          if (/^\s*select/i.test(sql)) {
            const row = rows.find(r => r.id === params[0]);
            return row ? { ...row } : undefined;
          }
          return undefined;
        },
        async all() { return rows; },
      };
    },
  };
  return db as unknown as Db;
}
```

**Example fake from `tests/outreach-claim.test.ts`:**
```typescript
function fakeDb(initial: Row[]) {
  const rows: Row[] = initial.map((r) => ({ ...r }));
  const find = (id: number) => rows.find((r) => r.id === id);
  
  return {
    prepare(sql: string) {
      return {
        async run(...params: unknown[]) {
          if (/UPDATE suppliers SET outreach_status='sending'/.test(sql)) {
            const [id, staleMinutes] = params as [number, number];
            const row = find(id);
            if (!row) return { changes: 0, lastInsertRowid: undefined };
            const claimable = !["sending", "sent"].includes(row.outreach_status)
              || isStale(row.outreach_claimed_at, staleMinutes);
            if (!claimable) return { changes: 0, lastInsertRowid: undefined };
            row.outreach_status = "sending";
            row.outreach_claimed_at = new Date();
            return { changes: 1, lastInsertRowid: undefined };
          }
          // ... more SQL pattern handlers
        },
      };
    },
  } as unknown as Db;
}
```

## Fixtures and Factories

**Test Data:**
- Helper functions return minimal valid objects with override support

**Example from `tests/billing.test.ts`:**
```typescript
function org(overrides: Partial<Organization>): Organization {
  return {
    id: 1,
    clerk_org_id: "org_test",
    name: "Test Org",
    plan: "pro",
    subscription_status: "active",
    stripe_customer_id: null,
    stripe_subscription_id: null,
    trial_ends_at: null,
    referral_code: null,
    referred_by: null,
    bonus_events: 0,
    checklist_progress: "{}",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}
```

**Example from `tests/process-supplier.test.ts`:**
```typescript
function scoutSupplier(overrides: Partial<ScoutSupplier> = {}): ScoutSupplier {
  return {
    name: "Acme Manufacturing",
    country: "Italy",
    city: "Milan",
    description: "A contract manufacturer.",
    capabilities: ["CNC machining"],
    certifications: ["ISO 9001:2015"],
    employees: "200-500",
    annual_revenue: "$20M-$50M",
    founded: "1992",
    website: "https://acme.example",
    contact_email: "",
    data_sources: ["https://acme.example/about"],
    business_type: "Manufacturer",
    employee_count: "201-500",
    founded_year: 1992,
    review_score: 4.5,
    capability_tags: [],
    partnered_customers: [],
    key_export_markets: [],
    ...overrides,
  };
}

function baseDeps(overrides: Partial<ProcessSupplierDeps> = {}): {
  deps: ProcessSupplierDeps;
  events: Record<string, unknown>[];
} {
  const events: Record<string, unknown>[] = [];
  const deps: ProcessSupplierDeps = {
    db: fakeDb(),
    eventId: 1,
    waveNumber: 1,
    categoryLabel: "Industrial Components",
    // ... more defaults
    ...overrides,
  };
  return { deps, events };
}
```

**Location:**
- Fixtures defined at the top of each test file, below imports
- Factories named with descriptive prefix: `org()`, `scoutSupplier()`, `fakeDb()`, `baseDeps()`
- Separated from test blocks by a comment: `// ─── Fixtures ───`

## Coverage

**Requirements:** None enforced

**View Coverage:**
```bash
# Not configured in this repo — would require coverage reporter in vitest.config.ts
```

**Current state:** No coverage threshold configured; tests focus on pure logic with high coverage in practice.

## Test Types

**Unit Tests:**
- Scope: Pure functions (business logic, data transformation, validation)
- Approach: Direct function calls with controlled inputs, assertions on outputs
- Examples: `billing.test.ts`, `search.test.ts`, `plans.test.ts`
- Environment: Node.js (no DOM/browser required)

**Integration Tests:**
- Scope: Functions that coordinate multiple modules (e.g., supplier processing pipeline)
- Approach: Use hand-written fakes for dependencies (DB, AI agents, external services)
- Examples: `process-supplier.test.ts` (tests the full pipeline with controlled side effects)
- Environment: Node.js with in-memory fakes

**E2E Tests:**
- Not used in this codebase
- API routes tested via direct imports and unit testing their dependencies, not HTTP calls

## Common Patterns

**Async Testing:**
```typescript
// Test awaits Promise resolution
it("inserts the supplier and sends supplier_found BEFORE enrichment", async () => {
  let releaseScrape!: () => void;
  const gate = new Promise<void>(resolve => { releaseScrape = resolve; });
  
  const deferredScrape = async (): Promise<ContactChannels> => {
    await gate;
    return { contact_email: "info@acme.example", ... };
  };

  const { deps, events } = baseDeps({ scrapeSupplierContact: deferredScrape });
  const process = makeProcessSupplier(deps, AGENT);

  await process(scoutSupplier());
  
  // Assertions on state before the gate releases
  expect(events.find(e => e.type === "supplier_found").supplier.enrichment).toBeNull();
  expect(deps.backgroundTasks.length).toBe(3);

  releaseScrape();
  await Promise.allSettled(deps.backgroundTasks);

  // Assertions after gate releases
  const contactUpdate = events.find(e => e.type === "supplier_updated" && "contact_email" in e);
  expect(contactUpdate).toMatchObject({ contact_email: "info@acme.example" });
});
```

**Error Testing:**
```typescript
// Test error handling without throwing
it("falls back to a neutral placeholder when enrichment fails, without crashing", async () => {
  const failingEnricher = async () => { throw new Error("llm down"); };
  const { deps, events } = baseDeps({ runEnricherAgent: failingEnricher });
  const process = makeProcessSupplier(deps, AGENT);

  await expect(process(scoutSupplier())).resolves.toBeUndefined();
  const settled = await Promise.allSettled(deps.backgroundTasks);
  expect(settled.every(r => r.status === "fulfilled")).toBe(true);

  const enrichUpdate = events.find(e => e.type === "supplier_updated" && "enrichment" in e);
  expect(JSON.parse(enrichUpdate.enrichment)).toMatchObject({
    market_position: "Unknown",
    key_risks: [],
    key_strengths: [],
    recommended_action: "monitor",
  });
});
```

**Parameterized Tests (via loop):**
```typescript
// Test multiple related cases
it("passes for active/trialing/past_due once billing is configured", () => {
  billingConfigured();
  for (const status of ["active", "trialing", "past_due"]) {
    expect(requireActiveSubscription(org({ subscription_status: status })).ok).toBe(true);
  }
});

// Test all tiers
it("paid tiers allow export", () => {
  for (const key of ["basic", "growth", "premium", "pro"] as const) {
    expect(getTier(key)!.limits.export).toBe(true);
  }
});
```

**Environment/Process Manipulation:**
```typescript
// Test behavior across different env configurations
it("always passes when billing isn't configured (dev/local)", () => {
  billingNotConfigured();
  const result = requireActiveSubscription(org({ subscription_status: "canceled" }));
  expect(result.ok).toBe(true);
});

// Helper to set/unset env vars
function billingConfigured() {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  process.env.STRIPE_PRICE_ID = "price_fake";
}

function billingNotConfigured() {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_ID;
}
```

## Test Examples by Module

**`tests/search.test.ts`** (simple pure logic):
- 8 tests total
- Test escape behavior for LIKE wildcards
- Test contains wrapping

**`tests/billing.test.ts`** (state machine logic):
- 12+ tests total
- Test subscription gates with env var control
- Test trial window logic
- Test spend ceiling gates

**`tests/process-supplier.test.ts`** (integration with fakes):
- 10+ tests total
- Test the full supplier processing pipeline
- Test background task execution order
- Test error handling in enrichment/scrape/verification
- Test event emission and database updates

**`tests/plans.test.ts`** (constant/configuration testing):
- 11+ tests total
- Test tier resolution
- Test tier limits invariants (monotonic pricing, feature unlocks)
- Test env var name generation
- Test price resolution

---

*Testing analysis: 2026-08-15*
