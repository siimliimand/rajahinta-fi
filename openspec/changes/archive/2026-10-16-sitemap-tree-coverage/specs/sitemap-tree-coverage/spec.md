# sitemap-tree-coverage Specification

## ADDED Requirements

### Requirement: Product enumeration endpoint

The API worker SHALL expose `GET /api/v1/products/ids` returning published products as id-ordered stable slices: request parameters `offset` (default 0) and `limit` (clamped to a maximum of 5,000), response `{ items: [{ id, lastmod }], total }`, items ordered by ascending product id. The endpoint SHALL sit behind the same server age-confirmation gate as the catalog reads. Each item's `lastmod` SHALL be `MAX(product_master.updated_at, latest retail_offers.observed_at)` for that product; when the offer-freshness aggregate is unavailable the endpoint SHALL fall back to `product_master.updated_at`; the endpoint SHALL NOT fabricate timestamps, and a read failure SHALL be an honest error response, never a synthesized payload.

#### Scenario: Ordered stable slices

- **WHEN** the endpoint is queried with successive offsets at the same limit
- **THEN** the items partition the catalog by ascending id with no overlap, and repeated queries return the same slices while the catalog is unchanged

#### Scenario: Limit clamp

- **WHEN** a request asks for limit greater than 5,000
- **THEN** the response serves at most 5,000 items rather than erroring or over-serving

#### Scenario: Truthful lastmod with fallback

- **WHEN** a product's freshest offer observation is later than its row update
- **THEN** lastmod reflects the offer observation; when the aggregate is unavailable, lastmod reflects `product_master.updated_at`; timestamps are never fabricated

#### Scenario: Read failure is honest

- **WHEN** the underlying read fails
- **THEN** the endpoint answers with an error status, never a partial or synthesized success payload

### Requirement: Sitemap index tree

The frontend SHALL serve `/sitemap.xml` as a sitemap index document whose children are: `pages` (the public static routes, the tax-change calendar pair, and the catalog base/category views, in both locales with hreflang alternates), `editorial` (the per-locale editorial index routes plus curated-list, blog, and guide slug URLs — present only when its content stores hold published entries, per the web-application content-gating requirement), and `products-0..N-1` (paired chunks: one child per ceil(total / 5,000), each carrying the fi+en URLs of one 5,000-product id-ordered slice with the enumeration endpoint's lastmod). The index SHALL reference only children that serve; any tree slug outside the served vocabulary — including a `products-N` chunk number at or past the derived chunk count — SHALL answer 404, never an empty or guessed document; a degraded enumeration read SHALL still serve the honest empty urlset (HTTP 200, no fabricated lastmod); the index and every child SHALL cache with ISR revalidate 900 seconds; `robots.txt` SHALL keep its single `Sitemap: https://rajahinta.fi/sitemap.xml` line.

#### Scenario: Index lists live children only

- **WHEN** the index is generated
- **THEN** every referenced child serves 200 `application/xml`, and the editorial child is absent while its content stores are empty

#### Scenario: Chunk shape is stable

- **WHEN** the catalog grows by new products
- **THEN** existing chunks keep their membership (ids are monotonic; new products land in the tail chunk) and the chunk count grows only when the total crosses a 5,000 boundary

#### Scenario: Unknown tree slug

- **WHEN** any path outside the defined tree vocabulary is requested under `/sitemaps/`
- **THEN** the response is 404, never an empty or guessed sitemap

#### Scenario: robots entry point unchanged

- **WHEN** `robots.txt` is served
- **THEN** it lists exactly the one `Sitemap:` line for `/sitemap.xml`
