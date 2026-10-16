# Design

## Context

Exploration findings (2026-10-16, production): `/sitemap.xml` serves 248 URLs (96 KB) from the Next 15.5 metadata route `apps/frontend/src/app/sitemap.ts` behind OpenNext on Cloudflare (ISR `revalidate = 900`, `x-nextjs-cache: HIT`). Product URLs come from `getServerProductListing()` → `/api/v1/products?sort=ALPHABETICAL&page=1&limit=100`; the catalog total is 20,839 (API `total` field, stable across pages). Blog and curated lists are empty in production — their index URLs are correctly absent per the content-gating contract (`sitemap-content-aware-advertisement`); one guide is published and advertised. `robots.txt` carries the single `Sitemap:` line. The existing test suite pins the public-route inventory, per-URL alternates honesty (every alternate target is emitted; x-default → the bare fi URL), and the degradation contract. Spot-check confirmed the sitemap's pairing equals what product pages render (`/tuotteet/1487` canonical + alternates). Next 15 offers `generateSitemaps()` (numeric chunk URLs, no index document) and nested sitemap metadata routes; neither produces a descriptive tree or an index document, so the index is hand-rolled either way.

## Goals / Non-Goals

**Goals:**
- Every published product URL (both locales) enumerated in the sitemap, chunked well within protocol limits.
- Truthful per-product `lastmod`, so index-level freshness differentiates changed slices from untouched ones.
- Preserve intact: the degradation contract, hreflang pairing honesty, per-locale content-gated editorial advertisement, and the single `robots.txt` entry point.

**Non-Goals:**
- Page ≥ 2 states, session-scoped routes, or a faster regeneration cadence.
- Changing any page's canonical/hreflang page metadata — the tree's pairing mirrors what pages already render.

## Decisions

- **D1 — Paired chunks, not locale-split.** `products-N.xml` holds the fi+en URLs of one product slice. This preserves the alternates-honesty invariant in its strongest form (every alternate target sits in the same chunk), matches the generator's existing group-by-route emission (chunking the emitted array by ID slice is a near-mechanical diff), and keeps the tree uniformly bi-locale (`pages` and `editorial` are inherently bi-locale). Cross-file hreflang is protocol-legal, but locale-split would turn the honesty tests into cross-document audits and double the file count for no operational gain — Search Console stats filter fine by URL prefix.
- **D2 — 5,000 products per chunk.** ~10,000 URLs, ~4 MB per file — far under the 50,000-URL / 50 MB caps. Chunk *count* grows with the catalog; chunk *size* never does (20,839 → 5 chunks; 100k products → 20 chunks of the same size). Finer index-level lastmod granularity matches the actual change pattern (batchy: monthly Alko price lists plus rolling merchant syncs), so "this slice changed, that one didn't" is real signal. Same bounded-chunk philosophy as the sitemap-crawl adapter's ≤300-fetch chunks.
- **D3 — ID-ordered offset slicing, never alphabetical.** `product_master.id` is a monotonic `serial`: new rows always land at the tail, so slice membership is frozen across regenerations and per-chunk lastmod stays meaningful. Alphabetical (Finnish collation) order shifts as products arrive and would migrate URLs between chunks on every regeneration. Known trade-off: a product *deletion* shifts offsets by one position — URLs never leave the advertised set, they just move chunks, and crawlers re-read the index each cycle; accepted.
- **D4 — Index honesty: the degradation contract, lifted one level.** The `<sitemapindex>` references only children that serve: the `editorial` tree is absent from the index while its stores are empty, and a degraded backend read never produces a dead reference — stale chunks keep serving under ISR (900 s) until content returns. The sitemap never fails, as before; the honesty bar just rises one level.
- **D5 — Truthful lastmod, gated.** `lastmod = MAX(product_master.updated_at, latest retail_offers.observed_at)` — product-row change or freshest observed price, whichever is later; both are page-content truths for a product page. Fallback chain: the aggregate proves too costly on D1 at slice scale → `updated_at` alone (coarser, still truthful); `updated_at` proves untrustworthy (never bumped by ingestion) → lastmod drops from scope and coverage ships alone. Regeneration time is forbidden: Google discounts lastmod that always equals fetch time, and it would be a fabricated signal.
- **D6 — Hand-rolled index over `generateSitemaps()`.** Next's built-in multi-sitemap yields opaque numeric URLs (`/sitemap/0.xml`), no index document, and one function owning the whole tree (static pages would live in chunk 0, mixing concerns). The index document is ~15 lines of XML through a small tested serializer; the descriptive tree (`pages`, `editorial`, `products-N`) is the operational win worth that surface. An unknown tree slug 404s; ISR revalidate 900 s applies to index and children alike.

## Risks / Trade-offs

- [MAX aggregate cost on D1 for a 5,000-ID slice] → task 1.1 measures it; the D5 fallback chain bounds the damage (`updated_at`-only is a single indexed column read), and chunking at 5,000 keeps every query bounded.
- [OpenNext serving the new Route Handlers (`/sitemap.xml`, `/sitemaps/[tree]`)] → route handlers are first-class in OpenNext; verified by the `next build` output (4.1) and the staging smoke (4.2) before operator hand-off.
- [Google reprocessing window during the urlset → index swap] → sitemap URLs are not page URLs; no redirects are involved; the robots.txt entry point is unchanged. Worst case is a brief informational-only reprocessing of children that were already known.
- [Editorial tree absent while empty could look like a regression] → it is the existing content-gating contract extended one level: a 404ing `/blogi` was never advertised, and now an empty tree is never referenced either. Publishing through the operator console re-adds it within one regeneration window, no code change.
