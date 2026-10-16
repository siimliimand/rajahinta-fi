# Tasks

- [x] 1.1 `AuthoritySourceLinks`: add the verified Alkoholiverolaskuri (vero.fi) and Tulli traveller-import guidance links to the surface set; rewrite the docblock from verbatim-mirror to curated calculator-surface set with provenance <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/app/[locale]/calculator/components/AuthoritySourceLinks.tsx] -->
- [x] 1.2 fi/en labels for the two new links (AuthorityLinks namespace); content-vocabulary rules apply <!-- agent: platform-engineer.fast, depends_on: [1.1], touches: [apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json] -->
- [x] 1.3 Update the component test: four links, order, hrefs, labels; run typecheck + eslint + full frontend suite + content lint (frontend 1709/1709 incl. key parity; tsc/eslint/content-lint clean) <!-- agent: platform-engineer.fast, depends_on: [1.1, 1.2], touches: [apps/frontend/src/app/[locale]/calculator/components/AuthoritySourceLinks.test.tsx] -->
