# Change notes — transport-confidence-unlock

## Pre-flight reads (2026-10-04)

Task 1.1: read-only operations reads before any grant/trigger/write in later
tasks. **Blocker: every remote read failed — wrangler is not authenticated in
this session** (exact error below). Nothing was fabricated; everything below
that could be verified comes from the repo itself (config, migrations,
handler source). The queries are recorded ready-to-run once auth exists.

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

### Blocker — exact failure

`npx wrangler whoami` → "You are not authenticated. Please run
`wrangler login`." No `CLOUDFLARE_API_TOKEN` is set in the session
environment (the token exists only as GitHub Actions secret input to the
deploy workflows — see `.github/workflows/deploy-*.yml`; no local `.env`).

A representative read was attempted and failed verbatim:

```
wrangler d1 execute DB --remote --env production \
  --command "SELECT merchant_id, permission_status FROM source_governance \
  WHERE merchant_id IN ('fransberg','posti')" --json
```

> error: "In a non-interactive environment, it's necessary to set a
> CLOUDFLARE_API_TOKEN environment variable for wrangler to work."

`wrangler deployments list --env production` failed the same way, so the
**deployed** cron state is unverified. Re-run the queries below with auth
set (interactive `wrangler login` or `CLOUDFLARE_API_TOKEN`) before task 2.

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

**Result: NOT RUN — auth blocker.** Expected for the unlock: a GRANTED row
per carrier (fail-closed gate means zero rows read as "not granted").

### Query 2 — carrier rows in transport_offers (does the Oct 1 tick append?)

```sql
SELECT carrier, COUNT(*) AS rows, MAX(observed_at) AS newest
FROM transport_offers GROUP BY carrier;
```

**Result: NOT RUN — auth blocker.** Proposal (verified 2026-10-03 against
the repo) states the table carries no carrier rows at all; this read
confirms whether that is still true and, if rows exist, which carrier and
how fresh.

### Query 3 — weight_grams coverage over product_master

```sql
SELECT COUNT(*) AS total, COUNT(weight_grams) AS with_weight,
       COUNT(*) - COUNT(weight_grams) AS null_weight
FROM product_master;
```

**Result: NOT RUN — auth blocker.** Schema facts verified from
`migrations/0020_product_weight_grams.sql`: nullable `INTEGER`, added by
forward migration, **no backfill, no default** — so partial-to-zero
coverage is expected by construction and informs how much of the
quantity-aware weight path (change item "quantity-aware weight") can rely
on stored weights vs the volume fallback.

### Query 4 — merchant registry countries

```sql
SELECT merchant_id, name, country FROM merchant_registry ORDER BY merchant_id;
```

**Result: NOT RUN — auth blocker.** Schema (`0000_supreme_bucky.sql`):
`merchant_id text(128)`, `name text(256)`, `country text(4)` (ISO-ish
2-letter per seed data, e.g. `FI`, `DE`). Needed as the anchor for the
carrier-per-merchant column this change adds.

### Curated-cron deploy state

- **Config (verified):** `0 5 1 * *` IS registered in `wrangler.jsonc`
  `triggers.crons` (top level — applies to all three env deploys). Handler:
  `apps/api-worker/src/cron/curated-rate-refresh.ts`, which exports
  `CURATED_REFRESH_CRON = '0 5 1 * *'` and syncs the in-repo Fransberg +
  Posti datasets, skipping a carrier whose newest stored `observed_at`
  already equals the dataset's constant.
- **Deployed state (NOT verified):** `wrangler deployments list` needs the
  same auth; blocked.
- **Oct 1 tick log (NOT verified — tooling limitation, per plan):**
  `wrangler tail` only streams live events, it cannot replay past
  invocations, so the 2026-10-01 05:00 UTC tick cannot be confirmed from
  here. Cheap alternatives once authenticated: Workers Logs / cron-invocation
  history in the Cloudflare dashboard for `rajahinta-api-production`, or the
  `MAX(observed_at)` from Query 2 as the effective evidence (the handler is
  append-only and skips unchanged datasets, so presence + freshness of
  carrier rows IS the tick's fingerprint).

### Doc drift noticed (no action this task)

`wrangler.jsonc` cron comment says the monthly handler is
`src/cron/fransberg-rate-refresh.ts`; the actual file is
`src/cron/curated-rate-refresh.ts` (covers fransberg + posti). Config and
code agree on the schedule; only the comment is stale.

### Re-run checklist once auth is available

```bash
cd apps/api-worker
wrangler d1 execute DB --remote --env production --json --command "<query 1..4 above>"
wrangler deployments list --env production
```

Then fill the TODO block below from the owner's answers and update this
section's "NOT RUN" entries with real results. Do not proceed to the
governance grant (task 2.x ops unlock) before these reads are on record.

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
