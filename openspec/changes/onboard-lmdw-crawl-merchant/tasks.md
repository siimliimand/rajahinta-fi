# Onboard LMDW crawl merchant — Tasks

> The probe (1.1) decides the integration shape and gates everything downstream; the vocabulary (2.1) follows its census; the adapter (3.1) needs both. Local → staging → production strictly ordered; production last; verification last of all.

## 1. Crawl probe (read-only)

- [x] 1.1 `scripts/lmdw-crawl-probe.ts`: read-only probe deciding the integration shape (design D1) — sitemap availability (robots.txt sitemap directives, `sitemap.xml`, product-sitemap index), state-JSON extraction coverage on ~300 sampled product pages (`volume` litres / `strength` ABV share, guarded-parse outcomes), page-side category signal census (JSON-LD category / breadcrumb terms + counts), GTIN13-in-JSON-LD presence, EUR sanity; records the **URL-source decision** (pure `SitemapCrawlFeedAdapter` subclass vs GraphQL-seeded variant) and the extraction targets in the notes with go for task 3.1 <!-- agent: platform-engineer.build, depends_on: [], touches: [scripts/lmdw-crawl-probe.ts, openspec/changes/onboard-lmdw-crawl-merchant/notes.md] -->

## 2. Vocabulary

- [x] 2.1 Source-category mapper vocabulary FR: additive exact keys from the probe's page-side census (breadcrumb/JSON-LD category terms → existing canonical categories, census spellings exact); deliberately unmapped: gift boxes, non-beverage terms, merch per census → correction queue; unit tests per vocabulary block + negatives; probe re-run recording the new drop rate in the notes <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/core-domain/src/normalization/source-category.mapper.ts, packages/core-domain/src/normalization/__tests__/source-category.mapper.test.ts, openspec/changes/onboard-lmdw-crawl-merchant/notes.md] -->

## 3. Adapter + extraction

- [ ] 3.1 `LmdwFeedAdapter` (`merchantId: 'lmdw'`): per the 1.1 decision — pure `SitemapCrawlFeedAdapter` subclass (sitemap `feedUrl`) or the GraphQL-seeded URL-list variant (design D1); whisky.fr per-source page normalizer (design D2): state-JSON `volume`/`strength` guarded extraction with honest ESTIMATED fallbacks, JSON-LD price → EUR minor units (non-EUR = per-row correction error), category through the 2.1 keys, GTIN13 only when page-attested (design D4), `depositSystem: false`; crawl discipline inherited (design D5); golden fixtures + unit tests (volume/strength forms, ESTIMATED paths, GTIN-present and EAN-less worlds, category mapping, non-EUR correction) <!-- agent: platform-engineer.build, depends_on: [1.1, 2.1], touches: [packages/data-acquisition/src/adapters/lmdw.adapter.ts, packages/data-acquisition/src/crawl/extract/**, packages/data-acquisition/src/__fixtures__/**, packages/data-acquisition/src/__tests__/**] -->

## 4. Composition + registry

- [ ] 4.1 Composition wiring: export the adapter from the package index; register per the 1.1 decision (crawl adapter map on the pure path — `crawlFeedAdapters` with watermark/cursor stores, pipeline.ts + ingestion-steps.ts in sync — plus the feed map if the seeded variant needs it); composition tests assert the thirteen-adapter reality; docblocks updated <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [packages/data-acquisition/src/index.ts, apps/api-worker/src/workflows/ingestion-steps.ts, apps/api-worker/src/workflows/__tests__/ingestion.workflow.test.ts, apps/api-worker/src/queues/pipeline.ts, apps/api-worker/src/queues/__tests__/ingestion.queue.test.ts] -->
- [x] 4.2 Registry seed row in `merchant-registry.seed.ts` (crawl-row convention): `('lmdw', 'La Maison du Whisky', 'FR', <feedUrl per 1.1 decision>, 'xml'|'json', 86_400_000)` — local + staging receive it through the deploy seed step; production never seeds (registration happens via the ops console in task 7.2) <!-- agent: platform-engineer.fast, depends_on: [1.1], touches: [packages/data-platform/src/seed/merchant-registry.seed.ts] -->

## 5. Local rollout

- [ ] 5.1 Local rollout: seed row (via the seed) + governance record (`RETAILER_API`, `GRANTED`, sourceUrl per decision) in local D1; producer tick + crawl end-to-end locally against whisky.fr (read-only GETs); verify watermark/cursor rows are written and lastmod diffing works, resumable chunking on a bounded run, `retail_offers` land with ABV/volume from the page extraction, repeat-run idempotency (no duplicate `product_master` rows), GTIN/EAN state as measured, correction rows for unmapped categories; evidence in the notes <!-- agent: platform-engineer.fast, depends_on: [4.1, 4.2], touches: [openspec/changes/onboard-lmdw-crawl-merchant/notes.md] -->

## 6. Staging rollout

- [ ] 6.1 Open PR from the feature branch; CI green (all required checks); merge; staging auto-deploys the api-worker <!-- agent: devops-engineer.fast, depends_on: [5.1], touches: [] -->
- [ ] 6.2 Staging rollout: registry row ships via seed + `RETAILER_API`/`GRANTED` governance via the ops console; first crawl triggered via the Workflows REST API; **Workers-egress smoke recorded** (design D6 — a blocked source follows the Posti playbook, not a retry loop); end-to-end verify (workflow instance `complete`, `retail_offers` populated with page-extracted ABV/volume, API + product pages serve lmdw items); executed commands and numbers in the notes <!-- agent: devops-engineer.fast, depends_on: [6.1], touches: [openspec/changes/onboard-lmdw-crawl-merchant/notes.md] -->

## 7. Production rollout

- [ ] 7.1 Production deploy via the gated workflow (`gh workflow run deploy-production.yml` with `confirm_deploy=yes`); health gate green <!-- agent: devops-engineer.fast, depends_on: [6.2], touches: [] -->
- [ ] 7.2 Production registration via the ops console (`POST /ops/console/merchants` — upsert + auto-grant, blanket-permission policy, two audited entries; pin `feedFormat` and `pollingIntervalMs` explicitly — runbook §2.0); first crawl manually triggered; API + product pages verified serving lmdw items; the next-scheduled-00:00-UTC checklist recorded (exactly one enqueue, one workflow instance, offers refreshed) <!-- agent: devops-engineer.fast, depends_on: [7.1], touches: [openspec/changes/onboard-lmdw-crawl-merchant/notes.md] -->

## 8. Verification

- [ ] 8.1 Full verification: rebuild `@rajahinta/core-domain` first, then typecheck, lint, content lint, unit suites (Node v24 — the v22 FTS5 quirk), e2e, D1 suites, golden/data-quality/compliance; evidence consolidated — probe numbers (§1.1), extraction coverage, mapper re-probe drop rate (§2.1), local idempotency + watermark behavior (§5.1), staging/production serving (§6.2/§7.2), scheduled-boundary checklist, hold-rule note (ESTIMATED rows stay out of user-facing surfaces), and the correction-noise observation (GTIN vs EAN-less world) <!-- agent: platform-engineer.fast, depends_on: [4.1, 5.1, 6.2, 7.2], touches: [openspec/changes/onboard-lmdw-crawl-merchant/notes.md] -->
