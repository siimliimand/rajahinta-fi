# Notes — unit-integrity-and-result-trust

## Task 1.3 — backfill applied locally + seed export path normalized (2026-09-26)

Branch `feature/unit-integrity-and-result-trust`. Local D1 = wrangler miniflare state of
`apps/api-worker` (binding `DB`, database `rajahinta-api-dev`).

### Apply command

```
cd apps/api-worker
CI=true ./node_modules/.bin/wrangler d1 execute DB --local \
  --file ../../openspec/changes/unit-integrity-and-result-trust/backfill.sql
```

### Counts (product_master)

| measure | before | after |
|---|---|---|
| total rows | 1,570 | 1,570 |
| ml-like (`unit_volume >= 5`) | 1,502 | 5 |
| `unit_volume >= 100` | 1,500 | 0 |
| `unit_volume < 0` | 0 | 0 |
| entity-bearing `name` (`&#…` or `&amp;`) | 196 | 0 |
| entity-bearing `brand` | 0 | 0 |

Baseline matches the 2026-09-25 header figures (1,502 ml-like of 1,570; 68 litre-like).

The 5 post-backfill rows still `>= 5` are correct litre values, not misses: two 5 l BIBs,
two 15 l BIBs ("1500cl BIB"), and one feed claim "24×33 l" (Karhu case; the feed name
itself says 33 l). They were ml-shaped only because the old mapper stored ml
(15000 → 15.0 etc.), so the single division fixed them. Consequence: the pass is NOT
re-runnable for those rows; the "idempotent" header claim was corrected in backfill.sql.

### Findings that changed backfill.sql

1. **Column affinity**: `product_master.unit_volume` is REAL (drizzle `real`), not TEXT
   as assumed in the task context. `typeof` was `real` for all 1,570 rows. Division by
   1000.0 is plain float arithmetic; spot values land on the same IEEE doubles the litre
   literals use (0.5, 0.33, 0.75) and a 10-decimal GLOB scan found zero artifacts.
   No CAST needed.
2. **LIKE guard was too narrow**: it matched `%&#0%` / `%&#8%` / `%&amp;%`, which misses
   `&#215;`-only rows — 79 occurrences (mostly `24×0.33 l` case names). Guard broadened
   to `%&#%` OR `%&amp;%`.
3. **Missing entity form**: `&#8211;` (en dash, 10 occurrences) was not in the REPLACE
   chain. Added. Full census: `&#038;`×29, `&#215;`×79, `&#8211;`×10, `&#8217;`×57,
   `&#8221;`×8, `&amp;`×17 (200 tokens total; 0 remain).

### Post-condition deviation: 20 zero-volume rows

`unit_volume <= 0 OR >= 100` cannot reach 0: 20 rows hold `unit_volume = 0.0` (feed
names with no parsable volume token, e.g. "33CLx24" — the parser's word-boundary rule
skips `Lx`; kept-by-design records). Unit conversion cannot invent a volume. The
post-condition was split into `>= 100` (0 ✓) and `< 0` (0 ✓), and the zero-volume
population is documented in backfill.sql as known residue. Task 1.4's quality invariant
(`0 < unit_volume < 100`) is the fix point going forward; these 20 rows predate it.

### Seed export path normalization (`scripts/seed-d1.ts`)

Reality found: the D1 seed export path (`writeSeedSqlFiles` → `staging.d1.sql`) emits the
45 staging fixtures, which already carry litre values and decoded text; the litres +
entity-decoding fix point for feed data is the ingestion mapper (tasks 1.1/1.2, already
committed). The ml rows in the local DB (product ids 9003+) came from pre-1.1 ingestion
runs, not from the seed.

Change: `scripts/seed-d1.ts` gained a fixture integrity gate that runs first in every
mode (including `--emit-sql-only`), failing loudly (exit 2) if any fixture volume sits
outside the canonical band (0, 100) litres or any fixture `name`/`manufacturer`/`brand`
is entity-bearing. Entity detection reuses `decodeHtmlEntities` from
`@rajahinta/data-acquisition` (imported from source; see follow-ups) as the single
decoding truth — no second entity map. The gate turns "reseeding cannot reintroduce ml"
into an enforced contract instead of an accident of current fixture values.

Note: `generate.ts` emits fixture values verbatim (`String(unitVolume)`, raw strings),
so validating the fixtures is equivalent to validating the emitted SQL.

### Reseed evidence

```
cd apps/api-worker && CI=true pnpm db:seed:d1:local
```

Output: fixture gate passed → generate (sha256 identical to the committed-on-disk
generation) → migrate → seed → `verification PASSED`. Post-reseed counts identical to
the post-backfill table above; Koskenkorva fixture (id 2) and the swept
"Koskenkorva 38% 50cl PET x 10 pullon laatikko" (id 10439) both read 0.5; a former
`&#038;` row reads a literal `&`.

One-time local cleanup: seed verification initially failed on
`transport_offers_total: expected 12, got 15` — ids 9101–9103 (carriers
`test-merchant-de`/`test-merchant-se`) were residue from test runs against local
miniflare state, unrelated to this change. Deleted locally; reseed then passed.

### Follow-ups for the lead

- `packages/data-acquisition/dist` is stale (built before wave 1; `dist/index.js` does
  not export `decodeHtmlEntities`). The gate imports the module from source like the
  script's existing relative imports; a dist rebuild may be worth a separate pass.
- No typecheck/lint coverage covers `scripts/` today (no tsconfig there); the script was
  verified by tsx execution in both `--emit-sql-only` and `--local` modes plus eslint.

## 5.1 local verification (2026-09-26)

Branch `feature/unit-integrity-and-result-trust`, tree at commit `7555174` plus a
pre-existing local `girder.toml` edit (not made in this task). All commands run from the
repo root unless stated. Exit codes are the shell status of each command.

### Suites

| Suite | Command | Exit | Result |
|---|---|---|---|
| typecheck | `pnpm typecheck` | 0 | 8/8 workspace projects pass |
| lint | `pnpm lint` | 0 | eslint clean, no output |
| content lint | `pnpm lint:content` | 0 | passes |
| unit core-domain | `pnpm --filter @rajahinta/core-domain test` | 0 | 56 files, 1408 tests |
| unit application-api | `pnpm --filter @rajahinta/application-api test` | 0 | 58 files: 725 passed, 3 skipped |
| unit data-platform | `pnpm --filter @rajahinta/data-platform test` | 0 | 59 files, 653 tests |
| unit data-acquisition | `pnpm --filter @rajahinta/data-acquisition test` | 0 | 19 files, 295 tests |
| unit api-worker | `pnpm --filter @rajahinta/api-worker test` | 0 | 62 files, 945 tests |
| unit frontend | `pnpm --filter @rajahinta/frontend test` | 0 | 93 files, 963 tests |
| golden | `pnpm test:golden` | 0 | 2 files, 44 tests; Case 8 (task 2.1 rail shape) green |
| D1 | `pnpm test:d1` | 0 | 14 files, 148 tests |
| e2e (vitest) | `pnpm test:e2e` | 0 | 1 file, 15 tests; ran with no extra environment |
| e2e-browser (Workers) | `E2E_FRONTEND_PORT=8797 E2E_API_PORT=8798 pnpm exec playwright test -c tests/e2e-browser/playwright.workers.config.ts` | 1 | 7 passed, 1 failed — see below |

### e2e-browser failure (diagnosis only, not fixed)

Failing test: `tests/e2e-browser/account-export.spec.ts:22 > anonymous visitor: no
session minted, no account data rendered`, assertion at line 42:
`expect(page.getByText('Tilin tietojen lataaminen epäonnistui.')).toBeVisible()` timed
out after 15 s.

Diagnosis: the spec's docblock assumes "the harness has no /me — credentials live in the
API Worker", but the API Worker does serve `GET /api/v1/account/me`
(`apps/api-worker/src/routes/accounts.routes.ts:699`, guarded by `sessionAuth()` in
`middleware/guards.ts:126`). An anonymous visitor therefore gets a real 401 and the
frontend follows the D8 design (401 → redirect to `/login`); the Playwright error
context shows the `/login` page ("Kirjaudu" link), not the account failure state. The
test's negative assertions (no "Tervetuloa takaisin", no `rajahinta_session` cookie)
passed. Nothing in this change's diff touches account, auth, or session code (verified
against `git diff 065971fa...HEAD` — 51 files, none in that area). Follow-up for the
lead: the spec or the accounts module needs a decision; this failure predates and is
independent of this change.

### Local stack pass

Booted per the repo's Workers harness (`tests/e2e-browser/boot-workers-stack.sh`):

1. `KEEP_D1=1 E2E_API_PORT=8798 E2E_FRONTEND_PORT=8797 bash
   tests/e2e-browser/boot-workers-stack.sh api` — failed by design: the task-2.6 seed
   verification checks exact totals and the journey fixtures were present
   (`transport_offers_total: expected 12, got 15`). The harness's documented answer is a
   reset, so the api was rebooted without `KEEP_D1` (state is reproducible: fresh
   migrate + seed + journey fixtures). Seed output: fixture integrity gate passed
   (45 products), `verification PASSED`.
2. `SKIP_BUILD=1 E2E_API_PORT=8798 E2E_FRONTEND_PORT=8797 bash
   tests/e2e-browser/boot-workers-stack.sh frontend` — reused the `.open-next` build the
   Playwright run had just produced with `NEXT_PUBLIC_API_URL=http://localhost:8798`.

Consequence for this task: the pre-reset local state (including swept feed row 10439,
"Koskenkorva 38% 50cl PET x 10 pullon laatikko" at €9.87) is gone; the fresh local D1
holds the 45 staging fixtures (litre-correct) plus journey fixtures. The exact
€98.70/€107 basket shape is therefore not servable from local fixture data; see the
cross-check below for why the figures still confirm the expectation.

Processes: API worker pid 3719481 (:8798), frontend worker pid 3720547 (:8797). Both
stopped after the pass via `E2E_API_PORT=8798 E2E_FRONTEND_PORT=8797 bash
tests/e2e-browser/boot-workers-stack.sh down`; ports 8797/8798 verified free. An
unrelated stale `workerd` from a previous session still listens on 127.0.0.1:8787
(pid 3366745, answering 404) — started outside this task, left untouched, flagged for
optional cleanup.

### Calculator figures (HTTP, POST /api/v1/calculator, `x-age-confirmed: 1`)

Request `{"productId":2,"quantity":10,"destination":"FI"}` (Koskenkorva Salmiakki,
0.5 l, 32 %, offer €25.90):

| Component | Cents | Reliability |
|---|---|---|
| Retail price (10 × €25.90) | 25900 | VERIFIED |
| Transport | 0 | UNAVAILABLE (known gap) |
| Alcohol excise | 9000 | VERIFIED |
| Container duty | 260 | ESTIMATED |
| Import VAT | 8966 | VERIFIED (import-vat-2024.2) |
| Total | 44126 | — |

Excise lands in the tens (€90.00), not tens of thousands; duty is €2.60 against the
task's ≈€2.55 estimate (dataset rate €0.26/bottle). Overall confidence LOW comes from
the UNAVAILABLE transport component; `sanityNotes` is absent — correct, the rail did not
arm (excise €9.00/bottle < 5 × €25.90/bottle). `meta.volumeLitres` reads `0.5`
(litres canonical end-to-end); `datasetVersions: ["v3.0-2026","v3.0-2026","import-vat-2024.2"]`.
A 12-quantity request through the UI reproduced the shape (total €529.51, excise
€108.00 = 1.92 LPA × €56.25/LPA).

Cross-check of the ≈€107 expectation: the observed engine rate is €56.25 per litre pure
alcohol; the task's basket (10 × 0.5 l × 38 % = 1.9 LPA) gives 1.9 × €56.25 = €106.88 ≈
€107. Price and duty deltas trace to the wiped swept row, not the engine.

### Sanity-rail arm check

No live seam exists in the fresh fixture set: no fixture's excise exceeds 5× its line
retail price (checked via D1 query over `retail_offers` ⋈ `product_master`; the only
cheap-strong candidates absent). The rail is instead covered by the green suites: golden
Case 8 ("degrades the implausible line (LOW + ESTIMATED + notes) instead of passing
VERIFIED — amounts unchanged") and the core-domain `sanity-rail.test.ts` unit tests.

### Search rows and value ranking (HTTP)

- `GET /api/v1/products?q=Koskenkorva`: id 2 "Koskenkorva Salmiakki" `unitVolume
  "0.5000"`, `lowestPriceCents 2590`, `merchantCount 1`; id 1 "Koskenkorva Viina"
  `"0.7000"`, 3290, 1. Aggregates non-null (task 3.1/3.2).
- `GET /api/v1/unitprice/ranking?category=spirits`: 11 items, ascending €/g
  (14.23–…), `ethanolGrams` max 315.6 g. No tonne-scale artifact; values physically
  plausible for the catalog.

### Browser pass (done)

Interactive pass on `http://localhost:8797` (fi locale): calculator search returned rows
"Koskenkorva Salmiakki — 50 cl · 32 % — Halvin havaittu hinta: €25.90" and
"Koskenkorva Viina — 70 cl · 38 % — €32.90"; selecting Salmiakki showed the Configure
step with "Alin havaittu hinta: €25.90"; calculating (qty 10) rendered the result panel
€441.26 with the breakdown above, the structural disclaimer, and no sanity-note block.
`/products` renders formatted attributes ("70 cl · 38 %", "50 cl · 32 %", prices and
"Myyjiä: 1"); `/value` renders ascending €/g with sane gram figures.

One interaction artifact observed, diagnosed, not fixed: the first UI calculation
(qty 10) also surfaced an error banner `D1_ERROR: UNIQUE constraint failed:
calculation_records.id, calculation_records.calculated_at`. The same input had been
calculated minutes earlier via curl, so the idempotency cache returned the original
result and the record re-save collided with the stored row. A fresh input (qty 12)
calculated cleanly with no banner, so record persistence works for new inputs. For
clean local passes, calculate each input through one client only.

Screenshots captured to `openspec/changes/unit-integrity-and-result-trust/images/`
(follows the archived-change `images/` convention):
`calculator-search-rows.png`, `calculator-configure-price.png`,
`calculator-result-10x.png`, `products-listing-formatting.png`, `value-ranking.png`.
Note: full-page captures render the sticky header band mid-image; a screenshot
artifact, not a page defect.

### Follow-ups for the lead

- Decide the `account-export.spec.ts` vs API Worker `/api/v1/account/me` divergence
  (failure pre-exists this change).
- The Workers e2e harness resets local D1 each run, so swept-feed rows (10439-style)
  never survive locally; basket-shape verification against swept data belongs in golden
  or seed fixtures, not the local stack.
- Optional: clean up the stale workerd pid 3366745 on :8787.
