# Change notes: hedge-dedup-confidence-meter

Implementation record for tasks 5.1–5.3. Decisions taken during implementation
that the proposal and design left open, followed by the legal re-review delta.

## Implementation decisions

### Margin refresh rides the existing aggregation tick

No dedicated cron existed for outcome aggregation, so the margin calibration
(`outcome_margins`, migration 0029) runs on the existing `AGGREGATION_CRON`
tick via the cron router, alongside freshness alerts, price-alert evaluation,
and time-series aggregation. No new wrangler cron trigger was added; the
calibration degrades to no rows when no outcome reports exist (honest empty
state end to end).

### Trip margin: fill response only

The trip planner's margin rides only the filled-plan response (`POST` fill),
where a concrete estimated total exists to hedge. Exploratory trip queries
without a priced plan carry no margin — there is no estimate to qualify.

### Event margin: priced plans only

The event calculator attaches `empiricalMargin` only to responses with a
computed (priced) plan. Unpriced responses are skipped: no estimate, no
margin, matching the render-nothing convention downstream.

### Basket margin: recommended combination only

The basket result attaches the margin to the recommended combination's total
only. Alternative pack combinations are not hedged individually — one
margin per basket view, next to the total the visitor is steered toward.

### Meter methodology link target: /ranking

The ConfidenceMeter's "Menetelmä" link points at `/ranking`, the same
destination as the SiteFooter methodology link. The margin methodology
section lives there (task 5.3), keeping one methodology surface rather than
introducing a new route.

---

## LEGAL RE-REVIEW DELTA

**To:** Holder of the written Finnish legal opinion (`legal-review-gating`)
**Re:** Presentation changes in change `hedge-dedup-confidence-meter` —
submitted for re-review; the launch gate itself is unchanged and this delta
is recorded, not blocking.

Three visible changes affect marketing-law-relevant surfaces. In all three,
the underlying data, totals, and calculation are untouched.

### 1. Estimate disclaimer deduplicated to one render per result view

Previously a single result view rendered the "this is an estimate" framing on
seven to eight surfaces (amber banner, per-line prefixes, confidence
breakdown, badge, prose, footer strip). Now exactly one disclaimer render per
result view, keyed to confidence (amber banner when LOW, quiet one-liner
otherwise).

- The disclaimer **text is byte-identical** to the reviewed wording — nothing
  was reworded, only the number of repetitions reduced.
- The disclaimer is still **sourced from the result object** on every API
  response and every persisted record; the structural-payload invariant is
  intact. Only the rendering count changed.
- The **SiteFooter legal strip is unchanged** and remains the legal line on
  non-result pages. The what-if simulator's stronger HYPOTHETICAL disclaimer
  is explicitly carved out and keeps its prominent render.

### 2. Estimate qualifiers removed from deterministic tax-line labels

The per-line "Arvio" prefixes were removed from the excise, container-duty,
and import-VAT category labels in both locales. These lines are deterministic
given classification (official versioned rate tables). Estimate-ness remains
visible through the existing per-value reliability status dots; the transport
line keeps its explicit "Arvioitu" label when no offer was selected, because
that line is genuinely an estimate.

### 3. New empirical ± figure beside totals

Result views may now show an empirical margin ("Havaittu hajonta") next to
the hero total: ± € computed as the 80th-percentile relative error between
user-reported actual totals and our estimates, with the sample size and
computation date always adjacent and a methodology link. It is display-only:
it never enters totals, breakdowns, rankings, or any computed output, and it
renders nothing when too few outcomes exist (fewer than 10). The methodology
is documented publicly on the /ranking page.

### Summary for the reviewer

No legal text was reworded; the reviewed disclaimer wording is unchanged and still travels on every
response. The changes reduce repetition, remove qualifiers from labels that
were deterministic all along, and add one factual, data-backed accuracy
figure. Re-review requested against the
Alcohol Act marketing provisions previously opined on (estimate framing,
comparative presentation); no other reviewed surface is affected.
