# SEO, AEO and agent surfaces

## Why

The product detail page renders almost no machine-readable signal: it carries zero
structured data (schema.org exists only for the site-level WebSite graph and curated
lists), its meta description is a bare template, the sitemap emits no `lastmod` for
product URLs, and blog/guide pages carry no article schema. Meanwhile the site's
genuine strengths — factual neutrality, per-observation timestamps, fast ISR-served
HTML, fully crawlable server content — are exactly what answer engines (ChatGPT,
Perplexity, Google AI Overviews) reward, and WebMCP reached real adoption in 2026
(ChatGPT desktop calls page-registered tools since 2025-08-25; Chrome/Edge origin
trial through 2027-03). The surface is crawlable but not yet quotable or callable.

## What Changes

- **Product JSON-LD (safe variant)**: `schema.org/Product` WITHOUT `Offer` — the
  stored `retail_offers` rows are collected observations, not merchant offers, and
  putting them in `Offer` would misrepresent them to rich-result consumers. The
  graph carries `brand`, `gtin13` only when an explicit-GTIN EAN exists,
  `additionalProperty` for volume/ABV/container/deposit-status, and `dateModified`
  from `product_master.updated_at`. Absent data renders absent properties, never
  placeholders.
- **BreadcrumbList JSON-LD plus a visible breadcrumb trail** (Home / catalog /
  product) in the shared product-page module, so the physical FI route and the
  `[locale]` route both inherit it.
- **Article/BlogPosting JSON-LD** on blog and guide pages.
- **Enriched localized meta title/description** for product pages, composed from
  stored attributes through the existing localized label formatters.
- **Deterministic product Q&A block**: two or three template-composed factual
  answers ("Paljonko X maksaa Suomessa?" style) derived from the same server
  payloads the page already renders — no LLM, content-lint tested, absent inputs
  drop the question. **FAQPage JSON-LD** mirrors only the visibly rendered pairs.
- **`/llms.txt` static route**: an index of public surfaces and methodology
  pointers, written from existing copy vocabulary.
- **Per-product Open Graph image**: `ImageResponse` rendered from product identity
  fields (name, brand, category) — no price, because the image outlives the 300 s
  price window.
- **MCP server at `/mcp` on the api-worker** (Cloudflare agents SDK): a closed,
  strictly read-only tool set — `search_products`, `get_product`,
  `calculate_landed_cost`. The age gate stays enforced at the API boundary: a
  confirmed session rides through, an unconfirmed caller receives the contract
  gate error. No write, no account, no PII tools.
- **WebMCP exposure** via the Cloudflare edge toggle (Agent Readiness > WebMCP,
  Site MCP Server pack pointing at `/mcp`) — zero origin code; hand-rolled
  `document.modelContext` registration stays the documented fallback. The
  dashboard toggle itself is an operator step, documented in the runbook.

## Capabilities

### New Capabilities
- `machine-readable-surfaces`: structured data, sitemap freshness, enriched
  metadata, deterministic Q&A, llms.txt, and per-product OG images — every
  emitted claim traceable to stored data, the safe no-Offer variant pinned.
- `agent-tool-surface`: the closed read-only MCP tool set at `/mcp` with
  age-gate semantics preserved and public-catalog-data-only exposure.

### Modified Capabilities

## Impact

- `apps/frontend`: shared product-page module (JSON-LD, breadcrumbs, Q&A block),
  new `lib/seo` structured-data builders, blog/guide metadata, sitemap, messages
  (fi/en), `llms.txt` route, per-route `opengraph-image.tsx`.
- `apps/api-worker`: new `mcp/` module wired in `index.ts`.
- `docs/`: runbook section for the Cloudflare WebMCP toggle and staging
  verification.
- No changes to excise math, ranking, landed-cost computation, cache windows, or
  alert semantics. ISR stays `revalidate = 300` untouched — structured data rides
  the cached HTML.

## Non-goals

- AI-generated product descriptions — removed from scope by owner decision;
  a separate future change if revisited.
- Product imagery sourcing (licensing).
- Write-capable MCP tools (conflicts with the calculator-not-a-shop boundary).
- Crawler-specific robots rules — the current allow-all posture is already the
  right AEO stance.
- Baking prices or other volatile figures into long-lived artifacts (OG images,
  llms.txt, Q&A copy beyond what the live page components already render).
