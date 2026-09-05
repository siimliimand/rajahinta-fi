---
# Design Tokens
# Values live as CSS variables in apps/frontend/src/app/globals.css (:root)
# and are referenced from apps/frontend/tailwind.config.ts, so utilities stay
# ergonomic (bg-status-verified) while values stay swappable at :root (D4).
colors:
  primary: # literal ramp, defined in tailwind.config.ts
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
  gray: # var(--gray-*) ramp; values below are what the variables resolve to
    50: "#f9fafb"
    100: "#f3f4f6"
    200: "#e5e7eb"
    300: "#d1d5db"
    400: "#9ca3af"
    500: "#6b7280"
    600: "#4b5563"
    700: "#374151"
    800: "#1f2937"
    900: "#111827"
    950: "#030712"
  status: # each group: solid (700 step), fg (800), bg (100 tint), border (200)
    verified: { solid: "#15803d", fg: "#166534", bg: "#dcfce7", border: "#bbf7d0" }
    estimated: { solid: "#1d4ed8", fg: "#1e40af", bg: "#dbeafe", border: "#bfdbfe" }
    stale: { solid: "#b45309", fg: "#92400e", bg: "#fef3c7", border: "#fde68a" }
    unavailable: { solid: "var(--gray-700)", fg: "var(--gray-800)", bg: "var(--gray-100)", border: "var(--gray-200)" }
  error: { solid: "#b91c1c", fg: "#991b1b", bg: "#fee2e2", border: "#fecaca" }
typography:
  font: Inter via next/font (self-hosted, --font-inter, latin + latin-ext)
  money: ".tabular-money utility — tabular numerals, mandatory for euro amounts"
spacing: {} # Tailwind defaults — no custom spacing tokens
elevation: {} # see shadows below
motion: {} # stock Tailwind animate-pulse only (LoadingSkeleton)
radii:
  sm: "0.125rem"
  md: "0.375rem"
  lg: "0.5rem"
shadows:
  sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)"
  md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)"
---

# DESIGN.md

## State

This project uses **Tailwind CSS 3.4** as its design system foundation. Every theme value Tailwind exposes lives as a CSS variable in `apps/frontend/src/app/globals.css` (`:root`) and is referenced from `apps/frontend/tailwind.config.ts`, so a future dark theme is a variable override, not a component sweep (D4). A custom `primary` color palette (blue scale) differentiates the brand; the neutral gray ramp is variable-backed so the whole neutral scale is swappable in one place. There are no custom plugins, CSS-in-JS libraries, or component frameworks — primitives are hand-rolled plain React components over Tailwind utilities (D5).

Status presentation has one canonical source: **`apps/frontend/src/lib/design/status.ts`** (`RELIABILITY_STATUS_META` and `CONFIDENCE_LEVEL_META`). Components must not keep private status-color maps; they import from this module directly or via the Badge primitives in `apps/frontend/src/components/ui/`.

The design system is minimal and intentionally understated — the product is an explainable financial-intelligence tool, not a consumer marketplace.

## Design intent (from planning documentation and implementation)

The UI is built around **transparency, neutrality, and explainability**. Every calculated figure must be traceable to its inputs, rate dataset version, and timestamp. Visual design prioritizes data legibility over marketing polish.

### Core principles

- **Every number explainable.** Price breakdowns, data-reliability flags, and disclaimer text are first-class UI citizens, not secondary footnotes.
- **Neutrality in presentation.** Ranking and comparison views are visually neutral and deterministic; no design element suggests a paid or promoted position for any merchant.
- **Data freshness surfaced.** Every externally sourced fact (price, shipping cost, tax rate) carries a reliability status and timestamp visibly surfaced to the user, not hidden in tooltips.
- **Disclaimer as structure.** The "estimated total cost in Finland, not final legal tax liability" disclaimer renders as a structural part of every calculation result, not a decorative footer.
- **Confidence and evidence.** Classification outputs are shown as observed patterns with confidence levels and evidence summaries ("likely distance selling, based on…") rather than bare legal conclusions.
- **Color is never the sole carrier of meaning.** Status dots differ in shape as well as hue, badges carry distinct icon shapes, and confidence badges use a bar-count meter — every status survives grayscale and color-blindness.

### Status colors (canonical, D1/D2)

The status hue ladder, decided in `openspec/changes/design-system-foundation/design.md`:

| Status | Hue | Dot shape | Badge icon | Meaning |
|---|---|---|---|---|
| VERIFIED | green | solid circle | check | observed data |
| ESTIMATED | blue | rounded square | wave | derived from incomplete data; informational, not a warning |
| STALE | amber | diamond | clock | past freshness threshold — amber belongs to staleness alone |
| UNAVAILABLE | gray | hollow ring | dashed circle | no data exists: absence, not danger (D1) |

**Red sits outside the ladder**, reserved for errors and destructive affordances — a red badge always means "something is wrong", never "we don't know" (D1). ESTIMATED is blue, not amber; amber is exclusive to STALE (D2).

Each status exposes four token roles mapped into Tailwind utilities: `<name>` (solid 700-step hue for dots, icons, text on white), `<name>-fg` (text on the tinted badge background), `<name>-bg` (tinted badge background), `<name>-border` (tinted badge border). The error group has the same shape. Never apply Tailwind opacity modifiers to these (e.g. `bg-status-verified/10`) — they do not work on var-based colors; the explicit `-bg` tint tokens exist for surfaces.

Confidence levels reuse the closest ladder groups via `CONFIDENCE_LEVEL_META`: HIGH=green (verified), MEDIUM=amber (stale), LOW=red (error — low confidence flags a problem with the numbers, which red legitimately signals).

Contrast (WCAG 2.1 AA, measured ratios recorded in `globals.css`): every solid on white and every `-fg` on `-bg` clears ≥ 4.5:1. Tightest pairs: green-700/white 5.0:1, green-800/green-100 6.5:1, amber-700/white 5.0:1, amber-800/amber-100 6.4:1, blue-700/white 6.7:1, gray-700/white 10.3:1, red-700/white 6.5:1.

Labels are message-catalog keys (full dotted paths into `src/messages/{fi,en}.json`), never hardcoded strings.

### Typography

**Inter** is attached by `next/font` in `apps/frontend/src/app/[locale]/layout.tsx` as the `--font-inter` variable (D3): self-hosted at build time, full Finnish glyph coverage (`latin` + `latin-ext` subsets), `display: swap`, and metric-adjusted fallbacks so there is no layout shift while it loads. The base stack in `globals.css` falls back to `ui-sans-serif, system-ui, …` if the variable is unavailable.

The `.tabular-money` utility (`font-variant-numeric: tabular-nums`) is **mandatory for every element that renders a monetary value** — digits occupy stable widths so money columns and totals stay aligned (D3).

### Design-system primitives (`apps/frontend/src/components/ui/`)

Plain, hook-free React components over Tailwind utilities — usable from both server and client components (D5). Exported via the barrel `index.ts`.

| Component | Purpose |
|---|---|
| `Button.tsx` | Variants primary/secondary/ghost/destructive; sizes sm/md/lg; optional `fullWidth`; `destructive` uses the error token group; defaults to `type="button"`; keyboard-only visible focus ring |
| `Badge.tsx` | `Badge` (generic tinted badge, tones: verified/estimated/stale/unavailable/error/neutral), `ReliabilityBadge` (status + grayscale-safe icon, reads `RELIABILITY_STATUS_META`), `ConfidenceBadge` (pill with 1/2/3 ascending-bar meter, reads `CONFIDENCE_LEVEL_META`) |
| `Card.tsx` | Quiet surface (border + white/gray fill + sm shadow); `padding` none/sm/md/lg, `shadow` none/sm/md, `muted` gray surface, semantic `as` element |
| `Input.tsx` | Label-friendly text input with `label`/`hint`/`error` props; error state uses the error token group; label requires `id` (compile-enforced) |
| `EmptyState.tsx` | Designed empty state — `role="status"` live region, decorative aria-hidden icon slot, action row; `data-state="empty"` test hook |
| `ErrorState.tsx` | Designed error state — `role="alert"`, error token group only (never the status ladder), optional retry Button (`retryLabel` required with `onRetry`); `data-state="error"` test hook |
| `LoadingSkeleton.tsx` | Pulsing placeholder blocks (variants text/box/card, `count`); `aria-hidden` — the consuming view owns the loading announcement; `data-variant` test hook |

### Brand assets and chrome

| Component file | Purpose |
|---|---|
| `apps/frontend/src/app/[locale]/components/Logo.tsx` | Typographic wordmark — "Rajahinta" in gray-900 with ".fi" in primary-700; optional rounded-square initial mark. Server-compatible |
| `apps/frontend/src/app/icon.svg` | Favicon: the initial on a primary-700 square; colors hardcoded to token values (renders outside CSS-variable scope) |
| `apps/frontend/src/app/opengraph-image.tsx` | OG image: wordmark + the fi catalog description on white, built with next/og (Inter deliberately not fetched at build); token values mirrored as inline-style literals |
| `apps/frontend/src/app/[locale]/components/SiteHeader.tsx` | Five primary destinations (calculator, compare, basket, account, ranking) on every page, outside the age gate. Three additional flag-gated destinations (`/event`, `/trip`, `/what-if`) are inserted at fixed positions only when their server-resolved flags are on — absent from first render when off. Group order and curated lists are deliberately not in the nav (share-link and sitemap discovery). Active page shown by underline (desktop) / left bar (mobile) plus `aria-current="page"` — never color alone. Mobile menu is a disclosure panel: closed means `display:none` (no focus trap), Escape closes and returns focus to the toggle, navigation closes the panel |
| `apps/frontend/src/app/[locale]/components/SiteFooter.tsx` | Structured legal layout: visually distinct disclaimer block on a white surface, methodology link, locale note naming the content languages |
| `apps/frontend/src/app/[locale]/components/AgeGate.tsx` | Age verification wrapper rendered on every page inside the locale layout; header/footer stay outside the gate |

### Homepage

`apps/frontend/src/app/[locale]/page.tsx` — static catalog copy only, no API calls (D6): a one-sentence value proposition, the calculator as primary CTA (a real navigable link styled as primary Button), quiet secondary links to comparison and methodology, and a trust row naming the data sources, the reliability model (the four statuses with their canonical dots + labels), and the methodology documentation. Freshness numbers stay on result and comparison views.

### Designed states

| Component file | Route | Purpose |
|---|---|---|
| `calculator/components/GateClosedNotice.tsx` | `/calculator` | Calm `role="status"` notice shown when the guarded endpoints reject with launch-gate-closed (403); replaces an unexplained API failure |
| Wired `EmptyState` | `/calculator`, `/calculator/result/[recordId]` | Settled search with zero results; missing/404 result record with a route back to the calculator |
| Wired `ErrorState` | `/calculator`, `/calculator/result/[recordId]` | Failed calculation; rate-limited (429) calculation surfaces the `Retry-After` wait in the state copy; retry re-runs the fetch |
| `[locale]/not-found.tsx` + `[...rest]` catch-all | any unmatched path | Localized 404; the catch-all routes through `notFound()` so unknown paths render it with the active locale's copy |

### Feature components

| Component file | Route | Purpose |
|---|---|---|
| `calculator/components/ProductSearch.tsx` | `/calculator` | Product search input |
| `calculator/components/ProductSelector.tsx` | `/calculator` | Product selection from results |
| `calculator/components/QuantitySelector.tsx` | `/calculator` | Quantity input for calculation |
| `calculator/components/CalculatorResult.tsx` | `/calculator` | Itemized landed-cost result display |
| `calculator/components/HistoryChart.tsx` | `/calculator`, `/compare` | Pure-SVG historical price/landed-cost chart with tax-change markers and reliability badges (flag-gated) |
| `calculator/components/ProductHistoryPanel.tsx` | `/calculator`, `/compare` | Flag-guarded chart panel — skips fetch when flag off; metric and merchant filters; "data available from" notice |
| `calculator/components/DisclaimerBanner.tsx` | `/calculator` | Structural disclaimer rendered on every result |
| `calculator/components/CorrectionFlagPanel.tsx` | `/calculator/result/[recordId]` | "Flag a problem" affordance posting correction feedback to `POST /api/v1/corrections` |
| `compare/components/ComparisonView.tsx` | `/compare` | Side-by-side product comparison |
| `compare/components/BasketComparisonSection.tsx` | `/compare` | Flag-gated store-grouped multi-store comparison view |
| `basket/components/BasketBuilder.tsx` | `/basket` | Basket construction — product search, quantities, destination, transport arrangement |
| `basket/components/BasketResults.tsx` | `/basket` | Recommended basket combination plus neutral cost-ordered alternatives with per-store breakdowns, reliability badges, structural disclaimer |
| `compare/components/MerchantLink.tsx` | `/compare` | Neutral merchant link with outbound-disclosure |
| `compare/components/SortSelector.tsx` | `/compare` | Sort-order control for comparison view |
| `calculator/components/ScenarioControls.tsx` | `/calculator` | Save/load named calculator input scenarios (flag-gated) |
| `calculator/components/ReportExportActions.tsx` | `/calculator`, `/account` | Report export affordance — JSON/CSV lossless, printable HTML via browser print (flag-gated, premium entitlement) |
| `calculator/components/DeclarationGuidancePanel.tsx` | `/calculator/result/[recordId]` | Collapsible advanced declaration guidance — excise derivation, advance-notice deadline, MyTax checklist, confidence caveats, official vero.fi links (flag-gated) |
| `compare/components/MerchantFreshnessSection.tsx` | `/compare` | Per-merchant data-freshness/reliability display — informational only, never affects ranking (flag-gated) |
| `account/components/SavedScenariosSection.tsx` | `/account` | Saved scenarios list with load affordance (flag-gated) |
| `components/ContentSafetyBadge.tsx` | — | Warns about promotional/subjective product content (content-lint violations); hidden when clean. Currently defined but not wired into any route |

Feature-component paths above are relative to `apps/frontend/src/app/[locale]/`.

### Routes

| Route | Purpose |
|---|---|
| `/` | Homepage — value proposition, calculator CTA, trust row (static copy, no API calls) |
| `/calculator` | Landed-cost calculator with product search, selection, quantity, result; designed empty/error/gate-closed states |
| `/calculator/result/[recordId]` | Individual calculation result page |
| `/compare` | Product comparison with multiple sort orders; flag-gated multi-store comparison |
| `/basket` | Basket builder and optimization results (hidden when `enable_basket_optimization` is off) |
| `/ranking` | Explanation of ranking methodology and neutrality enforcement |
| `/event` | Excursion alcohol calculator — MVP landed-cost estimate plus V2 deterministic cross-border sourcing plan (flag-gated) |
| `/trip` | Trip feasibility — break-even math and neutral ferry-offer block excluded from all calculation input (flag-gated) |
| `/what-if` | Hypothetical excise what-if simulator — pure recalculation, ephemeral share token, HYPOTHETICAL disclaimer (flag-gated) |
| `/what-if/embed` | Chrome-less embeddable what-if widget for third-party sites |
| `/products/[id]` | Server-rendered per-product page with crawler-facing product metadata (age-gated catalog read via first-party prerender token); includes the flag-gated evidence-backed dupe-alternatives panel |
| `/lists/[slug]` | Curated editorial product lists with JSON-LD; entries in sitemap (flag-gated) |
| `/group-order` | Group order session creation — create form and scope selection (flag-gated) |
| `/group-order/[token]` | Shared group order session view via opaque token — participants, item valuations, transfers breakdown, accounting-only boundary note; noindexed, 410 after expiry (flag-gated) |
| `/ops` | Internal operator console — client console fetches from `/ops/console/**` behind bearer-token + IP-allowlist realm and the OPERATOR_CONSOLE flag (default OFF); excluded from indexing |
| `/account` | Account management page (anonymous session, calculation history, data export, saved scenarios) |
| `/account/create` | Anonymous account creation confirmation |
| `/account/saved-baskets` | User's saved calculation baskets |
| `/age-gate` | Age verification page |
| `/age-gate/declined` | Neutral destination for declining the age gate — no alcohol-related content, no external links |
| `[...rest]` (catch-all) | Unmatched paths inside a locale route through `notFound()` to the localized not-found page |

Routes live under `apps/frontend/src/app/[locale]/`; Finnish serves from unprefixed paths, English from `/en`.

## Look and feel

Tailwind utilities over the token layer above — no custom visual language beyond the primary blue palette and the status/error groups. The UI is utilitarian, emphasizing:

- **Data density** — numbers and breakdowns are front and center; euro amounts render in Inter with tabular numerals
- **Minimal ornamentation** — quiet surfaces, `shadow-sm` borders over elevation; brand expression limited to the wordmark, favicon, and OG image
- **Status clarity** — reliability indicators use the canonical hue ladder (green VERIFIED, blue ESTIMATED, amber STALE, gray UNAVAILABLE) with shape affordances, from one source of truth (`src/lib/design/status.ts`)
- **Accessibility** — measured WCAG AA contrast on every status pairing (ratios recorded in `globals.css`); global `:focus-visible` ring floor; semantic HTML and landmark structure; `aria-current` navigation state; live-region semantics on empty/error states

The platform is positioned as a trustworthy, explainable financial/tax-intelligence tool for cross-border beverage purchases — the design reflects that positioning through clarity and neutrality rather than visual polish.

## Future design considerations

- **Dark mode — deferred, not implemented.** The token layer makes it a variable override on `:root`, not a component sweep (D4); no dark values exist yet.
- **Print stylesheet — deferred.** Report export prints via the browser's native print (ReportExportActions); a dedicated print stylesheet is a possible follow-up.
- Run `/make-design` after adding new components, custom plugins, or token overrides
- Consider shadcn/ui or similar component library if component count grows significantly (D5 keeps this in force)
- Swap the SiteFooter's hand-rolled card surface for the Card primitive once the primitive carries the React import the classic-JSX test runtime needs (noted in SiteFooter.tsx)

<!-- Last updated: 2026-08-28 -->
