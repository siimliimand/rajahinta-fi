# Design: sitemap-content-aware-advertisement

## Context

The sitemap (`apps/frontend/src/app/sitemap.ts`) serves two URL families:
static navigation routes from the hardcoded `STATIC_PATHS` array, and dynamic
slug URLs (products, list slugs, blog slugs, guide slugs) drawn from backend
reads that all degrade to empty on failure. The dynamic families are already
content-gated by construction — no published posts means zero `/blog/{slug}`
URLs. The editorial index routes (`/blog`, `/guides`) live in `STATIC_PATHS`,
so they are advertised regardless of content state, while the pages themselves
answer `notFound()` when their catalog is empty. Production (2026-10-03): all
three content stores are empty, so the sitemap advertises exactly four
dead URLs per generation (`/blog`, `/en/blog`, `/guides`, `/en/guides`).

## Decisions

### D1 — Derive advertisement from the slug fetches already in hand

`sitemap()` already fetches blog slugs per locale and guide slugs per locale
(`getServerBlogSlugs` / `getServerGuideSlugs`, revalidate 900). The index route
for a family is advertised iff the union over locales of its slug lists is
non-empty. No new fetch, no new backend endpoint, no feature flag. The
predicate lives next to the entry construction in `sitemap()` so the invariant
is visible in one screen.

Alternative rejected: probing each index page with a HEAD/GET fetch to learn
whether it 404s — a second network round-trip that duplicates information the
slug fetches already carry, and a new failure mode inside sitemap generation.

Alternative rejected: serving empty-state index pages (200 with "no posts
yet") instead of `notFound()` — that changes the pages' deliberate
crawler-honest contract, which is correct and out of scope.

### D2 — Any-locale union, not per-locale advertisement

`/blog` is a navigation-surface route rendered per locale from one content
store per locale (`blog_posts.locale`). A Finnish post alone makes the Finnish
`/blog` render content — but the index page in the OTHER locale may still 404.
The sitemap advertises the index route for a locale exactly when THAT locale's
slug list is non-empty (per-locale gate on the index URL, mirroring how slug
URLs are already per-locale). The union rule applies only to deciding whether
the family is "alive" for navigation-consistency purposes; the URL-level gate
is per locale. This is the tightest honest invariant: every advertised URL
serves.

### D3 — Degradation semantics unchanged in kind, tightened in effect

On backend failure the slug fetches degrade to `[]`, so a degraded backend now
also omits the editorial index routes it cannot verify. That is the existing
contract's own logic ("a catalog without published entries yields zero dynamic
URLs — the sitemap degrades to inert") extended to the two index routes; the
sitemap still always returns a valid sitemap. The existing test
`sitemap.test.ts` pins static-routes-only degradation for catalog/list
fetches; the new tests pin the same behavior for blog/guide fetches.

## Risks

- A transient blog-backend failure during one 900 s revalidation window drops
  `/blog` from the sitemap for that window. Accepted: the same transient
  already drops every `/blog/{slug}` URL today, and sitemap churn of this kind
  is routine for crawlers.
- If the blog page's emptiness predicate ever diverges from "zero published
  slugs" (e.g. the page renders with a future-dated post the listing endpoint
  filters out), the sitemap could advertise a 404 again. The change notes pin
  the shared predicate as the invariant both sides must agree on.
