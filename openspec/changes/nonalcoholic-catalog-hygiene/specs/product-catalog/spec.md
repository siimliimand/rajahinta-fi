# product-catalog Delta

## MODIFIED Requirements

### Requirement: Browsable catalog page

The site SHALL provide a server-rendered catalog page at `/products` listing products as cards (name, brand, category, ABV, unit volume, lowest offer price, merchant count), each card linking to the product's detail page. Page state — category, page number, and sort order — SHALL live in the URL query string, and every filter, sort, and pagination control SHALL be a plain link so the page renders and crawls without client-side JavaScript. The catalog SHALL default to `LOWEST_PRICE` ordering: the view a first-time visitor lands on leads with the lowest current prices, offer-less products after all priced rows. Unknown category parameter values SHALL render the unfiltered view; unknown sort values SHALL render the default price ordering. The catalog's product universe SHALL exclude non-alcoholic rows — products with zero or unknown ABV in an alcohol category, and rows held for review — through the same shared predicate every listing surface uses.

#### Scenario: Catalog renders products with prices

- **WHEN** a visitor opens `/products` for a category with products
- **THEN** product cards SHALL render with their lowest offer price and merchant count and link to `/products/[id]`

#### Scenario: Default view orders by price

- **WHEN** a visitor opens `/products` without a `sort` parameter
- **THEN** cards order by lowest current offer price ascending, offer-less products after all priced rows, and the first card is not an artifact of lexicographic name ordering

#### Scenario: State is URL-addressable

- **WHEN** a visitor opens `/products?category=beer&page=2`
- **THEN** the server renders page 2 of the beer category directly from the URL

#### Scenario: Unknown category is forgiving

- **WHEN** the page is requested with an unrecognized category value
- **THEN** the unfiltered catalog view SHALL render instead of an error

#### Scenario: Non-alcoholic rows are outside the catalog

- **WHEN** a product in an alcohol category has zero ABV, unknown ABV, or an active review hold
- **THEN** it renders nowhere in the catalog listing, and the product's detail page degrades consistently with the same predicate
