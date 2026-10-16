# web-application Specification

## MODIFIED Requirements

### Requirement: SEO surface

The frontend SHALL provide a sitemap, robots rules, and per-page metadata: per-product pages draw metadata from product data, and every other public route SHALL declare its own title and meta description through `generateMetadata`. The tool pages `calculator`, `compare`, `basket`, `trip`, `event`, `what-if`, `ranking`, and `value` SHALL NOT inherit the site-default title. Routes that must not be indexed (account, group order, ops, age gate) keep their `noindex` treatment. The sitemap SHALL be served as an index tree: `/sitemap.xml` SHALL be a sitemap index document referencing per-tree child sitemaps (`pages`, `editorial`, `products-N`), and the index SHALL reference only child trees that serve. The sitemap SHALL NOT advertise an editorial index route (`/blog`, `/guides`, per locale) whose content store has no published entries for that locale — a route whose page answers 404 SHALL NOT appear in the sitemap — and SHALL advertise it again automatically once published content exists. Every URL the sitemap emits SHALL serve a renderable page, and every emitted URL SHALL carry its localized hreflang alternates alongside it. Product URLs SHALL be enumerated across the chunked child sitemaps covering the whole published catalog in both locales — not capped to a listing page — and each product URL SHALL carry a `lastmod` that is a truthful content-change timestamp for that product, or no `lastmod` at all — never the sitemap generation time.

#### Scenario: Product page metadata

- **WHEN** a crawler fetches a product page
- **THEN** it SHALL receive title and description metadata specific to that product

#### Scenario: Each tool page has unique metadata

- **WHEN** the server renders any of the tool pages or `/value`
- **THEN** the HTML head carries that page's own title and description, distinct from the site default and from every other tool page

#### Scenario: Session-scoped pages stay unindexed

- **WHEN** the server renders account, group-order, ops, or age-gate pages
- **THEN** the noindex robots directive is present as before

#### Scenario: Empty content store omits the index route

- **WHEN** the sitemap is generated and no blog posts are published in a locale
- **THEN** that locale's `/blog` URL is absent from the sitemap while the rest of the static surface remains

#### Scenario: Published content restores the index route

- **WHEN** a blog post is published in a locale and the sitemap regenerates
- **THEN** that locale's `/blog` URL and the new post's slug URL both appear

#### Scenario: Degraded backend omits unverifiable index routes

- **WHEN** the blog or guide listing backend read fails during sitemap generation
- **THEN** the sitemap still renders, and the affected index route is omitted rather than advertised unverified

#### Scenario: The root is an index of live trees

- **WHEN** a crawler fetches `/sitemap.xml`
- **THEN** it receives a sitemap index referencing only child trees that serve — `pages`, the `products-N` chunks, and `editorial` when its content stores hold published entries

#### Scenario: Full catalog enumerated

- **WHEN** a crawler unions the product URLs across the `products-N` children
- **THEN** every published product is present in both locales, with no listing-page cap

#### Scenario: Paired chunks keep alternates co-located

- **WHEN** a product's fi and en URLs are advertised
- **THEN** both sit in the same child sitemap, each carrying the full alternates set with x-default → the bare fi URL

#### Scenario: Product lastmod is truthful or absent

- **WHEN** a `products-N` child is generated
- **THEN** each product URL's lastmod reflects that product's row or price freshness, and no URL carries the generation timestamp as lastmod
