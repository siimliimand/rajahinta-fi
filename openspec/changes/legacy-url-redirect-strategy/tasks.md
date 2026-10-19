# Tasks

## 1. Evidence

- [ ] 1.1 Process the operator-provided Search Console export for the legacy path set into `docs/legacy-url-map.md`: per-path impressions/clicks, mapped target from the `routing.ts` vocabulary, and an explicit keep/let-die recommendation per path. BLOCKED on the operator export; if no path has impressions, record the whole-set let-die decision here and leave the map module empty <!-- agent: platform-engineer.fast, depends_on: [], touches: [docs/legacy-url-map.md] -->

## 2. Redirect map

- [ ] 2.1 Legacy map data module (exact legacy paths → current canonical paths) applied in the middleware ahead of locale negotiation with permanent 301 responses <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/frontend/src/lib/legacy-redirects.ts, apps/frontend/src/middleware.ts] -->
- [ ] 2.2 Middleware tests: mapped path → 301 to its target; unmapped unknown path → falls through to the localized 404 unchanged; `/api`, static, and localized product-detail exclusions never consult the map <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [apps/frontend/src/middleware.test.ts] -->

## 3. Localized 404 affordances

- [ ] 3.1 Catch-all not-found page: verify and extend with a site-search entry plus calculator and catalog links, localized fi/en (the audit's "leht on kolitud" pattern) <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/app/[locale]/[...rest]/page.tsx, apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json] -->

## 4. Verification

- [ ] 4.1 Run typecheck, eslint, and the middleware/i18n suites <!-- agent: platform-engineer.fast, depends_on: [2.2, 3.1], touches: [] -->
- [ ] 4.2 Staging curl matrix: each documented map entry answers 301 to its target; an unmapped legacy path renders the localized 404 with affordances <!-- agent: devops-engineer.fast, depends_on: [4.1], touches: [] -->
