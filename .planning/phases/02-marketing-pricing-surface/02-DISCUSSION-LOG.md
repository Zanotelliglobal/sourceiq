# Phase 2: Marketing & Pricing Surface - Discussion Log

**Date:** 2026-08-15
**Mode:** default (interactive)

This log is for human reference only (audits, retrospectives). It is NOT consumed by
downstream agents — see `02-CONTEXT.md` for the canonical decisions.

## Areas Discussed

### 1. Grandfathering (PRICE-05)
- **Options presented:** Legacy-tier mapping (recommended) / One-time migration /
  Hybrid freeze-old-tiers.
- **User selection:** Neither — user clarified there are no real paying customers yet,
  making the whole question moot.
- **Outcome:** D-01 — no migration/mapping logic needed; just a defensive check that no
  org row is left pointing at a deleted tier key.

### 2. New tier names/positioning
- **Options presented:** Reuse Basic/Growth/Premium names (recommended) / All-new names
  / Claude's discretion.
- **User selection:** Reuse Basic/Growth/Premium names (recommended).
- **Outcome:** D-02, D-03 — 3 paid tiers keep existing names, re-priced in USD;
  `pro` retired/folded into Enterprise.

### 3. Feature-grid discretion boundary (MKT-04)
- **Options presented:** Add the section per backlog spec (recommended) / Same tiles
  but review copy before it ships.
- **User selection:** Add the section per backlog spec (recommended).
- **Outcome:** D-06 — Claude drafts the reworded copy for Workflow Automation,
  Collaboration Hub, Budget & Spend Intelligence without a separate review checkpoint.

### 4. CCPA page content (MKT-03)
- **Options presented:** Draft a standard CCPA policy (recommended) / Mirror Privacy
  Policy structure closely.
- **User selection:** Draft a standard CCPA policy (recommended).
- **Outcome:** D-07.

### 5. Hero demo slot (MKT-05)
- **Options presented:** Static screenshot placeholder (recommended) / Empty video
  embed placeholder.
- **User selection:** Static screenshot placeholder (recommended).
- **Outcome:** D-08.

### 6. Free trial mechanics (PRICE-03)
- **Options presented:** Stripe trial period on Basic checkout (recommended) / Keep
  current cardless-trial pattern, just remove the separate Free tier card.
- **User selection:** Stripe trial period on Basic checkout (recommended).
- **Outcome:** D-05.

## Deferred Ideas
None raised this session.

## Claude's Discretion Items
- Exact USD price points and per-tier limits.
- Exact reworded feature-grid copy for 3 of the 5 tiles.
- Visual layout/styling for new sections.
- Stripe Checkout card-requirement configuration for the trial.
- Stripe Price object naming for the new tier × cadence matrix.

---
*Phase: 2-Marketing & Pricing Surface*
*Discussion logged: 2026-08-15*
