---
# Design Tokens
colors:
  primary:
    50: "#eff6ff"
    100: "#dbeafe"
    200: "#bfdbfe"
    300: "#93c5fd"
    400: "#60a5fa"
    500: "#3b82f6"
    600: "#2563eb"
    700: "#1d4ed8"
    800: "#1e40af"
    900: "#1e3a8a"
typography: {}
spacing: {}
elevation: {}
motion: {}
radii: {}
shadows: {}
---

# DESIGN.md

## State

This project uses **Tailwind CSS 3.4** as its design system foundation. All tokens not listed in the frontmatter default to Tailwind's built-in design tokens. A custom `primary` color palette (blue scale) is defined to differentiate the brand. There are no custom plugins, CSS-in-JS libraries, or component frameworks.

The design system is minimal and intentionally understated — the product is an explainable financial-intelligence tool, not a consumer marketplace.

## Design intent (from planning documentation and implementation)

The UI is built around **transparency, neutrality, and explainability**. Every calculated figure must be traceable to its inputs, rate dataset version, and timestamp. Visual design prioritizes data legibility over marketing polish.

### Core principles

- **Every number explainable.** Price breakdowns, data-reliability flags, and disclaimer text are first-class UI citizens, not secondary footnotes.
- **Neutrality in presentation.** Ranking and comparison views are visually neutral and deterministic; no design element suggests a paid or promoted position for any merchant.
- **Data freshness surfaced.** Every externally sourced fact (price, shipping cost, tax rate) carries a reliability status and timestamp visibly surfaced to the user, not hidden in tooltips.
- **Disclaimer as structure.** The "estimated total cost in Finland, not final legal tax liability" disclaimer renders as a structural part of every calculation result, not a decorative footer.
- **Confidence and evidence.** Classification outputs are shown as observed patterns with confidence levels and evidence summaries ("likely distance selling, based on…") rather than bare legal conclusions.

### Existing UI components

| Component file | Route | Purpose |
|---|---|---|
| `AgeGate.tsx` | Root layout | Age verification wrapper rendered on every page |
| `ProductSearch.tsx` | `/calculator` | Product search input |
| `ProductSelector.tsx` | `/calculator` | Product selection from results |
| `QuantitySelector.tsx` | `/calculator` | Quantity input for calculation |
| `CalculatorResult.tsx` | `/calculator` | Itemized landed-cost result display |
| `HistoryChart.tsx` | `/calculator`, `/compare` | Pure-SVG historical price/landed-cost chart with tax-change markers and reliability badges (flag-gated) |
| `ProductHistoryPanel.tsx` | `/calculator`, `/compare` | Flag-guarded chart panel — skips fetch when flag off; metric and merchant filters; "data available from" notice |
| `DisclaimerBanner.tsx` | `/calculator` | Structural disclaimer rendered on every result |
| `CorrectionFlagPanel.tsx` | `/calculator/result/[recordId]` | "Flag a problem" affordance posting correction feedback to `POST /api/v1/corrections` |
| `ComparisonView.tsx` | `/compare` | Side-by-side product comparison |
| `BasketComparisonSection.tsx` | `/compare` | Flag-gated store-grouped multi-store comparison view |
| `BasketBuilder.tsx` | `/basket` | Basket construction — product search, quantities, destination, transport arrangement |
| `BasketResults.tsx` | `/basket` | Recommended basket combination plus neutral cost-ordered alternatives with per-store breakdowns, reliability badges, structural disclaimer |
| `MerchantLink.tsx` | `/compare` | Neutral merchant link with outbound-disclosure |
| `SortSelector.tsx` | `/compare` | Sort-order control for comparison view |
| `ScenarioControls.tsx` | `/calculator` | Save/load named calculator input scenarios (flag-gated) |
| `ReportExportActions.tsx` | `/calculator`, `/account` | Report export affordance — JSON/CSV lossless, printable HTML via browser print (flag-gated, premium entitlement) |
| `DeclarationGuidancePanel.tsx` | `/calculator/result/[recordId]` | Collapsible advanced declaration guidance — excise derivation, advance-notice deadline, MyTax checklist, confidence caveats, official vero.fi links (flag-gated) |
| `MerchantFreshnessSection.tsx` | `/compare` | Per-merchant data-freshness/reliability display — informational only, never affects ranking (flag-gated) |
| `SavedScenariosSection.tsx` | `/account` | Saved scenarios list with load affordance (flag-gated) |

### Routes

| Route | Purpose |
|---|---|
| `/` | Home page with navigation to all sections |
| `/calculator` | Landed-cost calculator with product search, selection, quantity, result |
| `/calculator/result/[recordId]` | Individual calculation result page |
| `/compare` | Product comparison with multiple sort orders; flag-gated multi-store comparison |
| `/basket` | Basket builder and optimization results (hidden when `enable_basket_optimization` is off) |
| `/ranking` | Explanation of ranking methodology and neutrality enforcement |
| `/account` | Account management page (anonymous session, calculation history, data export, saved scenarios) |
| `/account/create` | Anonymous account creation confirmation |
| `/account/saved-baskets` | User's saved calculation baskets |
| `/age-gate` | Age verification page |

## Look and feel

No custom visual language beyond Tailwind's defaults plus the primary blue palette. The UI is utilitarian, emphasizing:

- **Data density** — numbers and breakdowns are front and center
- **Minimal ornamentation** — no decorative elements, no branded graphics
- **Status clarity** — reliability indicators use predictable visual cues (color-coded badges: green for VERIFIED, amber for STALE, gray for UNAVAILABLE, blue for ESTIMATED)
- **Accessibility** — color choices from Tailwind's built-in contrast ratios; semantic HTML structure

The platform is positioned as a trustworthy, explainable financial/tax-intelligence tool for cross-border beverage purchases — the design reflects that positioning through clarity and neutrality rather than visual polish.

## Future design considerations

- Run `/make-design` after adding new components, custom plugins, or token overrides
- Consider shadcn/ui or similar component library if component count grows significantly
- Evaluate dark-mode support (not implemented)

<!-- Last updated: 2026-08-28 -->