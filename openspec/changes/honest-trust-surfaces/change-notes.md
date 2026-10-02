# Change notes — honest-trust-surfaces

## Production handover — sequencing invariants (read first)

1. **Backfill BEFORE deploy.** `product_master.unit_volume` is part of the Tier-2 identity compound key `(name, brand, container_type, unit_volume)`. Deploying the normalizer before correcting the stored rows lets the daily cron re-key affected rows onto corrupted volumes; the runbook below exists to prevent exactly that. Do not start the deploy section until the runbook's step 7 has verified the corrected values in production.
2. **The deploy is owner-gated.** Production ships only through `deploy-production.yml`, whose first step refuses to run unless `confirm_deploy=yes` is set explicitly at dispatch. No push, timer, or automation deploys production; a dispatch without the gate fails on purpose.
3. **Credentials never surface.** Every remote D1 step reads `CLOUDFLARE_API_TOKEN` from the environment, exported from the operator's own token file without echoing (see the deploy section). The token is never printed, pasted into a command, or committed; the `/tmp/opencode/` artifacts carry SQL and responses only.

## Runbook — unit-volume backfill BEFORE deploy (task 1.2)

### Why backfill before deploy

`product_master.unit_volume` participates in the Tier-2 identity compound key `(name, brand, container_type, unit_volume)`. Deploying the normalizer first would leave production rows at their corrupted pack totals: the daily cron re-ingests and re-keys affected rows while price-observation lookups still resolve the old compound-key tuples, so the corrupted volumes survive the very deploy meant to fix them. Correcting the stored values first means the cron matches the corrected keys on its first run after deploy. This is the same sequencing the brand backfill followed (finnish-first-client-experience): populate the compound-key column, then deploy.

The correction deliberately changes landed-cost inputs for affected rows (design D3). It fixes stored physical facts; it does not re-price anything.

### Ordered commands

Run the wrangler calls from `apps/api-worker`; run the script from the repo root. `CLOUDFLARE_API_TOKEN` comes from the environment and is never echoed. Artifacts live under `/tmp/opencode/` for reproducibility.

1. Dump production rows (the script reads the wrangler `--json` envelope directly):

   ```
   npx wrangler d1 execute DB --remote --env production --command "SELECT id, name, unit_volume FROM product_master" --json > /tmp/opencode/product-master-unit-volume.json
   ```

2. Candidate stats (the proposal counts 357/54/4 corrupted rows in production; treat large deviations from that as a stop):

   ```
   node --experimental-strip-types scripts/backfill-unit-volume.mts --input /tmp/opencode/product-master-unit-volume.json --stats
   ```

3. Sample the head of the would-update set (stored → parsed):

   ```
   node --experimental-strip-types scripts/backfill-unit-volume.mts --input /tmp/opencode/product-master-unit-volume.json --sample 20
   ```

4. Dry-run, then review the full statement list; stdout and the written artifact must agree:

   ```
   node --experimental-strip-types scripts/backfill-unit-volume.mts --input /tmp/opencode/product-master-unit-volume.json --dry-run > /tmp/opencode/backfill-unit-volume-preview.sql
   ```

5. Real run — writes `/tmp/opencode/backfill-unit-volume.sql` and prints the execution command; stdout carries no SQL:

   ```
   node --experimental-strip-types scripts/backfill-unit-volume.mts --input /tmp/opencode/product-master-unit-volume.json
   ```

6. Apply, only after steps 2–5 are reviewed. Refused rows are listed in the report and never guessed:

   ```
   npx wrangler d1 execute DB --remote --env production --file /tmp/opencode/backfill-unit-volume.sql
   ```

7. Verify the backfill before deploying:

   ```
   npx wrangler d1 execute DB --remote --env production --command "SELECT id, name, unit_volume FROM product_master WHERE id IN (2900, 6679)"
   ```

   Product 2900 must read `unit_volume` 0.33.

8. Deploy. Post-deploy spot checks:

   - Product 2900 detail page: €/g lands in the sane beer band once the metric reads the corrected volume.
   - Re-run the step-7 SELECT after the next daily 00:00 UTC cron: 2900 still reads 0.33. The cron re-ingests through the normalizer and matches the corrected compound keys, so no pack total is resurrected.

### Determinism and idempotence

The script imports the same `parsePackUnitVolumeLitres` the ingestion normalizer maps through, so every emitted value is byte-identical to what re-ingestion stores. Rows whose stored volume already equals the parsed value produce no statement; `updated_at` is never set. Re-running the dump plus the script yields byte-identical SQL. Candidate rows whose names admit no decisive pack-notation parse (zero or absurd volumes with nothing to read) are skipped and listed — the script never guesses a value.

## Gated production deploy (task 5.2)

House pipeline: push → PR CI green → merge to `master` → gated `deploy-production.yml` → live verification (next section).

### Operator token handling (applies to every remote D1 step)

Run the `npx wrangler d1 execute DB --remote --env production` calls from `apps/api-worker` (the runbook's steps 1, 6–7 and the post-deploy SQL checks below). Export the token from the operator's token file before the first remote call — the snippet tolerates a `KEY=` prefix and surrounding quotes and prints a length check only, never the value:

```bash
export CLOUDFLARE_API_TOKEN="$(sed -E 's/^[A-Za-z_][A-Za-z_0-9]*=//; s/^"//; s/"[[:space:]]*$//' "$HOME/.secrets/cloudflare-api-token" | head -n1)"
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] && echo "token loaded (${#CLOUDFLARE_API_TOKEN} chars)" || echo "token MISSING"
```

Never run with `set -x` while the variable is exported, never paste the value into a command line or any file inside the repo, and `unset CLOUDFLARE_API_TOKEN` once the D1 steps are done.

### Deploy steps

1. Merge the pull request after its checks are green:

   ```
   gh pr checks <pr-number> --watch
   gh pr merge <pr-number> --merge
   ```

2. Dispatch the gated production workflow against `master`:

   ```
   gh workflow run deploy-production.yml --ref master -f confirm_deploy=yes
   ```

3. Watch the run to completion (`gh workflow run` prints no id — take the newest run of the workflow):

   ```
   gh run list --workflow deploy-production.yml --limit 1
   gh run watch <run-id> --exit-status
   ```

Expected job shape: Require confirmation (refuses anything but `yes`) → Build frontend (OpenNext) → Apply D1 migrations (production) → Deploy API Worker → Deploy email Worker → Deploy frontend Worker → Health gate on `/api/v1/health/ready` (200 inside the bounded retry window). A green run ends with the production health body `{"status":"ok","checks":{"d1":{"status":"up"},"durableObjects":{"status":"up"}}}`. The workflow also carries a wrangler-rollback runbook job — that, not DNS, is the rollback path.

## Post-deploy live verification (task 5.2)

Run every check against the deployed production. Keep raw responses under `/tmp/opencode/postdeploy/` for the record.

1. **Karhu listing €/g** — the listing embed derives from the cheapest current-available single offer, so it must agree with the detail page's cheapest current offer:

   ```
   curl -s -H "x-age-confirmed: 1" "https://api.rajahinta.fi/api/v1/products?q=karhu&bust=$(date +%s%N)" | jq '[.items[] | {name, eurPerGram}]'
   ```

   Expected: items with a current offer carry `eurPerGram.status` `"computed"` and a `centsPerGram` in the sane beer band (~10–20 c/g for 0.33–0.5 l lagers); products without a current-available offer carry `status: "unavailable"` with an explicit reason (`MISSING_PRICE`, `MISSING_VOLUME`, `MISSING_ALCOHOL_FRACTION`, …) — never NaN, never a zero placeholder.

2. **Accuracy coverage block:**

   ```
   curl -s -H "x-age-confirmed: 1" "https://api.rajahinta.fi/api/v1/accuracy"
   ```

   Expected: `count: 0` (no user-reported outcomes yet) plus the additive `coverage` block with true values — `productCount ≈ 7876`, `offerObservations` the real row count, `lastIngestAt` the latest ingestion watermark (ISO string, or null before the first ingest). The trust row renders the labeled catalog-coverage mode until the first report flips it back to the user-reported statistic.

3. **Blog/guides crawler-honest 404 + footer state** (zero published for the locale):

   ```
   curl -s -o /dev/null -w "%{http_code}" https://www.rajahinta.fi/blog     # → 404
   curl -s -o /dev/null -w "%{http_code}" https://www.rajahinta.fi/guides   # → 404
   curl -s https://www.rajahinta.fi/ | grep -c 'href="/blog"'               # → 0
   curl -s https://www.rajahinta.fi/ | grep -c 'href="/guides"'             # → 0
   ```

   A real 404 status, not an empty-shell soft 404. Publishing the first post/guide restores the page and the footer links on the next request — no flag, no deploy.

4. **Product 2900 spot check** (the runbook's canary):

   ```
   cd apps/api-worker
   npx wrangler d1 execute DB --remote --env production --command "SELECT id, name, unit_volume FROM product_master WHERE id = 2900"
   curl -s -H "x-age-confirmed: 1" "https://api.rajahinta.fi/api/v1/products/2900" | jq '[.offers[] | {priceCents, eurPerGram}]'
   ```

   Expected: `unit_volume` 0.33 (the state the runbook's step 7 verified) and detail offers whose `eurPerGram.status` is `"computed"` with `centsPerGram` in the sane beer band — the corrupted 1.59 c/g reading is gone.

5. **ZERO_ETHANOL honesty** — alcohol-free rows state the physics instead of accusing the data:

   ```
   curl -s -H "x-age-confirmed: 1" "https://api.rajahinta.fi/api/v1/products?q=karhu+0,0&bust=$(date +%s%N)" | jq '[.items[] | {name, eurPerGram}]'
   ```

   Expected: rows with abv = 0 (the Karhu 0,0 variants) carry `status: "unavailable"`, `reason: "ZERO_ETHANOL"` — the reason must not be `INVALID_ALCOHOL_FRACTION`. Alcohol-carrying rows in the same result set stay `"computed"`.

6. **Compare EUR_PER_GRAM sort** — the €/g order on `/compare` is metric value ascending with the product id only as tiebreaker, no longer id-order. Spot check on the page (select a few products whose €/g differ and do not follow id order, choose the €/g order, compare against the previous id-order sequence) or read the sort inputs from the payloads the page is built from (each product's `offers[].eurPerGram.centsPerGram`, picked through the frontend's unit-price selection).

7. **Daily 00:00 UTC cron watch (regression guard)** — after the next daily Tier-1 refresh pass, re-run the runbook's step-7 SELECT:

   ```
   cd apps/api-worker
   npx wrangler d1 execute DB --remote --env production --command "SELECT id, name, unit_volume FROM product_master WHERE id IN (2900, 6679)"
   ```

   Expected: 2900 still reads 0.33 and 6679 its corrected value — the cron re-ingests through the deployed normalizer and matches the corrected compound keys, so no pack total is resurrected. Stronger optional check: re-run the runbook's dump plus `--stats` on a fresh dump; the would-update count should sit at the skipped/refused residue only (unparseable names stay listed and untouched, the script never guesses).
