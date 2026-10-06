# Design: hedge-dedup-confidence-meter

## Context

Two coupled problems: a hedging heap (one idea, 4–8 renders per view) and a
missing honest signal (no numeric margin on any result, despite the outcome
data existing). Part A is presentation-layer; Part B is a small domain
extension reusing the outcome-report aggregation that already powers
AccuracyStat.

## Goals

- One disclaimer render per view, payload-sourced, quiet by default.
- Estimate-ness expressed by the status-dot vocabulary, not by name prefixes.
- A ± figure the system has actually earned from user-reported outcomes.

## Non-goals

- Touching the content-policy vocabulary (purchase-advice avoidance stays).
- Touching the what-if HYPOTHETICAL disclaimer (stronger semantic, pinned).
- Touching savings / compare / €/g surfaces (already badge-driven).
- Changing any monetary figure anywhere.

## Decisions

### D1: Single-render rule

Exactly one disclaimer render per result view, always sourced from the result
object (`disclaimer` field — the structural invariant in
`landed-cost-calculator` and the persisted-record digest face is untouched).
Intensity keys to the result's confidence: `LOW` renders the existing amber
(`status-stale-*`) banner; `HIGH`/`MEDIUM` render a quiet neutral one-liner
(gray tokens, same byte-identical text and version tag — the text is pinned by
the SiteFooter test convention and stays byte-identical). The SiteFooter strip
remains the legal line on every page; on result views the single result render
plus the footer coexist (page-level vs result-level), and on non-result pages
the footer carries it alone.

### D2: Label honesty

The tax lines are deterministic given classification: excise and container
duty resolve from official versioned rate tables, import VAT is statutory.
Their category labels drop the "Arvio" prefix in both locales
("Alkoholin valmistevero", "Pakkausvero", "Tuonnin arvonlisävero" —
exact strings land in the catalogs). Estimate-ness stays on the per-value
status dots that already exist. The transport line keeps an explicit
"Arvioitu (kuljetustarjousta ei valittu)" label when no offer was selected —
that one is genuinely an estimate.

### D3: Margin calibration

Margin = empirical p80 quantile of relative error
`|reported_total − estimated_total| / estimated_total` over user-reported
calculation outcomes, matching the result through a cell ladder:
`category×carrier` → `category` → `global`. First rung with
`sample_count ≥ 10` wins; below the floor everywhere, the margin is null.
The quantile is inclusive (mirrors `WITHIN_MARGIN_FRACTION`'s inclusive
comparison). Pure function in `core-domain/src/outcomes/`, property-tested:
no fabrication (null without data), ladder monotonicity (deeper cell never
yields a wider margin than its parent when both meet the floor), determinism.

### D4: Display-only invariant

`empiricalMargin` is display-only: it never enters totals, breakdowns,
rankings, sort orders, savings, or any computed output (same precedent as
`alkoBenchmark`, proven byte-identical by compliance tests). Rendered as
±€ computed from the result's own total (`p × total`), with the relative
percent, sample count, and as-of date always adjacent — the reader can
always see the basis. Absent margin renders nothing (render-nothing
convention), never a placeholder.

### D5: What-if carve-out

The what-if simulator's HYPOTHETICAL disclaimer is a different semantic
(hypothetical-vs-forecast, not estimate-hedging) with a harder pin
("prominent, wording stronger than the standard"). It keeps its prominent
render; the single-render rule counts it as that view's one render.

### D6: Frozen snapshots

New share snapshots freeze the margin as an additive field of the digest;
the share page renders it when present, nothing when absent. Older snapshots
are untouched. The embed's "disclaimers intact" pin is re-verified by test.

### D7: Breakdown disclosure placement

The five-row confidence breakdown moves behind the existing derivation
disclosure ("Miten arvio laskettiin") on the calculator result. The
confidence-framework capability ("UI can show why") is preserved: the detail
is reachable in one click, not always-on. LOW-confidence results keep the
SanityNoteList visible — that is the degraded-state exception.

### D8: Legal re-review note

The dedup and the meter wording are recorded in the change notes as a delta
for the holder of the written Finnish legal opinion (`legal-review-gating`).
Recorded, not blocking: the gate binds the launch toggle, and the disclaimer
text itself is unchanged byte-for-byte.

## Migration/risk notes

Cold start means most results show no meter at first — accepted and honest.
The aggregation job degrades to no rows when outcome reports are empty; the
endpoint returns the honest empty state; the UI renders nothing.
