# Tasks: fi-native-copy-pass

## 1. Glossary foundation

- [x] 1.1 Create `docs/fi-copy-glossary.md`: canonical terms (FI/EN table per design.md D2), register rules (consumer sentence first; plain-but-precise mechanism; documented FI/EN asymmetry per D4), before/after examples for each replaced term <!-- agent: platform-engineer.fast, depends_on: [], touches: [docs/fi-copy-glossary.md] -->

## 2. Word fixes (class A)

- [x] 2.1 Event surface: `juonetarve` → `juomatarve` in fi+en (EventPage subtitle, metaTitle, metaDescription, taskCardsEventBody); update pinned tests (event page test, task-cards test) <!-- agent: platform-engineer.fast, depends_on: [1.1], touches: [apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json, apps/frontend/src/app/[locale]/event/page.test.tsx, apps/frontend/src/app/[locale]/page.taskcards.test.tsx] -->
- [x] 2.2 Ranking + footer naming: Nav/SiteFooter/methodology link → `Järjestysperiaatteet` (nav slot) / `Miten järjestys muodostuu` (title + metaTitle); `linkBasket` → `Ostoskorilaskuri`; update layout-SSR, page-SSR, and ranking page pinned tests <!-- agent: platform-engineer.fast, depends_on: [1.1], touches: [apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json, apps/frontend/src/app/[locale]/layout.ssr.test.tsx, apps/frontend/src/app/[locale]/page.ssr.test.tsx, apps/frontend/src/app/[locale]/ranking/page.test.tsx] -->
- [x] 2.3 Sort labels: `matalin ensin` → `halvin ensin` (compare sortOptionLabel and any other price sorts); update SortSelector test <!-- agent: platform-engineer.fast, depends_on: [1.1], touches: [apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json, apps/frontend/src/app/[locale]/compare/components/SortSelector.test.tsx] -->

## 3. Terminology unification (class B)

- [x] 3.1 Allowance-term unification: `tullimääräraja*` → `tullivapaiden määrien` family (trip task card, trip subtitle/meta/howBody, cap label, version label, error title/body — 8 keys); check trip tests for pinned phrasing <!-- agent: platform-engineer.fast, depends_on: [1.1], touches: [apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json, apps/frontend/src/app/[locale]/trip/] -->
- [x] 3.2 €/g unit unification + header bug: ValueRanking column header fixed to match cell unit (`snt/g`); canonical `etanolin grammahinta (snt/g)` across eurPerGramChip, compare sortOptionLabel, columnEurPerGram, linkValue, unitPriceChip, value metaTitle/metaDescription; on-surface explanation (caption/tooltip) per spec scenario; computed `centsPerGram` rendered verbatim (no conversion — corrected during apply, see design D5); update ValueRanking, SortSelector, calculator-view, products page tests <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/frontend/src/app/[locale]/value/components/ValueRanking.tsx, apps/frontend/src/app/[locale]/value/components/ValueRanking.test.tsx, apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json, apps/frontend/src/app/[locale]/compare/components/SortSelector.test.tsx, apps/frontend/src/app/[locale]/calculator/calculator-view.test.tsx, apps/frontend/src/app/[locale]/products/__tests__/page.test.tsx] -->

## 4. Register inversion (class C)

- [x] 4.1 Ranking methodology register: rewrite RankingPage section consumer-first per design D3 (subtitle, meta, howTitle/howBody, tiebreaker, deterministic badge removal, enforcementP1/P2, three layer names+descs, spot section) — every enforcement fact stays stated; sync `docs/legal-briefing-package.md` title reference; update ranking page pinned tests <!-- agent: platform-engineer.build, depends_on: [2.2], touches: [apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json, apps/frontend/src/app/[locale]/ranking/page.test.tsx, docs/legal-briefing-package.md] -->
- [x] 4.2 Spec-voice sweep: informationalNote + meta on savings/value/allowances, taskCardsSavingsBody, guides meta strings (unicode-escaped), `materialisoitu` ×4, `tiedollinen` ×5, `aineistoversio` ×6 → glossary register; *— ei neuvontaa* disclaimers preserved verbatim in intent; update any pinned page tests <!-- agent: platform-engineer.fast, depends_on: [1.1], touches: [apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json, apps/frontend/src/app/[locale]/savings/, apps/frontend/src/app/[locale]/allowances/, apps/frontend/src/app/[locale]/guides/] -->

## 5. EN alignment

- [x] 5.1 EN catalog alignment: units + terminology parity + wrong-word equivalents fixed; methodology section deliberately keeps semi-technical register (asymmetry documented in glossary) <!-- agent: platform-engineer.fast, depends_on: [2.1, 3.1, 4.2], touches: [apps/frontend/src/messages/en.json] -->

## 6. Verification

- [x] 6.1 Verify: typecheck, full vitest battery, content-vocabulary lint over the new copy (no promotional adjectives introduced), SEO surfaces render the new meta, every rendered snt/g figure equals the API centsPerGram value (no computed figure moved) <!-- agent: platform-engineer.fast, depends_on: [2.1, 2.2, 2.3, 3.1, 3.2, 4.1, 4.2, 5.1], touches: [] --> *(2026-10-06: typecheck, eslint, lint:content, frontend vitest 1327/1327, SEO SSR tests all green. Full-workspace `pnpm test`/`test:compliance` fail only on pre-existing environmental `no such module: fts5` (node v22.14.0 node:sqlite) in packages/data-platform suites this branch never touches (`git diff master -- packages/` empty); one lint violation (EN "cheapest first") found by this task and fixed in the 3.2 retry.)*
