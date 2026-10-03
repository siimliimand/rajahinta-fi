# Change notes — first-impression-pass

## Production handover — sequencing invariants (read first)

1. **Backfill BEFORE deploy.** The production snapshot holds 26 products above the EU intermediate-products boundary (22 % ABV) stored under the fermented duty key, and the excise engine keys duty by category — fermented rows are taxed per litre of product on wine bands (~3× understated for spirits), spirits per litre of pure alcohol. One honest nuance, stated so nobody over-claims the hazard: unlike the unit-volume backfill, `category` is **not** part of the Tier-2 identity compound key, so a deploy-first order would not corrupt anything — the backfill is deploy-order-SAFE. It still runs first for immediate correctness: the catalog, product detail, and landed-cost surfaces ship with corrected data on the first request after the gate opens, and the deployed adapters keep every later cron run correct. Do not start the deploy section until the runbook's step 8 has verified the corrected values in production.
2. **The deploy is owner-gated.** Production ships only through `deploy-production.yml`, whose first step refuses to run unless `confirm_deploy=yes` is set explicitly at dispatch. No push, timer, or automation deploys production; a dispatch without the gate fails on purpose.
3. **Credentials never surface.** Every remote D1 step reads `CLOUDFLARE_API_TOKEN` from the environment, exported from the operator's own token file (`~/.cloudflare-token`) without echoing. NEVER `cat`, `echo`, or paste the token anywhere — not into a command line, not into a file inside the repo. The `/tmp/opencode/` artifacts carry SQL and responses only.

## Runbook — category backfill BEFORE deploy (task 1.2)

### Why backfill before deploy

`product_master.category` (and its twin column `regulatory_classification` — ingestion writes the same derived key to both) is the excise engine's duty key. 26 rows with ABV 25–58 % (akvavit, sambuca, arrak, bitter) sit in `other_fermented`, so the landed-cost calculator reads the per-litre-of-product wine band instead of the per-litre-pure-alcohol spirits band and materially understates duty (~3×) for those rows. Task 1.1 gave the guarded mapper the 22 % ceiling and wired every ingestion adapter to pass ABV through it; task 1.2's script re-derives the stored rows through that SAME mapper and emits idempotent UPDATEs only where the guarded outcome differs. Correcting the stored rows first means production reads the right duty key from the first request after deploy.

**Expected volume, stated honestly:** the production snapshot counts 26 above-boundary `other_fermented` rows; the live catalog audit saw 20 — catalog drift is expected, treat the script's own `--stats` output as the number of record, and treat a large deviation from the mid-20s as a stop. The script heals BOTH columns per updated row. Separately, ~52 unparseable-ABV fermented rows are honest cannot-key unknowns and will be listed as untouched — that is correct behavior, not a defect (the guard cannot key without an ABV; the script never guesses).

### Ordered commands

Run the wrangler calls from `apps/api-worker`; run the script from the repo root (Node 24 in PATH — type stripping is native). `CLOUDFLARE_API_TOKEN` comes from the environment and is never echoed. Artifacts live under `/tmp/opencode/` for reproducibility.

1. Dump production rows (the script reads the wrangler `--json` envelope directly):

   ```
   npx wrangler d1 execute DB --remote --env production --command "SELECT id, name, category, alcohol_by_volume FROM product_master" --json > /tmp/opencode/product-master-category.json
   ```

2. Candidate stats (expect: would-update ≈ 26, all boundary-attributed; cannot-key ≈ 52 honest unknowns listed untouched; refused = 0):

   ```
   node --experimental-strip-types scripts/reclassify-category.mts --input /tmp/opencode/product-master-category.json --stats
   ```

3. Sample the head of the would-update set (stored → derived, with attribution):

   ```
   node --experimental-strip-types scripts/reclassify-category.mts --input /tmp/opencode/product-master-category.json --sample 20
   ```

   Every line must read `other_fermented → spirits (boundary > 22 %)` — the fermented bucket is the only key the boundary re-keys.

4. Dry-run, then review the full statement list; stdout and the written artifact must agree:

   ```
   node --experimental-strip-types scripts/reclassify-category.mts --input /tmp/opencode/product-master-category.json --dry-run > /tmp/opencode/reclassify-category-preview.sql
   ```

5. Real run — writes `/tmp/opencode/reclassify-category.sql` and prints the execution command; stdout carries no SQL:

   ```
   node --experimental-strip-types scripts/reclassify-category.mts --input /tmp/opencode/product-master-category.json
   ```

6. Apply, only after steps 2–5 are reviewed. Each statement sets `category` AND `regulatory_classification` and never touches `updated_at`:

   ```
   npx wrangler d1 execute DB --remote --env production --file /tmp/opencode/reclassify-category.sql
   ```

7. Verify the backfill before deploying (the canary and the aggregate):

   ```
   npx wrangler d1 execute DB --remote --env production --command "SELECT id, name, category, regulatory_classification FROM product_master WHERE id = 2900"
   npx wrangler d1 execute DB --remote --env production --command "SELECT category, COUNT(*) FROM product_master WHERE alcohol_by_volume > 0.22 GROUP BY category"
   ```

   Product 2900 (Aalborg Akvavit 41 %) must read `spirits` in BOTH columns, and the aggregate must show no `other_fermented` bucket among above-boundary rows.

8. **Idempotence check (part of the backfill's own verification):** re-run the step-1 dump plus the step-5 real run. The script must write an **empty** artifact (0 UPDATE statements) — proof the applied state equals the guarded mapper's outcome and nothing was missed or double-written.

### Determinism and idempotence

The script imports the same guarded `mapSourceCategory` the ingestion adapters map through, so every emitted value is byte-identical to what re-ingestion stores. Already-correct rows produce no statement; the fermented bucket is the only one the boundary re-keys (wine, sparkling, fortified and spirits pass through unchanged at every ABV); unknown stored keys and out-of-scale ABVs are refused and listed, never guessed; rows without a usable ABV are counted as honest unknowns and left untouched. `updated_at` is never set. Re-running the dump plus the script after applying yields a byte-identical empty artifact (step 8).

## Gated production deploy

House pipeline: push → PR CI green → merge to `master` → gated `deploy-production.yml` → live verification (next section). Deploy base for this handover: production currently runs `111d825`; `master` is one docs-only commit ahead (the archive merge); this branch merges to `master`, then deploys.

### Operator token handling (applies to every remote D1 step)

Run the `npx wrangler d1 execute DB --remote --env production` calls from `apps/api-worker` (the runbook's steps 1, 6–7 and the contact E2E's read-back below). Export the token from the operator's token file before the first remote call — the snippet tolerates a `KEY=` prefix and surrounding quotes and prints a length check only, never the value:

```bash
export CLOUDFLARE_API_TOKEN="$(sed -E 's/^[A-Za-z_][A-Za-z_0-9]*=//; s/^"//; s/"[[:space:]]*$//' "$HOME/.cloudflare-token" | head -n1)"
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] && echo "token loaded (${#CLOUDFLARE_API_TOKEN} chars)" || echo "token MISSING"
```

Never run with `set -x` while the variable is exported, never paste the value into a command line or any file inside the repo, and `unset CLOUDFLARE_API_TOKEN` once the D1 steps are done.

### Deploy steps

1. Merge the pull request after its checks are green:

   ```
   gh pr checks <pr-number> --watch
   gh pr merge <pr-number> --merge
   ```

2. Dispatch the gated production workflow against `master` — the owner says deploy, the operator types:

   ```
   gh workflow run deploy-production.yml --ref master -f confirm_deploy=yes
   ```

3. Watch the run to completion (`gh workflow run` prints no id — take the newest run of the workflow):

   ```
   gh run list --workflow deploy-production.yml --limit 1
   gh run watch <run-id> --exit-status
   ```

Expected job shape: Require confirmation (refuses anything but `yes`) → Install dependencies → Build frontend (OpenNext) → Apply D1 migrations (production) → Deploy API Worker → Deploy email Worker → Deploy frontend Worker → Health gate on `/api/v1/health/ready` (200 inside the bounded retry window). The workflow also carries a wrangler-rollback runbook job — that, not DNS, is the deploy-level rollback path (see Rollback below).

## Post-deploy live verification

Run every check against deployed production. Keep raw responses under `/tmp/opencode/postdeploy/` for the record. API calls carry `-H "x-age-confirmed: 1"` (the API-side 403 `AGE_GATE_REQUIRED` is unchanged); frontend calls use `-L` where noted — the locale middleware normalises `/fi/...` to the unprefixed Finnish default, so the redirect must be followed.

1. **Akvavit duty spot-check (≈3× correction) — product 2900, Aalborg Akvavit 41 %:** before this change it was taxed as fermented (per-litre-of-product wine band, ~3× understated); after, it keys duty as spirits (per-litre pure alcohol).

   ```
   curl -s -H "x-age-confirmed: 1" "https://api.rajahinta.fi/api/v1/products/2900" | jq '{name, category}'
   curl -s -H "x-age-confirmed: 1" -H "content-type: application/json" \
     -d '{"productId":2900,"quantity":1,"destination":"FI"}' \
     "https://api.rajahinta.fi/api/v1/calculator" | jq '{alcoholExciseEstimate, totalCents}'
   curl -sL "https://www.rajahinta.fi/fi/products/2900" -o /dev/null -w '%{http_code}\n'
   ```

   Expected: `category: "spirits"` on the detail payload; the calculator's excise estimate reflects the per-litre-pure-alcohol basis — roughly 3× the old fermented reading for the same bottle. The frontend detail page renders 200. (If the calculator ever 404s with `NoRetailOffers` — offer drift, not this change — the detail-endpoint category assertion stands on its own; re-run the calculator on any current above-22 % akvavit/snaps row.)

2. **Catalog head shows price-ordered rows:**

   ```
   curl -s -H "x-age-confirmed: 1" "https://api.rajahinta.fi/api/v1/products" | jq '[.items[].name][:12]'
   curl -sL "https://www.rajahinta.fi/fi/products" -o /tmp/opencode/postdeploy/products-fi.html -w '%{http_code}\n'
   ```

   Expected: the head is led by the lowest current prices; offer-less products appear strictly after all priced rows; "1-Enkelt"-style lexicographic artifacts no longer lead by default. The old alphabetical order is still selectable — `?sort=ALPHABETICAL` on the page (sort stays URL state as plain links) and on the API.

3. **Payload/TTFB vs the baseline:** baseline for `/fi/products` is 406 KB raw HTML at TTFB 2.1 s measured from Finland (1.3 s from Cloudflare ORD).

   ```
   curl -sL -o /tmp/opencode/postdeploy/products-fi.html \
     -w 'size %{size_download} bytes; ttfb %{time_starttransfer}s; total %{time_total}s\n' \
     "https://www.rajahinta.fi/fi/products"
   ```

   Expected: a large drop on both numbers from the i18n subset split (catalog client messages ~86 KB → ~8 KB; the payload-budget test pins the achieved per-locale baseline — fi 15,244 B — at a ×1.25 ceiling). Honest expectation: the page is still per-request by contract (searchParams), so do not expect ISR-style cache-hit latencies — the assertion is the payload/TTFB drop vs 406 KB / 2.1 s.

4. **Cache headers on public pages:**

   ```
   curl -sI https://www.rajahinta.fi/        | grep -i cache-control
   curl -sI https://www.rajahinta.fi/ranking | grep -i cache-control
   ```

   Expected: exactly `cache-control: s-maxage=60, stale-while-revalidate=31535940` — ISR went live in this change (task 2.1 removed the layout's `cookies()` read; task 2.2 verified the shapes). The pre-change regression — `private, no-store` on every response — must be GONE from these routes.

   **Honest expectation-setting:** `/products`, `/products/[id]`, and `/contact` remain per-request BY CONTRACT (URL-state searchParams / no-JS ack states / an unlisted dynamic segment) and pin `private, no-cache, no-store, max-age=0, must-revalidate` — a checker must NOT expect ISR headers there; that no-store is the honest cost of request state, not a regression. The assertion set is: shared-cache header present on `/` and `/ranking`, `private, no-store` absent there.

5. **Age gate: warm + cold cache, with and without JS.** The inline pre-paint script sets the `data-age-confirmed` flag on `<html>` from the `age_confirmed` cookie before first paint; the cookie stays the single source of truth.

   ```
   curl -s https://www.rajahinta.fi/fi | grep -c 'data-age-confirmed'        # ≥ 1 (pre-paint script present)
   curl -s https://www.rajahinta.fi/fi | grep -c 'data-age-gate-overlay'     # ≥ 1 (overlay markup present)
   ```

   Then in a real browser: with a confirmed `age_confirmed` cookie, load `/` and `/products` on a warm cache and after a hard reload (cold) with JS on — no gate flash at any point (the flag is set pre-paint). With JS disabled: the content must be present in the server HTML (crawlability invariant — curl already shows it) with the overlay blocking interaction; the decline path behaves exactly as before. Confirmed crawlers see content without any cookie.

6. **Contact form no-JS POST E2E.** The form-encoded path is the no-JS HTML form: every outcome is a 303 back to the page. Fields: `message`, `topic` (`product_error` | `store_inquiry` | `other`), optional `reply_email`, `locale` (hidden), `website` (honeypot).

   ```
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -X POST \
     -H "content-type: application/x-www-form-urlencoded" \
     --data-urlencode "message=Runbook E2E $(date +%s)" \
     --data-urlencode "topic=other" --data-urlencode "locale=fi" \
     https://api.rajahinta.fi/api/v1/contact
   ```

   Expected: `303` with a Location ending `/contact?sent=1`. Read the row back (the operator read path — newest-first via the `created_at` index):

   ```
   npx wrangler d1 execute DB --remote --env production --command "SELECT id, topic, locale, substr(message, 1, 60) AS head, created_at FROM contact_messages ORDER BY created_at DESC LIMIT 5"
   ```

   The newest row is the E2E message. Then resend with the honeypot filled (add `--data-urlencode "website=spammy"`): the ack is uniform — same 303 to `?sent=1` — and the re-run SELECT shows NO new row. A bot oracle does not exist; nothing was stored. (A rate-limited excess POST renders as `303` to `?error=rate_limited` for form requests — do not confuse it with the ack.)

7. **Ranking/what-if copy spot-checks (consumer language, zero jargon):**

   ```
   curl -sL https://www.rajahinta.fi/fi/ranking | grep -cE 'NeutralSortInput|paidBoost'   # → 0
   curl -sL https://www.rajahinta.fi/fi/what-if | grep -c 'kaava-yksikkö'                 # → 0
   curl -sL https://www.rajahinta.fi/fi/event   | grep -c '(V2)'                          # → 0
   ```

   Expected: the ranking transparency section reads as consumer copy (the neutrality promise, how orderings form, tiebreaks) with no type/field/build-time names; the what-if rate inputs/results name their physical units per rate family — "€ per litra puhdasta alkoholia" for spirits, "€ per litra juomaa" for fermented — never "kaava-yksikkö"; the event-calculator foreign-compare toggle carries no "(V2)" suffix. Read the rendered pages too: the greps prove absence, the read proves the copy reads human.

8. **Password policy (floor 8 + in-repo blocklist):**

   ```
   curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "content-type: application/json" \
     -d '{"email":"throwaway-'"$(date +%s)"'@example.com","password":"qW7#mLz9"}' \
     https://api.rajahinta.fi/api/v1/account/register
   curl -s -X POST -H "content-type: application/json" \
     -d '{"email":"throwaway-b-'"$(date +%s)"'@example.com","password":"password123"}' \
     https://api.rajahinta.fi/api/v1/account/register
   ```

   Expected: the 8-char non-blocklisted password registers (`201`, session issued; use a throwaway email). `password123` (above the floor, blocklisted at any length) is rejected `400` with the generic `InvalidPassword` message — `"password" is required and must meet the password policy (8 to 128 characters)` — byte-identical in class to a below-floor rejection. The response must NOT disclose that a blocklist exists, let alone its contents.

## Watch items

1. **The 00:00 UTC ingest now passes ABV through the guarded mapper (all feeds).** The day after the deploy, re-spot-check that the corrected categories PERSIST — the cron re-ingests through the wired adapters and must not re-misclassify:

   ```
   npx wrangler d1 execute DB --remote --env production --command "SELECT id, name, category, regulatory_classification FROM product_master WHERE id = 2900"
   ```

   Product 2900 must still read `spirits` in both columns — no regression to `other_fermented`. Stronger optional check: re-run the runbook's dump plus `--stats`; the would-update count must stay at 0 (only the honest cannot-key unknowns listed, untouched).

2. **`contact_messages` ride the daily cron's 90-day batch purge.** Rows persist until the operator reads them (the wrangler SELECT above) or the retention sweep deletes them past 90 days — nothing silently drops an unread message, but the read path is the operator's inbox; do not treat the table as archival.

## Rollback

- **Deploy:** revert the merge commit on `master` and redeploy through the same gate; the workflow's wrangler-rollback job (Workers version rollback, not DNS) is the instant deploy-level path.
- **Backfilled rows:** safe in both directions. The correction is re-derivable and idempotent — after any rollback, re-running the runbook's dump plus script re-heals the same rows byte-identically, and `category` is not part of the Tier-2 identity key, so no re-keying hazard exists either way.
- **Contact intake + migration:** additive and harmless on rollback. The `contact_messages` table and migration can stay; nothing reads them once the route is reverted, and the retention sweep keeping them bounded needs no code.

## Errata — found during the 2026-10-03 production run

1. **Canary id was wrong:** production product 2900 is `Karhu Olut 5.3% 24×33 l` (beer — the unit-volume change's famous row), not the akvavit. The correct spot-check rows are the above-boundary family: 459 (Bovens's Arrak 58 %), 1164/1554/2248/2342 (Aalborg Jule Akvavit 47 %), 2760 (Arnbitter 50 %) — all read `spirits` in both columns. The AGGREGATE is the authoritative step-7 check: above-0.22 rows must show no `other_fermented` bucket (live run: spirits 2702 + intermediate_products 4).
2. **Missing operational step — the intake's deployment secret.** `CONTACT_IP_HASH_SALT` must be set per environment before the contact intake can store (`npx wrangler secret put CONTACT_IP_HASH_SALT --env production` from `apps/api-worker`; the route fails CLOSED without it — honest `?error=unavailable`, nothing stored). Discovered live: first real POST 303'd to `?error=unavailable`; after setting the secret (both production and staging) the same POST stored and returned `?sent=1`. Fail-closed behaved exactly as designed; the runbook simply omitted the step.
3. **Check-5 greps need `-L`** — `/fi` issues a 307 to `/`, so `curl -s https://www.rajahinta.fi/fi | grep …` reads the redirect stub, not the page. All gate markers verify on the followed response.
4. **Cache-header literals are OpenNext-translated in production**: expect `s-maxage=2, stale-while-revalidate=2592000` (not the Next-native `s-maxage=60, stale-while-revalidate=31535940` the test suite pins via `next start`). The functional assertions are unchanged: shared-cache header present on `/` and `/ranking`, `private, no-store` gone there, `/products` + `/contact` + detail still pin no-store by contract.
5. **Duty spot-check magnitude:** the live swing was ~8.8× (Arrak 459: €22.85 spirits-keyed vs ~€2.60 on the old fermented wine band), not "≈3×" — the proposal's ≈3× came from snapshot band-table approximations. Direction and materiality confirmed; the rate table itself is engine-side and unchanged by this deploy (already exercised daily by 2 702 correctly-keyed spirits rows).
6. **Payload expectation-setting:** the honest production delta is 406 KB → ~338 KB (−68 KB ≈ exactly the i18n subset savings; the page ships full offer data, unlike the data-empty harness/benchmark renders the budget test pins).
