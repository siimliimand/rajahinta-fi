# Change notes: sitemap-tree-coverage — staging deploy + live smoke (task 4.2)

- Performed: 2026-10-16
- Branch: `feature/sitemap-tree-coverage`
- Scope: dispatch the staging deploy for the sitemap tree, run the live
  smoke matrix against the staging origin, record the Search Console
  re-submission step for the operator. Staging only; nothing production.

## Deploy mechanism and safety gate

The staging deploy mechanism is the GitHub Actions workflow
`.github/workflows/deploy-staging.yml` (push to `master`, or
`workflow_dispatch` with an explicit `--ref`; dispatching a feature
branch is the established pattern — cf. the `feature/calendar-event-
automation` run of 2026-10-16). The job checks out the git ref with
`actions/checkout@v4` and never reads the local worktree, so the
**uncommitted, unrelated edit in `infra/environments/staging.yaml`
carried by this worktree cannot ship**. Gate result: safe to dispatch.
Branch `feature/sitemap-tree-coverage` was pushed (it existed only
locally) so the ref could be dispatched; the push contains committed
work only.

## What shipped

Two staging deploys were dispatched (both end-to-end green: migrate →
seed → deploy API/email → OpenNext build → deploy frontend → health
gate 200):

1. Run [`38936095798`](https://github.com/siimliimand/rajahinta-fi/actions/runs/38936095798)
   — SUCCESS, 3m03s. Smoke: the new `/sitemap.xml` sitemapindex served
   (200 `application/xml`, correct namespaces), but **every tree child
   (`/sitemaps/*`) returned the Next 404 page**. Root cause: the i18n
   middleware matcher `'((?!api|_next|_vercel|.*\..*|tuotteet/[^/]+).*)'`
   exempts dot-paths (so `/sitemap.xml` reached its Route Handler) but
   not `/sitemaps/<tree>`; the locale negotiation treats `sitemaps` as
   a page pathname (it is not in `routing.pathnames`) and 404s before
   the Route Handler runs. The 4.1 verification (typecheck/suites/
   `next build`) could not catch this — it is a runtime routing
   behavior, visible only on a deployed worker.
2. Run [`38937664048`](https://github.com/siimliimand/rajahinta-fi/actions/runs/38937664048)
   — SUCCESS, 2m03s, after the fix (commit `fef49cf`): the matcher now
   also excludes `sitemaps/[^/]+` — the same literal-URL ISR rationale
   as the `tuotteet/[^/]+` exclusion — with the matcher literal re-pinned
   and the sitemap-tree exclusions asserted in `src/middleware.test.ts`
   (frontend suite 1750 green, typecheck + eslint green). Smoke: 12/12
   PASS (matrix below).

## Staging smoke matrix (origin `https://rajahinta-frontend-staging.siim-liimand.workers.dev`)

Staging has no custom-domain DNS (`staging.rajahinta.fi` does not
resolve), so requests go to the workers.dev origin; documents advertise
`https://rajahinta.fi` URLs because staging builds without
`NEXT_PUBLIC_SITE_URL` (`SITE_URL` falls back to the production base) —
byte-identical to the pre-change metadata route, i.e. the established
staging convention, not a regression. Children are verified by
host-rewriting each advertised `<loc>` onto the staging origin.

Staging catalog reality: `GET /api/v1/products/ids` reports
**total = 9,703** (with the public age-gate confirmation header, exactly
as the frontend server reader sends it) → `ceil(9703 / 5000)` = **2
product chunks**. The task brief's "≈20,839 → 5 chunks" expectation is
the production-data figure; on staging the honest chunk count is 2, and
the acceptance criterion "chunk count matches the catalog total at the
5,000 chunk size" is checked against the real total.

| # | Check | Result | Evidence |
| - | ----- | ------ | -------- |
| 1 | `GET /sitemap.xml` → 200, `application/xml`, `<sitemapindex>` with namespaces | PASS | HTTP 200, `content-type: application/xml`, sitemap-0.9 namespace present, `<sitemapindex>` root |
| 2 | Every `<loc>` child → 200 `application/xml` | PASS | all 3 children 200 `application/xml` (none 404 — D4) |
| 3 | Child set = `pages` + `products-0..ceil(total/5000)-1` | PASS | exactly `pages`, `products-0`, `products-1` for total 9,703; no unexpected, none missing |
| 3b | Editorial honesty: referenced ⟺ stores hold published content | PASS | `/sitemaps/editorial` serves 200 with 0 URLs and is **not** referenced — absent-while-empty is the content-gating contract, not a regression |
| 4 | `products-0` shape: `<urlset>`, paired fi/en, alternates | PASS | 5,000 fi (`/tuotteet/{id}`) + 5,000 en (`/en/products/{id}`), every entry carries x-default/fi/en `xhtml:link` alternates |
| 4b | Truthful `<lastmod>` (ISO, sweep dates, never build time) | PASS | 10,000 ISO values spanning `2026-08-31T18:29:50Z`..`2026-10-08T23:59:58Z` — the staging sweep dates (90-day window), not the 2026-10-16 deploy moment |
| 5 | Tail chunk serves its remainder exactly | PASS | `products-1` = 9,406 URLs = 2 × 4,703 remainder products (exact) |
| 5b | Chunk at/past the count → 404 | PASS | `products-2`, `products-4`, `products-5` all 404 (staging count is 2; the brief's literal `products-5` case included) |
| 5c | Unknown slug → 404 | PASS | `/sitemaps/nope` → 404 (Route Handler `notFound()`, never an empty document) |
| 6 | `robots.txt`: exactly one `Sitemap:` line → `/sitemap.xml` | PASS | single line `Sitemap: https://rajahinta.fi/sitemap.xml` |
| 7 | Product-chunk URL union = 2 × total | PASS | 19,406 = 2 × 9,703 (delta 0; chunks 0: 10,000, 1: 9,406) |

**Smoke matrix: 12/12 PASS.** Both deploys' health gates (staging
`/api/v1/health/ready` → 200) confirm OpenNext serves the new Route
Handlers cleanly after the matcher fix.

## Operator hand-off — Search Console re-submission

After this branch reaches production (merge → the same workflow deploys
`master`), re-submit the sitemap in Google Search Console:

1. GSC → the `rajahinta.fi` property → **Sitemaps**.
2. `https://rajahinta.fi/sitemap.xml` is already known to GSC (it was
   the flat sitemap URL before this change); enter it and press
   **Submit** (a re-submission request is enough — the URL is unchanged).
3. GSC will now discover the sitemapindex children (`pages`,
   `products-0..N-1`, and `editorial` once editorial content exists).
   Expect "Discovered URLs" to grow by ~2 × catalog total; the child
   set it reports should match the index exactly (any "couldn't fetch"
   on a child is a regression — the index only references live children,
   D4).

No robots.txt change is needed: the single `Sitemap:` line already
points at `/sitemap.xml`.

## Residual notes

- **Staging chunk count is 2, not 5** — driven by the staging catalog
  total (9,703). This is the honest enumeration behavior (chunk count
  derives from the live total), verified exactly at the remainder
  boundary. The 5-chunk shape will appear on production if its catalog
  total is ≈20,839.
- **Editorial child absent on staging** — its stores (curated lists,
  blog, guides) hold no published entries on staging, so the index
  omits it and the route serves an honest empty `<urlset>`. That is the
  content-gating contract (D4), not a regression.
- **Advertised URLs use the production base on staging** — pre-existing
  build convention (`NEXT_PUBLIC_SITE_URL` unset in staging build vars),
  unchanged by this branch; noted so nobody mistakes it for a sitemap
  bug when re-checking staging.
- The middleware matcher fix (commit `fef49cf`) is covered by the
  re-pinned literal test plus new exclusion assertions — the same
  drift-catch pattern the fi-path-isr task established.
