# Proposal: fi-locale-surface-hardening

## Why

The 2026-10-04 full-site walkthrough found the Finnish-first product
leaking English on its money surfaces. The basket optimizer's result —
the flagship multi-store feature — renders **"Retail price", "Alcohol
excise", "Container duty", "Import VAT (estimated)"** and full English
sentences ("Data point is verified against an authoritative source.")
inside an otherwise Finnish page. Root cause: the landed-cost service
hardcodes English line labels in the domain response; the calculator view
maps them to Finnish, but `BasketResults.tsx` (and share snapshots) render
`item.label` verbatim.

The same walkthrough found systemic presentation inconsistencies for the
Finnish audience:

- Money formats three ways across the site — `€64.19` (calculator, dot
  decimals, symbol-first), `0,49 €` (catalog, correct Finnish), and
  `10.35 snt/g` (unit embed, dot) — sometimes within one catalog card.
- Raw ISO dates sit inside Finnish prose: "tilanne 2026-10-04",
  "Havainnot 2026-10-04 asti", "2026-01-01 alkaen" — while the calculator
  formats "4.10.2026 klo 22.57.50" correctly.
- Raw internal merchant ids ("alks", "mydrink") are shown as merchant
  names on product detail, the history merchant select, and basket
  alternatives, although `merchant_registry` carries display names.
- Products whose feed name yields no brand render a dangling
  "· spirits ·" line.
- The newsletter-confirm landing page links to `/blog` unconditionally —
  a new subscriber's first click 404s while zero posts are published
  (the footer already hides the link on the same condition).

## What Changes

- Additive closed-set `code` on landed-cost cost lines (the established
  evidence-`code` precedent from `consumer-clarity-and-discovery`),
  passed through the basket and calculator routes unchanged otherwise.
  `BasketResults` renders line labels and reliability-explanation
  sentences from the message catalogs by code, falling back to the
  verbatim API label for unknown codes. The English labels stay on the
  wire byte-identical for API consumers.
- Shared `formatMoney` / `formatDate` helpers (Finnish: comma decimals,
  suffix symbol, localized numeric date) adopted across the calculator
  result card and record view, search dropdown rows, allowances, trip,
  and the product price-context line. Pinned test updates are deliberate;
  compliance byte-identity suites re-prove no monetary figure moved.
- `merchantName` resolved from the merchant registry on the three read
  paths, additive, with the id as fallback.
- Brandless product rows render without the dangling separator.
- The newsletter-confirm blog link respects the same publication-count
  condition as the footer.

## Capabilities

- `basket-optimization` — ADDED *Localized basket result presentation*.
- `web-application` — ADDED *Localized monetary and date presentation*.
- `product-catalog` — MODIFIED *Clickable merchant offers on product
  detail*: the merchant renders under its registry display name.
