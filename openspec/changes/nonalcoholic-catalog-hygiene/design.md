# Design: nonalcoholic-catalog-hygiene

## Context

Merchant feeds (WooCommerce Store APIs) expose storefront categories; the
shared parser maps them into the six canonical alcohol categories. The
mapper's additive synonym tables admit anything resembling the storefront
taxonomy — energy drinks, waters, and juices land in `other_fermented`
because the storefront files them under the same parent node as ciders.
Nothing downstream asserts the physical prerequisite of the platform:
an alcohol-category product must contain alcohol.

## Decisions

### D1: Hold for review, never delete

Affected rows stay in `product_master` (provenance, offer history, and
the correction queue's evidence all reference them) and are
correction-flagged with a machine-readable hold reason. Deletion was
rejected: it destroys audit history and makes the correction workflow
impossible. The hold is what removes them from user surfaces.

### D2: One shared predicate at the repository layer

The rule "alcohol-category product ⇒ ABV > 0 AND not held-for-review"
lives as a single shared SQL fragment used by the product-search
repository (browse, ranked-q, and ids paths must not drift), the
savings-snapshot qualification, and the unitprice ranking query.
Per-surface filters were rejected as drift-prone — yesterday's
`unitprice-ranking-scale-fix` post-mortem shows these surfaces have
already diverged once. Detail pages resolve through the same listing
universe, so a held product's detail page degrades consistently (404)
rather than half-rendering.

### D3: Unknown-ABV rows are held, not dropped, and the ESTIMATED contract survives

"Unparseable alcohol fields ingest as ESTIMATED" stays untouched: the row
still ingests with ESTIMATED status. The new rule is about **category
eligibility**, not status — a row with no parsed ABV cannot be *placed*
in an alcohol category. Rows with a parsed ABV > 0 keep today's behavior
entirely, including ESTIMATED-abv products.

### D4: Cleanup is an audited dry-run-first script, not a migration

The existing ~120 production rows are enumerated by
`scripts/nonalcoholic-catalog-audit.ts` (dry-run default, explicit
`--apply`), which flags/holds them idempotently and prints a review
summary for the operator. A migration was rejected: the affected set is
data-dependent and the correction queue — not the schema — owns review
state. The script pattern follows the existing catalog-sweep precedent.

## Risks

- Legitimate near-zero products: 0.0% alcohol beers (Karhu 0,0,
  Heineken 0.0) are genuinely sold near-alcohol-free; the platform's
  landed-cost calculator has nothing to compute for them either, so
  holding them is correct for this platform even though they are
  "alcohol-branded".
- Catalog counts drop in affected categories (honest shrinkage); the
  savings market-overview's coverage counts shrink with it — expected and
  displayed as-is.
