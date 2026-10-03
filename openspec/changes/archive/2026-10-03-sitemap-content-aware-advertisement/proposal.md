# Proposal: sitemap-content-aware-advertisement

## Why

`sitemap.xml` advertises four URLs that answer 404: `/blog`, `/en/blog`,
`/guides`, `/en/guides`. Verified live (2026-10-03): the sitemap lists them;
the pages return 404 because their content stores are empty (`/blog/posts` and
`/guides` serve `{"items":[],"total":0}`).

Both halves are behaving correctly *by their own specifications* — the pages
deliberately answer `notFound()` when their content store is empty (both page
files document "a crawler-honest 404 instead of an empty shell"), and the
sitemap's degradation contract emits static routes when backend reads fail.
The contradiction is that the sitemap's `STATIC_PATHS` hardcodes the editorial
index routes unconditionally, so the sitemap advertises pages whose existence
depends on content that does not exist. Two crawler-honest mechanisms, built by
different changes (page 404s: trust-and-reach-roadmap; sitemap static paths:
insight-surfaces), never reconciled. Search engines are being fed 404s for the
site's own advertised surface.

Scope correction from exploration: `/lists` also 404s (empty list catalog), but
the sitemap never advertised the lists index — only `/lists/{slug}` URLs drawn
from the catalog, which correctly yield zero URLs when the catalog is empty.
`/lists` is therefore out of scope. `/savings` and `/value` serve 200 and stay
advertised.

## What Changes

- The sitemap derives editorial index-page advertisement from the emptiness
  signal it ALREADY fetches (published blog slugs per locale, published guide
  slugs per locale): `/blog` is advertised iff any locale has at least one
  published blog slug; `/guides` iff any locale has at least one published
  guide slug. Zero new backend reads. Slug-level URLs are unchanged (they
  already derive from the same fetches and already yield zero when empty).
- The degradation contract is preserved exactly: a failed or unexpected backend
  read yields an empty slug list, which now also means the corresponding index
  route is omitted — the sitemap still never fails, and now also never
  advertises a route that would 404.
- Spec delta on `web-application` (SEO surface): the sitemap SHALL NOT
  advertise an index route whose content store is empty (the route answers
  404); advertisement SHALL resume automatically when published content
  exists.
- Change notes document the operational companion — content authoring through
  the (now bearer-armed) operator console republishes the index routes into the
  sitemap with no code change. Authoring itself is an owner act outside this
  change's scope.

## Capabilities

### Modified Specifications

- `specs/web-application/spec.md` — SEO surface: adds the empty-content index
  advertisement invariant.
