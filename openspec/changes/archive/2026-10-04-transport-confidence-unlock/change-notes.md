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

## Ops unlock (task 2.1, 2026-10-04)

Executed by the devops agent on the owner's explicit authorization ("you
do all yourself") for these mutations only: D1 migrations 0027 + 0028
applied to staging and production, and one curated-refresh trigger per
environment. Everything else stayed read-only. Token injected inline
per-command from the local secret file; never echoed, logged, or
committed. **No commits, no pushes, no deploys.**

### Migrations applied — 0027 + 0028, both envs

`wrangler d1 migrations list DB --remote` showed both pending per env;
`pnpm db:migrate:d1:staging` then `db:migrate:d1:production` (run from
`apps/api-worker`; wrangler `d1 migrations apply DB --remote --env …`)
applied both, ✅ per the wrangler status table on each:

- staging (`rajahinta-api-staging`, da49e685): 0027_merchant_carrier ✅,
  0028_offer_verification ✅
- production (`rajahinta-api-production`, f8f67277): 0027 ✅, 0028 ✅

Post-apply verification (direct D1 reads): `merchant_registry.carrier_id`
exists — 5 merchants, 0 populated (correct: owner data, TODO below);
`retail_offers.verified_at` / `verified_by` exist — production 102,096
rows / 0 verified, staging 107,625 / 0 (correct birth state).

### Posti gap — root cause found (code + deploy evidence, no log replay needed)

Two independent layers; either alone produces zero posti rows:

1. **Governance gate wired to an empty store (the decisive bug).**
   `curated-rate-refresh.ts` built its refresh adapter with the no-arg
   `composeGovernanceService()` — whose default is the **in-memory**
   `InMemorySourceGovernanceRepository` (empty, fail-closed). Every
   carrier reaching the gate was therefore skipped
   (`sources.length === 0` → skip) regardless of the D1 `source_governance`
   GRANT — the grants from 2026-09-28 were in place and irrelevant to
   that gate. The price pipeline composes the same service correctly
   (`new D1SourceGovernanceRepository(env.DB)` in
   `queues/pipeline.ts` and `queues/ingestion-producer.ts`); only the
   curated cron missed the wiring. Fransberg never noticed because its
   stored `MAX(observed_at)` always equalled the dataset constant — it
   skips before the gate. Demonstrated empirically 2026-10-04: staging
   run with the deployed (buggy) wiring logged GRANTED-in-D1 +
   "Refreshed 0 curated posti transport rates"; the Nest-adapter skip
   warnings are invisible in Workers because `@nestjs/common` is aliased
   to the no-op shim. **Consequence: the deployed code would ALSO have
   no-oped the 2026-11-01 tick.**
2. **The Oct 1 tick ran pre-transcription Posti data anyway.** Deploy
   history (`gh run list`, deploy-production.yml): production deploys
   2026-09-29T19:39:26Z (`b28a03be`) → next 2026-10-01T09:52:50Z — so
   `b28a03be` was live at the 05:00 UTC tick. `git show` on that commit:
   the Posti-capable handler IS present (`99e869c` is an ancestor — the
   "old code" hypothesis is dead), but `POSTI_RATES = []` — the
   transcription (`1c499a2`, 2026-09-30T17:14Z, 1 domestic row +
   `POSTI_OBSERVED_AT` → 2026-09-30) was NOT, and first shipped in the
   09:52Z deploy, ~5 h after the tick. (Governance-timing hypothesis
   also dead: grants 2026-09-28T12:33Z predate both the Sep 28 12:59Z
   deploy and the tick.)

Workers Logs / cron-invocation replay remains unreached (no documented
wrangler command; `wrangler tail` is live-only) — moot now: the deploy
timeline + dataset constants fully determine the outcome.

### Refresh trigger — method, fix, runs

Path: the handler's own documented out-of-band sync — remote dev against
real bindings, per env:

```
cd apps/api-worker
wrangler dev --env <env> --remote --test-scheduled --port 8788 \
  --show-interactive-dev-session false
curl "http://localhost:8788/__scheduled?cron=0+5+1+*+*"
```

`--remote` accepts `--test-scheduled` on wrangler 4.127.1; the session
binds the REAL per-env D1 (`env.DB (rajahinta-api-<env>)` in the binding
banner) and uploads the working-tree bundle. Queues/DO-SQLite warnings
are expected and irrelevant to this handler.

**Uncommitted repo change (left in the working tree, NOT committed per
instruction — needs the platform engineer's proper commit + deploy):**
`apps/api-worker/src/cron/curated-rate-refresh.ts` (+7/−1, `tsc
--noEmit` clean) — pass
`composeGovernanceService(new D1SourceGovernanceRepository(env.DB))`
instead of the no-arg call, mirroring the established wiring elsewhere.
Without it the trigger appends nothing (staging demonstrated 0 pre-fix,
1 post-fix) and the next monthly tick would no-op. Note the deployed
production Worker still carries the bug — the fix only lived in the
ephemeral dev sessions; deployed code is unchanged.

Runs (all via the fixed working-tree code):

- staging rehearsal: first trigger appended **1** posti row
  (`transport_offers` id 49); second trigger → both carriers skip
  (idempotent).
- production: trigger → `Refreshed 1 curated posti transport rates`
  (id 37); re-trigger → both carriers skip (idempotent). Fransberg took
  the unchanged-dataset skip in every run, both envs — 36 rows
  untouched, as designed.

### Per-carrier counts — before → after

Production (`transport_offers GROUP BY carrier`):

| carrier   | before       | after                          |
|-----------|--------------|--------------------------------|
| fransberg | 36 @ 2026-09-17 | 36 @ 2026-09-17 (unchanged — skip) |
| posti     | 0            | 1 @ 2026-09-30, VERIFIED       |

Staging: identical fransberg/posti deltas (posti id 49); the 10 legacy
probe rows @ 2026-08-31 are untouched.

The new row in both envs is the complete curated Posti domestic dataset
as transcribed (`posti-rate.source.ts`): FI→FI, parcel, 0–2 kg,
790 ¢ EUR, sender-paid (`seller_involvement_indicator` 0), observed
2026-09-30, reliability VERIFIED, `refreshed_at` 2026-10-04T13:16Z.
**Expectation correction: "12 domestic rows" (task briefing) was an
overestimate — the transcription is exactly 1 weight-distinct tier by
design (commit `1c499a2`: larger size classes share the 25 kg cap and
differ only in dimensions the row shape cannot carry).**

### Open items for task 2.1 closure

- **Before 2026-11-01 05:00 UTC:** commit + deploy the governance-wiring
  fix (or the next tick silently appends nothing again). This is
  application code — platform engineer's call.
- Owner carrier mapping (TODO block below) still pending — `carrier_id`
  column now exists and is NULL everywhere.
- `wrangler.jsonc` cron comment still names `fransberg-rate-refresh.ts`
  (see doc-drift note above); while touching config, the comment could
  name the curated handler and datasets accurately.
- A stray `wrangler tail --env production` process from an earlier
  session was observed running on the deploy host; left untouched, not
  ours to kill.

## TODO(owner) — carrier truth per merchant

> **RESOLVED — DECIDED (owner-directed 2026-10-04):** see **Carrier
> assignments & Omniva dataset (task 8.3)** at the end of this file for the
> assignments, per-row evidence basis, and the exact reversal UPDATE. Block
> kept verbatim for audit history — the notes below (including the then-valid
> "no EE→FI dataset exists" expectation for Longero) describe the state at
> question time and are superseded, not deleted.

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

- **Decided 2026-10-04 (owner-directed):** `alko → posti`, `alks →
  fransberg`, `kippis → posti`, `mydrink → omniva`, `longero → omniva`.
  Applied by task 8.2 to staging and production; best-evidence until each
  merchant confirms its actual carrier — see the task 8.3 section.

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

## Carrier assignments & Omniva dataset (task 8.3, 2026-10-04)

Runbook addendum for the owner-directed carrier assignments (task 8.2
applies them) and the Omniva EE→FI curated dataset (task 8.1
transcribed it). This section records provenance and expectations only —
the operator verification flow, its audit trail, and how to read the
resulting statuses are already in the **Verification runbook (task 5.3)**
section above and are not repeated here.

### Assignment provenance — owner-directed, reversible

The five `merchant_registry.carrier_id` values are **owner-directed data
operations of 2026-10-04** (applied to staging and production by task 8.2):
`alko → posti`, `alks → fransberg`, `kippis → posti`, `mydrink → omniva`,
`longero → omniva`. They are data, not code — the entire assignment is
reversible with a single UPDATE (this is also the "undo" if a merchant
disowns the mapping):

```sql
UPDATE merchant_registry SET carrier_id = NULL
WHERE merchant_id IN ('alko', 'alks', 'kippis', 'mydrink', 'longero');
```

Evidence basis per row (merchant registry country ↔ carrier lane
coverage; Query 4 above anchors the countries):

- `alks → fransberg` — the DE-origin merchant; Fransberg is the only
  curated carrier whose dataset covers DE→FI lanes.
- `alko → posti`, `kippis → posti` — FI merchants; Posti's curated
  dataset is the domestic FI→FI lane.
- `mydrink → omniva`, `longero → omniva` — EE merchants; Omniva's new
  dataset is the EE→FI lane (the dataset the old TODO block found
  missing in 1.1 now exists).

These remain **best-evidence assignments** until each merchant confirms
its actual carrier; a confirmation (or refutation) is a one-row UPDATE of
the same shape — set the single `carrier_id`, never guess a replacement.

### Omniva dataset — source, validity, admin

- **Source:** Omniva's published price list "International parcels for
  private customers — prices including VAT in EUR, valid from 1.07.2025"
  (PDF):
  `https://www.omniva.ee/wp-content/uploads/sites/7/2025/08/hinnakiri-rv-pakiteenused-era-est-en-2025-4.pdf`
  — transcribed 2026-10-04 into
  `packages/data-acquisition/src/adapters/omniva-rate.source.ts`: 11
  Standard-service EE→FI parcel brackets, 0–30 kg, 1240–2601 ¢,
  VAT-inclusive, recipient-paid (`sellerInvolvementIndicator` false on
  every row).
- **Standard service only** (3–6 working days — the default consumer
  parcel service). **Premium is deliberately omitted:** the
  transport-offer schema does not dimension on service level, and
  encoding both services into one weight bracket would let the first DB
  hit decide the price — the same rationale as Posti's size classes:
  never encode an ambiguous choice into one weight bracket. **Economy is
  omitted:** capped at 0.5 kg, a sliver this calculator's baskets do not
  fit.
- **1.10.2026 universal-service change: no impact.** That change covers
  universal-service letters/parcels only; Omniva's commercial parcel
  prices are unaffected (omniva.ee news "New Postal Service Price List
  from 1 October", 01.09.2026), so this dataset needed no re-review at
  that date.
- **`OMNIVA_OBSERVED_AT` convention:** every row carries the
  transcription's review date (currently `2026-10-04T00:00:00Z`). When
  Omniva reprices, edit the bracket table and bump the constant to the
  new review date — the date is the dedupe key, so a bump without a
  price change is harmless but creates an append.
- **Admin procedure:** identical to Fransberg/Posti — edit the dataset,
  bump `OMNIVA_OBSERVED_AT`, deploy; the monthly curated-rate-refresh
  cron re-ingests it through the same governance-gated pipeline and the
  per-carrier skip guards against duplicate appends.
- **2026-11-01 cron expectation:** the dataset is unchanged since its
  2026-10-04 observation, so the monthly tick (2026-11-01 05:00 UTC)
  takes the unchanged-dataset skip path and appends nothing — zero new
  `omniva` rows after that tick is correct behavior, not a failure.

### Expected transport outcomes per merchant (after 8.2)

| merchant | carrier | lane coverage | expected transport outcome |
|---|---|---|---|
| alks | fransberg | DE→FI | quotes the Fransberg parcel/pallet brackets |
| alko | posti | FI→FI | quotes Posti's single parcel row only when the derived tier is parcel **and** weight ≤ 2 kg; above that, honest `0 ¢ / UNAVAILABLE` until Posti's table grows |
| kippis | posti | FI→FI | same as alko |
| mydrink | omniva | EE→FI | quotes the Omniva EE→FI 0–30 kg parcel brackets |
| longero | omniva | EE→FI | quotes the Omniva EE→FI 0–30 kg parcel brackets |

The EE merchants (mydrink, longero) go from permanently UNAVAILABLE to
priced — the assignment is exactly what the Omniva dataset unlocks.
Anything outside a covered lane/tier/bracket — an origin country no
dataset covers, a pallet-tier shipment against Posti, weight above the
last bracket — degrades to `0 ¢ / UNAVAILABLE` as designed. How to read
the resulting statuses (transport VERIFIED gated on exact bracket match
plus stored-weight basis; merchant reliability shares) is in the
**Verification runbook (task 5.3)** section above; per-carrier row
counts after the 8.2 refresh are that task's verification.

## Ops data + deploy (task 8.2, 2026-10-04)

Executed 2026-10-04 ~16:30–17:00 UTC on the deploy host, staging first
then production. Mutations were limited to the owner-directed
assignments, the api-worker deploys, and one refresh trigger — no
commits, no pushes.

### Carrier assignments — applied and verified

Provenance: **owner-directed 2026-10-04** (alko→posti, alks→fransberg,
kippis→posti, mydrink→omniva, longero→omniva). One CASE UPDATE per
environment against `merchant_registry` (staging `changes: 5`, then
production `changes: 5`); verified by SELECT — both envs show exactly
alko=FI/posti, alks=DE/fransberg, kippis=FI/posti, mydrink=EE/omniva,
longero=EE/omniva. Pre-state was carrier_id NULL on all five in both
envs.

### api-worker deploy — gate fix + omniva source now live

No package.json deploy script exists; the repo's own CI commands
(`deploy-staging.yml` / `deploy-production.yml`) were mirrored from
`apps/api-worker/`:

- **staging** `rajahinta-api-staging`: version
  `fa5b0939-b6c0-403e-9600-e9ec6eec29ca`, created 2026-10-04T16:39:42Z,
  active at 100%.
- **production** `rajahinta-api-production`: version
  `1b9cfb92-d8e3-4156-8f28-d27f54fca663`, created
  2026-10-04T16:39:55Z, active at 100% (custom domain api.rajahinta.fi,
  `0 5 1 * *` cron present in the trigger set).

This closes the task 2.1 open item: the deployed bundle now carries the
governance-gate D1 wiring fix plus the 8.1 omniva source/registration
(commit `9acf5da`). The uncommitted test-file edits in the working tree
are untouched and not part of the bundle.

### Refresh trigger — omniva appended 0 (BLOCKED on governance grant)

Proven 2.1 path, production env, run once:

```
wrangler dev --env production --remote --test-scheduled --port 8788 \
  --show-interactive-dev-session false
curl "http://localhost:8788/__scheduled?cron=0+5+1+*+*"
```

Outcome: fransberg and posti took the unchanged-dataset skip
(2026-09-17 / 2026-09-30) — idempotent, no dupes. Omniva logged
"Running monthly curated rate refresh for omniva" then **"Refreshed 0
curated omniva transport rates"** — the expected 11 rows did not land.

Root cause (code-level, verified by reads only): the pipeline adapter's
`checkCarrierPermission` looks up `source_governance` by carrierId as
merchant_id. `fransberg` and `posti` have MANUAL_VERIFICATION GRANTED
rows (created 2026-09-28 for exactly this); **no `omniva` row exists in
`source_governance` in any env** — 8.1 registered the carrier in code
only, and migrations 0027/0028 (merchant_carrier, offer_verification)
don't cover governance. Missing record → default PENDING → skip before
any fetch → 0 rows. The gate fix working as deployed is what surfaces
this.

**Remediation needs owner direction (not executed — outside the
authorized mutation set):** INSERT a `source_governance` GRANTED row for
merchant_id `omniva`, mirroring the fransberg/posti precedent —
acquisition_method `MANUAL_VERIFICATION`, source_url
`https://omniva.ee` (or the owner's preferred citation), status_reason
in the "owner policy 2026-10-04: manually curated in-repo dataset
(omniva-rate.source.ts) … grant enables the monthly curated-rate-refresh
cron" pattern — in staging and production. Then re-trigger once via the
same path: fransberg/posti will skip unchanged (safe), omniva will
append its 11 rows @ 2026-10-04.

### Per-carrier counts — before → after (transport_offers)

| carrier   | production before | production after | staging |
|-----------|-------------------|------------------|---------|
| fransberg | 36 @ 2026-09-17   | 36 (unchanged — skip) | 36 (unchanged) |
| posti     | 1 @ 2026-09-30    | 1 (unchanged — skip)  | 1 (unchanged)  |
| omniva    | 0                 | **0 (governance-blocked)** | 0 |
| legacy probes | —             | — | 10 rows @ 2026-08-31 untouched |

Staging got no refresh trigger (task scope: production trigger, once);
staging additionally carries `alks` governance REVOKED (pre-existing
staging drift, unrelated to 8.2).

### Task 8.2 status

Assignments: DONE (both envs, verified). Deploy: DONE (gate fix +
omniva live in staging and production). Refresh: PARTIAL — omniva
append blocked on the missing governance grant; everything else
verified. No blockers for the assignments/deploy; one owner decision
pending for the omniva governance INSERT + one re-trigger.
