# product-catalog Specification

## Purpose
TBD - created by archiving change product-catalog. Update Purpose after archive.

## Requirements

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
other sort orders render a single undivided list.

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

### Requirement: Category filter over canonical values

The page SHALL offer a category filter consisting of an unfiltered option plus exactly the canonical category values, rendered as links with localized FI and EN labels. Selecting a category SHALL reset pagination to page 1.

#### Scenario: Filter row lists every canonical category

- **WHEN** the catalog page renders
- **THEN** the filter row SHALL contain an all-products option and one link per canonical category with locale-correct labels

#### Scenario: Filtering resets pagination

- **WHEN** a visitor switches category from page 3 of the unfiltered view
- **THEN** the category link SHALL target page 1 of that category

### Requirement: Pagination over the filtered catalog

The page SHALL paginate the filtered listing with pagination controls at a
fixed catalog page size, rendered as a windowed control: previous/next links,
the first and last page, a bounded window around the current page, and
ellipsis spans for the gaps — never one link per page. Pages beyond the
available range SHALL not be linkable, the current page SHALL render as a
non-link, and an empty result set SHALL render an honest empty state.

#### Scenario: Paging through results

- **WHEN** a category contains more products than one page
- **THEN** pagination controls link previous/next, first/last, and the bounded window around the current page, with the page-status sentence retained

#### Scenario: Honest empty state

- **WHEN** a category has no products
- **THEN** the page SHALL render the empty state rather than an empty grid or an error

#### Scenario: Large catalog renders a bounded control

- **WHEN** the filtered catalog spans hundreds of pages
- **THEN** the control renders only prev/next, first/last, the bounded window, and ellipsis spans — never an anchor per page

#### Scenario: Window slides with the current page

- **WHEN** a visitor pages deep into the catalog
- **THEN** the window follows the current page and the first/last anchors remain reachable

### Requirement: Neutral, factual presentation and discoverability

The catalog SHALL list products alphabetically (Finnish collation) and SHALL NOT rank, weight, or recommend; all displayed figures are factual per-product aggregates. The page SHALL be discoverable: a localized "Products" entry in the site header, per-category localized page metadata, a canonical URL per state, and sitemap inclusion of the base and category URLs.

#### Scenario: Ordering is neutral

- **WHEN** any catalog view renders
- **THEN** products appear in Finnish alphabetical order with no merchant weighting or promotional ordering

#### Scenario: Discoverability wired

- **WHEN** the site renders
- **THEN** the header links to `/products`, category views carry their own localized metadata and canonical URL, and the sitemap includes the base and category URLs

### Requirement: Current offer per merchant on product detail

The product detail response and page SHALL display at most one retail offer per merchant: the latest observed row for that (product, merchant), latest = greatest `observed_at` with `id` as tiebreak. Repeated scrapes of an unchanged price SHALL collapse into that single row carrying the current price and the last-observed date. Write-side storage SHALL remain append-per-scrape — the collapse is a read contract, and the scrape log keeps every check.

#### Scenario: Unchanged price collapses

- **WHEN** a merchant's price for a product is scraped repeatedly without changing
- **THEN** the product detail shows one row for that merchant with the price and the most recent observed date

#### Scenario: Price move supersedes

- **WHEN** a merchant's price for a product changes
- **THEN** the product detail shows the new price with the newer observation date, and only that row

#### Scenario: Lowest-price computation unaffected

- **WHEN** the best-price or unit-price embeds are computed from the deduped offer set
- **THEN** the results equal those computed over the full scrape log, because superseded rows for a merchant carry no lower price

### Requirement: Clickable merchant offers on product detail

Product-detail offers SHALL render the merchant as a clickable outbound call-to-action through `GET /api/v1/outbound/:offerId`, matching the compare page's existing outbound behavior. The CTA copy ("Katso kaupassa →" / "View at store →") SHALL make clear that the visitor is leaving Rajahinta. The merchant SHALL be presented under its registry display name where one exists, with the raw merchant identifier as fallback; the identifier remains the wire contract and the redirect/analytics key.

#### Scenario: Offer renders as an outbound CTA

- **WHEN** a product detail page lists an offer with a source URL
- **THEN** the offer renders a labelled call-to-action that routes through the outbound redirect controller for that offer id

#### Scenario: Click analytics stay intact

- **WHEN** a visitor follows the outbound CTA
- **THEN** the click records through the same redirect controller the compare page uses

#### Scenario: Registry display name shown, identifier preserved

- **WHEN** an offer's merchant has a display name in the merchant registry
- **THEN** the offer row (and the offer-facing merchant selects it feeds) presents the display name, while the outbound redirect, analytics, and API fields continue to use the merchant identifier

### Requirement: Stock availability display

Offers SHALL surface their stock status (`in_stock`, `low_stock`, `out_of_stock`) as a localized badge. Out-of-stock offers SHALL remain visible (price-history context) but SHALL be visually de-emphasized and SHALL be excluded from calculator and allowance-fill default selections. The badge reflects the last observed state with the existing reliability status and timestamp.

#### Scenario: Out-of-stock offer is de-emphasized and skipped by defaults

- **WHEN** a product's cheapest offer is out of stock and a cheaper-alternative default is assembled for the calculator
- **THEN** the offer renders with an out-of-stock badge in de-emphasized styling and is not selected as a default

### Requirement: Distance-selling status guidance

Each offer SHALL carry a status badge derived from the seller-country signal: Etämyynti (the merchant handles Finnish alcohol tax; no buyer steps) or Etäosto (the buyer arranges transport and declares excise; links to the etäosto guide). The badge SHALL be an additive display field that never enters a calculation or ranking input, and the guidance SHALL be framed as general information, not legal advice, in an empowering rather than warning tone.

#### Scenario: Estonian seller shows etäosto guidance

- **WHEN** an offer's seller country differs from FI
- **THEN** the offer renders the Etäosto badge with a link to the etäosto guide

#### Scenario: Badges never alter results

- **WHEN** calculation or ranking output is compared across zero, one, and many status badges present
- **THEN** the output is byte-identical in all cases (compliance-pinned)
