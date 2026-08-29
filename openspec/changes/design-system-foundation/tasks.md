# Design System Foundation — Tasks

> Decisions D1 to D6 recorded in `design.md`. Groups follow dependency order: tokens, primitives, chrome, homepage, states, docs.
> Agents: `platform-engineer` (React, Next.js, Tailwind). No infra work, so `devops-engineer` is not involved. No missing specializations.

---

## 1. Design token foundation

- [x] 1.1 Define the semantic token layer in `globals.css` and `tailwind.config.ts`: status palette per D1/D2 (VERIFIED green, ESTIMATED blue, STALE amber, UNAVAILABLE gray, red reserved for errors), neutral gray scale, radii, and shadows as CSS variables mapped into the Tailwind theme; base element styles <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/tailwind.config.ts, apps/frontend/src/app/globals.css] -->
- [x] 1.2 Wire Inter through `next/font` in the root layout (D3), add the tabular-numeral money utility, and set base typography styles <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/app/[locale]/layout.tsx, apps/frontend/src/app/globals.css] -->
- [x] 1.3 Add brand assets as code: Logo wordmark component, app icon favicon, Open Graph image via `next/og` ImageResponse <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/frontend/src/app/[locale]/components/Logo.tsx, apps/frontend/src/app/icon.svg, apps/frontend/src/app/opengraph-image.tsx] -->

## 2. Shared primitives

- [x] 2.1 Create UI primitives at `apps/frontend/src/components/ui/`: Button, Badge (reliability and confidence variants from the token palette), Card, Input (D5) <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/frontend/src/components/ui/**] -->
- [x] 2.2 Create the canonical status module `apps/frontend/src/lib/design/status.ts` (D1, D2) replacing `RELIABILITY_BADGE`, `RELIABILITY_DOT`, and `CONFIDENCE_META`, and adopt it in CalculatorResult <!-- agent: platform-engineer.build, depends_on: [1.1, 2.1], touches: [apps/frontend/src/lib/design/status.ts, apps/frontend/src/app/[locale]/calculator/components/CalculatorResult.tsx] -->
- [x] 2.3 Adopt the primitives and status module in the remaining components: ProductSearch, AgeGate, HistoryChart, ProductHistoryPanel, ComparisonView, BasketComparisonSection, BasketResults, MerchantFreshnessSection, DisclaimerBanner, CorrectionFlagPanel <!-- agent: platform-engineer.build, depends_on: [2.1, 2.2], touches: [apps/frontend/src/app/[locale]/calculator/components/**, apps/frontend/src/app/[locale]/compare/components/**, apps/frontend/src/app/[locale]/components/AgeGate.tsx] -->
- [x] 2.4 Unit tests for the primitives and the status module (variant rendering, accessibility roles) <!-- agent: platform-engineer.build, depends_on: [2.1, 2.2], touches: [apps/frontend/src/components/ui/__tests__/**] -->

## 3. Layout chrome

- [x] 3.1 Rebuild SiteHeader: active-page nav indicator, keyboard-operable mobile menu, logo placement <!-- agent: platform-engineer.build, depends_on: [1.3, 2.1], touches: [apps/frontend/src/app/[locale]/components/SiteHeader.tsx, apps/frontend/src/app/[locale]/layout.ssr.test.tsx] -->
- [x] 3.2 Restructure SiteFooter into a structured legal layout (disclaimer block, methodology link, locale note); the disclaimer text stays unchanged and structural <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [apps/frontend/src/app/[locale]/components/SiteFooter.tsx] -->

## 4. Homepage

- [x] 4.1 Rebuild the homepage hero: one-sentence value prop, primary calculator CTA, secondary links to compare and methodology <!-- agent: platform-engineer.build, depends_on: [1.3, 2.1, 3.1], touches: [apps/frontend/src/app/[locale]/page.tsx, apps/frontend/src/messages/**] -->
- [x] 4.2 Add the trust row: data sources, reliability model explainer, methodology link; static catalog copy only (D6) <!-- agent: platform-engineer.build, depends_on: [4.1], touches: [apps/frontend/src/app/[locale]/page.tsx, apps/frontend/src/messages/**] -->
- [x] 4.3 Add fi and en catalog keys for chrome and homepage, then pass the content-policy lint in both locales <!-- agent: platform-engineer.fast, depends_on: [3.1, 3.2, 4.2], touches: [apps/frontend/src/messages/**] -->

## 5. Designed states

- [x] 5.1 Create state primitives at `components/ui/`: EmptyState, ErrorState, LoadingSkeleton <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [apps/frontend/src/components/ui/**] -->
- [x] 5.2 Add the launch-gate-closed notice shown on the calculator page when production launch gates are closed <!-- agent: platform-engineer.build, depends_on: [5.1], touches: [apps/frontend/src/app/[locale]/calculator/page.tsx, apps/frontend/src/app/[locale]/calculator/components/GateClosedNotice.tsx, apps/frontend/src/messages/**] -->
- [x] 5.3 Wire the states into real flows: search no-results, calculator API error with surfaced 429 `Retry-After`, calculation result not found <!-- agent: platform-engineer.build, depends_on: [5.1, 5.2], touches: [apps/frontend/src/app/[locale]/calculator/page.tsx, apps/frontend/src/app/[locale]/calculator/result/[recordId]/**] -->

## 6. Documentation and verification

- [x] 6.1 Update DESIGN.md: fill the token frontmatter, record the canonical status colors (D1, D2), refresh the component and route inventory, note the deferred dark-mode and print decisions <!-- agent: platform-engineer.fast, depends_on: [1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 4.2, 5.3], touches: [DESIGN.md] -->
- [x] 6.2 Run the full verification pass: `pnpm lint`, `pnpm lint:content`, `pnpm typecheck`, frontend unit tests, `pnpm build`, and the compliance suite (structural disclaimer intact); manual WCAG AA contrast check on the new status hues and a long-Finnish-label wrap check <!-- agent: platform-engineer.fast, depends_on: [4.3, 5.3, 6.1], touches: [] -->
