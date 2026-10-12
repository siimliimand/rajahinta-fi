# Product page cold-latency

## Why

The `price-history-latency` change (merged 2026-10-11, PR #126) removed the request-path observation-log scan; the product page now renders in ~1.4–3.3 s from a North-American vantage (less for EU). A cold visit is still dominated by per-request SSR: the page re-renders and re-fetches four API endpoints on **every** visit because `/products/[id]` is `private, no-store`.

The cache-headers test records why: the page is a dynamic segment without `generateStaticParams`, and the earlier verdict ruled ISR out because "going ISR needs a build-time id catalog; CI builds without a reachable API — do not add a stub." That blocker does not apply to **on-demand ISR**: exporting `revalidate` on the page (default `dynamicParams = true`) renders on first visit and caches in the already-configured OpenNext R2 incremental cache — no build-time catalog, no stub. The `/account` page already establishes the house precedent for shared cached HTML: session state is a client fetch, and this page's personalized pieces (favorites, alerts) are already client components.

User-perceived goal: a cold visit to any product rendered in the last 5 minutes becomes an **edge/R2 cache hit (~0.05–0.15 s)**; a truly cold product becomes a **streamed render (~0.3–0.8 s EU)** with the shell flushing before the secondary sections.

## What Changes

1. **On-demand ISR for `/products/[id]`** — `export const revalidate = 300` on the page (explicit `dynamicParams = true`). First visitor per product per window triggers the blocking render; everyone else hits the incremental cache. This consciously supersedes the cache-headers test's per-request verdict for this route; the route moves from the per-request inventory to the ISR contract (`s-maxage=300` + `stale-while-revalidate`), the same shape `/account` already has. Compliance note: the old `no-store` was mechanical (per-request render), not age-gate policy — the age gate is a client-side overlay unaffected by shared HTML caching.
2. **Suspense streaming** — the page starts its four upstream fetches immediately (already true since price-history-latency 3.1) and passes **promises** to the three secondary sections (price-history chart, price-context line, dupes panel), each wrapped in `<Suspense fallback={null}>`. The shell and the primary content (name, master data, offers) flush as soon as the detail fetch resolves; secondary sections stream into the same response as their promises land. No spinners, no empty shells — a section is simply absent from the early stream when its data is late. Crawler-visible content is preserved (streamed HTML).
3. **SSR service binding** — a server-only `serverRequest()` routes the five public catalog reads (`getServerProductDetail`, `getServerProductListing`, price-history, price-context, dupes) through an `API_WORKER` service binding (`getCloudflareContext().env.API_WORKER.fetch`), eliminating the public edge hop per SSR fetch. Safe by the cookie argument: these reads carry only the fixed age-confirmation header, never session cookies; every session-carrying call stays on the URL base. Falls back to the URL base whenever the binding or worker context is unavailable (next dev, build, unit tests). With ISR absorbing render frequency, the fetch data-cache role for these reads shrinks to revalidation-time only — acceptable and recorded.
4. **D1 batch on the detail critical path** — `findByIdWithOffers(id)` on `D1ProductSearchRepository` using `DB.batch([...])`: the product row and its offer set arrive in **one** D1 round trip instead of two sequential ones. `getProduct` becomes: one batched call → one concurrent wave (merchant names ∥ warnings ∥ reliability). Response bytes identical.

## Non-goals

- R2 `appendLine` write-path read-modify-write pattern (own change).
- `attribution=auto` cost for the calculator panel (unchanged here; the page pins `attribution=none`).
- Client-side `<Link>` prefetch tuning for internal navigation flows.
- Any change to endpoint response contracts (bytes identical; the only wire-visible change is the page's `Cache-Control` header, test-pinned).

## Impact

- **Code:** frontend `products/[id]/page.tsx` (+ the two panel components, price-context/product-dupes helpers, `lib/api.ts`, new `lib/server-api.ts`), `cache-headers.test.ts` (route contract flip — the test's own docblock invites conscious extension of the pins), frontend `wrangler.jsonc` (+ per-env binding), api-worker `search.routes.ts`, data-platform `product-search.repository.ts` (+ tests).
- **Infra:** one `API_WORKER` service binding on the frontend Worker (dev/staging/production) — same-zone, no secrets.
- **Specs:** none — no API contract changes; the Cache-Control contract's home is the frontend test file, which this change updates deliberately (`skip_specs: true`).
- **Expected outcome:** warm-window cold visit ≈ edge hit (tens of ms); first-render-of-window ≈ streamed shell + secondary sections streaming; worst-case full render shrinks by the detail-handler batch and the removed edge hops.
