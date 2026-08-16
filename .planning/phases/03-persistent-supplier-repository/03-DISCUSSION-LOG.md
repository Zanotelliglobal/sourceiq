# Phase 3: Persistent Supplier Repository - Discussion Log

**Date:** 2026-08-15
**Mode:** default (interactive)

This log is for human reference only (audits, retrospectives). It is NOT consumed by
downstream agents — see `03-CONTEXT.md` for the canonical decisions.

## Areas Discussed

### 1. Schema split for shared vs org-private fields (REPO-04)
- **Options presented:** Two tables: identity + org-private (recommended) / Single
  table with org_id + WHERE discipline.
- **User selection:** Two tables: identity + org-private (recommended).
- **Outcome:** D-01.

### 2. Repository write path (REPO-02)
- **Options presented:** Extend makeProcessSupplier/makeProcessSupplierQuick
  (recommended) / New standalone service function called explicitly by each route.
- **User selection:** Extend makeProcessSupplier/makeProcessSupplierQuick (recommended).
- **Outcome:** D-02.

### 3. Dedup reuse (REPO-03)
- **Options presented:** Reuse lib/dedup.ts directly (recommended) / Claude's
  discretion.
- **User selection:** Reuse lib/dedup.ts directly (recommended).
- **Outcome:** D-03.

### 4. Pre-search repository check timing (REPO-05)
- **Options presented:** Orchestrator planning step before scout dispatch (recommended)
  / Claude's discretion.
- **User selection:** Orchestrator planning step before scout dispatch (recommended).
- **Outcome:** D-04 (matching heuristic itself flagged as Claude's discretion / research
  item).

### 5. Repository scope confirmation (REPO-06)
- **Options presented:** Yes, per-org only (recommended) / Reconsider — want cross-org
  sharing now.
- **User selection:** Yes, per-org only (recommended).
- **Outcome:** D-05 — no scope expansion; matches existing REPO-06/PROJECT.md/
  REQUIREMENTS.md v2 deferral.

## Deferred Ideas
None raised this session.

## Claude's Discretion Items
- Exact repository-check matching heuristic (category/geography) for REPO-05.
- Exact column list/naming for the two new tables beyond fields explicitly named in
  REPO-01/REPO-04.
- Whether makeProcessSupplierDeepen() needs its own repository upsert call.

---
*Phase: 3-Persistent Supplier Repository*
*Discussion logged: 2026-08-15*
