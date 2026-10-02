# Change notes — finnish-first client experience

Operator evidence log for the verification and rollout tasks. Sections
here hold **recorded facts, never predictions**: every command result
below is the run's real output, and the browser section records only
what a real headless Chromium rendered against this branch's stack.

## 4.1 Local verification (2026-10-01)

Full local verification of the working tree at `3bb58e2`
(`feature/finnish-first-client-experience`, all nine implementation
tasks committed: `d025caf`, `00f7b2e`, `ce76724`, `f5c10fc`, `b05164e`,
`3bb58e2`), run with node v24.21.0 / pnpm 9.15.9
(`PATH=/root/.nvm/versions/node/v24.21.0/bin`). Everything below is
recorded output; no code was changed by this pass.

### Suite results

| Suite (command) | Exit code | Count |
|---|---|---|
| `pnpm typecheck` | 0 | 8/8 workspace projects pass |
| `pnpm lint` | 0 | clean |
| `pnpm lint:content` | 0 | clean |
| `pnpm test:golden` | 0 | 44/44 (2 files) |
| `pnpm test:d1` | 0 | 159/159 (14 files) |
| `pnpm test:e2e` | 0 | 15/15 (1 file) |
| `pnpm test` (unit, recursive) | 0 | **5482 passed / 3 skipped**, 0 failed |
| `pnpm build` | 0 | all 8 projects build (frontend OpenNext build included) |

Unit totals by package — core-domain 1457 (56 files), api-worker 1066
(64 files), frontend 1062 (98 files), data-platform 724 (61 files),
data-acquisition 337 (21 files), application-api 734 passed + 3 skipped
(58 files), email-worker 83 (5 files), backend 19 (5 files). `pnpm
test` completed every package this time — no short-circuit, no
per-package re-runs needed.

### Browser pass (real headless Chromium, 10/10 checks passed)

The session's desktop browser tool was disconnected, so the walk ran as
a scripted Playwright driver over the repo's own Chromium
(`@playwright/test` 1.62.1, headless) — the same approach as the
archived 5.1 pass's "headless-Chromium driver over the real UI".
Driver kept outside the repo at `/tmp/opencode/walk-4.1.mjs`; evidence
screenshots at `/tmp/opencode/41-*.png`.

Stack: booted per the harness's own steps
(`tests/e2e-browser/boot-workers-stack.sh` `api`/`frontend` sequence)
on **non-default ports API :8798 / frontend :8799** — 8787/8788 were
occupied by an unrelated workspace project's dev servers (PostGavel
`workerd`, pids 415659/415941); the harness's `E2E_API_PORT`/
`E2E_FRONTEND_PORT` overrides exist for exactly this. API health/ready
200 (D1 + DOs up); frontend built by the harness's own
`build:worker` step with `NEXT_PUBLIC_API_URL=http://localhost:8798`
inlined at build time, HTTP 200.

One local-D1 preparation step (operator act mirrored locally, recorded):
the curated seed never publishes, so the pass inserted the seed's exact
dataset rows (version `eu-2007-74-2026.1`, five EU cap rows — spirits
10 l, intermediate 20 l, wine_still 90 l, wine_sparkling 60 l, beer
110 l — citations verbatim from
`packages/data-platform/src/seed/traveller-allowances.seed.ts`) and
flipped `PENDING_CONFIRMATION → PUBLISHED`, the repository's documented
operator transition. Post-publish check read back
`eu-2007-74-2026.1 / PUBLISHED` + all five cap rows from local D1.
SQL kept at `/tmp/opencode/allowance-publish-local.sql`. Task 4.2's
"published allowance dataset" is production's own.

Observed (locale fi, bare paths, anonymous visitor, age gate accepted
via the "Olen 18 vuotta täyttänyt" overlay button):

1. **Buying-mode toggle — PASS.** The calculator form renders the
   `Ostotapa` fieldset with `Toimitus` (default) and `Otan itse
   mukaan`; clicking `buying-mode-PERSONAL` checks its radio
   (`checked=true`).
2. **6× Jameson PERSONAL = shelf price — PASS.** Search "Jameson" →
   select "Jameson Irish Whiskey" (spirits · 70 cl · 40 %, alin
   havaittu hinta €59.90) → quantity 6 → Otan itse mukaan → Laske.
   Result: **YHTEENSÄ €359.40** (= 6 × €59.90 shelf price, nothing
   else); every tax line renders the within-allowance label —
   "Arvio alkoholin valmisteverosta **(sallitun määrän sisällä,
   veroton)** €0.00", "Arvio pakkauksen talletuksesta (sallitun
   määrän sisällä, veroton) €0.00", "Arvio tuonnin
   arvonlisäverosta (sallitun määrän sisällä, veroton) €0.00" — plus
   the single-traveller note ("Laskenta noudattaa yhden matkustajan
   määräaikoja…") and "Matkustajamäärien tietoaineisto:
   **eu-2007-74-2026.1**". Screenshot
   `/tmp/opencode/41-personal-jameson.png`.
3. **Delivery default unchanged + callout — PASS.** Switching back to
   Toimitus and recalculating: **YHTEENSÄ €572.43** (359.40 retail +
   94.56 excise + 2.16 pakkausvero Arvioitu + 116.31 import VAT +
   0 transport "Ei sisällytetty"), plain delivery labels (no
   allowance copy), and the `MATKALASKURIN ARVIO` callout: "Yksi
   matkustaja, sama määrä — arvio yhteensä **€359.40**." +
   "Matkustajamäärien tietoaineisto: eu-2007-74-2026.1" +
   "Kokeile matkalaskuria" button, href exactly
   `/trip?product=5&quantity=6`. Screenshot
   `/tmp/opencode/41-delivery-callout.png`.
4. **Trip prefill handshake — PASS.** Clicking the callout link lands
   on `/trip?product=5&quantity=6` with the fill form pre-seeded:
   candidate row `trip-fill-selected-5` = "Jameson Irish Whiskey",
   quantity input `#trip-fill-qty-5` = **6**. Screenshot
   `/tmp/opencode/41-trip-prefill.png`.
5. **viski / viini / olut heads — PASS (recorded as rendered).**
   - `viini` → head recalls **TEST Wine** — a Finnish term pulling an
     English-language catalog row, the synonym-recall scenario shape
     live in the browser.
   - `olut` → head (DOM order): Absolut Original, Absolut Vodka,
     TEST Beer. This is the designed **below-threshold** branch: the
     local fixture has ~1 FTS token match ("TEST Beer" via `beer`),
     under the listing page size, so the LIKE merge correctly runs and
     Absolut rows enter. The ≥ page-size clean-head scenario cannot be
     produced by a 45-product fixture; it is pinned by the D1 suite
     (below) with its purpose-built catalog.
   - `viski` → zero results with the honest empty-state copy
     ("Tuotteita ei löytynyt haulla \"viski\""): the fixture catalog
     carries no `whisky` token at all ("Whiskey" ≠ `whisky*` in FTS),
     so there is nothing for the expansion to recall locally. The
     recall-parity scenario is pinned by the D1 suite (below).
   Screenshot `/tmp/opencode/41-search-heads.png`.
6. **koskenkrova suggestion chip — PASS.** Searching `koskenkrova`
   renders the banner "**Tarkoititko: Koskenkorva**"
   (`search-suggestion` / `search-suggestion-chip`) with the input
   still holding `koskenkrova` (original preserved, no rewrite);
   clicking the chip runs the suggested query — Koskenkorva product
   buttons render, input still `koskenkrova`. Screenshots
   `/tmp/opencode/41-suggestion-chip.png`,
   `/tmp/opencode/41-suggestion-results.png`.

Command-level API parity on the same stack (curl, real responses kept
under `/tmp/opencode/`): `POST /api/v1/calculator`
`{"productId":5,"quantity":6,"destination":"FI","transportArrangement":"PERSONAL"}`
→ `totalCents: 35940`, all tax categories 0, classification
`TravellerImport`/HIGH, evidence names "allowance dataset:
eu-2007-74-2026.1 … allowance covers 6 of 6 units; surplus 0 units
taxed", metadata `allowanceDatasetVersion: eu-2007-74-2026.1`; the
delivery twin → `totalCents: 57243` (9456 + 216 + 11631 taxed) with
`travellerAlternative: {estimatedTotalCents: 35940, withinAllowance:
true, allowanceDatasetVersion: "eu-2007-74-2026.1", categoryKey:
"spirits"}`; `GET /api/v1/products?q=koskenkrova` → 0 results +
`suggestion: "Koskenkorva"`.

### Spec-scenario evidence (ADDED requirement scenarios → pinning tests)

Every test name below is quoted verbatim from the committed test files;
all suites green in this pass.

| Delta requirement / scenario | Pinning test |
|---|---|
| **landed-cost-calculator — Traveller-import calculation mode** | |
| Quantity within the category cap is shelf price only | `landed-cost-calculator.service.test.ts:1412` — "quantity within the spirits cap is shelf price only — taxes zero, dataset version recorded" |
| Surplus over the cap is taxed on the surplus only | `:1462` — "over-cap surplus is taxed on the surplus only — exact VAT base composition" (quantity-cap variant `:1507`) |
| No effective allowance dataset rejects honestly | `:1563` — "no published dataset rejects with the dedicated error carrying the transaction date"; route parity `calculator.routes.test.ts:306` — "rejects a PERSONAL request with 409 NoPublishedAllowances when no allowance dataset is effective (trip-route parity)" |
| Delivery mode is unchanged | `:1596` — "delivery-mode pre-existing fields stay byte-for-byte identical with the port wired or unwired (task 1.2 adds only the callout key)" |
| **landed-cost-calculator — Traveller-alternative estimate on delivery results** | |
| Delivery result carries the labelled traveller estimate | `:1744` — "carries the labelled traveller estimate — allowed quantity × shelf price, dataset version, category key"; figures-untouched pin `:1767` — "changes no delivery figure, status, or confidence (design D4)" |
| No cap row yields no callout | `:1846` — "no cap row for the category → the key is absent and delivery figures equal the unwired engine" (no-dataset `:1868`; PERSONAL-never-carries `:1912`) |
| Cache identity separates PERSONAL from delivery | `idempotency.do.test.ts:102` — "separates PERSONAL from delivery for identical product/quantity (task 1.2)" (hash membership `:96`); GET-path never reconstructs the callout — `calculator-result.mapper.test.ts:481`, `:497` |
| **product-search — Finnish synonym recall** | |
| Finnish term recalls the English-language catalog | `product-search.repository.test.ts:1387` — "spec: \"viski\" recalls the English-language whisky catalog — parity with \"whisky\"" |
| Expansion is monotone | `:1401` — "spec: expansion is monotone — each expanded query is a superset of its un-expanded query" (first-arm monotone anchor `:1313`) |
| **product-search — Substring merge scarcity gating** | |
| Common short word is not flooded by brand-substring noise | `:1446` — "spec: \"olut\" at ≥ page-size token matches — the head is clean of brand-substring noise (Absolut incident)" (gate counts category-narrowed candidates `:1481`) |
| Fragment recall survives the gate | `:1473` — "spec: \"arhu\" produces no FTS token matches — the merge runs and recalls Karhu" |
| **product-search — Zero-result suggestion** | |
| Misspelled brand name yields a suggestion | `:1662` — "spec: \"koskenkrova\" (zero results) suggests \"Koskenkorva\" — distance-2 transposition"; `:1671` — "\"jackdanels\" … \"Jack Daniel's\""; route passthrough `search.routes.test.ts:410` |
| No suggestion when results exist | `:1683` — "no suggestion when the query has results — the vocabulary is never consulted" (routes `:434`, ids path `:465`) |
| Deterministic ordering | `:1692` — "stable tie ordering: \"karu\" ties Karhu/Karju at distance 1 and picks the alphabetically first" (distance-beats-alphabetical `:1701`, multi-token `:1718`) |
| **web-application — Buying-mode selection in the calculator** | |
| Toggle switches the request scenario | `calculator-view.test.tsx:473` — "sends transportArrangement PERSONAL when Otan itse mukaan is selected" |
| Traveller mode without allowance data renders honestly | `:495` — "renders the honest traveller-unavailable state on 409 NoPublishedAllowances and keeps the form usable" |
| Finnish and English copy in parity | `messages.test.ts:284` buyingMode, `:294` traveller-mode honest-state, `:301` allowance, `:310` travellerAlternative key parity + `pnpm lint:content` exit 0 |
| PERSONAL split rendering (within/surplus labels, version, note) | `ResultCard.test.tsx:506` describe "traveller-mode split labels (task 2.1)" — `:507` within-allowance zero lines, `:530` taxed surplus lines, `:543` single-traveller note + dataset version, `:554` plain labels without a cap split, `:585` delivery renders without allowance copy |
| **web-application — Traveller callout on delivery results** | |
| Callout links into a pre-filled trip | `TravellerAlternativeCallout.test.tsx:81` — "links to the trip page with the product and quantity as prefill params" (+ label/version `:43`, portion-only `:66`; integration `CalculatorResult.test.tsx:294`, `ResultCard.test.tsx:600`) |
| Trip page accepts the prefill | `trip/prefill.test.ts:19` — "parses a valid product and quantity" (quantity fallbacks `:26`/`:37`, malformed-product rejection `:47`, whitespace `:56`) |
| **web-application — Search suggestion banner** | |
| Zero-result query offers the correction | `calculator-view.test.tsx:549` — "runs the suggested query from the chip and preserves the original query in the input"; product listing `products/__tests__/page.test.tsx:542` — "renders the chip on a zero-result search and links the suggested query" |
| Original query is preserved | same `calculator-view.test.tsx:549` (input-preservation pin); no chip when results exist `:591` / `page.test.tsx:563` |

### Exact commands

```bash
export PATH=/root/.nvm/versions/node/v24.21.0/bin:$PATH

pnpm typecheck; pnpm lint; pnpm lint:content
pnpm test:golden; pnpm test:d1; pnpm test:e2e; pnpm test; pnpm build

# Browser stack — harness steps on override ports (8787/8788 busy:
# unrelated PostGavel dev servers, not this repo's):
rm -rf apps/api-worker/.wrangler/state
pnpm --filter @rajahinta/api-worker db:seed:d1:local
pnpm --filter @rajahinta/api-worker exec wrangler d1 execute DB --local \
  --file tests/e2e-browser/seed-journeys.d1.sql -y
pnpm --filter @rajahinta/api-worker exec wrangler d1 execute DB --local \
  --file /tmp/opencode/allowance-publish-local.sql -y   # operator publish, mirrored locally
cd apps/api-worker && pnpm exec wrangler dev --port 8798 \
  --var "CORS_ORIGIN:http://localhost:8799" &
NEXT_PUBLIC_API_URL=http://localhost:8798 \
  pnpm --filter @rajahinta/frontend build:worker
cd apps/frontend && pnpm exec wrangler dev --port 8799 &

# Walk driver (headless Chromium, evidence screenshots to /tmp/opencode/41-*.png):
node /tmp/opencode/walk-4.1.mjs    # → WALK SUMMARY: 10/10 checks passed

# API parity calls:
curl -s -H "x-age-confirmed: local-verification" -H 'content-type: application/json' \
  -X POST http://localhost:8798/api/v1/calculator \
  -d '{"productId":5,"quantity":6,"destination":"FI","transportArrangement":"PERSONAL"}'
curl -s -H "x-age-confirmed: local-verification" -H 'content-type: application/json' \
  -X POST http://localhost:8798/api/v1/calculator \
  -d '{"productId":5,"quantity":6,"destination":"FI"}'
curl -s -H "x-age-confirmed: local-verification" \
  "http://localhost:8798/api/v1/products?q=koskenkrova"
```

### Known limitations (deliberate, recorded — not defects of this pass)

1. **Persisted PERSONAL results on GET render plain category labels.**
   The allowance framing is deliberately not persisted (the split is
   presentation evidence computed live), so a calculation record
   fetched back via GET renders today's plain category labels — and
   the `travellerAlternative` callout is likewise absent from a
   persisted GET (pinned by `calculator-result.mapper.test.ts:481`/
   `:497`). Delivery GET is unaffected: the delivery-mode amounts were
   never framing-dependent.
2. **The idempotency cache-key change orphans pre-deploy cached
   entries once.** `transportArrangement` now participates in the
   cache-key hash (`idempotency.do.test.ts:96`/`:102`), so entries
   stored under pre-deploy keys are never hit again — a one-time
   recompute per stale entry. No wrong-mode hits are possible: the
   key that separates PERSONAL from delivery is exactly what makes
   old entries unreachable, not merely stale-valued.
3. **`basket.routes.ts` is deliberately not wired to the allowance
   port.** PERSONAL baskets keep today's full-taxation math (task 1.1
   lead decision, documented in the change design); the calculator's
   PERSONAL branch is the only allowance-aware path this change.

No verification command failed; nothing was fixed or suppressed during
this pass. Task 4.1's gate for 4.2 (gated production deploy + live
verification) is satisfied on the local side: 8/8 suite commands exit
0, 10/10 browser checks pass, and every ADDED requirement scenario
maps to a green committed test.

## 4.2 — Production deploy + live verification (2026-10-02)

Owner-approved gated rollout executed per the established pipeline:
push → PR CI → merge → gated `deploy-production.yml` → live
verification against `https://api.rajahinta.fi` / `https://rajahinta.fi`.
Everything below is recorded output (raw responses kept under
`/tmp/opencode/42-evidence/`); the production-credential token was used
only in-memory for two read-only D1 diagnostics and never written
anywhere.

### Pipeline (all steps green)

| Step | Result |
|---|---|
| Push `feature/finnish-first-client-experience` | new remote branch |
| PR | [#73](https://github.com/siimliimand/rajahinta-fi/pull/73) → master |
| PR checks (watched) | **all pass**: D1 suite ×2, Data-quality ×2, E2E ×2, Golden-dataset ×2, Integration ×2, Lint ×2, Load test (calculator, in-process), Unit tests ×2, Worker checks ×2, Wrangler config validation ×2 (Artillery staging job `skipping` — PR-path by design) |
| Merge | merge commit **`71c7264`** ("Merge pull request #73 …", task commits preserved) |
| Gated deploy | run **`36974411926`** ([actions/runs/36974411926](https://github.com/siimliimand/rajahinta-fi/actions/runs/36974411926)), `confirm_deploy=yes`, ref `master` |
| Deploy steps | Build frontend (OpenNext) ✓ → Apply D1 migrations (production) ✓ → Deploy API Worker ✓ → Deploy email Worker ✓ → Deploy frontend Worker ✓ → **Health gate ✓** (`/api/v1/health/ready` 200) |
| Post-deploy health | `{"status":"ok","checks":{"d1":{"status":"up"},"durableObjects":{"status":"up"}}}` |

### Live search battery (production API, `x-age-confirmed: 1`, cache-busted)

| Term | Before | After (live `total`) | Verdict |
|---|---|---|---|
| `viski` | 1 | **≥ 100** (response `total: 100` = saturated MAX_PAGE_SIZE window; page returns 20) | **PASS** — whisky recalled via fi↔en synonym expansion, ≫ pre-change 1 |
| `viini` | 16 | **73** | **PASS** — synonym-expanded recall, ~4.5× baseline |
| `olut` | Absolut rows in head | **36**; head = Olutpaja XA Stout, Olutpaja Vasen Ranta IPA, Karhu Olut 5.3 %, Carlsberg olut, Fentimans Ginger Beer, Carabao Lager Beer — all `olut`/`beer` token matches, **zero Absolut rows in the head** | **PASS** — scarcity gate holds on real catalog (Absolut incident fixed) |
| `koskenkrova` | 0 (no suggestion field pre-change) | **0 results + `suggestion` ABSENT** | **DATA-GATED** — see finding 1 |
| `jackdanels` | 0 (no suggestion field pre-change) | **0 results + `suggestion` ABSENT** | **DATA-GATED** — see finding 1 |
| `arhu` | Karhu recalled | **9**, all Karhu rows | **PASS** — fragment LIKE-merge recall survives the gate |

Control queries recorded the same hour: `Koskenkorva` → 84 results
(head: Koskenkorva Viina / Caipiroska / Vodka), `"Jack Daniel"` → 23,
`jackdaniels` (correct concatenated spelling) → 0 — names tokenize as
`jack`/`daniels`, so the concatenated form needs the did-you-mean path
exactly as designed.

**Finding 1 (recorded observation, no workaround attempted): the 3.2
did-you-mean suggestion is deployed but dormant on today's production
data.** The API responses carried no `suggestion` field for
`koskenkrova`/`jackdanels`. Root cause verified read-only against
production D1: `SELECT COUNT(*) … WHERE brand <> ''` on
`product_master` returns **0 of 7876 rows with a non-empty brand** —
`BRAND_VOCABULARY_SQL`'s vocabulary is empty, so `suggestBrand`
correctly returns null (an empty vocabulary admits no candidate; the
route attaches the field only when non-null, per the committed tests).
Product 5057's detail record corroborates: `"brand": ""`. This is not
a regression (the field did not exist pre-change; zero-result behavior
is otherwise identical). Unblocking = populating `product_master.brand`
via the catalog/ETL load — an owner/data-platform decision, not
attempted here.

### Live calculator on real product 5057 — Jameson Caskmates Stout Edition

Product confirmed live: `id=5057`, category `spirits`,
`alcoholByVolume 0.4`, `unitVolume "0.7000"`, single alko offer €44.58
(`observedAt 2026-10-02T00:01:10Z`). Quantity **6** → 6 × 0.7 l = 4.2 l,
within the 10 l spirits cap. Two POSTs to
`https://api.rajahinta.fi/api/v1/calculator` (the task's stated
budget; no further writes):

| Request | Response (real figures) |
|---|---|
| Delivery default `{"productId":5057,"quantity":6,"destination":"FI"}` | HTTP 200 — `totalCents 36420` = foreignRetailPrice **26748** (6 × 4458) + alcoholExciseEstimate **9456** + containerDutyEstimate **216** + transport **0** (domestic FI seller → no import VAT line); classification `DistanceBuying`/HIGH; `travellerAlternative` **absent** — the contracted null-when-no-dataset state, so the callout correctly does not render |
| PERSONAL `{"productId":5057,"quantity":6,"destination":"FI","transportArrangement":"PERSONAL"}` | HTTP **409** `error:"NoPublishedAllowances"` — "No published traveller allowance dataset is effective on 2026-10-02 — a traveller-mode calculation cannot run without a bound" |

**Finding 2 (recorded observation): production has NO published
traveller allowance dataset — the honest 409 state, which the task
explicitly allows as a correct outcome.** Read-only D1 diagnostic:
`traveller_allowance_datasets` is **empty (0 rows)**; the table itself
exists (migration 0007 applied by the deploy's migrate step). The
PERSONAL branch, the 409 mapping (task 1.3), and the dataset-absent
delivery semantics (task 1.2's contracted null) are all verifiably
live — the pre-change API had no PERSONAL branch at all, so this 409
shape is itself new-code evidence. The within-cap shelf-price
response, `metadata.allowanceDatasetVersion`, and the delivery
`travellerAlternative` callout go live the moment the operator
publishes a dataset (e.g. the `eu-2007-74-2026.1` five-cap row set
already mirrored locally in 4.1) — a deliberate manual owner act per
the deploy workflow's own "production is NEVER seeded" contract, not
attempted here.

### Frontend liveness (SSR HTML, production)

`https://rajahinta.fi/fi/calculator` (→ `/calculator`, HTTP 200)
serves the new UI strings in the SSR HTML: `Ostotapa` /
`Otan itse mukaan` (task 2.1 buying-mode toggle) and `Tarkoititko`
(task 3.3 banner copy). Until Finding 2 is unblocked, a PERSONAL
submission in production renders the honest traveller-unavailable
state pinned by `calculator-view.test.tsx:495`.

### Summary

Deploy `36974411926` green end-to-end; both search pains verified
fixed on production (viski ≥100 vs 1, viini 73 vs 16, olut head
clean, arhu→Karhu); PERSONAL/delivery engine live with the honest
409 state pending the owner's dataset publication; did-you-mean
deployed but dormant pending brand-column population. No
regressions observed: delivery totals match pre-change engine
semantics on a domestic product, all search totals ≥ baseline, and
no live check was papered over — both gaps are recorded with root
causes and owner actions.

---

## Addendum — owner-directed data operations (2026-10-02, post-merge)

Both production gaps from §4.2's findings were closed the same day under the owner's explicit direction.

### 1. Traveller allowance dataset published

`eu-2007-74-2026.1` (Commission Directive 2007/74/EC, EUR-Lex CELEX 32007L0074) seeded into production `traveller_allowance_datasets` + `traveller_allowance_limits` (5 cited limit rows: spirits 10 l, intermediate products 20 l, wine still 90 l / sparkling 60 l shared, beer 110 l — the seed module's exact values, generated verbatim from `traveller-allowances.seed.ts`), then transitioned PENDING_CONFIRMATION → PUBLISHED (the repository's only publish path; `confirmed_by: 'owner-directed (agent session 2026-10-02)'`). No endpoint was used — the operator-console-only lifecycle was respected; statements ran via `wrangler d1 execute --remote`.

Live verification (product 5057 Jameson Caskmates Stout 40 %, 6 × 0.7 l = 4.2 l ≤ 10 l spirits cap):

- PERSONAL: HTTP 200, total **€267.48 = shelf price only** (retail 26 748 c; excise/duty/VAT zero within cap), `metadata.allowanceDatasetVersion: eu-2007-74-2026.1` — the pre-change delivery figure was €364.20.
- Delivery: unchanged €364.20 **plus** `travellerAlternative { estimatedTotalCents: 26748, withinAllowance: true, version: eu-2007-74-2026.1, categoryKey: 'spirits' }`.

### 2. product_master.brand populated (derived)

Root cause confirmed: no feed carries brands (alks store API `brands: []` on every payload; alko adapter deliberately empty) — the pipeline was faithful, the data absent. Owner approved derivation + backfill + deploy.

- `deriveBrand(name)` (packages/data-acquisition, `feature/derive-product-brand`): pure conservative leading-run extractor — beverage/grape/qualifier stoplist (207 folded words), 3-token cap, honest `''` refusals; 31 unit pins on real catalog names.
- Backfill: 7,876 rows dumped, script emitted **7,279 UPDATEs** (stored-empty only, `updated_at` untouched; FTS synced by the existing `product_master_fts_au` trigger). Distribution: 2,205 × 1-token / 2,253 × 2-token / 2,821 × 3-token (cap) / 597 honest refusals (7.6%).
- Deploy: PR #74 (CI green) merged `aa63ab0`, gated deploy run `36980931195` success — the daily cron now derives brands instead of overwriting them back to ''.
- Live: `koskenkrova` → 0 results + `suggestion: Koskenkorva`; `jackdanels` → `Jack Daniel's`; 53 products branded Koskenkorva, 23 Jack Daniel's; `jameson` recall now leads with brand-token matches; viski (100) and olut (clean head) unchanged.

Known v1 limitation (documented in the module header): lexically unmarked line names over-capture within the 3-token cap ("Tuborg Sunsæt", "Bacardi Carta Blanca") — advisory-only impact on suggestions/bm25 ranking, never product identity (the Tier-2 compound key was backfilled BEFORE deploy so lookups match).
