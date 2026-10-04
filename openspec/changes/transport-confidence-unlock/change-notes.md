# Change notes — transport-confidence-unlock

## Pre-flight reads (2026-10-04)

Task 1.1: read-only operations reads before any grant/trigger/write in later
tasks. **First attempt was blocked on wrangler auth (history kept below);
re-run completed 2026-10-04 against production** (D1
`rajahinta-api-production`, f8f67277-5046-46fc-9144-4342ab7af003) with
`CLOUDFLARE_API_TOKEN` injected inline per command from a local secret
file — never echoed, logged, or committed. All queries succeeded; the
`carrier_id` sub-read returned the expected migration-pending state (0027
not yet applied remotely — see Query 4). Staging cross-check included.

### Environment / binding map (verified from `apps/api-worker/wrangler.jsonc`)

One D1 binding `DB` per environment; three environments, each its own
database (EU jurisdiction, pinned at creation — not visible in config):

| Env        | Worker name              | D1 database name         | database_id |
|------------|--------------------------|--------------------------|-------------|
| dev        | `rajahinta-api-dev`      | `rajahinta-api-dev`      | `b91b27b2-2d5f-4cd8-b46c-a6b6688669b0` |
| staging    | `rajahinta-api-staging`  | `rajahinta-api-staging`  | `da49e685-7a6a-420c-a7fe-f68c1f06321b` |
| production | `rajahinta-api-production` | `rajahinta-api-production` | `f8f67277-5046-46fc-9144-4342ab7af003` |

Invocation convention per `docs/ingestion-runbook.md`: run from
`apps/api-worker` with `wrangler d1 execute DB --remote --env <env> ...`.
The environment that matters for every read below is **production**.

### Prior blocker — RESOLVED 2026-10-04

First attempt: `npx wrangler whoami` → "You are not authenticated. Please
run `wrangler login`." A representative D1 read failed verbatim with:
"In a non-interactive environment, it's necessary to set a
CLOUDFLARE_API_TOKEN environment variable for wrangler to work."
Resolved by sourcing the token per-command (inline
`CLOUDFLARE_API_TOKEN="$(cat <secret-file>)"` env, same secret the deploy
workflows use via GitHub Actions) — no interactive login, nothing stored
in the repo or shell history.

### Query 1 — source_governance rows for the curated carriers

Task text said `WHERE source_id IN (...)`; the real schema
(`migrations/0021_source_governance.sql`) has no `source_id` — the gate key
is `merchant_id`, and the curated refresh reuses each carrier's `carrierId`
(`fransberg` / `posti`, per `fransberg-rate.source.ts:141`,
`posti-rate.source.ts:114`) as the governance subject
(`apps/api-worker/src/cron/curated-rate-refresh.ts` docblock: "without a
GRANTED record the carrier's refresh appends nothing"). Adjusted query:

```sql
SELECT merchant_id, acquisition_method, permission_status, status_reason,
       last_verified_at, updated_at
FROM source_governance WHERE merchant_id IN ('fransberg','posti');
```

**Result (production, 2026-10-04): 2 rows, both GRANTED** — the fail-closed
gate is open for both curated carriers:

| id | merchant_id | acquisition_method | permission_status | last_verified_at | created_at / updated_at |
|----|-------------|--------------------|-------------------|------------------|-------------------------|
| 5  | fransberg   | MANUAL_VERIFICATION | GRANTED | 2026-09-28T12:33:55.000Z | 2026-09-28T12:33:58.863Z (both) |
| 6  | posti       | MANUAL_VERIFICATION | GRANTED | 2026-09-28T12:33:55.000Z | 2026-09-28T12:33:58.863Z (both) |

`source_url`: `https://fransberg.eu/pricing` / `https://www.posti.fi`.
`status_reason` (both): owner policy 2026-09-28 — transport rates are a
manually curated in-repo dataset, admin re-verifies a few times per year,
grant enables the monthly curated-rate-refresh cron (posti adds: its
price-list JSON endpoint is CDN-blocked for datacenter/Cloudflare egress,
403/1031). A zero-row result would have read as "not granted".

### Query 2 — carrier rows in transport_offers (does the Oct 1 tick append?)

```sql
SELECT carrier, COUNT(*) AS rows, MAX(observed_at) AS newest
FROM transport_offers GROUP BY carrier;
```

**Result (production, 2026-10-04): the proposal's "no carrier rows at all"
is outdated — one carrier present:**

| carrier | rows | newest `observed_at` |
|---|---|---|
| fransberg | 36 | 2026-09-17T00:00:00.000Z |

No `posti` rows and no other carrier values. Reading the tick fingerprint
(the handler is append-only and skips a carrier whose newest stored
`observed_at` already equals its dataset constant):

- **fransberg @ 2026-09-17** is consistent with the dataset's constant —
  fransberg reads as already current; an Oct 1 tick would have taken the
  skip path and appended nothing. This read alone cannot distinguish
  "tick ran and skipped" from "rows loaded by an earlier sync".
- **posti: 0 rows is the notable gap.** The grant (2026-09-28 12:33) and
  the Posti-capable handler (commit `99e869c`, 2026-09-28) both predate
  the 2026-10-01 05:00 UTC tick, and a zero-row carrier takes the append
  path — yet nothing was appended. Either the Oct 1 Posti refresh failed
  or the then-deployed build lacked the Posti path; not determinable from
  reads. Flag: do not assume the cron works end-to-end for Posti until a
  tick succeeds or the Workers Logs / dashboard cron-invocation history
  for `rajahinta-api-production` is checked (see deploy state below).

### Query 3 — weight_grams coverage over product_master

```sql
SELECT COUNT(*) AS total, COUNT(weight_grams) AS with_weight,
       COUNT(*) - COUNT(weight_grams) AS null_weight
FROM product_master;
```

**Result (production, 2026-10-04): total 9494, with_weight 3766** (39.7%;
5728 NULL — matches the no-backfill, no-default expectation from migration
0020). The quantity-aware weight path can rely on stored weights for ~2 in
5 products; the volume fallback carries the rest. (Staging: 4638/6158 =
75.4% — staging coverage is NOT representative of production.)

### Query 4 — merchant registry countries

```sql
SELECT merchant_id, name, country FROM merchant_registry ORDER BY merchant_id;
```

**Result (production, 2026-10-04): `carrier_id` column missing — migration
0027 NOT applied remotely.** The query with `carrier_id` failed verbatim:

> "no such column: carrier_id at offset 35: SQLITE_ERROR [code: 7500]"

Recorded as the migration-pending state (per task definition), not a data
anomaly: 0027 must be applied to the remote production (and staging) D1
before this change's merchant→carrier reads/writes can run. Fallback query
without the column succeeded — the registry anchor for the new column:

| merchant_id | name    | country |
|-------------|---------|---------|
| alko        | Alko    | FI      |
| alks        | Alks    | DE      |
| kippis      | Kippis  | FI      |
| longero     | Longero | EE      |
| mydrink     | MyDrink | EE      |

(Schema `0000_supreme_bucky.sql`: `merchant_id text(128)`, `name
text(256)`, `country text(4)` ISO-ish 2-letter — confirmed by the rows.)

### Staging cross-check (2026-10-04, same reads against `rajahinta-api-staging`)

- `source_governance`: fransberg + posti both GRANTED (matches production).
- `transport_offers`: fransberg 36 rows @ 2026-09-17 constant (identical to
  production) plus 10 legacy probe rows frozen at 2026-08-31T18:29:50.316Z
  (db_schenker 2, dhl_fi 2, dsv_fi 1, kaukokiito 1, maersk_fi 2,
  posti_freight 2, vr_transport 2) — production has none of those.
- `product_master`: 4638/6158 with weight (75.4%).
- `merchant_registry`: same five merchants/countries as production.
- Cron triggers on the staging Worker: same six schedules incl. `0 5 1 * *`.

### Curated-cron deploy state

- **Config (verified):** `0 5 1 * *` IS registered in `wrangler.jsonc`
  `triggers.crons` (top level — applies to all three env deploys). Handler:
  `apps/api-worker/src/cron/curated-rate-refresh.ts`, which exports
  `CURATED_REFRESH_CRON = '0 5 1 * *'` and syncs the in-repo Fransberg +
  Posti datasets, skipping a carrier whose newest stored `observed_at`
  already equals the dataset's constant.
- **Deployed state (verified 2026-10-04):** active production deployment is
  2026-10-04T09:51:28.034Z, version `5364d1b2-bc5b-46d4-934c-6298ccb443f4`
  (100% of traffic). The remote trigger set on `rajahinta-api-production`
  includes `0 5 1 * *` (created 2026-09-26, refreshed by the latest deploy)
  alongside `0 * * * *`, `0 2 * * *`, `0 */6 * * *`, `*/30 * * * *`,
  `30 3 * * *`. The curated handler is in the codebase since commit
  `99e869c` (2026-09-28, "curated transport sources (Posti joins
  Fransberg)"), which predates the active deployment — so the deployed
  worker carries both the handler and the trigger.
- **Oct 1 tick log (still not directly verifiable — tooling limitation):**
  `wrangler tail` only streams live events and cannot replay past
  invocations; Workers Logs / dashboard cron-invocation history for
  `rajahinta-api-production` remains the way to confirm the 2026-10-01
  05:00 UTC invocation itself. The Query 2 fingerprint partially covers
  it: fransberg sits at its dataset constant (skip path), but posti has
  zero rows even though the append path should have run — treat "the cron
  works end-to-end for Posti" as unproven until a tick succeeds or the
  invocation history is checked.

### Doc drift noticed (no action this task)

`wrangler.jsonc` cron comment says the monthly handler is
`src/cron/fransberg-rate-refresh.ts`; the actual file is
`src/cron/curated-rate-refresh.ts` (covers fransberg + posti). Config and
code agree on the schedule; only the comment is stale.

### Re-run checklist — EXECUTED 2026-10-04

All four queries plus `wrangler deployments list` ran against production
(token injected per-command from a local secret file; nothing logged or
committed), and the same reads were cross-checked against staging (see
above). The reads are on record; the governance GRANT already exists in
production.

Still open before task 2.x: (a) owner answers for the TODO block below —
carrier mapping remains unanswered; (b) migration 0027 applied remotely
(Query 4); (c) optionally confirm the Oct 1 cron invocation via Workers
Logs / dashboard history (Posti gap in Query 2).

## TODO(owner) — carrier truth per merchant

The `merchant_registry.carrier_id` values are owner data. Fill one line per
merchant; `NULL` (leave unknown) is a valid answer and keeps that merchant
UNAVAILABLE — nothing will be guessed or defaulted.

- `alko → ?`
- `alks → ?` — plausibly `fransberg`, but NOT to be assumed; confirm or deny.
- `kippis → ?`
- `mydrink → ?`
- `longero → ?` — note: no EE→FI carrier dataset exists yet (Posti's tables
  are domestic-only; Longero ships from an EE origin), so `NULL` /
  "stays UNAVAILABLE until real data exists" is the expected answer unless
  the owner has a source.

Owner answers:

- (pending — fill in)

## Verification runbook (task 5.3, 2026-10-04)

Owner/operator procedure for the VERIFIED write path (task 5.1), its
audit trail, the ageing contract (task 5.2), and what each surface
shows once a verification exists. Docs-only: everything below was
read off the committed code (`ops.routes.ts` `verifyOffer`,
`freshness-alert.ts` `writeBackAgedVerifiedOffers`,
`audit-event.repository.ts`, `middleware/ops-access.ts`,
`lib/design/status.ts`); no commands were executed.

### Operator flow — POST /ops/console/offers/:id/verify

- **Access:** every `/ops/console/*` route rides the opsAccess guard —
  fail-closed 403 unless `OPS_BEARER_TOKEN` matches the
  `Authorization: Bearer <token>` header (constant-time SHA-256 digest
  compare) or `OPS_IP_ALLOWLIST` matches `CF-Connecting-IP`. The same
  token the rest of the console uses; per-environment secret.
- **Request:** JSON body `{ "operator": "<name>", "note": "<why>" }`.
  `operator` is required (non-empty, ≤ 128 chars after trim,
  `validateOperator`); `note` is an optional string. `:id` is the
  numeric `retail_offers.id` — unknown id → 404, non-JSON body → 400.
- **Effect:** sets `reliability_status = 'VERIFIED'` on that row and
  stamps `verified_at` (ISO-8601 at handling time) and `verified_by`
  (the trimmed operator name), then appends one audit row (below).
- **Success response:** `{ id, merchant, productId, reliabilityStatus:
  "VERIFIED", verifiedAt, verifiedBy }`.
- **Re-verification:** allowed — a later verify overwrites the
  `verified_at`/`verified_by` pair in place and appends another audit
  row. The columns hold only the latest decision; the history lives in
  `audit_events`.
- **No un-verify endpoint, deliberately:** superseding a verdict is a
  later operator decision, never an accident. Ingestion never writes
  VERIFIED either (offers are pinned ESTIMATED at birth), so a human
  with a name on record is the only writer (design D7).

### Audit query

Each verify appends to the append-only `audit_events` table with
`entity_type = 'retail_offer'`, `action = 'confirmed'`,
`author = <operator>`, and JSON `previous_value` / `new_value`
snapshots (previous `reliabilityStatus`; new status + verifiedAt +
verifiedBy) — the same WorkerAuditService write path as every other
console mutation.

Console read (newest first; limit clamped 1..100, default 25):

```
GET https://api.rajahinta.fi/ops/console/audit?limit=25
```

Direct D1 read (repo convention: `cd apps/api-worker`,
`--remote --env production`, per `docs/ingestion-runbook.md`):

```bash
wrangler d1 execute DB --remote --env production --command "\
  SELECT id, entity_id, author, reason, occurred_at, previous_value, new_value \
  FROM audit_events \
  WHERE entity_type = 'retail_offer' AND action = 'confirmed' \
  ORDER BY occurred_at DESC, id ASC LIMIT 50" -y
```

Columns are snake_case in D1; the console JSON maps them to camelCase.
The `(entity_type, entity_id, occurred_at)` index serves per-offer
history — add `AND entity_id = '<offer id>'` for one offer's timeline.

### Ageing contract (task 5.2 — what happens to VERIFIED over time)

- The freshness cron (`FRESHNESS_ALERT_CRON = */30 * * * *`, every
  30 min) runs the VERIFIED → STALE write-back before its alerting
  evaluation — and before the alert-config gate, so ageing runs even
  where email paging is unconfigured. A failed pass is logged, never
  thrown; offers stay VERIFIED until the next tick retries.
- **Window source:** the SAME window that defines `actualStatus` in
  the data-quality classifier — `ReliabilityService.stalenessThreshold
  For('price')`, module default 48 h. A row ages out when
  `observed_at < now − window` (strict: AT the boundary is still
  fresh), mirroring `assessDataRecency` one-to-one — no second
  freshness constant.
- **Status-only + idempotent:** the UPDATE touches only
  `reliability_status`, guarded on `reliability_status = 'VERIFIED'` —
  price, `observed_at`, and the verification pair are never written,
  and a re-run over already-STALE rows matches zero rows.
  ESTIMATED / UNAVAILABLE rows never match (they age through
  re-ingestion, not this pass).
- **Attribution survives:** `verified_at` / `verified_by` remain on
  the row across VERIFIED → STALE. STALE reads as "was verified, the
  evidence has since aged out"; the pair is historical attribution,
  overwritten only by the next explicit verification.

### Expected surfaces after a verification

- **Merchant reliability score** (merchants surface): `statusCounts`
  and `statusShares` aggregate stored statuses, so the verified offer
  moves its merchant's count into VERIFIED and the VERIFIED share
  becomes non-zero. Past the price window the freshness tick moves it
  to STALE — counts follow, shares renormalize; no code involved
  (design D8: scoring aggregates stored statuses unchanged).
- **Calculator confidence:** the confidence report is built from
  per-input reliability statuses; the offer's retail status feeds it
  directly (`resolveRetailOfferStatus`), so a verified retail offer
  presents as the verified input it is. Transport VERIFIED is gated
  separately (task 3.2, design D6): the estimator reports VERIFIED
  only on an exact weight-bracket match whose weight basis is
  `STORED_PRODUCT_WEIGHT` (non-null `weight_grams`); a volume-estimate
  basis caps at ESTIMATED regardless of any verification. Note the
  asymmetry: the endpoint verifies `retail_offers` rows — transport
  VERIFIED comes from the curated datasets through that estimator
  gate, never from this endpoint.
- **Legend (reliability status meta):** canonical source
  `apps/frontend/src/lib/design/status.ts` + the `Common.reliability.*`
  catalog labels (green Verified / blue Estimated / amber Stale / gray
  Unavailable). No copy change: with phase 5 approved, green becomes a
  reachable state and the legend's "green = verified" promise is
  simply true (design D9 — the fallback copy does not apply).
  Checked, not edited.

### Prerequisite — carrier mapping (TODO(owner) above)

A verified retail offer says nothing about shipping until the
merchant→carrier assignment exists: with `merchant_registry.carrier_id
= NULL` the calculator falls back to the merchant name and typically
degrades transport to `0 ¢ / UNAVAILABLE`, leaving the confidence
report unverified on the transport input no matter how many offers are
verified. Fill the `TODO(owner) — carrier truth per merchant` block
above (NULL is a valid, honest answer) before promising green
transport lines; Longero (EE→FI) is expected to stay UNAVAILABLE until
a real carrier dataset exists.
