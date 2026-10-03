# web-application Specification

## MODIFIED Requirements

### Requirement: SEO surface

The frontend SHALL provide a sitemap, robots rules, and per-page metadata: per-product pages draw metadata from product data, and every other public route SHALL declare its own title and meta description through `generateMetadata`. The tool pages `calculator`, `compare`, `basket`, `trip`, `event`, `what-if`, `ranking`, and `value` SHALL NOT inherit the site-default title. Routes that must not be indexed (account, group order, ops, age gate) keep their `noindex` treatment. The sitemap SHALL NOT advertise an editorial index route (`/blog`, `/guides`, per locale) whose content store has no published entries for that locale — a route whose page answers 404 SHALL NOT appear in the sitemap — and SHALL advertise it again automatically once published content exists. Every URL the sitemap emits SHALL serve a renderable page.

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
