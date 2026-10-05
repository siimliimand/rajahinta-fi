# Design: fi-locale-surface-hardening

## Context

Cost-line labels originate in `packages/core-domain/src/calculator/
landed-cost-calculator.service.ts` as hardcoded English strings. The
calculator view already localizes presentation through the message
catalogs; the basket and share surfaces render `item.label` directly.
Money and date formatting is ad-hoc per component
(`€${(cents / 100).toFixed(2)}` in the calculator; catalog cards format
Finnish-style). Merchant identity is stored twice: `merchant_registry`
display names for operators, feed ids on offers.

## Decisions

### D1: Machine-readable line codes, not a client-side English-label dictionary

Each cost line gains an additive closed-set `code` (e.g.
`foreign_retail_price`, `transport`, `alcohol_excise`, `container_duty`,
`import_vat`) emitted next to the unchanged English `label`. This is the
same pattern `consumer-clarity-and-discovery` used for classification
evidence codes. Alternative — a frontend dictionary keyed by the English
label string — was rejected: it couples localization to display copy, and
any future label rewording silently breaks the mapping. Unknown codes
fall back to the verbatim API label so appended lines can never render as
blank.

The reliability-explanation sentences on the basket result
("[Transport] Data point is verified…") localize through the same
mechanism: reliability inputs carry their dimension + status already, so
the catalog composes the sentence from existing structure.

### D2: Shared formatters; calculator migration is deliberate

New `apps/frontend/src/lib/format/money.ts` and `date.ts` implement the
Finnish presentation (`64,19 €`, `4.10.2026`) with an EN variant. Adoption
scope is the client-side money/date surfaces named in the proposal —
including the calculator result, whose tests pin `€31.50`-style strings
and are updated deliberately (repo precedent: "existing EN assertions
move to explicit-'en' cases"). Server amounts are untouched;
`tests/compliance/` byte-identity suites re-run to prove no monetary
figure moved — only its rendering.

### D3: merchantName resolved at the read paths, additive

Product-detail, historical, and basket responses add `merchantName`
resolved from `merchant_registry` (in-process lookup keyed by merchant
id; the registry is small and already read by these paths' neighbors).
Fallback to the raw id keeps rows renderable for unregistered merchants.
No schema change; no renaming of the existing `merchant` id fields.

### D4: Newsletter-confirm link uses the footer's own condition

`getServerBlogIndex(locale)` already returns the publication count the
footer gates on; the confirm page reuses it. A fetch failure hides the
link (the footer's honest default), so the page cannot link into a 404.

## Risks

- Formatting migration touches several pinned suites; mitigated by doing
  it as one task with explicit test updates and a full battery run last.
- `merchantName` adds a registry read to hot listing paths — mitigated by
  reading it only where offers are already resolved (detail, basket
  result, history), never on the catalog listing page.
