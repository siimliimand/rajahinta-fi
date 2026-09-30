# Change notes — data quality gates and publication trust

Operator evidence log. Sections here hold **recorded facts, never
predictions**: every placeholder marked `TBD (operator)` is filled by
the operator who ran the command, with the command output as the
source. This file is never pre-filled with expected values — an
estimated count next to a real one is indistinguishable from the real
one, which is the exact failure mode this change exists to prevent.

## 2.1 Alko reference landing

Production data operation — trigger and verification procedure:
`docs/ingestion-runbook.md` §6 ("Alko reference feed — manual
(re-)run and verification"). All commands read-only except the one
registry write called out there (§6.2).

| Metric | Value | Recorded via |
|---|---|---|
| `withReference` before | TBD (operator) | §6.4(b) |
| `withReference` after | TBD (operator) | §6.4(b) |
| EAN join hit-rate | TBD (operator) | §6.4(c) |
| Verified at (UTC) | TBD (operator) | command timestamp |

Supporting before/after pair for the reference offers themselves
(runbook §6.4a) — baseline expected to be 0:

| Metric | Value |
|---|---|
| Alko reference offers before | TBD (operator) |
| Alko reference offers after | TBD (operator) |

Exact commands (production, runbook §6.4 flag pattern):

```bash
cd apps/api-worker

# §6.4(b) withReference — materialized snapshot rows, latest as-of day
wrangler d1 execute DB --remote --env production --command "\
  SELECT COUNT(*) AS with_reference FROM savings_snapshots \
  WHERE as_of = (SELECT MAX(as_of) FROM savings_snapshots) \
    AND alko_reference_cents IS NOT NULL" -y

# §6.4(c) EAN join hit-rate — offered products whose EAN matches an
# Alko-referenced product's EAN / all offered products
wrangler d1 execute DB --remote --env production --command "\
  WITH alko_eans AS ( \
    SELECT DISTINCT pm.ean AS ean FROM retail_offers ro \
    JOIN product_master pm ON pm.id = ro.product_id \
    WHERE ro.merchant = 'alko' AND pm.ean IS NOT NULL), \
  offered AS ( \
    SELECT DISTINCT ro.product_id AS product_id, pm.ean AS ean \
    FROM retail_offers ro JOIN product_master pm ON pm.id = ro.product_id) \
  SELECT (SELECT COUNT(*) FROM offered) AS products_with_offers, \
    (SELECT COUNT(*) FROM offered WHERE ean IS NOT NULL \
      AND ean IN (SELECT ean FROM alko_eans)) AS ean_matched_products, \
    ROUND(100.0 * (SELECT COUNT(*) FROM offered WHERE ean IS NOT NULL \
      AND ean IN (SELECT ean FROM alko_eans)) / \
      NULLIF((SELECT COUNT(*) FROM offered), 0), 1) AS ean_join_hit_rate_pct" -y

# §6.4(a) Alko reference offer count (before/after pair)
wrangler d1 execute DB --remote --env production --command "\
  SELECT COUNT(*) AS alko_reference_offers FROM retail_offers \
  WHERE merchant = 'alko'" -y

# Public-surface confirmation (age gate applies; runbook §6.5)
curl -H "x-age-confirmed: 1" \
  "https://api.rajahinta.fi/api/v1/savings?category=spirits"
# Expect coverage.withReference > 0 after the landing.
```

Endpoint confirmation record (fill after §6.5):

| Check | Result |
|---|---|
| `GET /api/v1/savings?category=spirits` → `coverage.withReference` | TBD (operator) |
| Homepage savings card state (listing CTA restored) | TBD (operator) |

Task 2.1 stays open until the operator records the real numbers above;
task 5.2's "savings coverage after 2.1" live check reads this section.

## 2.2 Posti transcription — operator procedure

The live fetch was attempted from this session (2026-09-30) per the
admin procedure in `posti-rate.source.ts` and confirmed still blocked:

| Attempt | Result |
|---|---|
| `GET https://www.posti.fi/api/price-list/parcels.json` (this session, datacenter egress) | HTTP 403 — the documented CDN block (error 1031 class) |
| Wayback availability API for the same URL | no archived snapshots (re-confirmed) |
| posti.fi public HTML (homepage, business parcel pages) | reachable, but publishes only domestic and outbound (from-Finland) prices — **not** the inbound lane table; transcribing those rows into TO-Finland lanes would fabricate data and was not done |

The block is **egress-IP-specific** (datacenter/Cloudflare ranges), so
the operator's own browser should fetch the endpoint directly:

1. Open `https://www.posti.fi/api/price-list/parcels.json` from a
   normal (residential/mobile) connection and save the payload.
2. Deliver the JSON to the engineer/agent session (or transcribe
   directly per the admin procedure in `posti-rate.source.ts` steps
   1–3): every lane shipping TO Finland, one row per lane + package
   tier + weight bracket, VAT-inclusive EUR cents, `POSTI_OBSERVED_AT`
   bumped to the review date.
3. The transcription lands as the `POSTI_RATES` dataset rows plus the
   golden-fixture test pinning them (task 2.2's remaining deliverable);
   the monthly curated sync publishes them on the next deploy.
4. Record the fetch date + row count here and re-run the calculator
   transport check (task 5.1's fourth evidence item) — until then the
   calculator honestly renders transport as not-included.

| Metric | Value |
|---|---|
| Payload fetched at (UTC) | TBD (operator) |
| Inbound-lane rows transcribed | TBD (operator) |
| `POSTI_OBSERVED_AT` bumped to | TBD (operator) |

Task 2.2 stays open until the transcribed rows land.

## 5.1 Local verification (2026-09-30)

Full local verification of the working tree at `cbab396`
(`feature/data-quality-and-publication-trust`), run with node
v24.21.0 / pnpm 9.15.9 (`PATH=/root/.nvm/versions/node/v24.21.0/bin`).
Everything below is recorded output; no code was changed by this pass.

### Suite results

| Suite (command) | Exit code | Count |
|---|---|---|
| `pnpm typecheck` | 0 | 8/8 workspace projects pass |
| `pnpm lint` | 0 | clean |
| `pnpm lint:content` | 0 | clean |
| `pnpm test` (unit, recursive) | **1** | 1 failed / 5371 passed / 3 skipped — details below |
| `pnpm test:golden` | 0 | 44/44 (2 files) |
| `pnpm test:d1` | 0 | 159/159 (14 files) |
| `pnpm test:e2e` | 0 | 15/15 (1 file) |

Unit totals by package — email-worker 83, core-domain 1440, api-worker
1058, frontend 1025, data-platform 695 passed + **1 failed** (696),
data-acquisition 323, application-api 728 passed + 3 skipped (731),
backend 19. `pnpm -r test` stops at the first failing package, so the
last three were run individually afterwards (`pnpm --filter … test`)
and are green; the failure is not masking anything downstream.

### Failures (recorded, not fixed — verifier pass)

1. **Unit** — `packages/data-platform`:
   `src/repositories/d1/__tests__/session.repository.test.ts >
   D1SessionRepository > deleteExpiredBefore removes only expired
   sessions and returns the count`
   → `AssertionError: expected null not to be null`
   at `session.repository.test.ts:193:5`. Reproduces in isolation
   (rerun of the single file: 1 failed / 8 passed) — deterministic,
   not flaky. This branch's diff touches no session code; the test and
   repository were last modified in `aa743c4` (migrate-to-cloudflare
   2.5).
2. **Browser** — Playwright workers suite
   (`tests/e2e-browser/playwright.workers.config.ts`): 13 passed /
   **1 failed** — `[chromium] › account-export.spec.ts:22:7 ›
   anonymous visitor: no session minted, no account data rendered`
   → `Error: expect(locator).toBeVisible() failed …
   'Tilin tietojen lataaminen epäonnistui.' element(s) not found`.
   Observed on the live stack: `GET /api/v1/account/me` unauthenticated
   answers 401 `SessionRequired` (correct), and the account page
   handles 401 by redirecting to `/login` (its designed sign-in
   surface); the journey still expects the retry-affordance message.
   Stale journey expectation on the auth surface — unrelated to this
   change's data-quality behaviors. The journey's other assertions
   (no welcome heading, no session id, no `rajahinta_session` cookie
   on the calculator path) passed.

### Live checks (workers stack, real headless Chromium)

Stack booted per the repo's own harness
(`tests/e2e-browser/boot-workers-stack.sh`): local D1 reset →
migrations → task-2.6 seed → journey fixtures → API Worker `:8788`
(health/ready 200, d1 + DOs up) → frontend Worker `:8787`
(`SKIP_BUILD=1`, `.open-next` output from the suite's build).
Locale fi (default); evidence screenshots kept outside the repo in
`/tmp/opencode/51-home-savings.png`, `/tmp/opencode/51-calculator-transport.png`.

1. **LOWEST_PRICE head has no €0.00 — PASS.**
   `GET /api/v1/products?sort=LOWEST_PRICE` (age-gated): head is
   "Pirkka Pasta" at `lowestPriceCents: 89` (€0.89); all 47 products
   sort strictly ascending 89 → 95000 c with **no zero-priced row**;
   the one unpriced product ("Sample Aperitif") sorts **last** with
   `lowestPriceCents: null` — offer-less tail, never a €0.00 figure.
2. **Calculator renders the honest transport state — PASS.**
   API (`POST /api/v1/calculator`, product 9001 TEST Beer ×6 → FI):
   itemized `transportCost | cents: 0 | reliability: UNAVAILABLE`;
   total 1770 c = 894 + 516 + 0 + 360 (transport adds nothing).
   Browser (`/calculator`, search TEST Beer, qty 6, "Laske
   kokonaiskustannus"): the transport row renders
   `transport-not-included` = "Ei sisällytetty – tietoaineisto
   odottaa" with the "Ei saatavilla" badge — **no amount on the
   line** — plus the `transport-pending-note` explanation. The only
   €0.00 anywhere in the breakdown is the container-duty line
   (different category, verified-zero); the transport line shows text,
   not a figure.
3. **Homepage savings card matches the overview — PASS.**
   `GET /api/v1/savings/overview` → `{"asOf":null,"categories":[]}`
   (with-reference sum = 0). Homepage renders
   `savings-card-pending` ("Alkon viitehintoja ei ole vielä
   yhdistetty tuotteiden kokonaishintalaskelmiin, joten luetteloa ei
   ole vielä julkaistu.") and contains **zero** `a[href="/savings"]`
   links — pending card, no CTA into the unpublished listing.
4. **Posti-backed calculation shows a real transport figure — DEFERRED.**
   Not runnable: the transport dataset is empty by design until task
   2.2's operator transcription lands (see §2.2 — live endpoint 403
   from datacenter egress, no Wayback snapshot, inbound lanes not
   published on posti.fi HTML). The honest-state rendering above is
   the designed behavior for exactly this state; the check re-runs
   after §2.2's table is filled.

### Exact commands

```bash
export PATH=/root/.nvm/versions/node/v24.21.0/bin:$PATH

pnpm typecheck; pnpm lint; pnpm lint:content
pnpm test                       # 1 failed (data-platform) → short-circuit
pnpm --filter @rajahinta/data-acquisition test
pnpm --filter @rajahinta/application-api test
pnpm --filter @rajahinta/backend test
pnpm test:golden; pnpm test:d1; pnpm test:e2e

# Browser pass — workers stack (D1), suite manages both servers:
pnpm exec playwright test -c tests/e2e-browser/playwright.workers.config.ts
# → 13 passed / 1 failed (account-export journey, see above)

# Manual live pass for the three checks:
bash tests/e2e-browser/boot-workers-stack.sh api
SKIP_BUILD=1 E2E_API_PORT=8788 E2E_FRONTEND_PORT=8787 \
  bash tests/e2e-browser/boot-workers-stack.sh frontend
curl -s -H "x-age-confirmed: 1" \
  "http://localhost:8788/api/v1/products?sort=LOWEST_PRICE"
curl -s -H "x-age-confirmed: 1" -H "content-type: application/json" \
  -X POST http://localhost:8788/api/v1/calculator \
  -d '{"productId":9001,"quantity":6,"destination":"FI"}'
curl -s -H "x-age-confirmed: 1" http://localhost:8788/api/v1/savings/overview
# + headless-Chromium driver over the real UI (age gate → calculator
# → result card; homepage card), script kept in /tmp/opencode/
bash tests/e2e-browser/boot-workers-stack.sh down
```

### Failure verdicts (lead review, 2026-09-30) — both PRE-EXISTING on master, fixed on this branch

Neither failure touches a file this change modifies (`git diff master...HEAD` over
`packages/data-platform/`, `tests/e2e-browser/`, and the account pages is empty):

1. **`session.repository.test.ts` date bomb** — the kept session's expiry was the
   hardcoded literal `2026-09-30T00:00:00Z`, which expired at 00:00 UTC on its own
   date: the test passed 2026-09-29 and failed 2026-09-30, turning master CI red
   independently of this branch. Fixed in `a4164d9`: kept-session expiry rides
   `DEFAULT_EXPIRY()` (now + 30 days); the expired-side fixtures stay fixed past
   dates, which is correct for always-expired rows.
2. **`account-export.spec.ts` stale journey** — the journey pinned the old
   harness-stack divergence ("retry affordance"), but the account page's client
   unconditionally replaces the route with `/login` on a 401 (design D8) on every
   stack, so the retry message never renders. Fixed in `9230896`: the journey
   asserts the designed redirect outcome (`/login` URL) plus the unchanged
   no-data/no-cookie pins.

Post-fix evidence (owner-approved fixes, 2026-09-30):

| Check | Result |
|---|---|
| `session.repository.test.ts` in isolation | 9/9 pass |
| `account-export` journey on the workers stack | 1 passed |
| Full `pnpm test` (all packages) | green — api-worker 1058, frontend 1025, data-platform 696, data-acquisition 323, application-api 728 (+3 skip), backend 19 |

With these two, every suite in task 5.1's list is green; the only non-green item
remains the deferred Posti-backed figure (§2.2 operator data), and 5.1's run is
otherwise the verification record for the deploy gate in 5.2.
