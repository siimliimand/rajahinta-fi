# Design System Foundation — Design

## Context

A design analysis (2026-08-28) reviewed the frontend after the technical-assessment remediation landed. The UI is functional and consistently styled with Tailwind utilities, but everything above utility styling is missing: one renamed stock-blue token, an empty `globals.css`, no webfont, no brand assets, copy-pasted class strings, per-component status color maps that disagree with DESIGN.md, a placeholder homepage, and no designed failure or gate-closed states.

The product sets hard constraints on any visual language. It is a Finnish alcohol landed-cost calculator: legally sensitive numbers, neutrality enforced by a compliance test suite, a disclaimer stored in every API result, reliability statuses flowing from ingestion to the UI, and a Finnish-first audience reading long compound words. The design must communicate credibility, explainability, and neutrality. DESIGN.md already states the direction: "explainable financial-intelligence tool", data legibility over marketing polish. This change builds that out instead of inventing a new direction.

## Goals

- Give the UI one canonical visual vocabulary: tokens, typography, status colors, primitives.
- Make every reliability status visually consistent everywhere, with color never the sole carrier of meaning.
- Give the site a brand surface: logo, favicon, Open Graph image.
- Give the homepage a value proposition and trust signals.
- Design the states users actually hit: empty, loading, error, rate-limited, launch-gate-closed.
- Keep WCAG AA contrast, visible focus, and keyboard operability throughout.

## Non-Goals

- Dark mode (the token layer makes it a cheap follow-up, D4).
- Print stylesheet for report export.
- Layout redesign of compare, basket, or ranking views; they adopt primitives mechanically only.
- Any ranking or ordering behavior change, and no "featured" or "sponsored" visual style anywhere.
- shadcn/ui or another component framework (D5).
- New backend endpoints or homepage API calls (D6).

## Decisions

### D1: UNAVAILABLE is neutral gray

DESIGN.md says gray for UNAVAILABLE; the code uses red. Gray wins. UNAVAILABLE means "no data exists", which is absence, not danger. Red stays reserved for errors and destructive affordances so a red badge always means "something is wrong", never "we simply don't know". DESIGN.md is updated to match.

### D2: ESTIMATED is blue

ESTIMATED means "derived from incomplete data", which is informational, not a warning. Blue marks it; amber becomes exclusive to STALE. The four statuses then sit on a clean hue ladder: green (verified), blue (estimated), amber (stale), gray (unavailable), with red outside the ladder for errors.

### D3: Inter with tabular numerals

Inter via `next/font`: full Finnish glyph support, a tabular-numeral feature for stable money columns, and no layout shift from font loading. Every euro amount renders with `tabular-nums`. The site is number-dense; proportional digits in totals and breakdowns read as sloppy.

### D4: CSS variables mapped into Tailwind

Tokens live as CSS variables in `globals.css` and are referenced from `tailwind.config.ts`. Utilities stay ergonomic (`bg-status-verified`), while the values stay swappable at the `:root` level. Dark mode later becomes a variable override, not a component sweep.

### D5: Hand-rolled primitives

Button, Badge, Card, Input, and the state components are plain React components with Tailwind classes, colocated in `components/ui/`. At the current component count a framework adds dependency weight without payoff. DESIGN.md's own future note (consider shadcn/ui when count grows) stays in force.

### D6: Static homepage trust content

The trust row names the data sources (Systembolaget feed, official Vero rate datasets), explains the reliability model (VERIFIED / ESTIMATED / STALE / UNAVAILABLE with timestamps), and links to the ranking methodology. All static catalog copy. Freshness numbers themselves stay on result and comparison views where they belong per-spec; the homepage does not gain new API dependencies.

## Risks and Constraints

- **Content-policy lint**: homepage and chrome copy is policed by `pnpm lint:content` in both locales. Marketing phrasing fails the build; copy is written inside that vocabulary from the start.
- **Compliance suite**: the structural disclaimer must remain on every result view after the CalculatorResult refactor. The compliance tests are the gate.
- **Long Finnish labels**: components are checked against the longer Finnish catalog strings, not just English. Menus and badges wrap or truncate deliberately; nothing overflows.
- **Contrast regression risk**: the new status hues are chosen against WCAG AA on their badge backgrounds; the verification task runs the whole suite plus a manual contrast pass.
