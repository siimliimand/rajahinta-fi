# machine-readable-surfaces Specification

## Purpose

Make the product page and its supporting surfaces quotable by search engines and
answer engines: structured data that never misrepresents collected observations as
offers, sitemap freshness that tracks master data rather than price churn, and
deterministic factual Q&A that gives answer engines a clean citation target —
every emitted claim traceable to stored data.

## ADDED Requirements

### Requirement: Product structured data without offer semantics

Every served product page (the physical FI route and the `[locale]` route) SHALL
embed `schema.org/Product` JSON-LD built from stored master data. The graph SHALL
NOT contain an `Offer`, `AggregateOffer`, `AggregateRating`, or any review-type
property: `retail_offers` rows are collected observations, not merchant offers.
The graph SHALL carry `name`, `brand` when present, `gtin13` only when the product
row has an explicit-GTIN EAN, `additionalProperty` entries for volume, ABV,
container type, and deposit-system status rendered through the shared localized
formatters (an absent or unparseable value contributes no entry), and
`dateModified` from `product_master.updated_at`. No property MAY be fabricated to
fill the graph.

#### Scenario: Crawler receives the product graph on both routes

- **WHEN** the FI `/tuotteet/<id>` page or the EN `/en/products/<id>` page is
  server-rendered
- **THEN** the initial HTML contains the `application/ld+json` product graph with
  the product's stored name, brand, and attributes

#### Scenario: No offer semantics in the graph

- **WHEN** the product graph is serialized
- **THEN** it contains no `Offer`, `AggregateOffer`, `AggregateRating`, or review
  property even when the product has observed price rows

#### Scenario: Absent attributes stay absent

- **WHEN** a product has no EAN or an unparseable ABV
- **THEN** the graph omits `gtin13` and the corresponding `additionalProperty`
  entry instead of emitting a placeholder

### Requirement: Breadcrumb structured data and visible trail

Product pages SHALL embed a `BreadcrumbList` JSON-LD (site home, localized catalog
URL, the product URL) and render a visible breadcrumb trail linking the same
destinations, localized per serving locale.

#### Scenario: Localized breadcrumb pair

- **WHEN** the FI and EN product pages render
- **THEN** each carries the breadcrumb JSON-LD and visible links matching its
  locale's URL vocabulary

### Requirement: Sitemap lastmod parity (verification only)

Product-URL `lastmod` SHALL remain governed by the shipped `sitemap-tree-coverage`
capability (the enumeration endpoint's truthful lastmod). This change SHALL NOT
introduce a competing lastmod contract; verification confirms the structured-data
work composes with the existing sitemap tree without touching it.

#### Scenario: Structured-data work leaves the sitemap tree untouched

- **WHEN** the change's frontend modifications are applied and the sitemap suites
  run
- **THEN** no source under the sitemap index tree (`apps/frontend/src/app/sitemap.xml/**`,
  `apps/frontend/src/app/sitemaps/**`, `apps/frontend/src/lib/sitemap-xml.ts`,
  `apps/frontend/src/lib/sitemap-entries.ts`) is modified and the sitemap suites
  pass unchanged

### Requirement: Enriched localized product metadata

Product-page meta title and description SHALL be composed from stored attributes
(brand, category label, volume, ABV) through the existing localized catalog
formatters, in both locales. The degraded (unavailable-detail) fallback metadata
SHALL remain exactly as today.

#### Scenario: Metadata carries identifying attributes

- **WHEN** a product page resolves its detail payload
- **THEN** the title and description include the stored brand, localized category
  label, volume, and ABV where present

### Requirement: Deterministic product Q&A block

Product pages SHALL render a Q&A block of two to three questions whose answers are
composed by page templates from the same server payloads the page already renders
(price context, master attributes). No LLM or external text generation MAY
participate. Answers SHALL pass the content lint (no advice phrasing, no
promotional vocabulary). A question whose input payload is absent or degraded
SHALL be absent from the block — absent, never a placeholder or an empty shell.

#### Scenario: Price question only with price context

- **WHEN** the price-context payload resolves to null
- **THEN** the price question and its answer are absent from the block while the
  attribute questions still render

#### Scenario: Answers stay within the content policy

- **WHEN** the Q&A copy is linted
- **THEN** no banned adjective or advice phrasing is present

### Requirement: FAQPage schema mirrors visible content only

The product page MAY embed `FAQPage` JSON-LD only when a Q&A block is rendered,
and the schema's question/answer pairs SHALL equal the visibly rendered pairs —
no invisible or extra schema content.

#### Scenario: Schema equals rendered pairs

- **WHEN** the FAQPage graph is serialized
- **THEN** its pairs match one-to-one the questions and answers rendered in the
  visible block, in the same language

### Requirement: llms.txt index of public surfaces

A static `/llms.txt` route SHALL return a plain-text index of the public surfaces
(products, calculator, guides, methodology) and their URLs. Its copy SHALL reuse
existing methodology vocabulary, pass the content lint, and contain no volatile
figures.

#### Scenario: Agent-readable index

- **WHEN** `/llms.txt` is fetched
- **THEN** it returns `text/plain` listing the public surfaces with absolute URLs

### Requirement: Per-product Open Graph image

The product routes SHALL render a per-product OG image via `ImageResponse` from
product identity fields (name, brand, category label). The image SHALL NOT contain
prices or timestamps, because the image is cached far longer than the 300 s price
window. Optional fields that are absent SHALL degrade the composition without
failing the render.

#### Scenario: Identity-only composition

- **WHEN** the OG image for a product is generated
- **THEN** it contains the product name and brand and no price, availability, or
  observation-date content
