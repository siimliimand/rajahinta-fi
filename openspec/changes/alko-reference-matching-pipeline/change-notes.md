# Change notes — alko-reference-matching-pipeline

## Production handover — pilot, full pass, owner review, live checks

Status at writing (2026-10-03, branch `feature/alko-reference-matching-pipeline`): code tasks 1.1–4.1 are committed — migration 0026, the D1 repositories, the matcher port adapter, the one-shot pass script, the console match-review surface, and savings cron v2. The spec deltas (5.1) are on disk; the test suites for the script and routes (2.2, 3.2, 4.2, 4.3) are landing in parallel review. Nothing below has been executed against production: `match_review` and `product_reference_links` hold zero rows in every environment until the owner runs the pass and works the queue. This runbook is the owner's script for those acts — the pass and the confirmations remain deliberate, operator-executed steps by doctrine (design D2/D5: nothing publishes autonomously).

### What shipped (the full vertical)

- **Migration 0026** (`packages/data-platform/src/d1/migrations/0026_product_reference_links.sql`): `product_reference_links` — the foreign→Alko identity EDGE, not a merge (design D1): status CHECK `CONFIRMED`/`REJECTED`/`SUPERSEDED`, terminal decisions only; a conditional CHECK makes CONFIRMED-without-attribution unrepresentable (`confirmed_by` + `confirmed_at` required); a self-link CHECK; and **partial unique indexes per side** (`WHERE status = 'CONFIRMED'`) so at most one live link exists per foreign product AND per Alko product while SUPERSEDED/REJECTED history coexists under the same keys. `match_review` — the queue: pair-unique `(foreign_product_id, alko_product_id)` (the idempotency anchor), confidence CHECK `EXACT/HIGH/MEDIUM/LOW/NONE`, method CHECK `ean|fuzzy`, score CHECK 0–100, both sides' name/brand/ABV/volume **frozen at enqueue** (the reviewer sees what the scorer saw, even if `product_master` moves afterward), decided-rows-immutable attribution CHECK. Plus `savings_snapshots.reference_link_id`, a nullable FK provenance column (NULL = pair produced from a direct Alko reference offer — still representable).
- **D1 repositories** (`reference-link.repository.ts`, `match-review.repository.ts`, registered in abstracts; 42 node:sqlite tests over the migrated DB, commit `e28511e`): link confirm/reject/supersede/`listConfirmed` with typed refusals (`MatchReviewAlreadyDecidedError`, `MissingDecisionAttributionError`, `ReferenceLinkConflictError`); queue `enqueue` idempotent per pair — outcomes `created | refreshed | skipped` — refreshing PENDING rows in place and never touching decided ones.
- **Matcher port adapter** (task 1.3): `D1ProductMasterQueryRepository` implements `IProductMasterQuery` with **blocked** `findCandidates` — category equality via `product_master_category_idx`, ABV rounded to the nearest 0.5 pp and volume to the nearest 0.05 l, each with a ±1-bucket tolerance window (design D3) so scrape noise degrades to larger candidate sets instead of missed pairs; 18.9M naive pairwise comparisons collapse to tens of candidates per product. Tolerant numeric assembly: missing/zero volumes and split decimals (`"0. 7 l"`) parse or degrade — they never crash the pass, and a numerically broken row is still queued, scored on name/brand/category with the mismatch visible to the reviewer (the queue is the honesty surface).
- **The one-shot pass** `scripts/match-alko-references.mts` (precedent `reclassify-category.mts`; design D5 — a script, not a cron): walks the FOREIGN side (any `product_master` row with a non-`alko` offer — kippis FI included — and no CONFIRMED link), wraps the adapter in `AlkoSideCandidateFilter` so only Alko-universe rows are scored (an unfiltered run would score a foreign seed against itself at ~100), constructs the matcher's internal `ManualReviewService` **inert**, and enqueues EVERY graded pair itself — EXACT and HIGH included. Nothing links autonomously: no `product_reference_links` row can reach CONFIRMED from this pass alone. `--stats` mode computes the identical walk with zero writes (the enqueue repository is never constructed); `--limit`/`--category` slice pilots; per-product failures are logged, counted, and never drop the run; exit 0 = completed (errors counted), 1 = usage/fatal.
- **Console match-review surface** (`ops.routes.ts`, under the `opsAccess` prefix guard on `/ops/console/*` — bearer fail-closed, IP allowlist honored): `GET /ops/console/match-review`, `POST /ops/console/match-review/:id/confirm`, `POST .../match-review/:id/reject`, `POST /ops/console/reference-links/:id/supersede` — operator attribution required (`validateOperator`), `audit_events` row written on every decision (`match_review` confirmed/updated; `reference_link` updated) — the exact trust pattern of the consumption-norms confirm queue.
- **Savings cron v2** (`savings-snapshots.ts` + calculator): qualification extends to "direct Alko reference offer OR CONFIRMED link" (a product in both sets evaluates ONCE — direct wins); the calculator gains an optional `alkoReferenceProductId` input so benchmark selection stays inside `resolveAlkoBenchmark` (design D4 — no cron-side selection logic); snapshot rows carry `reference_link_id`. Only `listConfirmed` links are read; PENDING and REJECTED links are inert.
- **Spec deltas**: `savings-discovery` (linked qualification + the provenance column), `product-normalization` (the pass, blocked retrieval, confidence-graded routing, the manual-review gate, CONFIRMED-link semantics as the only trust level the savings surface reads).

### Why — the root cause, in one paragraph

The `/savings` page has been proving the opposite of its pitch: all 2,058 materialized snapshot rows (six categories, verified in production 2026-10-03) were trivial self-comparisons — `bestMerchant = alko`, gap positive by construction, every one honestly rendered as a loss ("kalliimpi kuin Alkon vertailuhinta"), every category's largest-gap highlight a loss. The cause is structural, not a bug in the math: 4,257 Alko-referenced and 4,442 foreign products (alks DE 2,849, longero EE 982, kippis FI 637, mydrink EE 649) share **zero** `product_id`s, so the cron — which enumerates products carrying an Alko offer — only ever saw Alko's own offers for the Alko side; and the EAN bridge is dead on arrival because the Alko side carries **zero** EANs (all 3,164 EAN-bearing rows are foreign). Meanwhile `ProductMatcherService` + `ManualReviewService` were built, unit-tested (their own header calls the scoring HIGH-LIABILITY), and specified as required by `product-normalization` — with zero consumers. This change wires that orphaned capability to persistence, a pass, and a review gate, so CONFIRMED links finally let foreign landed costs face real Alko references — and negative gaps (the product's thesis) become renderable instead of impossible.

---

### (a) Pilot first: `--stats` — read-only yield report, owner-gated by expectation

The script header's own guidance: run `--stats` BEFORE any write pass. It computes the full walk — every match decision, zero I/O — and reports the yield by confidence grade:

```bash
# Yield report, nothing written (fresh fixture: created + migrated 0000→0026 on first use):
pnpm --filter @rajahinta/data-platform exec tsx \
  --tsconfig ../../packages/core-domain/tsconfig.json \
  scripts/match-alko-references.mts --db-file /tmp/opencode/pilot.sqlite \
  --stats --limit 50

# Per-category pilots (keys are the stored category literals — `-h` prints them; e.g. beer):
#   ... match-alko-references.mts --db-file /tmp/opencode/pilot.sqlite --stats --category beer
```

The report is explicit that NOTHING was written, and prints: yield by grade, zero-candidate products (skipped — no queue row for an empty candidate set), self-candidate anomalies (a non-zero count here means the universes overlap — ingestion defect; the report surfaces it, never folds it away), candidate sets truncated at the cap, the foreign∩alko overlap counter (0 in healthy data), Alko universe size, and per-product errors.

**Expectation-setting (read this before judging the numbers):** with zero Alko-side EANs the EAN path cannot fire — every link comes from fuzzy scoring, the `method` column is `fuzzy` throughout, and the EXACT grade is designed-but-inert (design D2). Expect the yield to be **mostly MEDIUM/HIGH** — the proposal's realistic first-run estimate is hundreds of links — with LOW/NONE and German-scrape-noise false candidates mixed in. That is the pipeline working, not failing: **the owner review is the quality gate**, and the grade mix is calibration data, not a verdict. REJECTED rows become scorer-calibration data by design.

### (b) The full pass (write)

Same invocation minus `--stats`. Every walked candidate lands in `match_review` as PENDING — created, refreshed (still PENDING), or skipped (already decided, untouched); the end-of-run summary prints the split plus the proof that the matcher's internal review service stayed inert. Nothing publishes: no CONFIRMED link exists as a result of the pass (design D2). Re-runs are idempotent per (foreign, alko) pair — PENDING rows refresh in place, CONFIRMED/REJECTED decisions are never touched — and products that gained a CONFIRMED link drop out of the walk (marked done). Per-category write passes with `--category`/`--limit` are the recommended rollout shape; the full pass converges, so partial runs lose nothing.

### (c) Owner review through the console — the trust gate (norms-queue precedent)

**Auth, same as every `/ops/console/*` route** (verified `middleware/ops-access.ts`, prefix-mounted in `middleware/guards.ts`): `OPS_BEARER_TOKEN` as `Authorization: Bearer <token>` (constant-time compare) and/or `OPS_IP_ALLOWLIST` matched against `CF-Connecting-IP` only; both configured → both must pass; neither → fail-closed 403; every denial is a generic 403. The token is a per-environment Cloudflare secret (`wrangler secret put OPS_BEARER_TOKEN`), never present in env files, never read or printed by an agent session.

**Keep the token out of shell history** (the 0600-header-file pattern the onboarding runbooks use for wrangler's OAuth token, applied to the ops bearer): write it once to a temp header file, use `-H @file` on every call, delete after:

```bash
umask 077
read -rs OPS_BEARER_TOKEN   # paste, Enter — never echoed, never in history
printf 'Authorization: Bearer %s\n' "$OPS_BEARER_TOKEN" > /tmp/opencode/ops-auth-header
unset OPS_BEARER_TOKEN
# ... every call below uses -H @/tmp/opencode/ops-auth-header ...
# rm /tmp/opencode/ops-auth-header   # after the session
```

```bash
# 1. The worklist — default is the pending queue; both universes side by side:
curl -s "https://api.rajahinta.fi/ops/console/match-review?status=PENDING" \
  -H @/tmp/opencode/ops-auth-header | jq '.total, .items[:5]'
#    each item: {id, status, foreign:{productId,name,brand,abv,volume},
#                alko:{...}, confidence, method, score, createdAt}
#    deterministic order: score desc, then pair ids ascending.

# 2. Confirm a pair (repeat per id; operator ≤128 chars, note recommended):
curl -s -X POST \
  "https://api.rajahinta.fi/ops/console/match-review/<id>/confirm" \
  -H @/tmp/opencode/ops-auth-header -H "Content-Type: application/json" \
  -d '{"operator": "<your name>", "note": "Names/brand/ABV/volume consistent"}'
# → {"id", "status":"CONFIRMED", "linkId", "foreignProductId", "alkoProductId", "confirmedAt"}
#    + an audit_events row (entityType match_review, action confirmed).

# 3. Reject a false candidate — records the decision, creates NO link:
curl -s -X POST \
  "https://api.rajahinta.fi/ops/console/match-review/<id>/reject" \
  -H @/tmp/opencode/ops-auth-header -H "Content-Type: application/json" \
  -d '{"operator": "<your name>", "note": "Different product; volume mismatch"}'
```

Review guidance: compare both frozen identities per row — name, brand, ABV, volume. German scrape noise (embedded `%`/`l`, split decimals, empty volumes) is the expected false-candidate source; a numeric mismatch is visible in the row, not hidden. Semantics (verified in `ops.routes.ts`): unknown id → 404; already-decided → 409 `InvalidTransition` (decisions are immutable — the norms-confirm parity); blank operator → 400 (caught earlier by `validateOperator`).

**The conflict path — duplicate listings surface here, by design:** a confirm that would create a second live link on either side rolls back whole (the candidate stays PENDING) and returns 409 `ReferenceLinkConflict` whose `conflictingLink` names the blocking link (id, both product ids, who confirmed it, when). Supersede the old link, then re-confirm the candidate:

```bash
curl -s -X POST \
  "https://api.rajahinta.fi/ops/console/reference-links/<blockingLinkId>/supersede" \
  -H @/tmp/opencode/ops-auth-header -H "Content-Type: application/json" \
  -d '{"operator": "<your name>", "note": "Replaced by review <id>"}'
# → {"id", "status":"SUPERSEDED", ...}. SUPERSEDED is terminal; the operator
#    identity lives in this audit row (entityType reference_link), and the
#    replacement link comes into being only via the re-confirm in step 2.
```

`status=CONFIRMED` / `status=REJECTED` on the listing read the decision history; there is no delete and no edit — replacement, not mutation, is the only correction (§f).

### (d) Materialization — the next shared tick, not a new act

Nothing to schedule and nothing to trigger: the savings snapshot handler already rides the **existing 30-minute shared aggregation tick** (`AGGREGATION_CRON`, registered after the time-series aggregation in its own `waitUntil`), and the snapshot is a **daily-grain** materialization — one row per product per as-of day, the `(asOf, product_id)` upsert key IS the idempotence, so extra same-day ticks are converging no-ops and no watermark is kept. The next tick after your confirms qualifies linked products via `listConfirmed`, computes the full landed cost on the foreign product's OWN best offer, resolves the Alko benchmark through the calculator's `alkoReferenceProductId` input, and writes snapshot rows carrying `reference_link_id`. A product without a usable benchmark produces NO row — absence is the honest state; a guessed gap never materializes. Once linked pairs exist, German/Estonian landed costs face monopoly references through full landed cost, and **negative gaps become possible for the first time** — the page has simply never had one to render before.

### Live checks (after confirms + the next tick)

1. **Regression canary — event-calc unaffected** (this change touches nothing it reads; the norms are live since the predecessor change's seeding):

```bash
curl -s -X POST https://api.rajahinta.fi/api/v1/event-calc \
  -H "Content-Type: application/json" \
  -d '{"guests": 12, "durationHours": 4, "eventProfile": "casual_gathering", "eventDate": "2026-12-31"}' \
  | jq '{status, normsVersion}'
```
   Expected: HTTP 200, `status: "COMPUTED"`, version `standard-drink-fi-2026.1` (anonymous route, per-IP rate limit ~10/min — don't hammer).
2. **`/savings` renders both polarities, labeled**: `https://rajahinta.fi/savings` — the labels already exist in the i18n contract (`halvempi kuin Alkon vertailuhinta` for gap < 0, `kalliimpi kuin Alkon vertailuhinta` for gap > 0; the page's test suite pins negative-gap rendering with a −2266 ct / −64742 bp fixture). With confirmed links materialized, at least one row should finally render the cheaper label; until then, only-losses remains the honest state, not a defect. The coverage counts (products evaluated / `withReference` / rows listed) now count linked evaluation truthfully.
3. **Provenance in D1** — the delta between the two counts is the number of linked pairs so far:

```bash
cd apps/api-worker
npx wrangler d1 execute DB --remote --env production --json \
  --command "SELECT COUNT(*) AS rows_total, COUNT(reference_link_id) AS rows_linked FROM savings_snapshots"
```

### Remote-execution caveat — what exists today vs what is follow-up (be precise)

The pass script binds **local SQLite only**: `--db-file <path>` (created and migrated 0000→0026 when missing) or `--local` (the wrangler/miniflare local D1 state of `apps/api-worker` — stop `wrangler dev` first; SQLite is a single writer). **Remote D1 is deliberately NOT bound** (script header): house discipline routes every remote D1 touch through wrangler, and this pass's per-pair read-modify-write enqueue cannot be expressed as a blind `wrangler d1 execute` artifact. The honest consequence for production:

- **Exists today:** pilots and `--stats` runs against a local fixture, against `--local` dev data, or against a **`--db-file` restored copy of production data** (the `wrangler d1 export` precedent lives in `docs/cutover-runbook.md`) — all read-only in effect on production, since writes land on the copy.
- **Follow-up (not built):** a remote-bindings path for the pass — the script header names the D1 HTTP API binding as a possible future slice, and design D5 separately defers **scheduled re-matching** (new foreign products arrive continuously; without it the queue stales — accepted for this slice while review throughput is unknown). Neither exists yet.
- **Owner-run SQL is the only production write path today** for moving queue rows into remote D1 (the owner-directed direct-D1 fallback, at the recorded cost of no `audit_events` rows), or waiting for the follow-up slice. Do not improvise bulk INSERTs casually: the pair-unique index and status CHECKs will reject malformed rows loudly, but attributions frozen in `match_review` are what the reviewer sees.
- Migration 0026 itself needs none of this: it reaches staging via the deploy pipeline's migration step and production via the gated `deploy-production.yml` (the standard `wrangler d1 migrations apply` path), independent of the script.

### (f) Rollback / terminality

**Links are rows, and the console is the in-band path.** There is no delete and no unpublish: a wrong pairing is corrected by superseding the live link (CONFIRMED → SUPERSEDED, terminal) and confirming the replacement; a false candidate is REJECTED and stays as calibration history. Decided review rows are immutable — nothing re-enters the queue, and the repository refuses any decision on an already-decided row. The schema admits exactly these states and the CHECKs make everything else unrepresentable.

**Out-of-band: git revert of the change commits is the rollback.** It removes every consumer — the pass script, the console endpoints, savings cron v2's linked qualification, the calculator's optional input — while migration 0026's tables and the nullable `savings_snapshots.reference_link_id` column remain (an `ALTER ADD COLUMN` does not revert with the code). Savings rows that carry `reference_link_id` therefore survive a revert harmlessly: the column stays, the consumers are gone, and the cron reverts to the direct-reference predicate that produced the all-losses status quo — no data corruption, no orphaned reads. There are **no cron-schedule changes to undo**: v2 rides the pre-existing 30-minute aggregation tick. Event-calc is untouched by this change in either direction. Mass deletion of link rows would be an owner-gated direct-D1 act outside routine operations; no tooling assumes it exists.
