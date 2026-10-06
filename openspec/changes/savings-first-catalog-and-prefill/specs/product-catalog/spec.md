# product-catalog Delta

## MODIFIED Requirements

### Requirement: Browsable catalog page

The `/products` page SHALL server-render the browsable catalog over the
`GET /api/v1/products` browse contract with category, keyword, sort, and page
in the URL query string through plain links and no-JS GET forms. The page's
absent-sort default SHALL follow the API default (`BIGGEST_SAVING`). Each card
SHALL render, beside the lowest observed "from" price, the product's landed
cost to Finland and the Alko reference gap when the listing item carries the
savings embed — reusing the /savings vocabulary ("Kokonaishinta Suomeen",
"Alkon vertailuhinta") and stating a dearer-than-Alko gap factually. Cards
without the embed SHALL render no gap UI at all (the render-nothing precedent
of the €/g chip). In the default order the page SHALL separate covered rows
from uncovered rows with a quiet divider labeled honestly ("Ei Alko-vertailua"
/ "No Alko reference"); other sort orders render a single undivided list.

#### Scenario: Default view leads with the biggest current savings

- **WHEN** a visitor opens /products without parameters
- **THEN** the first card is the largest current saving, and every covered card shows its landed cost and Alko gap beside the "from" price

#### Scenario: Card without a reference renders no gap UI

- **WHEN** a listed item has no savings embed
- **THEN** its card renders no landed-cost or gap element — no placeholder, no zero

#### Scenario: Dearer-than-Alko gap is stated factually

- **WHEN** a covered card's gap is positive (dearer than the Alko reference)
- **THEN** the card states the direction factually in both locales without editorial framing

#### Scenario: Uncovered rows sit behind an honest divider in the default order

- **WHEN** the default order renders both covered and uncovered rows
- **THEN** a quiet labeled divider separates the tiers, and uncovered rows follow it alphabetically

### Requirement: Pagination over the filtered catalog

The catalog page SHALL paginate over the exact filtered total with true page
semantics, and SHALL render a windowed pagination control: previous/next
links, the first and last page, a bounded window around the current page, and
ellipsis spans for the gaps — never one link per page. The page-status
sentence SHALL be retained. Pages beyond the range SHALL not be linkable, and
the current page SHALL render as a non-link.

#### Scenario: Large catalog renders a bounded control

- **WHEN** the filtered catalog spans hundreds of pages
- **THEN** the control renders only prev/next, first/last, the bounded window, and ellipsis spans — never an anchor per page

#### Scenario: Window slides with the current page

- **WHEN** a visitor pages deep into the catalog
- **THEN** the window follows the current page and the first/last anchors remain reachable

#### Scenario: Out-of-range pages stay unlinked

- **WHEN** the current page is the first or last page
- **THEN** the corresponding prev/next control renders as a disabled span, matching the existing behavior
