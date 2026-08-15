# SourceGPT — Design System (Source of Truth)

> When building a page, first check `design-system/pages/[page-name].md`.
> If it exists, its rules override this file. Otherwise follow the rules below.
> Generated with the `ui-ux-pro-max` skill, then reconciled for procurement/enterprise.

**Project:** SourceGPT — AI-powered B2B supplier discovery / procurement funnel
**Category:** Analytics Dashboard + B2B SaaS marketing site
**Design Dials:** Variance 4/10 (Balanced) · Motion 4/10 (Standard) · Density 8/10 (Dense)

---

## Strategy: one brand, two densities

Same tokens, fonts, and components across both surfaces. Only spacing + motion change.

| | Dashboard app | Marketing landing |
|---|---|---|
| Style | Data-Dense Dashboard | Social-Proof / Trust & Authority |
| Density | Tight (8/32px) | Spacious (24/96px) |
| Motion | Restrained (150–300ms) | Standard (scroll reveal, stat count-up) |
| Goal | Maximum scannable data | Credibility → Book demo / Start trial |

---

## Color — "Trust Blue + Signal Amber"

Blue = enterprise trust. Amber = the **single** primary CTA per screen; never competes with status colors.

| Role | Hex | Token |
|------|-----|-------|
| Primary | `#2563eb` | `--color-primary` / `brand-600` |
| Primary strong | `#1E40AF` | `--color-primary-strong` / `brand-800` |
| Secondary | `#3B82F6` | `--color-secondary` / `brand-500` |
| Accent / CTA | `#D97706` | `--color-accent` / `accent` |
| Background | `#F8FAFC` | `--color-background` |
| Surface | `#FFFFFF` | `--color-surface` |
| Foreground | `#0F172A` | `--color-foreground` (slate-900, NOT blue) |
| Muted text | `#64748B` | `--color-muted-fg` |
| Border | `#E2E8F0` | `--color-border` |

### Funnel status (always pair color with a text label — never color-only)

| Stage | Hex | Badge class |
|-------|-----|-------------|
| Long list | `#64748B` slate | `.badge-stage-long` |
| Contacted | `#3B82F6` blue | `.badge-stage-contacted` |
| Responded | `#059669` green | `.badge-stage-responded` |
| Declined | `#DC2626` red | `.badge-stage-declined` |
| Shortlisted | `#D97706` amber | `.badge-stage-shortlisted` |

Dark mode: desaturate (primary → `#60A5FA`, canvas → slate-950). Do not invert.

---

## Typography — dual track

- **UI + Marketing:** Plus Jakarta Sans (`--font-sans`), weights 400/500/600/700/800.
- **Data / numbers:** JetBrains Mono (`--font-mono`) or `font-variant-numeric: tabular-nums`
  for tables, AI scores, spend, token costs. Applied globally to `table`, `.score-ring`, `.stat-card`.
- Type scale: `12 · 14 · 16 · 18 · 24 · 32 · 48`. Body 16px min, line-height 1.5.
- Accessibility fallback: Lexend.

---

## Layout

**Dashboard (`/events/[id]`, `/dashboard`)**
- Persistent left sidebar nav ≥1024px (collapses to top bar on mobile).
- KPI cards → funnel visualization → dense supplier table (sticky header, hover highlight,
  sortable with `aria-sort`, inline filters, virtualize past ~50 rows).
- 8px spacing rhythm; `max-w-7xl`. Detail = right-side drawer, animate from trigger, 40–60% scrim.

**Landing**
- Hero (headline + product preview) → Proof (logos, stats, security/GDPR badges) →
  How it works (Describe → AI scouts → Shortlist) → Pricing → CTA (repeated in nav).
- Spacious; one primary CTA per section; stat count-up + logo fade-in on scroll.

---

## Motion
UI ≤300ms, page ≤400ms, `transform`/`opacity` only, respect `prefers-reduced-motion`.
Use shimmer **skeletons** (not spinners) while SSE streams populate suppliers.

## Avoid
Ornate decoration · dark-mode-by-default on landing · AI purple/pink palette ·
emoji as structural icons (use Lucide) · tables without filtering · color-only status.

## Pre-delivery checklist
- [ ] SVG icons only (Lucide) · [ ] cursor-pointer on clickables · [ ] hover 150–300ms
- [ ] Text contrast ≥4.5:1 · [ ] visible focus rings · [ ] prefers-reduced-motion
- [ ] Responsive 375/768/1024/1440 · [ ] tabular figures on all data columns
