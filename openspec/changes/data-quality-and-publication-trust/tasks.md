# Tasks — data quality gates and publication trust

## 1. Ingestion plausibility gates

- [ ] 1.1 Price floor gate: reject `priceCents <= 0` at mapping time in `data-mapping.service.ts` with an explicit price-drift error (parser's `readMinorUnitCents` stays structural); data-quality counter for rejections; unit tests cover `"0"`, negative, and valid-price passthrough <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-acquisition/src/services/data-mapping.service.ts, packages/data-acquisition/src/__tests__/**] -->
- [ ] 1.2 Category-bounded volume ceilings in the ingestion quality stage next to the existing `0 < unit_volume < 100` invariant (bounds in one constants table: beer ≤ 2 l, wine ≤ 6 l, spirits ≤ 3 l, remaining categories bounded); implausible → volume unavailable + review flag + share metric; tests pin the live Karhu "33 l" case and plausible passthrough <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/api-worker/src/workflows/ingestion-steps.ts, packages/data-acquisition/src/services/data-quality.service.ts, apps/api-worker/src/__tests__/**] -->
- [ ] 1.3 Multipack-aware volume parse in `alks.parser.ts` (`24×0,33 l` → unit 330 ml, pack 24) + bundle-name rejection to review; unit tests cover the multipack shapes, the observed bundle names, and single-product passthrough across the four adapters sharing the parser <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-acquisition/src/adapters/alks.parser.ts, packages/data-acquisition/src/__tests__/**] -->
- [ ] 1.4 Golden fixtures ("price 0", category-implausible volume, bundle name) + pipeline contract test asserting none publish; run in the existing unit suite <!-- agent: platform-engineer.build, depends_on: [1.1, 1.2, 1.3], touches: [packages/data-acquisition/src/__fixtures__/**, packages/data-acquisition/src/__tests__/**] -->

## 2. Data landing (ops)

- [ ] 2.1 Trigger Alko reference feed ingestion in production; verify savings snapshot qualification end-to-end; record `withReference` before/after counts and the EAN join hit-rate in change notes; runbook addendum for re-runs <!-- agent: devops-engineer.fast, depends_on: [], touches: [docs/**] -->
- [ ] 2.2 Transcribe Posti's parcel price table into `POSTI_RATES` per the documented admin procedure (lanes shipping TO Finland, every tier the source publishes); bump `POSTI_OBSERVED_AT`; golden-fixture test for the transcribed rows <!-- agent: platform-engineer.fast, depends_on: [], touches: [packages/data-acquisition/src/adapters/posti-rate.source.ts, packages/data-acquisition/src/__tests__/**] -->

## 3. Publication honesty (frontend)

- [ ] 3.1 Transport `UNAVAILABLE` renders the honest "not included — dataset pending" state instead of €0.00; LOW-confidence copy explains which inputs are missing; fi/en messages in parity pinned by the messages test <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/app/[locale]/calculator/components/**, apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json] -->
- [ ] 3.2 Homepage savings card honest state when the overview reports `withReference: 0` (pending-reference copy, no CTA into the empty listing); CTA restores automatically at non-zero; copy passes content lint; fi/en parity <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/app/[locale]/page.tsx, apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json] -->

## 4. Observability

- [ ] 4.1 Grafana data-quality panel + threshold alerts: zero-price rejections, implausible-volume share, Alko reference coverage %, transport-row count per carrier, per-feed last-success age; wires the counters from 1.1/1.2 and the existing freshness/metrics plumbing <!-- agent: devops-engineer.build, depends_on: [1.1, 1.2], touches: [infra/**, apps/api-worker/src/observability/**] -->

## 5. Verification, rollout, spike

- [ ] 5.1 Full local verification: typecheck, lint, content lint, unit, golden, e2e, D1 suites; browser pass recording evidence in change notes — LOWEST_PRICE head has no €0.00, calculator transport renders the honest state, homepage savings card state matches the overview, Posti-backed calculation shows a real transport figure <!-- agent: platform-engineer.fast, depends_on: [1.4, 2.1, 2.2, 3.1, 3.2, 4.1], touches: [] -->
- [ ] 5.2 Production: gated deploy (`gh workflow run` with `confirm_deploy=yes`); live verification of all four pains with evidence in change notes (live `sort=LOWEST_PRICE` head, live calculator transport state, savings coverage after 2.1) <!-- agent: devops-engineer.fast, depends_on: [5.1], touches: [] -->
- [ ] 5.3 Spike: quantify cross-feed near-dupe collapse candidates over production data (exact EAN; brand+volume+ABV tuple; the 16-Jameson case as the worked example); findings + recommended spec decision in `spike-notes.md` feeding a future dedupe change <!-- agent: platform-engineer.build, depends_on: [], touches: [openspec/changes/data-quality-and-publication-trust/spike-notes.md] -->
