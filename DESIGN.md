---
# Design tokens
# No design tokens exist yet — this is a greenfield project with no UI code.
# The design system will be defined and captured here via /make-design once a
# frontend and its tokens/theme exist.
colors: {}
typography: {}
spacing: {}
elevation: {}
motion: {}
radii: {}
shadows: {}
---

# DESIGN.md

## State

This is a **greenfield project**. There is no frontend, no CSS, no Tailwind config, no theme files, and no design tokens in the repository yet. DESIGN.md is intentionally empty of token values until a UI and design system exist.

Run `/make-design` once a frontend, component library, or style system is in place to populate this file with real tokens and captured design intent.

## Design intent (from planning documentation)

Although no UI exists, the engineering plan in `docs/rajahinta-fi-implementation-plan.md` fixes several design-relevant requirements that a future design system must honor:

- **Every number explainable.** The UI must make every calculated figure traceable to its inputs, rate dataset version, and timestamp. Visual design must prioritize transparency over marketing polish — price breakdowns, data-reliability flags, and disclaimer text are first-class UI citizens.
- **Neutrality in presentation.** Ranking and comparison views must be visually neutral and deterministic; no design element may suggest a paid or promoted position for any merchant.
- **Data freshness surfaced.** Every externally sourced fact (price, shipping cost, tax rate) carries a reliability status and timestamp that must be visibly surfaced to the user, not hidden.
- **Disclaimer as structure.** The "estimated total cost in Finland, not final legal tax liability" disclaimer must render as a structural part of every result, not a decorative footer.
- **Confidence & evidence.** Classification outputs are shown as observed patterns with confidence levels and evidence summaries — the UI should present these honestly (e.g., "likely distance selling, based on…") rather than as bare legal conclusions.

## Look and feel

No visual language is established yet. When a design system is created, it should reflect the platform's positioning as a trustworthy, explainable financial/tax-intelligence tool for cross-border beverage purchases — prioritizing clarity, data legibility, and neutrality.

<!-- Last updated: 2026-08-15 -->