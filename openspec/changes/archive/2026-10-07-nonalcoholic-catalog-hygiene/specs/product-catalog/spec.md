# product-catalog Delta

## MODIFIED Requirements

### Requirement: Browsable catalog page

The site SHALL provide a server-rendered catalog page at `/products` listing
products as cards (name, brand, category, ABV, unit volume, lowest offer
price, merchant count), each card linking to the product's detail page. Page
state — category, page number, and sort order — SHALL live in the URL query
string, and every filter, sort, and pagination control SHALL be a plain link
so the page renders and crawls without client-side JavaScript. The catalog
SHALL default to the API's absent-sort default (`BIGGEST_SAVING` — the largest
current saving first); every explicit sort option, including `LOWEST_PRICE`
and `ALPHABETICAL`, SHALL remain selectable and URL-addressable. Unknown
category parameter values SHALL render the unfiltered view; unknown sort
values SHALL render the default ordering. Each card SHALL render, beside the
lowest observed "from" price, the product's landed cost to Finland and the
Alko reference gap when the listing item carries the savings embed — reusing
the /savings vocabulary ("Kokonaishinta Suomeen", "Alkon vertailuhinta") and
stating a dearer-than-Alko gap factually. Cards without the embed SHALL render
no gap UI at all (the render-nothing precedent of the €/g chip). In the
default order the page SHALL separate covered rows from uncovered rows with a
quiet divider labeled honestly ("Ei Alko-vertailua" / "No Alko reference");
other sort orders render a single undivided list. The catalog's product
universe SHALL exclude non-alcoholic rows — products with zero or unknown ABV
in an alcohol category, and rows held for review — through the same shared
predicate every listing surface uses.

#### Scenario: Catalog renders products with prices

- **WHEN** a visitor opens `/products` for a category with products
- **THEN** product cards SHALL render with their lowest offer price and merchant count and link to `/products/[id]`

#### Scenario: Default view orders alphabetically

- **WHEN** a visitor opens `/products` without a `sort` parameter
- **THEN** the first card is the largest current saving (gap basis points ascending, deterministic tie-breaks), every covered card shows its landed cost and Alko gap beside the "from" price, and the sort control's visible default matches

#### Scenario: Price ordering remains selectable

- **WHEN** a visitor opens `/products?sort=LOWEST_PRICE`
- **THEN** cards order by lowest current offer price ascending, offer-less products after all priced rows

#### Scenario: State is URL-addressable

- **WHEN** a visitor opens `/products?category=beer&page=2`
- **THEN** the server renders page 2 of the beer category directly from the URL

#### Scenario: Unknown category is forgiving

- **WHEN** the page is requested with an unrecognized category value
- **THEN** the unfiltered catalog view SHALL render instead of an error

#### Scenario: Card without a reference renders no gap UI

- **WHEN** a listed item has no savings embed
- **THEN** its card renders no landed-cost or gap element — no placeholder, no zero

#### Scenario: Dearer-than-Alko gap is stated factually

- **WHEN** a covered card's gap is positive (dearer than the Alko reference)
- **THEN** the card states the direction factually in both locales without editorial framing

#### Scenario: Uncovered rows sit behind an honest divider in the default order

- **WHEN** the default order renders both covered and uncovered rows
- **THEN** a quiet labeled divider separates the tiers, and uncovered rows follow it alphabetically

#### Scenario: Non-alcoholic rows are outside the catalog

- **WHEN** a product in an alcohol category has zero ABV, unknown ABV, or an active review hold
- **THEN** it renders nowhere in the catalog listing, and the product's detail page degrades consistently with the same predicate
