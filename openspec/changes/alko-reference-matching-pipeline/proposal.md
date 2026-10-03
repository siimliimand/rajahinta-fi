# Proposal: alko-reference-matching-pipeline

## Why

The `/savings` surface proves the opposite of its pitch. Every materialized
snapshot row (2,058 rows across six categories, verified in production
2026-10-03) is a trivial self-comparison: `bestMerchant = alko`,
`bestMerchantCountry = FI`, `bestPriceCents == alkoReferenceCents`, gap always
positive — the page's own honest labeling renders them all as losses
("kalliimpi kuin Alkon vertailuhinta"), and every category's largest-gap
highlight is a loss. A Finnish user visiting "savings vs Alko" sees zero wins
and nonsense pairs ("Alko product, landed €16 more"): full landed-cost math
applied to domestic prices.

Root cause (verified in production):

- The two sides of the comparison live in **disjoint product universes**.
  4,257 Alko-referenced products and 4,442 foreign products (alks DE 2,849,
  longero EE 982, kippis FI 637, mydrink EE 649) share **zero** `product_id`s.
  The savings cron enumerates products carrying an Alko offer, so the only
  offers it ever sees for them are Alko's own — best offer equals the
  reference, and the gap is positive by construction. The cron's design intent
  (best offer across merchants, full landed cost vs Alko reference) has never
  once been able to fire as designed.
- The **EAN bridge is structurally dead**: the Alko side carries zero EANs;
  all 3,164 EAN-bearing product rows are foreign-side. Only fuzzy matching can
  bridge the universes.
- The bridge that exists on paper is **orphaned, like the event-calc seeds
  were**: `ProductMatcherService` (EAN exact → fuzzy on brand/category/volume/
  ABV with EXACT–NONE confidence grades and a ≥75 score gate) and
  `ManualReviewService` (queue routing for low-confidence matches) are built
  and unit-tested — their own test header calls the scoring "HIGH-LIABILITY" —
  and have **zero consumers** outside their package. The `product-normalization`
  spec already REQUIRES cross-merchant matching with manual-review routing;
  the capability was specified and built but never wired to persistence, a
  pass, or a consumer.

## What Changes

- Migration 0026 adds the persistence the matcher never had:
  `product_reference_links` (foreign product → Alko product, status-ruled
  lifecycle), `match_review` (queued candidates with scores, confidence,
  method, and both sides' names for review), and
  `savings_snapshots.reference_link_id` (explainability: every gap row names
  the link that produced the pair).
- D1 repositories for both tables and a D1 adapter for the matcher's
  `IProductMasterQuery` port — `findCandidates` blocks on category + ABV
  bucket + volume bucket so 18.9M naive pairwise comparisons collapse to
  small per-product candidate sets.
- A one-shot matching pass `scripts/match-alko-references.mts` (precedent:
  `reclassify-category.mts`) walks the foreign side, scores Alko candidates,
  and writes EVERYTHING to the review queue on the first run — nothing
  auto-publishes. `--stats` mode reports yield by confidence without writing.
- The operator console gains a match-review surface with confirm/reject
  endpoints (bearer-guarded, attributed, audited — the same trust pattern as
  the consumption-norms confirm queue). CONFIRMED links are the only ones the
  savings cron reads.
- The savings cron materializes linked pairs: a foreign product with a
  CONFIRMED reference link qualifies; its landed cost is computed on ITS best
  (foreign) offer; the Alko reference is resolved from the linked Alko
  product's offers (reference resolution extends the calculator rather than
  duplicating the benchmark-selection predicate in the cron).
- No frontend changes: `/savings` already renders both gap polarities and its
  honest-labeling contract is untouched — it has simply never seen a negative
  gap to render. The compliance isolation invariant (savings data feeds no
  computation) is preserved.
- Honest expectation setting: with zero Alko-side EANs every link comes from
  fuzzy scoring — realistic first-run yield is hundreds of links, mostly
  HIGH/MEDIUM, each owner-reviewed before it affects the page. Once links
  exist, German/Estonian retail prices compared against monopoly references
  through full landed cost should finally produce genuine wins — the
  product's thesis becomes visible instead of inverted.

## Capabilities

### Modified Specifications

- `specs/savings-discovery/spec.md` — qualification extends from
  "carries an Alko reference offer" to "carries an Alko reference offer
  directly OR through a CONFIRMED product reference link"; snapshot rows
  carry the reference link id when one produced the pair.

### Added Specifications

- `specs/product-normalization/spec.md` — Alko reference linking: the
  one-shot pass, blocked candidate retrieval, confidence-graded routing, the
  manual-review gate (no auto-publication), and CONFIRMED-link semantics as
  the only trust level the savings surface reads.
