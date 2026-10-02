# Change notes — honest-trust-surfaces

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
