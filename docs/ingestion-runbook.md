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

Before a grant, the gate's behavior for the merchant is exactly the
spec's fail-closed scenario: **the pipeline performs no fetch for it
and persists no data**. The producer log line for an ungranted
merchant reads:

```
Not scheduling merchant "alks": no governance records — defaulting to PENDING
```

Every grant and revocation is a human console action, recorded in the
durable `audit_events` table with the operator identity, target, and
reason. There is no auto-grant or config-file grant path.

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
- [ ] **Durable governance store wired.** Current status: the
      source-governance store has no D1 counterpart yet (no table was
      ported in `migrate-to-cloudflare` 2.5), so console governance
      mutations fail closed with `503 StoreUnavailable` rather than
      write to a non-durable store, and the console list reports every
      merchant as `PENDING` with zero sources. This is a prerequisite
      for the grant steps below to take effect, owned by the platform
      engineer. **A 503 is the fail-closed stop, not a failed grant —
      do not work around it with manual database writes** (the absence
      of a governance table is itself part of the gate).

---

## 2. Staging: register and grant the `alks` source

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
     VALUES ('alks', 'Alks', 'DE', 'https://alks.fi', 'json', 3600000) \
     ON CONFLICT (merchant_id) DO UPDATE SET \
       name = 'Alks', country = 'DE', feed_url = 'https://alks.fi', \
       feed_format = 'json', polling_interval_ms = 3600000, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')" -y
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

## 4. Verification checklist (per environment)

- [ ] Pre-grant: producer skips the merchant, no fetch, no data
      persisted (§0 fail-closed contract).
- [ ] Grant action returns `permissionStatus: GRANTED`,
      `changed: true`; console row shows `GRANTED` with one source.
- [ ] Audit entry recorded with operator identity and reason.
- [ ] Next hourly pass enqueues the merchant; first run upserts offers
      and appends observations to R2.
- [ ] Revocation path exercised once (staging): producer skips the
      merchant again after `REVOKED`.
