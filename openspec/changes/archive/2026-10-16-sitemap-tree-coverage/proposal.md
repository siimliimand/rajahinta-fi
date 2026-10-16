# Sitemap tree coverage

## Why

The sitemap's structure is healthy — hreflang-correct, degradation-safe, test-pinned — but it was built for a catalog the site has outgrown. The live file advertises 100 of 20,839 products (0.5%): the per-product URLs come from `getServerProductListing()`, which reads `/api/v1/products?page=1&limit=100` and stops at the first page. It carries no `<lastmod>` on any of its 248 URLs, so crawlers get neither the catalog's long tail nor a freshness signal — on a site whose value proposition is changing prices, the missing lastmod costs as much as the missing URLs. The single-document shape has no room for either: full paired coverage (41,678 product URLs) would sit at 89% of the 50,000-URL protocol cap in one ~16 MB file.

## What Changes

- **Enumeration endpoint** (`apps/api-worker`): `GET /api/v1/products/ids` — id-ordered stable slices (`offset`/`limit`, limit clamped at 5,000), returning `{ items: [{ id, lastmod }], total }`, behind the same server age-confirmation gate as the catalog reads. `lastmod = MAX(product_master.updated_at, latest retail_offers.observed_at)` — truthful page-content freshness, with an honesty fallback chain (aggregate → `updated_at` → absent), never generation time.
- **Sitemap tree** (`apps/frontend`): `/sitemap.xml` becomes a hand-rolled `<sitemapindex>` (the metadata route `app/sitemap.ts` is replaced by Route Handlers); children: `pages` (static routes + tax-change calendar pair + catalog base/category views, bi-locale), `editorial` (curated lists, blog, guides slugs — omitted from the index while its content stores are empty, lifting the content-gating contract one level), and `products-0..N` — paired chunks: the fi+en URLs of one 5,000-product ID-ordered slice per file, chunk count derived from the enumerated total, chunk size never grows. Per-URL lastmod from the enumeration reader. ISR revalidate 900 s throughout; `robots.txt` unchanged (its single `Sitemap:` line).
- **Tests restructured**: the inventory-pin and alternates-honesty invariants move from one-document assertions to per-tree assertions — alternates co-located within a chunk, index references only live children, chunk membership stable across regenerations.

## Capabilities

### New Capabilities
- `sitemap-tree-coverage`: the product enumeration endpoint contract (ordered slices, clamped limit, truthful lastmod with fallback chain, honest failures) and the sitemap index-tree mechanics (children shape, paired 5,000-product chunks, index honesty, unknown-tree 404).

### Modified Capabilities
- `web-application`: the SEO surface requirement's sitemap clauses — the sitemap is served as an index tree whose index references only serving children; per-locale editorial index gating is preserved; per-URL lastmod is truthful or absent; product coverage is the whole published catalog, not a listing page.

## Impact

- `packages/data-platform`: one enumeration read (grouped MAX aggregate over `product_master` + `retail_offers` by ID slice).
- `apps/api-worker`: one route, `GET /api/v1/products/ids`, age-gated like the catalog reads.
- `apps/frontend`: `app/sitemap.ts` → `app/sitemap.xml/route.ts` + `app/sitemaps/[tree]/route.ts`; entry-builder extracted to `src/lib/sitemap-entries.ts`; enumeration reader in `src/lib/server-api.ts`; `app/sitemap.test.ts` restructured.
- `robots.txt`: unchanged — still `Sitemap: https://rajahinta.fi/sitemap.xml`.
- Public page routes, canonicals, and per-page hreflang metadata are untouched: the tree changes what crawlers are told, not what pages exist.

## Non-goals

- Page ≥ 2 catalog/category states stay unadvertised (existing deliberate decision — an infinite parameter space with no uniquely indexable value).
- Session-scoped and gated routes (account, group order, ops, age gate, share, auth flows) stay out; their noindex treatment is unchanged.
- Legacy-URL redirects: covered by the in-flight `legacy-url-redirect-strategy` change; no interaction (exact-path redirect table only).
- Search Console re-submission of the index: an operator action after deploy, recorded in the smoke notes — not code.
- Regenerating sitemap content on a faster cadence than the 900 s revalidation window.
