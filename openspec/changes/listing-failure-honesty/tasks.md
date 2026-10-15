# Tasks

## 1. Failure classes on the client fetch layer

- [x] 1.1 Carry the HTTP status and a derived failure class (age-gate | rate-limited | timeout | server | network) on `ApiFetchError` in `apps/frontend/src/lib/api.ts`, derived from response status plus `AbortSignal` timeout detection <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/lib/api.ts] -->
- [x] 1.2 Unit tests for the class mapping: 403→age-gate, 429→rate-limited, abort→timeout, 5xx→server, network TypeError→network <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/frontend/src/lib/__tests__/api.fetch-client.test.ts] -->

## 2. Value page states

- [x] 2.1 `ValueRanking` renders the three failure classes distinctly: age-gate → age confirmation CTA linking `/age-gate`; rate-limited → backoff copy; timeout/server/network → the existing transient ErrorState with retry <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/frontend/src/app/[locale]/value/components/ValueRanking.tsx] -->
- [x] 2.2 Stale-while-error: persist the last successful per-category response (localStorage, value + fetchedAt); on failure render it with an as-of label alongside retry; absent cache render the class-distinct failure state <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/frontend/src/app/[locale]/value/components/ValueRanking.tsx] -->
- [x] 2.3 i18n keys (fi/en): age-gate CTA, rate-limit copy, stale as-of label <!-- agent: platform-engineer.fast, depends_on: [2.1, 2.2], touches: [apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json] --> (absorbed into the 2.1/2.2 worker — keys landed with the component change)
- [x] 2.4 Component tests: each failure class renders its distinct state; stale fallback renders cached data with the as-of label; no-cache renders the failure state; the success path is byte-unchanged <!-- agent: platform-engineer.build, depends_on: [2.1, 2.2, 2.3], touches: [apps/frontend/src/app/[locale]/value/components/ValueRanking.test.tsx] -->

## 3. Alert rule

- [x] 3.1 Grafana provisioning YAML: per route-pattern 5xx share over the AE counters (unitprice, products, search, savings routes), threshold + `for:` window, warning severity, runbook annotation, noDataState quiet — same import conventions as `d1-spend-alerts.yaml` <!-- agent: devops-engineer.build, depends_on: [], touches: [infra/grafana/endpoint-error-alerts.yaml] -->

## 4. Verification

- [ ] 4.1 Run typecheck, eslint, and the frontend suites across touched paths <!-- agent: platform-engineer.fast, depends_on: [2.4, 3.1], touches: [] -->
- [ ] 4.2 Staging deploy + manual failure matrix: fresh browser (no age cookie) on /grammahinta renders the age CTA — not "backend did not respond"; simulated 5xx renders the transient state with the seeded stale table + as-of label <!-- agent: devops-engineer.fast, depends_on: [4.1], touches: [] -->
