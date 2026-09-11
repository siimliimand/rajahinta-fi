# product-catalog Specification

## Purpose
TBD - created by archiving change product-catalog. Update Purpose after archive.
## Requirements
### Requirement: Browsable catalog page

The site SHALL provide a server-rendered catalog page at `/products` listing products as cards (name, brand, category, ABV, unit volume, lowest offer price, merchant count), each card linking to the product's detail page. Page state — category and page number — SHALL live in the URL query string, and every filter and pagination control SHALL be a plain link so the page renders and crawls without client-side JavaScript. Unknown category parameter values SHALL render the unfiltered view.

#### Scenario: Catalog renders products with prices

- **WHEN** a visitor opens `/products` for a category with products
- **THEN** product cards SHALL render with their lowest offer price and merchant count and link to `/products/[id]`

#### Scenario: State is URL-addressable

- **WHEN** a visitor opens `/products?category=beer&page=2`
- **THEN** the server renders page 2 of the beer category directly from the URL

#### Scenario: Unknown category is forgiving

- **WHEN** the page is requested with an unrecognized category value
- **THEN** the unfiltered catalog view SHALL render instead of an error

### Requirement: Category filter over canonical values

The page SHALL offer a category filter consisting of an unfiltered option plus exactly the canonical category values, rendered as links with localized FI and EN labels. Selecting a category SHALL reset pagination to page 1.

#### Scenario: Filter row lists every canonical category

- **WHEN** the catalog page renders
- **THEN** the filter row SHALL contain an all-products option and one link per canonical category with locale-correct labels

#### Scenario: Filtering resets pagination

- **WHEN** a visitor switches category from page 3 of the unfiltered view
- **THEN** the category link SHALL target page 1 of that category

### Requirement: Pagination over the filtered catalog

The page SHALL paginate the filtered listing with pagination controls at a fixed catalog page size. Pages beyond the available range SHALL not be linkable, and an empty result set SHALL render an honest empty state.

#### Scenario: Paging through results

- **WHEN** a category contains more products than one page
- **THEN** pagination controls SHALL link to the available adjacent and numbered pages

#### Scenario: Honest empty state

- **WHEN** a category has no products
- **THEN** the page SHALL render the empty state rather than an empty grid or an error

### Requirement: Neutral, factual presentation and discoverability

The catalog SHALL list products alphabetically (Finnish collation) and SHALL NOT rank, weight, or recommend; all displayed figures are factual per-product aggregates. The page SHALL be discoverable: a localized "Products" entry in the site header, per-category localized page metadata, a canonical URL per state, and sitemap inclusion of the base and category URLs.

#### Scenario: Ordering is neutral

- **WHEN** any catalog view renders
- **THEN** products appear in Finnish alphabetical order with no merchant weighting or promotional ordering

#### Scenario: Discoverability wired

- **WHEN** the site renders
- **THEN** the header links to `/products`, category views carry their own localized metadata and canonical URL, and the sitemap includes the base and category URLs

