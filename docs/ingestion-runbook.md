# Ingestion runbook — merchant onboarding and governance grants

Operational sequence for onboarding a merchant source in the merchant
registry and granting it through the operator console (`/ops`). The
worked example is the `alks` source — a WooCommerce Store API feed at
`https://alks.fi`, seller country `DE`, hourly cadence (task 2.3,
change `alks-feed-and-import-vat`). Future merchants follow the same
sequence. The staging grant is performed by an operator during change
verification; production grants follow §3.

Every artifact this runbook references is in the repository:

| Artifact | Path |
|---|---|
| Operator console (`/ops`) | `apps/frontend/src/app/[locale]/ops/` |
| Console routes (grant/revoke/audit) | `apps/api-worker/src/routes/ops.routes.ts` |
| Access guard (`OPS_BEARER_TOKEN`, `OPS_IP_ALLOWLIST`) | `apps/api-worker/src/middleware/ops-access.ts` |
| Hourly scheduler + governance gate | `apps/api-worker/src/queues/ingestion-producer.ts` |
| Pipeline permission gate | `packages/data-acquisition/src/services/pipeline-orchestrator.service.ts` |
| Merchant registry seed (incl. `alks`) | `packages/data-platform/src/seed/merchant-registry.seed.ts` |
| alks adapter | `packages/data-acquisition/src/adapters/alks.adapter.ts` |
| Full-catalog sweep (read-only audit) | `scripts/alks-catalog-sweep.ts` |

Roles: the **ops lead** executes grants and revocations; the
**platform engineer** owns the adapter, the registry seed, and the
governance-store wiring.

---

## 0. How the gate works (read before granting)

**Registry ≠ permission.** A `merchant_registry` row only makes a feed
known to the scheduler. Fetching requires a governance record for the
merchant whose status aggregates to `GRANTED`; new merchants have no
governance records and therefore default to `PENDING` (off).

Three fail-closed checkpoints enforce this. None of them can be
configured to default open:

1. **Hourly producer** (`schedulePriceIngestions`, cron `0 * * * *`):
   one Queue message per permitted merchant only. No governance
   records, a governance error, or any status other than `GRANTED`
   skips the merchant with a warning log.
2. **Pipeline/workflow gate** (`checkMerchantPermission`): re-checks
   permission before the fetch step. A governance repository outage is
   reported as `PENDING` so an infrastructure failure can never
   surface as access.
3. **Console reads**: `GET /ops/console/governance` never overstates
   permission; a merchant without records surfaces as `PENDING`.

**Cadence and the hourly tick.** The producer runs once per hour
(cron `0 * * * *`, UTC) and honors each registry row's
`pollingIntervalMs` by comparing epoch-aligned interval buckets
between consecutive ticks (`intervalBucketFires`). The minimum
schedulable interval is therefore 3,600,000 ms (1 h) — a row cannot
fire more than once per hour no matter how small its interval. The
seed's daily value, 86,400,000 ms (24 h), fires on the 00:00 UTC pass
— the first hourly tick of the UTC day.

Before a grant, the gate's behavior for the merchant is exactly the
spec's fail-closed scenario: **the pipeline performs no fetch for it
and persists no data**. The producer log line for an ungranted
merchant reads:

```
Not scheduling merchant "alks": no governance records — defaulting to PENDING
```

Every grant and revocation is a human console action, recorded in the
durable `audit_events` table with the operator identity, target, and
reason. The one exception to the two-step sequence is registration
itself: per owner policy (2026-09-11, blanket permission for every
merchant feed the owner registers), `POST /ops/console/merchants`
auto-grants a merchant that has NO governance records — registering a
merchant asserts permission for its feed. Explicit records are never
touched by registration: a `REVOKED` merchant stays revoked after
re-registration (revocation remains the kill switch), and there is no
config-file grant path.

---

## 1. Preconditions

- [ ] **Registry row present.** `alks` ships in the merchant-registry
      seed (task 2.2); staging gets it through the deploy pipeline's
      seed step. Verify: `GET $STAGING_API_URL/ops/console/governance`
      lists `alks`. A grant against an unknown merchant returns 404.
- [ ] **Console access configured on the API Worker.** The
      `/ops/console/*` prefix requires the bearer token
      (`wrangler secret put OPS_BEARER_TOKEN`, per environment) and,
      optionally, an IP allowlist (`OPS_IP_ALLOWLIST`, comma-separated
      IPs/CIDRs). If neither is configured, every ops route is denied
      (403) by design. Requests carry
      `Authorization: Bearer $OPS_BEARER_TOKEN`.
- [ ] **Migration 0021 applied to the environment's D1 database.** The
      durable `source_governance` table (D1 migration
      `packages/data-platform/src/d1/migrations/0021_source_governance.sql`)
      must exist before granting is possible — grant, revoke, list, and
      both ingestion gates read it, and granting is possible only
      through the console once it does. The staging deploy pipeline
      applies it automatically (`wrangler d1 migrations apply` over the
      shared drizzle-kit migration dir, before seed and rollout);
      production applies migrations in the gated
      `deploy-production.yml`. Verify:
      `GET $STAGING_API_URL/ops/console/governance` lists every
      merchant as `PENDING` with zero sources. An un-granted merchant
      stays fail-closed (`PENDING`) exactly as before. **Do not work
      around a missing table with manual database writes** — apply the
      migration through the pipeline; grants themselves are console
      actions (§2.2).

---

## 2. Staging: register and grant the `alks` source

### 2.0 One-step alternative: register + auto-grant (preferred)

For a NEW merchant the two steps collapse into one console call — the
registration upserts the registry row and auto-grants the feed URL in
the same request (two audit entries: `merchant_registry` created and
`source_governance` created):

```bash
curl -X POST "$STAGING_API_URL/ops/console/merchants" \
  -H "Authorization: Bearer $OPS_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "merchantId": "alks",
        "name": "Alks",
        "country": "DE",
        "feedUrl": "https://alks.fi",
        "feedFormat": "json",
        "pollingIntervalMs": 86400000,
        "operator": "ops-lead-name",
        "note": "owner blanket permission policy"
      }'
```

Optional fields: `acquisitionMethod` (default `RETAILER_API` — the
public store-API pattern), `feedFormat` (default `json`),
`pollingIntervalMs` (default 3600000). Pin `feedFormat` and
`pollingIntervalMs` explicitly when UPDATING an existing row: the
upsert overwrites the whole registry row, so an update that omits
`pollingIntervalMs` silently resets the cadence to the hourly default
— the seed's alks cadence is daily, 86400000. The response carries
`registered: created|updated`, `autoGranted: true|false`, and the
effective aggregated `permissionStatus` — `autoGranted` is `false` and
governance untouched when the merchant already has records (a
`REVOKED` merchant stays revoked). This also replaces §3's manual
production registry insert: against the production API the same call
registers and grants in one audited action.

The worked example below keeps the original two-step sequence (seeded
registry row + explicit grant) for environments where the row already
exists.

### 2.1 Confirm the fail-closed state before the grant

Trigger or wait for one hourly pass and check the Worker logs:

```
Skipping merchant "alko": registry feed URL is empty
Not scheduling merchant "alks": no governance records — defaulting to PENDING
Hourly price ingestion: enqueued 0/2 registry merchant message(s) — one message per permitted merchant
```

(The seed's `alko` row carries an empty `feedUrl` until that adapter's
feed URL is live, so `alks` is the only merchant the pass currently
considers for enqueueing.) Also confirm no `alks` offers exist: the
calculator and product search return nothing for the merchant, and no
data was persisted.

### 2.2 Grant through the operator console

Console steps (staging frontend
`https://rajahinta-frontend-staging.siim-liimand.workers.dev/ops`):

1. Enter the operator name (recorded as the audit author) and the ops
   bearer token; load the console.
2. In the governance section, set **acquisition method** to
   `RETAILER_API` and **source URL** to `https://alks.fi`. This
   matches the registry `feedUrl`; the adapter appends the Store API
   path `/wp-json/wc/store/v1/products` to it. Optionally add a note
   (recorded as the audit reason).
3. Press **Grant** on the `alks` row (the button enables once the
   source URL is non-empty).
4. Expect the mutation result `permissionStatus: GRANTED`,
   `changed: true`, and the row refreshing to `GRANTED` with one
   source.

The same action via the API:

```bash
curl -X POST "$STAGING_API_URL/ops/console/governance/alks/grant" \
  -H "Authorization: Bearer $OPS_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "operator": "ops-lead-name",
        "acquisitionMethod": "RETAILER_API",
        "sourceUrl": "https://alks.fi",
        "note": "change alks-feed-and-import-vat: staging grant for verification"
      }'
```

Grant semantics, in order: a merchant with a `PENDING` or `EXPIRED`
record has it transitioned to `GRANTED`; a merchant with no records
gets one registered directly as `GRANTED` — so this single action is
both the source registration (`RETAILER_API`, `https://alks.fi`) and
the grant; an already-`GRANTED` merchant is a no-op
(`changed: false`, nothing audited). Validation errors (400): operator
must be a non-empty string (max 128 chars), `acquisitionMethod` must
be one of the governance enum values, `sourceUrl` must be non-empty.

Verify the audit entry:

```bash
curl "$STAGING_API_URL/ops/console/audit?limit=5" \
  -H "Authorization: Bearer $OPS_BEARER_TOKEN"
```

Expected: an `audit_events` entry with `entityType: source_governance`,
`entityId: alks`, `action: created`, the operator identity, and the
note.

### 2.3 Verify the first ingestion run

At the next hourly pass (cron `0 * * * *`; the message dedupe key is
`price-ingestion-alks-<UTC hour bucket>`):

- Producer log: `enqueued 1/2 registry merchant message(s)` with no
  `Not scheduling merchant "alks"` warning.
- The workflow runs fetch → map → lint → upsert against the Store API
  (sequential pagination, `per_page` 100). Offers for `alks` appear
  with reliability status and provenance; products with unparsed ABV
  or volume ingest as `ESTIMATED` by design, and SKU rows that do not
  match the EAN pattern land in the correction queue — both are
  expected adapter behavior (design D1/D3), not gate failures.
- Today's R2 observation partition (`observations/YYYY-MM-DD.jsonl`)
  grows after the first changed-offer pass.

To turn the source off again, use the console **Revoke** action on the
`alks` row (the note field doubles as the required reason) or
`POST /ops/console/governance/alks/revoke`. The status flips to
`REVOKED`, the producer skips the merchant on the next pass, and the
gate blocks any in-flight run. Revocation stops ingestion; it does not
purge already-ingested data — removal is a separate, explicit purge
(as done for the removed Systembolaget merchant).

---

## 3. Production grant

Production grants follow the same procedure against the production
origins (`https://api.rajahinta.fi`, console at
`https://rajahinta.fi/ops`), with two production-specific
preconditions:

1. **Registry row (production is never seeded).** The deploy pipeline
   deliberately has no seed step in production, so the `alks` row must
   be inserted manually, mirroring the seed row exactly and
   idempotently:

   ```bash
   cd apps/api-worker
   wrangler d1 execute DB --remote --env production --command "\
     INSERT INTO merchant_registry (merchant_id, name, country, feed_url, feed_format, polling_interval_ms) \
     VALUES ('alks', 'Alks', 'DE', 'https://alks.fi', 'json', 86400000) \
     ON CONFLICT (merchant_id) DO UPDATE SET \
       name = 'Alks', country = 'DE', feed_url = 'https://alks.fi', \
       feed_format = 'json', polling_interval_ms = 86400000, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')" -y
   ```

   Verify with `GET https://api.rajahinta.fi/ops/console/governance`
   (the merchant appears in the list). Do not set an empty `feed_url`
   for a merchant whose adapter is live — an empty URL marks "adapter
   not live yet" and the producer skips the merchant.
2. **Per-environment console access.** `OPS_BEARER_TOKEN` (and
   `OPS_IP_ALLOWLIST` if used) is a separate secret per environment;
   confirm it exists for production before granting.

Then grant exactly as in §2.2 against the production API, and verify:

- [ ] Audit entry present (`entityType: source_governance`,
      `entityId: alks`, production operator identity).
- [ ] Next hourly pass enqueues `alks` (producer log
      `enqueued 1/2`) and the first run completes without a
      `Not scheduling merchant "alks"` warning.
- [ ] Offers for `alks` appear in the calculator with the data
      freshness panel populated; the production R2 observation log
      gains the merchant's partitions.

Revocation in production follows §2.3's revoke path, with the reason
recorded in the audit trail.

---

## 4. Catalog sweep (`scripts/alks-catalog-sweep.ts`)

A manual, read-only audit of the live alks catalog (task 7.1). It
walks the Store API exactly as the adapter does — sequential pages,
`per_page` 100, `X-WP-TotalPages` bound — and pushes every raw row
through the production parser (`parseAlksStoreProducts`), so its
numbers describe what the next ingestion pass would produce. It
issues GET requests only: no database, no writes, no ingestion. The
governance gate does not apply to it — running the sweep against a
PENDING or REVOKED merchant is expected and harmless, and running it
is never a substitute for a grant.

Run from the repo root (the path is relative to the `data-platform`
package cwd, same convention as `scripts/seed-d1.ts`):

```bash
pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/alks-catalog-sweep.ts
```

Reading the report:

- **Catalog walk.** `X-WP-Total` versus raw rows seen, pages fetched
  ok, page failures. A `WARNING: rows seen ... differ from
  X-WP-Total` line means pagination drift or a catalog change
  mid-walk; re-run before trusting the shares. The script prints
  `sweep COMPLETE` only with zero page failures and a non-empty walk;
  otherwise it exits 1 and the shares are not trustworthy.
- **EAN pattern coverage.** Share of SKUs matching
  `^[a-z]{2}-\d{13}$`, measured on raw rows so missing or empty SKUs
  stay in the denominator. Non-matching SKUs are kept by the parser
  without an EAN and land in the correction queue (design D1); a low
  share is the signal to reconsider EAN matching for this merchant.
- **ESTIMATED share.** Parsed records whose ABV (null) or volume
  (0 ml) could not be parsed from the name — exactly the offers that
  ingest as ESTIMATED (design D3). A rising share means the name
  parser needs another iteration.
- **Category disagreements and drop buckets.** Name-vs-category
  beverage-type contradictions, the other adapter-level drop
  categories (no canonical beverage category, non-EUR price, invalid
  minor-unit price, missing product name), and the KEPT
  non-matching-SKU bucket. `records parsed + rows dropped` should
  reconcile with raw rows seen; parse errors matching no known
  category print a WARNING — the classifier vocabulary has drifted
  from the parser's wording and the sweep table needs updating.

Treat the numbers as sweep outputs to re-measure, never as pinned
values. The first full sweep (2026-09-09) reported 2,856 rows, EAN
coverage 91.3 % before the mapper-vocabulary patch for
`akvavit`/plural forms landing in parallel, an ESTIMATED share around
2 %, and category disagreements around 0.6 %.

Re-run the sweep when a parser or category-mapper vocabulary change
lands (confirm the drop buckets actually shrink), before and after a
production grant (record the baseline for that environment's
catalog), or when the correction queue shows an unexplained spike.
Nothing schedules the sweep — it runs when an operator runs it.

---

## 5. Verification checklist (per environment)

- [ ] Pre-grant: producer skips the merchant, no fetch, no data
      persisted (§0 fail-closed contract).
- [ ] Grant action returns `permissionStatus: GRANTED`,
      `changed: true`; console row shows `GRANTED` with one source.
- [ ] Audit entry recorded with operator identity and reason.
- [ ] Next hourly pass enqueues the merchant; first run upserts offers
      and appends observations to R2.
- [ ] Catalog sweep run against the live Store API (§4) and its
      EAN / ESTIMATED / disagreement numbers recorded in the change
      notes or an ops note.
- [ ] Revocation path exercised once (staging): producer skips the
      merchant again after `REVOKED`.

---

## 6. Alko reference feed — manual (re-)run and verification

Operational sequence for landing the domestic Alko reference prices in
production and verifying the savings funnel end-to-end (task 2.1,
change `data-quality-and-publication-trust`). Unlike `alks` (§2–§3),
nothing here is a first onboarding: the adapter is golden-fixture
tested, the savings-snapshot cron and the `/api/v1/savings` route are
shipped, and the governance grant already exists (precedent: grants
recorded 2026-09-28). What has never happened is the data landing —
production `retail_offers` carries zero `alko` rows, so the snapshot
pass honestly materializes nothing and `withReference` reads 0. This
section is the sequence for making the data land, verifying it, and
re-running it later.

Every artifact this section references is in the repository:

| Artifact | Path |
|---|---|
| Alko feed adapter (EUR assortment parser) | `packages/data-acquisition/src/adapters/alko.adapter.ts` |
| Adapter registry (`FEED_ADAPTERS`, keyed `alko`) | `packages/data-acquisition/src/index.ts` |
| Hourly producer (registry + governance + cadence gate) | `apps/api-worker/src/queues/ingestion-producer.ts` |
| Offer upsert (EAN tier matching) | `apps/api-worker/src/adapters/d1-upsert.repository.ts` |
| Savings-snapshot cron (qualification predicate) | `apps/api-worker/src/cron/savings-snapshots.ts` |
| Cron dispatch (30-minute shared tick) | `apps/api-worker/src/cron/router.ts` |
| Savings route (`withReference` count) | `apps/api-worker/src/routes/savings.routes.ts` |

Roles: the **ops lead** executes the production registry update and
records the counts; the **platform engineer** owns the adapter and the
snapshot cron.

### 6.1 How the ingestion is triggered

There is no one-off "ingest now" command — the only trigger is the
hourly producer (cron `0 * * * *`), and it enqueues `alko` only when
all three of these hold (§0's checkpoints, in the producer's order):

1. **Non-empty registry `feed_url`.** The seed's `alko` row carries an
   empty `feedUrl` — the "adapter not live yet" marker — and the
   producer logs `Skipping merchant "alko": registry feed URL is
   empty` for exactly that reason. The adapter fetches whatever URL
   the registry row names (`AlkoFeedAdapter.fetch` reads
   `config.feedUrl`), so setting the real feed URL is the act that
   arms the feed.
2. **Governance aggregated `GRANTED`.** Already the case in
   production (grants recorded 2026-09-28); re-granting an
   already-`GRANTED` merchant is a no-op (`changed: false`).
3. **Cadence bucket crossed.** The seed cadence is daily
   (86,400,000 ms), which fires on the 00:00 UTC pass (§0). A fresh
   grant does not shortcut the bucket — the first enqueue lands on the
   next tick whose interval bucket differs, which for a daily row is
   the next 00:00 UTC.

The enqueued message runs the standard workflow (fetch → map → lint →
upsert, §2.3): `parseAlkoAssortment` rejects a non-EUR list outright,
flags unmappable category rows and missing prices to the correction
queue per-row, and maps Finnish assortment groups through the
source-category normalization. Offers land in `retail_offers` with
`merchant = 'alko'`, `country = 'FI'`, and an `observed_at` timestamp
(NOT NULL by schema — the column's default stamps every row).

The savings snapshots are a separate cron on the shared 30-minute
aggregation tick (`*/30 * * * *`), registered after the time-series
aggregation handler. The snapshot is a daily materialization keyed
`(as_of, product_id)`: a same-day extra tick converges on the same
rows (keyed upsert, no watermark). There is no manual snapshot
trigger either — "run the snapshot" means "wait for the next
30-minute tick after the reference offers exist".

### 6.2 Prerequisites

- [ ] **Production registry row carries the real feed URL.** The
      production database is never seeded (§3), so the `alko` row —
      if present at all — carries an empty `feed_url` or does not
      exist. Setting the URL is the **one write** in this runbook
      section; it mirrors §3's idempotent upsert exactly. The feed URL
      itself is an owner decision (the adapter is fixture-pinned; no
      live endpoint is recorded in the repository) — substitute the
      owner-provided URL for `<ALKO_FEED_URL>`:

      ```bash
      cd apps/api-worker
      wrangler d1 execute DB --remote --env production --command "\
        INSERT INTO merchant_registry (merchant_id, name, country, feed_url, feed_format, polling_interval_ms) \
        VALUES ('alko', 'Alko', 'FI', '<ALKO_FEED_URL>', 'json', 86400000) \
        ON CONFLICT (merchant_id) DO UPDATE SET \
          name = 'Alko', country = 'FI', feed_url = '<ALKO_FEED_URL>', \
          feed_format = 'json', polling_interval_ms = 86400000, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')" -y
      ```

      The command mirrors the seed row (`country 'FI'`, `json`,
      daily 86400000). Do not lower `polling_interval_ms` here unless
      an off-schedule re-run is wanted (§6.6) — and never leave it
      lowered (§2.0's pinning warning applies to every update).
- [ ] **Governance `GRANTED` in production.** Verify read-only:
      `GET https://api.rajahinta.fi/ops/console/governance` lists
      `alko` as `GRANTED` (bearer token per §1; production secrets are
      per-environment, §3). If it is not granted, follow §2.2 against
      the production API before anything else.
- [ ] **Baseline counts recorded (before).** Run the three read-only
      queries of §6.4 against production and note the numbers — the
      change notes compare before/after, and a before-count of zero
      Alko offers is itself the expected baseline, worth recording
      rather than assuming.

### 6.3 Wait for the producer pass and the first run

At the next eligible hourly pass (daily row → the 00:00 UTC pass;
hourly row → the next tick):

- Producer log: no `Skipping merchant "alko"` line, and the summary
  line `Hourly price ingestion: enqueued N/N registry merchant
  message(s)` counts `alko` among the enqueued. The message dedupe key
  is `price-ingestion-alko-<UTC hour bucket>` (§2.3 convention).
- The workflow runs fetch → map → lint → upsert against the feed URL.
  Rows failing the payload contract (non-EUR, unmappable category,
  missing price) surface as per-row errors and land in the correction
  queue — the adapter never guesses around them (adapter docblock).
  A whole-payload failure (non-EUR currency, missing `products`
  array, HTTP error status) persists nothing: check the feed URL and
  payload contract before re-running.

### 6.4 Read-only verification queries

Every command in this subsection is a SELECT — read-only, safe to run
against production repeatedly. All use the flag pattern of §3
(`cd apps/api-worker`, `DB --remote --env production`, `-y`).

**(a) Alko reference offers — before/after.** The landing is visible
as this count moving from its baseline (0) to the assortment size:

```bash
wrangler d1 execute DB --remote --env production --command "\
  SELECT COUNT(*) AS alko_reference_offers FROM retail_offers \
  WHERE merchant = 'alko'" -y
```

**(b) `withReference` — the join the savings snapshot uses.** The
route's `coverage.withReference` counts snapshot rows for the latest
as-of day with a non-null `alko_reference_cents`
(`savings.routes.ts`); the snapshot pass qualifies a product only when
it carries an Alko offer **with an observation timestamp** and the
calculator resolves a usable benchmark and gap
(`savings-snapshots.ts`). The SQL mirror of the qualification
enumeration is:

```bash
wrangler d1 execute DB --remote --env production --command "\
  SELECT COUNT(DISTINCT product_id) AS qualification_superset \
  FROM retail_offers WHERE merchant = 'alko' AND observed_at IS NOT NULL" -y
```

(`observed_at` is NOT NULL by schema, so this equals the distinct
Alko-referenced product count — it is the enumeration superset, not
the guaranteed qualified count: the benchmark and gap steps run in the
calculator and have no SQL mirror.) The honest `withReference` figure
is the materialized one:

```bash
wrangler d1 execute DB --remote --env production --command "\
  SELECT COUNT(*) AS with_reference FROM savings_snapshots \
  WHERE as_of = (SELECT MAX(as_of) FROM savings_snapshots) \
    AND alko_reference_cents IS NOT NULL" -y
```

**(c) EAN join hit-rate.** The offer upsert matches by EAN first
(tier 1, `d1-upsert.repository.ts`): an Alko record whose EAN equals a
stored product's EAN attaches its offer to that same `product_id` —
which is exactly the pairing the snapshot pass needs. The compound-key
fallback (tier 2) and the new-row insert (tier 3) explain any
residual mismatch. The hit-rate measures how many offered products
carry an EAN that some Alko-referenced product also carries:

```bash
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
```

A low rate with a healthy Alko offer count means the reference rows
landed on their own product ids (tier 3) instead of joining — the
design's named risk (`design.md` Risks): the finding scopes the
dedupe/matching follow-up (task 5.3's spike), it does not block this
change; the honest empty state stays correct either way.

### 6.5 End-to-end savings verification

Wait for one 30-minute tick **after** the (a) count is non-zero (the
hourly producer and the :00 snapshot tick coincide, but the workflow
may finish mid-hour — the first tick after the offers are visible is
the one that qualifies them; extra same-day ticks converge).

- Workers Logs, `savings-snapshots` handler:
  `Starting savings-snapshot pass for YYYY-MM-DD` with the enumerated
  product count, then `Savings-snapshot pass for YYYY-MM-DD: N rows
  written, N skipped, N failed`, then `Cron handler
  "savings-snapshots" complete`. Skipped products without a usable
  reference are the design's honest absence, not errors; per-product
  failures are isolated and counted (`failed`), never fatal to the
  tick.
- Re-run the (b) materialized query — `with_reference` must now be
  > 0 and equal the route's count for the day.
- The public surface, end to end:

  ```bash
  curl -H "x-age-confirmed: 1" \
    "https://api.rajahinta.fi/api/v1/savings?category=spirits"
  ```

  (The savings routes sit behind the age gate — a bare request 403s
  with `AGE_GATE_REQUIRED`.) Expect `coverage.withReference > 0` and
  rows ordered by `gapBasisPoints` descending for categories with
  qualifying rows; a category with no qualifying rows returns 200
  with an empty `rows` list and the counts — an honest empty state,
  not an error. The homepage savings card flips from its
  pending-reference state to the listing CTA on the same overview
  data, with no frontend change (task 3.2 covers the empty-side
  rendering).

### 6.6 Re-run guidance

- **Idempotency.** Re-running is safe at every layer: the producer
  dedupes per UTC hour bucket, the consumer skips duplicate messages
  by that key, offer upserts append an observation only when the price
  changed (change detection against the latest prior row), and the
  snapshot upsert is keyed `(as_of, product_id)` — the same day
  converges, last write wins.
- **Cadence.** The daily bucket fires at 00:00 UTC; nothing needs
  re-running between passes. For an off-schedule re-run (e.g. the
  feed published a corrected assortment mid-day), temporarily set the
  registry row's `pollingIntervalMs` to `3600000` — the hourly
  minimum, fired on every tick — via the ops console or the registry
  API, **pinning `feedUrl` and `feedFormat` in the same update**
  (§2.0: the upsert overwrites the whole row), wait one pass, then
  restore `86400000`.
- **When to re-run.** A new assortment payload version; after an
  adapter or category-mapper change lands (the correction-queue and
  hit-rate numbers should move the expected direction); when the
  freshness panel shows the reference age growing past the daily
  expectation (a silently failing fetch enqueues but persists
  nothing); before recording change-notes numbers, so the after-counts
  reflect the current catalog.
- **Stopping.** Revocation (§2.3 path, production §3) is the kill
  switch: the producer skips a `REVOKED` merchant on the next pass and
  the gate blocks in-flight runs. Revocation stops ingestion; it does
  not purge landed offers or snapshots.

### 6.7 Verification checklist (Alko reference landing)

- [ ] Registry row updated with the real feed URL (§6.2; the one
      write, mirroring §3's pattern), `GET /ops/console/governance`
      shows `alko` GRANTED.
- [ ] Producer pass enqueues `alko` (no `Skipping merchant "alko"`
      warning); workflow completes; correction-queue rows, if any,
      are understood per-row failures.
- [ ] (a) count > 0; baseline (before) and after numbers recorded.
- [ ] One 30-minute tick observed: `savings-snapshots` handler logs
      rows written; (b) materialized `with_reference` > 0.
- [ ] `GET /api/v1/savings?category=...` reports
      `coverage.withReference > 0` (age-confirmed request).
- [ ] (c) EAN join hit-rate computed and recorded; a low rate noted as
      the dedupe/matching follow-up input, not a blocker.
- [ ] Numbers transcribed into the change notes
      (`openspec/changes/data-quality-and-publication-trust/change-notes.md`,
      §2.1) with the verified-at timestamp — TBD placeholders are
      filled by the operator only, never pre-filled.

---

## 7. History summary backfill (initial convergence and targeted re-scans)

Operational sequence for closing `price_history_summaries` coverage
gaps — products whose observation history exists but whose daily
buckets were never materialized. The client-visible symptom is the
calculator result page's "Hintahistoria" panel stuck on its gray
loading skeleton and product pages missing the 90-day price-context
figures. Two procedures, by state:

- **Initial backfill (§7.1) — the primary path.** The aggregation pass
  is cursor-chunked (change `aggregation-cursor-chunking`): each */30
  tick aggregates a bounded ≤300-product slice just above the
  `time-series-backfill-cursor` row and advances the cursor only after
  that chunk's writes succeed. The ticks converge on their own —
  deploy and wait, no script, no per-tick operator action.
- **Targeted re-scan (§7.3–§7.5) — post-convergence corrections.**
  `scripts/backfill-history-summaries.ts` `--lower`/`--restore` close
  specific gaps: a correction whose offers were re-observed, an
  aggregation outage window, incident-named products. It assumes a
  persisted `time-series-aggregation` watermark exists to lower and
  restore — exactly the post-convergence state — and runs only when an
  operator runs it.

In both procedures every summary row is written by the aggregation
job's idempotent per-bucket upserts during a regular tick (the
targeted path through the job's documented "manual re-scans can lower
the watermark directly" contract); the script only moves the watermark
and verifies. Request-path aggregation is never involved — "charts
never recompute raw history" is an architecture rule, and the gap is
filled by the batch job exactly as the spec's backfill scenario
requires. Re-running either procedure converges: an extra tick over an
already-summarized range rewrites identical rows and re-running the
script's phases is a no-op.

Every artifact this section references is in the repository:

| Artifact | Path |
|---|---|
| Aggregation job (watermark `time-series-aggregation`, backfill cursor, idempotent upserts) | `apps/api-worker/src/cron/time-series-aggregation.ts` |
| Backfill script (plan/lower/restore/verify — targeted re-scans) | `scripts/backfill-history-summaries.ts` |
| Coverage alert (`RajahintaHistorySummaryCoverageBelowInvariant`) | `infra/grafana/data-quality-alerts.yaml` |
| Coverage dashboard panel ("History summary coverage") | `infra/grafana/data-quality-dashboard.json` |
| Watermark repository (read/upsert contract) | `packages/data-platform/src/repositories/d1/aggregation-watermark.repository.ts` |
| Weekly bucket anchor (`startOfIsoWeek`, reused by the script) | `packages/data-platform/src/d1/summary-aggregation.ts` |
| Cron dispatch (the shared 30-minute tick) | `apps/api-worker/src/cron/router.ts` |
| Historical route (serves series from summaries only) | `apps/api-worker/src/routes/historical.routes.ts` |

Roles: the **ops lead** deploys, watches convergence, silences and
un-silences the coverage alert, and executes targeted re-scans against
an environment, recording before/after numbers; the **platform
engineer** owns the script and the aggregation job.

### 7.1 Primary procedure — initial backfill: deploy and let the */30 ticks converge

The initial backfill needs no script. Before the first convergence
there is no `time-series-aggregation` watermark to lower — the
production execution of the original procedure paused at `--plan` on
exactly that outcome (2026-10-05: the pass had never completed; every
tick died at the 15-minute wall re-aggregating the same ~880-product
prefix) — and the cursor-chunked pass turns the ticks themselves into
bounded, resumable progress.

1. **Deploy** the cursor-chunked aggregation (change
   `aggregation-cursor-chunking`). Nothing else to configure.
2. **Wait for convergence.** 10,264 products / 300 per tick ≈ 35
   ticks ≈ 17 h at the */30 cadence. Each tick logs
   `Scanning observations from <date> (watermark: none)` followed by
   `Aggregated N summary buckets across M products (chunk of K active,
   cursor was C); backfill continues next tick` — N ≈ 300 every tick,
   and a killed invocation resumes at its last completed chunk. Ticks
   re-scan the R2 partitions each pass until the watermark lands:
   expected, and it disappears at convergence.
3. **Watch convergence.** The `rajahinta_history_summary_coverage_ratio`
   gauge (written after each tick's chunk writes) must rise
   tick-over-tick — the data-quality dashboard's "History summary
   coverage" panel plots it (~0.09 → 1). Read-only spot checks at any
   point: the script's `--verify`, or the §7.6 SQL.
4. **Done when all three hold:** the §7.6 verification query answers
   `products_missing_summaries = 0`; `aggregation_watermarks` has the
   `time-series-aggregation` row at the activity high water; and the
   `time-series-backfill-cursor` row is gone (the final tick's log
   ends `; pass complete, watermark now <instant>`).

```bash
cd apps/api-worker
wrangler d1 execute DB --remote --env production --command \
  "SELECT job_name, watermark FROM aggregation_watermarks \
     WHERE job_name IN ('time-series-aggregation', 'time-series-backfill-cursor')" -y
```

Expected: exactly one row — `time-series-aggregation`, at the activity
high water.

**The coverage alert fires BY DESIGN during this window — read §7.2
before reacting to it.**

### 7.2 Grafana during convergence — `RajahintaHistorySummaryCoverageBelowInvariant` fires by design

The alert (`infra/grafana/data-quality-alerts.yaml`, `lt 1` on
`rajahinta_history_summary_coverage_ratio`, `for: 1h`) firing during
the convergence window is the alert doing its job: the invariant IS
unmet while the backfill runs.

- **Silence it for the window** in Grafana Cloud (a silence rule or
  mute timing), expiry ≈ deploy + 17 h.
- **Confirm it clears** when the coverage check answers 0 (§7.6 /
  `--verify`), then lift the silence.
- **A ratio that FAILS to rise tick-over-tick is the real regression
  signal** — the chunked pass is not progressing. Do not ride the
  silence: check the tick logs (`exceededWallTime` or error outcomes,
  the per-tick cursor advance of §7.1's log lines) and escalate to the
  aggregation-job owners. The alert's `noDataState: Alerting` firing
  (the gauge not written at all) is likewise a real regression.

### 7.3 Targeted re-scan path — dry-run first, then lower (post-convergence corrections)

The script's `--lower`/`--restore` assume a persisted
`time-series-aggregation` watermark exists to lower and restore — the
post-convergence state after §7.1. Run this path for corrections whose
offers were re-observed, to re-scan an aggregation outage window, or
for the named gap products of an incident investigation. During the
initial backfill it is the wrong tool — there is nothing to lower; the
convergence procedure of §7.1 owns that state. The mechanism
(watermark-isolation-history-backfill design D3):

1. **Read the watermark.** The script reads the persisted watermark of
   the `time-series-aggregation` row ONLY — the job-scoped read is the
   table's contract, and the incident that change fixed was exactly a
   non-ISO row (`9194`) shadowing table-wide reads. The script never
   touches any other job's row.
2. **Find the earliest unsummarized observation.** Products with
   `retail_offers` rows in the window but zero `daily` summary buckets
   (the coverage check of that change's D1 pair — the R2 observation
   log mirrors these offer appends via `retail_offer_id`). The window
   is bounded to the last 365 days (the historical route's
   `MAX_RANGE_DAYS`), changeable with `--window-days`.
3. **Lower the watermark** to the earliest unsummarized observation's
   ISO-week Monday (`startOfIsoWeek`, the same pure helper the job's
   read path uses — the job re-reads partitions from the watermark's
   ISO-week Monday and recomputes every overlapped bucket from its
   FULL contents, so weekly buckets stay correct). The script lowers
   only — it never advances or touches an already-lower value.
4. **Trigger the aggregation** (§7.4). The tick scans from the lowered
   watermark, upserts every missing bucket idempotently, and — only
   after all writes succeed — advances the watermark to the activity
   high water by itself. A lowered window too large for one
   invocation's budget chunk-walks through the same cursor protocol as
   §7.1, so a multi-tick re-scan is progress, not a failure.
5. **Restore and verify** (§7.5). The verification query must answer
   `products_missing_summaries = 0`. The restore step never regresses
   the watermark: a completed tick leaves it at the activity high
   water (≥ the pre-backfill value), which supersedes the restore; the
   pre-backfill value is written back only when the watermark is
   still below it, or explicitly via `--force` (abort).

The apply path is deliberately two operator steps with the trigger
between them — there is no single `--apply`, because the aggregation
cannot be fired synchronously by the script.

**Dry-run first (always).** Run from the repo root (the path is
relative to the `data-platform` package cwd, same convention as
`scripts/seed-d1.ts`). `--plan` is the default phase and writes
nothing:

```bash
pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/backfill-history-summaries.ts --remote --env production --plan
```

The plan prints the current watermark, the coverage counts and gap
products, the exact lowering target, and the apply commands. Targets
follow the seed-d1 conventions: `--remote --env staging|production`,
`--local` (apps/api-worker's local wrangler D1), or `--db-file <path>`
(a plain SQLite file through node:sqlite — no wrangler, no
credentials; used by the script's own verification).

Expected plan outcomes: `coverage invariant HOLDS` (nothing to do),
`no persisted watermark` (**the pre-convergence state — do not lower;
there is nothing to lower, the next tick scans from the epoch by
contract and §7.1's convergence does the work**), `already at/below
the lowering target` (skip the lowering below), or the `WOULD lower`
plan (proceed).

**Apply step 1 — lower the watermark.**

```bash
pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/backfill-history-summaries.ts --remote --env production --lower
```

One write: the job-scoped watermark upsert (repository-parity SQL,
`aggregation_watermarks` row `time-series-aggregation` only). The
pre-backfill watermark is recorded in a state file (default
`./backfill-history-summaries.state.json`, `--state-file` to override)
that `--restore` requires — the state file is the only record of the
pre-backfill value, so it must survive until the restore. Re-running
`--lower` while a backfill is open is a no-op; after an aborted or
superseded attempt it starts a fresh lowering.

### 7.4 Trigger the aggregation

Under §7.1 no trigger is needed — the ticks run themselves. This
subsection is the manual trigger for the targeted re-scan path (and
for out-of-band verification ticks). There is no one-off "aggregate
now" command for the deployed Worker — the time-series aggregation
fires on the shared 30-minute tick
(`*/30 * * * *`, `AGGREGATION_CRON`), exactly like the savings
snapshots in §6.1. Two established paths:

1. **Wait for the next tick** (at most 30 minutes). Workers Logs,
   `time-series-aggregation` handler, expect the job's protocol lines:
   `Scanning observations from <date> (watermark: <lowered>)` followed
   by `Aggregated N summary buckets across M products (chunk of K
   active, cursor was C)…`. A mid-pass tick appends
   `; backfill continues next tick` and leaves the watermark untouched
   (the cursor is the progress marker); the pass-completing tick
   appends `; pass complete, watermark now <instant>` and that instant
   must be the activity high water (≥ the pre-backfill value) — the
   tick advances it only after every summary write succeeded.
2. **Out-of-band trigger against real bindings** (the proven
   curated-rate-refresh path, transport-confidence-unlock change
   notes) — uploads the working-tree bundle and fires the scheduled
   handler on demand:

   ```bash
   cd apps/api-worker
   wrangler dev --env production --remote --test-scheduled --port 8788 \
     --show-interactive-dev-session false
   curl "http://localhost:8788/cdn-cgi/handler/scheduled?cron=*%2F30+*+*+*+*"
   ```

   (`/cdn-cgi/handler/scheduled` is the wrangler 4.127 form; older
   versions exposed `/__scheduled`.) Firing the 30-minute pattern runs
   ALL its registered handlers — aggregation, freshness alert,
   price-alert evaluation, savings snapshots, data-quality gauges —
   each idempotent by design (cron-router docs), so the extra tick is
   safe on any environment.

### 7.5 Apply step 2 — restore and verify

```bash
pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/backfill-history-summaries.ts --remote --env production --restore
```

`--restore` runs the verification query and applies the restore rule
of §7.3 step 5. Outcomes:

- **PASSED** — coverage holds; the watermark ends at or above the
  pre-backfill value (the tick's own advance) and the state file is
  removed. Exit 0. The backfill is complete.
- **FAILED, watermark still lowered** — the aggregation has NOT
  re-scanned yet (restore ran before §7.4). The script writes nothing:
  wait for the tick and re-run `--restore`. Exit 1.
- **FAILED, otherwise** — the tick ran but gaps remain: inspect the
  aggregation handler logs (an R2 partition gap is the honest
  candidate — the script verifies what D1 can see). Exit 1. Pass
  `--force` to ABORT deliberately: the pre-backfill watermark is
  written back and the coverage failure is still reported.

### 7.6 Verification query (standalone)

The check the whole procedure answers to, runnable read-only at any
point (§6.4 flag pattern). Expected result after a successful pass:
`products_missing_summaries = 0` — the spec's coverage invariant
("products with observations but zero summary rows" answers zero):

```bash
cd apps/api-worker
wrangler d1 execute DB --remote --env production --command "\
  WITH summarized AS ( \
    SELECT DISTINCT product_id FROM price_history_summaries \
     WHERE granularity = 'daily' AND period_start >= strftime('%Y-%m-%d', 'now', '-365 days')) \
  SELECT COUNT(DISTINCT product_id) AS products_missing_summaries \
    FROM retail_offers \
   WHERE observed_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-365 days') \
     AND product_id NOT IN (SELECT product_id FROM summarized)" -y
```

The script's `--verify` phase runs the same measurement (plus the gap
list) and is the preferred form — it exits non-zero on gaps, so it can
gate change-notes sign-off:

```bash
pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/backfill-history-summaries.ts --remote --env production --verify
```

### 7.7 Verification checklist (history summary backfill)

Initial backfill (§7.1):

- [ ] Cursor-chunked aggregation deployed; first post-deploy tick logs
      `Scanning observations from <date> (watermark: none)`.
- [ ] `RajahintaHistorySummaryCoverageBelowInvariant` silenced for the
      window (§7.2); silence expiry recorded (≈ deploy + 17 h).
- [ ] Coverage ratio rising tick-over-tick on the "History summary
      coverage" panel; a flat or falling ratio treated as the
      regression signal (escalate), not silenced through.
- [ ] Per-tick log cadence `Aggregated N summary buckets across M
      products (chunk of K active, cursor was C); backfill continues
      next tick` with no `exceededWallTime` on the handler.
- [ ] §7.6 verification query answers `products_missing_summaries = 0`
      (or `--verify` exit 0).
- [ ] §7.1's watermark/cursor query answered exactly one row:
      `time-series-aggregation` at the activity high water;
      `time-series-backfill-cursor` gone.
- [ ] Alert unsilenced and confirmed cleared.
- [ ] A previously gapped product's series is served end to end:
      `curl -H "x-age-confirmed: 1" "$API_URL/api/v1/products/<gapId>/price-history?granularity=day&from=...&to=..."`
      returns a non-empty `series` (the calculator's Hintahistoria
      panel renders).
- [ ] Before/after numbers transcribed with the verified-at timestamp
      — filled by the operator only, never pre-filled.

Targeted re-scan (§7.3–§7.5):

- [ ] `--plan` run first; the gap products and lowering target from
      its output recorded in the change notes or an ops note.
- [ ] `--lower` succeeded; state file present; the only watermark
      change is the `time-series-aggregation` row (spot-checkable with
      a `SELECT job_name, watermark FROM aggregation_watermarks` —
      other jobs' rows, including the backfill cursor, untouched).
- [ ] Aggregation tick observed (§7.4): the
      `; pass complete, watermark now <instant>` log line with the
      watermark at the activity high water.
- [ ] `--restore` PASSED (exit 0); state file removed; the watermark
      ended at or above the pre-backfill value.
- [ ] §7.6 verification query answers `products_missing_summaries = 0`
      (or `--verify` exit 0).
- [ ] A gapped product's series is served end to end (the curl above).
- [ ] Before/after numbers transcribed with the verified-at timestamp
      — filled by the operator only, never pre-filled.

Production execution is a deliberate, gated operator action: the
script's remote modes require explicit `--remote --env production`
flags and wrangler authentication, never stored credentials.

---

## 8. Non-alcoholic catalog audit (`scripts/nonalcoholic-catalog-audit.ts`)

One-time cleanup after the non-alcoholic ingestion guard and the shared
listing predicate landed (change `nonalcoholic-catalog-hygiene`, design
D4): merchant-feed category mapping used to file energy drinks, mineral
waters, and juices under canonical alcohol categories, and roughly 120
production rows are affected (2026-10-04 observation: in the first 300
`other_fermented` rows, 80 products at 0.0 % ABV and 42 with unknown
ABV). Those rows are already invisible to every user-facing surface
(the read-side predicate excludes zero/unknown-ABV and held rows), but
until they are flagged the correction review flow cannot see why. This
script enumerates them and — only on the explicit `--apply` — holds
them for review:

```
review_hold_reason = 'nonalcoholic_in_alcohol_category'
```

(the core-domain `NONALCOHOLIC_HOLD_REASON` token, migration 0029's
column). **Hold, never delete** (design D1): provenance, offer history,
and correction evidence reference the rows; the hold is what removes
them from user surfaces, and the correction queue — not the schema —
owns review state (design D4).

Every artifact this section references is in the repository:

| Artifact | Path |
|---|---|
| Audit script (dry-run default, explicit `--apply`) | `scripts/nonalcoholic-catalog-audit.ts` |
| Hold column (migration 0029) | `packages/data-platform/src/d1/migrations/0029_product_master_review_hold.sql` |
| Hold-reason token (ingestion guard) | `packages/core-domain/src/normalization/source-category.mapper.ts` |
| Shared listing predicate (why held rows are invisible) | `packages/data-platform/src/repositories/d1/product-search.repository.ts` |
| Offer upsert (how re-ingestion re-flags or clears holds) | `apps/api-worker/src/adapters/d1-upsert.repository.ts` |

Roles: the **ops lead** runs the audit against production and records
the before/after numbers; the **platform engineer** owns the script.

### 8.1 When to run

After the `nonalcoholic-catalog-hygiene` change deploys to the
environment (guard + predicate live), before recording the §3.5
post-deploy verification numbers. Re-running at any later time is safe
and expected — new arrivals are guarded at ingestion, so a growing
affected set is itself the signal to investigate. Nothing schedules the
script; it runs when an operator runs it.

### 8.2 Commands (dry-run first, always)

Run from the repo root (the path is relative to the `data-platform`
package cwd, same convention as §7):

```bash
pnpm --filter @rajahinta/data-platform exec tsx \
  ../../scripts/nonalcoholic-catalog-audit.ts --remote --env production
```

The default mode is a dry-run: it writes nothing. The summary reads:

- `product_master rows: N (already held: H)` — catalog size and how
  many rows already carry a hold (the audit never touches those).
- `affected rows (not held, ABV zero/negative/unknown): A` — the set
  apply would flag: rows outside the listing universe's ABV condition
  that are not held yet. Every canonical product category is an alcohol
  category, so no category filter applies (the read-side predicate
  makes the same assumption).
- `affected per category: ...` — counts per category, review-flow
  triage input.
- `sample` — up to `--sample <n>` (default 10) rows as
  `id, name, category, ABV, ean`.
- The exact `--apply` command for the same target.

### 8.3 Apply

```bash
pnpm --filter @rajahinta/data-platform exec tsx \
  ../../scripts/nonalcoholic-catalog-audit.ts --remote --env production --apply
```

One write: `review_hold_reason = 'nonalcoholic_in_alcohol_category'` on
exactly the enumerated rows (statement-level re-check of the hold
condition; `updated_at` deliberately untouched). Nothing is deleted, no
existing hold is lifted or overwritten, and the printed re-enumeration
must answer `0 remaining`.

**Idempotency.** Already-held rows are outside the enumeration by
construction, so re-running `--apply` is a no-op — the third run's
summary reads `affected rows: 0 — nothing to apply` and exits 0. Zero
affected rows is a SUCCESS (honest shrinkage is the expected end
state), never an error. Exit codes: 0 success (including zero rows),
1 connection/execution failure, 2 usage error.

### 8.4 How a held row returns to the catalog

A hold is a review state, and only the correction review flow resolves
it (design D4):

1. **Explicit review action.** The review confirms the row's real
   category/ABV, then clears the hold per row with the §6.4 flag
   pattern (`cd apps/api-worker`,
   `wrangler d1 execute DB --remote --env production --command "UPDATE product_master SET review_hold_reason = NULL WHERE id = <id>" -y`).
   The read-side predicate admits the row again immediately — no
   re-ingestion needed.
2. **Natural re-ingestion.** The offer upsert's EAN tier rewrites
   `review_hold_reason` from the fresh mapping on every re-observe: a
   row whose feed now parses an ABV > 0 returns un-held automatically,
   and a still-0/unknown-ABV row re-holds itself through the ingestion
   guard. (The compound-key tier does not touch the column — such a
   row stays held until route 1.)

### 8.5 Verification checklist

- [ ] Dry-run summary recorded (target, totals, per-category counts)
      in the change notes or an ops note.
- [ ] `--apply` run; `applied: A row(s) now held` and
      `re-enumeration finds 0 remaining` observed.
- [ ] Post-apply spot check: a flagged row 404-shapes on its detail
      route and is absent from browse/ranked/ids surfaces.
- [ ] Re-run of `--apply` answered `affected rows: 0`.
- [ ] Before/after numbers transcribed with the verified-at timestamp
      — filled by the operator only, never pre-filled.

Production execution is a deliberate, gated operator action: the
script's remote modes require explicit `--remote --env production`
flags and wrangler authentication, never stored credentials.

---

## 9. Sitemap crawl merchants

Operational reference for the four sitemap-crawl merchants
(viinarannasta, viinikauppa, licorea, drinkonline) and the two parked
candidates (spritxxl, lazyshop), change `sitemap-crawl-merchants`.
These sources have no Store API: the registry `feedUrl` is the
merchant's product sitemap, and the ingestion Workflow discovers and
fetches individual product pages from it through a polite, chunked
crawl. Governance works exactly as everywhere else in this runbook;
only the fetch mechanics and the verification steps differ.

Every artifact this section references is in the repository:

| Artifact | Path |
|---|---|
| Shared crawl cycle, walker, sitemap parser, lastmod diff | `packages/data-acquisition/src/crawl/` |
| Shared sitemap-crawl adapter + per-source subclasses | `packages/data-acquisition/src/adapters/sitemap-crawl.adapter.ts`, `viinarannasta.adapter.ts`, `viinikauppa.adapter.ts`, `licorea.adapter.ts`, `drinkonline.adapter.ts` |
| Extractor (JSON-LD, microdata, OG/meta with per-source normalizers) | `packages/data-acquisition/src/crawl/extract/` |
| Chunked crawl steps (crawl-discover, crawl-chunk-N, crawl-advance-N) | `apps/api-worker/src/workflows/crawl-fetch-steps.ts` |
| Durable watermark + cursor store | `apps/api-worker/src/adapters/d1-crawl-watermark.store.ts` |
| Registry seed (eight rows, two parked) | `packages/data-platform/src/seed/merchant-registry.seed.ts` |
| Governance seed (four GRANTED, two PENDING) | `packages/data-platform/src/seed/source-governance.seed.ts` |
| Read-only crawl sweeps | `scripts/viinarannasta-crawl-sweep.ts` and its three per-source siblings |

Roles: the **ops lead** verifies seeds through the console, performs
production registration and grants, and watches the first crawl; the
**platform engineer** owns the crawl packages, the adapters, and the
sweeps.

### 9.1 Onboarding sequence (staging)

The rows already exist. Staging receives both seeds through the deploy
pipeline's seed step, the same path as the merchant-registry seed:

1. `merchant_registry` carries eight rows: the four active merchants
   with their sitemap URLs (`feedFormat: 'xml'`, daily
   `pollingIntervalMs` of 86,400,000) and the two parked merchants
   (spritxxl, lazyshop) with an EMPTY `feedUrl`. The empty URL is the
   producer's skip marker, by design (§9.3).
2. `source_governance` carries the permission records: the four active
   merchants are `COMPLIANT_CRAWLING` / `GRANTED` with source URL set
   to their sitemap and `statusReason`
   `documented_scraping_rights_recon_2026_10_07`; the parked two are
   `COMPLIANT_CRAWLING` / `PENDING` with their own machine-readable
   reasons (§9.3). The seed is presence-guarded: it inserts a row only
   when the merchant has no record for that (method, source URL) pair
   in ANY status, so an operator's REVOKED or GRANTED decision always
   survives a re-seed. Production governance is never seeded.
3. Verify through the console or the API:
   `GET $STAGING_API_URL/ops/console/governance` lists all six with
   the statuses above. No grant action is needed in staging; the seed
   did it. Do not re-grant through the console "to be sure": granting
   an already-GRANTED merchant is a no-op, but the console is for
   operator decisions, not seed verification.
4. Wait for the next hourly pass (cron `0 * * * *`). A daily row fires
   on the 00:00 UTC pass (§0 cadence rules). The producer logs
   `Skipping merchant "spritxxl": registry feed URL is empty` and the
   same for lazyshop, and the summary line counts the four crawl
   merchants among the enqueued. Message dedupe follows the §2.3
   convention (`price-ingestion-<merchantId>-<UTC hour bucket>`).
5. The workflow then runs `crawl-discover`, pairs of
   `crawl-chunk-N` / `crawl-advance-N` until the queue drains, and
   after that the ordinary map, volume-ceiling-gate, upsert, and
   data-quality steps unchanged. Verify per §9.6.

### 9.2 Politeness parameters

These are code-pinned, not conventions. Do not tune them per run; the
scheduled crawl and any manual expectation must stay identical.

- Pages are fetched strictly sequentially per host. The spacing
  (minimum 1,000 ms, `MIN_REQUEST_SPACING_MS`) sits before every
  request except a walk's first, so consecutive request STARTS are at
  least 1 s apart regardless of how fast the server answers.
- Every request carries the descriptive User-Agent
  `rajahinta-crawler/1.0 (+https://rajahinta.fi)`
  (`CRAWLER_USER_AGENT`). A site admin can tell who is polling at
  1 req/s and reach a human. None of the four hosts publishes a
  `Crawl-delay`; the 1 req/s floor is the self-imposed policy.
- The sitemap is fetched at most once per cycle. A resumed cycle (a
  prior invocation left an in-flight cursor) replays the cursor and
  never re-fetches the sitemap or the already-crawled prefix.
- A chunk is at most 300 detail-page fetches
  (`CRAWL_CHUNK_FETCHES`), about 5 min of wall time at 1 req/s. A
  durable 1 s sleep between chunk steps gives each chunk a fresh
  invocation, keeping the run inside the roughly 1,000-subrequest
  ceiling. The step-pair loop caps at 400 chunks (120,000 URLs); a
  larger queue is a registry-config error and stays resumable.
- Records commit before the cursor advances past them
  (write-then-advance). A lost chunk output re-walks its slice; a lost
  advance resumes from the persisted offset. Pages are re-fetched on
  failure, never skipped silently.
- Crawl state lives in two `aggregation_watermarks` rows per merchant:
  `sitemap-crawl-lastmod-<merchantId>` (the completed cycle's
  `loc → lastmod` map, JSON) and `sitemap-crawl-cursor-<merchantId>`
  (the in-flight queue plus offset; an absent row means no cycle is in
  flight). Reads are job-scoped per the watermark-isolation rule.
- drinkonline exposes no sitemap `lastmod`, so it is configured as
  full-refresh: every cycle crawls the whole set (about 1,838 pages,
  roughly 31 min at 1 req/s, spread over chunks). The first crawl of
  any source is always a full crawl.

Raising the chunk size or lowering the spacing is a measured change,
not a setting: both budgets (subrequests per invocation, scheduled
wall time) were measured with these numbers. Re-measure before
changing either, and record it in the change notes.

### 9.3 Parked sources (spritxxl, lazyshop)

Both are recorded in governance, not scraped. The producer skips them
by the registry's empty-feedUrl rule, and no adapter code exists for
either (the spec forbids it). The governance rows carry the why:

- `spritxxl` (`fastly_js_challenge_blocks_sitemap`): a Fastly JS
  client challenge blocks the sitemap and robots.txt. This is the
  Posti blocked-egress precedent: egress blocking is parked and
  recorded, never fought with workaround clients.
- `lazyshop` (`no_extractable_product_attributes`): pages expose no
  structured data and no ABV, volume, EAN, or brand. Rows would be
  held by the non-alcoholic guard (zero or unparseable ABV cannot
  enter alcohol categories) and would be unmatchable against
  `product_master`. Revisit only when an attribute source exists; a
  working crawler changes nothing about this.

Because both park as data rows, unparking is covered in §9.5.

### 9.4 Read-only crawl sweeps

Each active source has a sweep script:
`scripts/viinarannasta-crawl-sweep.ts`, `scripts/viinikauppa-crawl-sweep.ts`,
`scripts/licorea-crawl-sweep.ts`, `scripts/drinkonline-crawl-sweep.ts`.
They fetch the sitemap ONCE and push it through the production
discovery path (the shared parser and the adapter's own product-URL
predicate), reporting total locs, product URLs after the filter,
lastmod coverage, and, when given a `YYYY-MM-DD` argument, how many
product entries carry a `lastmod` at or after that date. With
`--sample` they fetch exactly ONE product page under the crawler
User-Agent and print what the production extractor would ingest from
it, field by field. They never bulk-crawl: no chunk loop, no watermark
or cursor writes, no ingestion.

```bash
pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/viinarannasta-crawl-sweep.ts [--sample] [YYYY-MM-DD]
```

Exit codes: 0 complete, 1 unusable sitemap or empty product set,
2 usage error. `--help` prints usage without touching the network.
The governance gate does not apply to the sweeps (§4's rule):
running one against a PENDING or REVOKED merchant is expected and
harmless, and running it is never a substitute for a grant.

Run a sweep when extraction or predicate changes land, when a source's
pages look drifted (the design's named HTML-drift risk; the sweeps
catch it before the scheduled pipeline does), or before onboarding a
source in a new environment to record its baseline. The changed-since
count is an estimate: production diffs verbatim `lastmod` strings
against the persisted watermark, it never parses dates.

### 9.5 Unparking a parked source

Unparking has a code half and a data half, in that order:

1. **Deploy the adapter first.** A parked source has no adapter code,
   so unparking ships a per-source adapter subclass, its registration
   in the ingestion compositions, and the workflow crawl-map entry as
   a normal gated deploy. Order matters: a GRANTED merchant whose
   adapter is not deployed is SAFE, the run completes in-band with
   `No feed adapter registered for merchant "<merchantId>"` and
   nothing is crawled, but do not lean on that; deploy the code
   before flipping the data.
2. **Then flip the data.** Set the registry `feedUrl` to the sitemap
   (production insert per §3's idempotent upsert with
   `feed_format 'xml'`; staging via the console or a seed-row update)
   and grant through the console with acquisition method
   `COMPLIANT_CRAWLING` and the sitemap URL as the source URL (§2.2's
   action, §3's production origin). Both mutations are audited as
   usual. Confirm the seller country first: the parked seed rows
   carry best-effort countries that feed the transport origin and the
   import-VAT signal, and spritxxl's `FI` is explicitly unverified.
3. **Verify per §9.6.** The first crawl is a full crawl.

Reversing (re-parking) is revoke (§2.3) plus emptying the registry
feedUrl; landed offers stay (revocation never purges, §2.3).

### 9.6 First-crawl verification checklist (staging)

- [ ] `GET $STAGING_API_URL/ops/console/governance` lists the six
      merchants: four GRANTED with one `COMPLIANT_CRAWLING` source
      each, spritxxl and lazyshop PENDING.
- [ ] Hourly pass log: no `Not scheduling merchant "viinarannasta"`
      (or sibling) warnings; the four enqueued; spritxxl and lazyshop
      appear only as empty-feedUrl skips.
- [ ] Workflow log shows `crawl-discover`, then `crawl-chunk-N` /
      `crawl-advance-N` pairs. Chunk steps land about 5 min apart at
      the polite 1 req/s; no step breaches its wall budget. A resume
      after an interruption logs the `resumes its in-flight cursor`
      line and continues without re-fetching the sitemap.
- [ ] Cursor rows advance: mid-cycle, `aggregation_watermarks` holds
      `sitemap-crawl-cursor-<merchantId>` for the running merchant;
      after the final chunk the cursor rows are gone and each merchant
      has a `sitemap-crawl-lastmod-<merchantId>` row. Spot check:

      ```bash
      cd apps/api-worker
      wrangler d1 execute DB --remote --env staging --command \
        "SELECT job_name, updated_at FROM aggregation_watermarks \
           WHERE job_name LIKE 'sitemap-crawl-%' ORDER BY job_name" -y
      ```
- [ ] Offers land for the four merchants with EUR prices and
      reliability status ESTIMATED. Every ingestion-pinned offer is
      ESTIMATED (only the audited operator verify action writes
      VERIFIED); a non-EUR price surfaces as a per-row correction
      error, never as a converted row.
- [ ] Held-row behavior: a page whose name yields no parseable ABV
      while resolving to an alcohol category ingests as non-alcoholic
      with `review_hold_reason = 'nonalcoholic_in_alcohol_category'`
      and stays out of every alcohol category surface. The extraction
      errors naming these rows appear in the run's collected errors,
      not as gate failures.
- [ ] The sweeps (§9.4) run clean against all four sitemaps and their
      numbers are recorded in the change notes.

### 9.7 First-crawl verification checklist (production)

Production onboarding follows §9.5's data half against the production
origins (the production database is never seeded, §3): registry rows
in via the §3 upsert (`feed_format 'xml'`, sitemap as `feed_url`),
governance via the console grant (`COMPLIANT_CRAWLING`, sitemap source
URL). The deploy itself is the gated production pipeline
(`deploy-production.yml`), never a manual `wrangler deploy`.

- [ ] Gated deploy carried the crawl adapter family and workflow
      steps; the four adapters are registered in the production
      compositions.
- [ ] Registry and governance rows in place (§9.5 step 2), audit
      entries recorded with the production operator identity.
- [ ] First full crawl completes: chunk pairs advance, cursor rows
      clear, `sitemap-crawl-lastmod-<merchantId>` rows exist for all
      four merchants (§9.6's query against `--env production`).
- [ ] EAN-matched products resolve for viinarannasta and licorea: the
      two GTIN-bearing sources join existing `product_master` rows
      through the upsert's EAN tier. viinikauppa and drinkonline have
      no EAN and are expected to match (if at all) through the
      compound tier; their match rate is measured honestly by
      data-quality, not forced.
- [ ] No held-row leaks: zero rows with
      `review_hold_reason = 'nonalcoholic_in_alcohol_category'`
      appear in any alcohol category surface (the listing predicate
      excludes them; verify the count, not just the surfaces).
- [ ] Data-quality grades recorded for the new offers in the change
      notes or an ops note, with the verified-at timestamp filled by
      the operator only.

