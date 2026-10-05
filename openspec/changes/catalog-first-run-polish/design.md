# Design: catalog-first-run-polish

## Context

`first-impression-pass` (2026-10-03) flipped the absent-sort default to
LOWEST_PRICE deliberately: "the listing leads with the lowest observed
prices, offer-less products after all priced rows". At that time the
catalog's cheap end was ordinary priced inventory. Since then the catalog
grew to 9,494 products and the cheapest-first head is now 2-cl mini
bottles — legally alcoholic, honestly priced, and useless as a first
impression for the Finnish audience the site serves.

## Decisions

### D1: Default alphabetical, with the evidence on record

The absent-sort default becomes ALPHABETICAL on the API
(`parseSortOrder`) and the products page's select. Rationale: predictable,
neutral (the ranking page's own framing), and independent of catalog
composition — no future feed addition can distort the landing view the
way price-ascending can. Alternatives: keeping LOWEST_PRICE post-hygiene
(rejected: change `nonalcoholic-catalog-hygiene` removes the 0%-ABV rows
but the mini bottles remain — they are legitimate products); defaulting to
a per-litre order (rejected: introduces a new first-impression metric
without user evidence). This decision deliberately supersedes the
`first-impression-pass` flip; `LOWEST_PRICE` stays one click away and the
URL contract is unchanged.

### D2: Pack context reuses the read-time parse — no new API surface

Listing items already carry the €/g embed derived from the cheapest
current offer with the read-time package-units parser
("a pack row can never price a 24-pack against one can"). The dropdown
renders that embed and, when the parser yields more than one unit,
an "≈ x,xx €/kpl" line computed client-side as price / units. No new
endpoint, no duplicated parser.

### D3: Scroll only when needed, never against motion preferences

After a successful calculation the result card scrolls into view only if
it is not already substantially in the viewport, using
`prefers-reduced-motion` to pick instant over smooth scrolling. The
desktop sticky summary keeps working unchanged; the fix targets the
mobile single-column flow.

### D4: Consent stays a hard gate; the lock becomes legible

The Tilaa button stays disabled until the consent checkbox is ticked
(explicit consent is the stronger pattern and matches the double-opt-in
backend); the change adds a visible hint beside the disabled button
stating consent is required, so the state is self-explanatory. Enabling
the button and validating on submit was rejected: it produces a failed
submit as the feedback mechanism.

### D5: Contrast is audited, not assumed

The trust line's foreground/background pairs are computed (WCAG AA ratio
≥ 4.5:1 for the rendered sizes). The fix, if needed, is a token-level
adjustment in `globals.css` — no structural redesign; if all pairs pass,
the task records that and changes nothing.
