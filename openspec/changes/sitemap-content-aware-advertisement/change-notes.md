# Change notes — sitemap-content-aware-advertisement

## What shipped

The frontend sitemap (`apps/frontend/src/app/sitemap.ts`) no longer advertises the editorial index routes into emptiness. The per-locale slug fetches the sitemap already performs (`getServerBlogSlugs` / `getServerGuideSlugs`, revalidate 900 — no new backend reads, design D1) now gate the index URLs inside the static-path loop: a locale's `/blog` is emitted only when that locale's blog slug fetch returned at least one published slug, and likewise `/guides` against guide slugs (per-locale gate, design D2 — a Finnish post alone advertises `/blog`, not `/en/blog`). While all three content stores are empty (the verified production state, 2026-10-03), the four previously-advertised dead URLs — `/blog`, `/en/blog`, `/guides`, `/en/guides` — are omitted, and every remaining URL in the sitemap serves a renderable page. Slug-level URLs were already content-gated by construction and are unchanged.

The degradation contract is preserved in kind and tightened in effect (design D3): a failed or unexpected backend read still degrades to an empty slug list, which still yields a valid sitemap — and now also omits the index route that could not be verified. The sitemap can therefore never advertise a URL it has not seen evidence for. The spec delta (task 1.2, `specs/web-application/spec.md` under `web-application` → SEO surface) pins this as the invariant: an editorial index route whose content store has no published entries for a locale SHALL NOT be advertised, advertisement SHALL resume automatically once content exists, and degraded reads SHALL omit unverifiable index routes.

## Verification (this change)

- Full frontend vitest suite (`pnpm test` → `vitest run`, Node v24.21.0): **102 test files, 1177 tests, all passed, exit 0** — including the extended `src/app/sitemap.test.ts` (12 tests) covering the new gates: empty blog slugs → `/blog` omitted while other static routes remain; non-empty → index advertised alongside slug URLs; guide-family parity; degraded blog/guide fetch → index omitted.
- Production build (`pnpm build` → `next build`): **exit 0**, `/sitemap.xml` prerendered static with `15m` revalidate (the 900 s regeneration window below) and `1y` assets cache; `/fi/savings`, `/en/savings`, `/fi/value`, `/en/value` all present in the build output.

## Post-deploy live checks (owner-runnable)

Run after the frontend deploy lands. The fix is live as soon as the deployed `/sitemap.xml` regenerates.

**1. The dead URLs are gone.** When the content stores are empty the sitemap contains **no `/blog` or `/guides` URLs at all** — neither index (`/blog`, `/en/blog`) nor slug URLs — so substring counting is safe: `/blog` as a substring also matches `/en/blog` and `/blog/{slug}`, so `0` proves every variant is gone.

```bash
curl -s https://www.rajahinta.fi/sitemap.xml | grep -c "/blog"     # expected: 0
curl -s https://www.rajahinta.fi/sitemap.xml | grep -c "/guides"   # expected: 0
```

(`grep -c` exits 1 on zero matches — that non-zero exit **is** the passing result.) The rest of the static surface must remain: `/calculator`, `/compare`, `/basket`, `/trip`, `/event`, `/what-if`, `/value`, `/products`, `/ranking`, `/allowances`, `/savings`, `/about`, `/contact` (plus `/`), each per locale.

**2. The still-advertised routes still serve.** `/savings` and `/value` stay in `STATIC_PATHS` unconditionally and must keep answering 200, renderable:

```bash
for p in /savings /en/savings /value /en/value; do
  printf '%s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://www.rajahinta.fi$p)"
done   # expected: 200 on every line
```

A transient blog/guide backend failure can drop `/blog` (or `/guides`) from one regeneration window even after content exists — that is the degradation contract working, not an incident (design Risks; the same transient already dropped every slug URL before this change).

## The operational companion — authoring re-advertises, no code change

The index routes come back by themselves when content exists. Publishing through the operator console (`/ops/console/*` surfaces, bearer-gated by `OPS_BEARER_TOKEN`, now armed in production; constant-time comparison, fail-closed 403 — `apps/api-worker/src/middleware/ops-access.ts`) writes a `PUBLISHED` row, and the next sitemap regeneration — within the 900 s revalidation window — emits that locale's index URL alongside the new slug URL. No code change, no deploy, no flag.

- **Guides:** `POST /ops/console/blog/guides` creates a GUIDE-kind draft, `POST /ops/console/blog/guides/:id` edits it, and `POST /ops/console/blog/posts/:id/publish` flips DRAFT → PUBLISHED (both kinds live in `blog_posts`; the publish endpoint is shared). The transition is lint-gated: a body violating the content policy is rejected 400 and stays a draft; a non-draft id is 409 (`PUBLISHED` is terminal); an unknown id is 404. Each publish writes an `audit_events` entry.
- **Blog posts:** rate-change posts are created automatically as FI + EN DRAFT rows by the repository when a rate dataset lands (fail-open draft creation, `packages/data-platform/src/repositories/d1/blog-post.repository.ts` header) — the owner's act is reviewing and `POST /ops/console/blog/posts/:id/publish` per id.

The gate reads the same store the pages read: the page answers `notFound()` exactly when its locale's published listing is empty (`apps/frontend/src/app/[locale]/blog/page.tsx`, `.../guides/page.tsx`), and the sitemap advertises exactly when that listing is non-empty. **Shared predicate invariant:** if either side ever changes its emptiness predicate (e.g. the page renders a future-dated post the listing endpoint filters out), the sitemap could advertise a 404 again — both sides must keep agreeing on "zero published slugs for the locale ⇔ no page". Content authorship itself is an owner act outside this change's scope.

## Rollback / terminality

The change is code-contained and plainly revertible: `git revert` of its commits restores the old unconditional advertisement — the runtime behavior lives entirely in the task-1.1 commit (`apps/frontend/src/app/sitemap.ts` + its tests; the remaining commits in the change are OpenSpec docs with no runtime effect, revert optional). **No migrations, no stored data, no API-worker change** — the backend never learned about this gate. After revert + deploy, the sitemap returns to the previous static-path set on its next regeneration, nothing to clean up in D1, no feature flag to unwind.
