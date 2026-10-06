# Proposal: hedge-dedup-confidence-meter

## Why

A single calculator result currently renders the "this is an estimate" idea on
**seven to eight surfaces per view**: the amber DisclaimerBanner, the
SanityNoteList label ("Luotettavuus alennettu: tulos on arvio"), three per-line
"Arvio" prefixes on the tax lines, the five-row confidence-breakdown list, the
confidence badge, the prose copy (`howBody`, `subtitle`), and the SiteFooter
legal strip. Verified against the repo on 2026-10-06:

- The message catalogs carry **77 hedge strings (fi) / 85 (en)** across 15+
  namespaces; several result views repeat the estimate framing 4–8 times
  (`CalculatorResult` alone holds 10–11).
- The specs pin **one** disclaimer render per surface
  (`landed-cost-calculator:43` "SHALL render the structural disclaimer from the
  result object"; `web-application:125` basket; `web-application:384` trip /
  event / what-if / packing). Nothing pins the heap.
- The per-line "Arvio" prefixes sit on **excise, container duty, and import
  VAT** — deterministic given classification (official versioned rate tables;
  golden tests assert `round(441 × 0.255)`). The genuinely estimated inputs
  (transport, retail price) are the ones carrying per-value status dots.
- The site's only empirical accuracy signal — user-reported outcomes vs
  estimates, aggregated with the pinned `WITHIN_MARGIN_FRACTION = 0.05` and
  already powering AccuracyStat's `withinMarginShare` — is never shown next to
  the estimate it describes. There is no numeric error margin anywhere in the
  result surfaces; confidence is categorical (`HIGH | MEDIUM | LOW`).

The result is that hedging drowns the value: the numbers a visitor needs are
wrapped in repeated caveats, and the one honest accuracy number the system
owns is confined to a trust-row island.

## What Changes

**Part A — dedup (presentation + copy + spec amendments):**

- **Single-render rule:** exactly one disclaimer render per result view,
  sourced from the result object (the structural-payload invariant is
  untouched — the disclaimer still travels on every API response and every
  persisted record). Render intensity keys to confidence: amber banner when
  LOW, quiet neutral one-liner otherwise. The SiteFooter strip is unchanged
  and remains the legal line for non-result pages.
- **Label honesty:** the tax-line category labels drop the "Arvio" prefix
  (fi/en); estimate-ness is carried by the existing per-value status dots.
  Transport keeps an explicit "arvio" label only when no offer was selected.
- **SanityNoteList** keeps its informational note bodies but drops the
  "tulos on arvio" framing label; notes name the degraded input instead.
- **Breakdown disclosure:** the always-on five-row confidence breakdown moves
  behind the existing "Miten arvio laskettiin" disclosure on the calculator
  result (the confidence-framework "UI can show why" capability is preserved
  as a capability, not an always-on heap).
- **SEO/intro prose dedup** across ~15 namespaces (`howBody`, `subtitle`,
  `metaDescription`) in both locales; content lint stays green.
- **Spec amendment:** `web-application` requirement "Structural disclaimers on
  all new result surfaces" changes "not as decorative footer text" to a
  single-render rule (one payload-sourced render per view, result body or
  footer). The what-if simulator's stronger HYPOTHETICAL disclaimer is
  explicitly carved out and untouched. Share-page and embed "disclaimers
  intact" pins stay as-is.

**Part B — empirical ± meter (domain + API + UI):**

- A per-result margin calibrated from **real outcome reports**: the p80
  quantile of relative error `|reported − estimated| / estimated` over
  user-reported calculation outcomes, resolved through a cell ladder
  (category×carrier → category → global) with a hard `N ≥ 10` sample floor.
  Below the floor the margin is null and the UI renders nothing — never a
  fabricated constant, mirroring AccuracyStat's honest-zero conventions.
- The aggregation job persists per-cell margins (`outcome_margins` table,
  D1 migration) with `as_of`; a new additive endpoint
  `GET /api/v1/accuracy/margins` exposes the ladder.
- Calculator, basket, trip, and event results carry an optional,
  **display-only** `empiricalMargin` field. The UI renders it as a
  ConfidenceMeter next to the hero total: "±3 €" (p × own total) with the
  sample count and as-of date always adjacent, linking to the methodology
  explanation. It never enters totals, breakdowns, rankings, or any computed
  ordering (same display-only precedent as `alkoBenchmark`).
- Share snapshots freeze the margin going forward (additive field); older
  snapshots render nothing. The embed keeps its "disclaimers intact" pin.

**Explicitly out of scope:** the savings / compare / €/g surfaces (already
badge-driven, per `savings-discovery:63` and `unit-price-metrics:44`), the
content-policy vocabulary (Hedge B — "no product is presented as a good
purchase" is the alcohol-marketing-law moat, not hedging), and the what-if
HYPOTHETICAL disclaimer (a different semantic: hypothetical-vs-forecast, not
estimate-hedging).

## Risks

- **Legal re-check:** `legal-review-gating` requires a written Finnish legal
  opinion; the dedup + meter wording is recorded as a delta for re-review in
  the change notes. Recorded, not blocking (the gate binds the launch toggle).
- **Cold start:** until ≥10 matching outcome reports exist per ladder rung,
  the meter renders nothing on most results. Accepted: honest absence mirrors
  the AccuracyStat coverage block.
- **Frozen-digest growth:** share payloads gain one additive field; existing
  additive-field conventions (parse-tolerant readers) apply.
