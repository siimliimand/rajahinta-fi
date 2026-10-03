# Change notes — eventcalc-reference-seed-wiring

## Production handover — seeding, review, publication, live checks

Status at writing (2026-10-03, read-only production check via `wrangler d1 execute DB --remote --env production --json --command "SELECT …"`): `consumption_norms` **0 rows**, `carrier_box_types` **0 rows** — nothing published or pending yet; the entire pipeline below is still to be operated. Task 1.1 wired the producing half (generated SQL + orchestrator + verify floors); this runbook is the owner's script for the producing acts, which remain manual by doctrine ("production seeding is a deliberate, manual act", `scripts/seed-d1.ts` header; design D4).

---

### (a) Emit and apply the seed SQL — owner-gated, never automatic

The two files are generated artifacts (`.gitignore`d under `packages/data-platform/src/seed/d1/sql/` — doctrine: never edit or commit by hand). They exist on disk from task 1.1's in-process regeneration, but the operator should regenerate freshly before the production act:

```bash
# from the repo root — byte-deterministic; logs bytes + sha256 per file;
# runs the fixture integrity gate first (fails loudly on drift)
tsx scripts/seed-d1.ts --emit-sql-only
```

Apply to production (migrations must already be applied — run from `apps/api-worker`, where `wrangler.jsonc` lives, so the files sit at `../../packages/…`):

```bash
cd apps/api-worker
npx wrangler d1 execute DB --remote --env production --file ../../packages/data-platform/src/seed/d1/sql/consumption-norms.d1.sql
npx wrangler d1 execute DB --remote --env production --file ../../packages/data-platform/src/seed/d1/sql/carrier-box-types.d1.sql
```

Both files are idempotent and safe to re-run: the norms upsert carries `DO UPDATE … WHERE status = 'PENDING_CONFIRMATION'` (PUBLISHED rows are byte-immutable — design D2); carrier boxes upsert on `(carrier, name)`. Rows land `PENDING_CONFIRMATION` — the seed never publishes.

**Tokenizer fallback (task 1.1 finding, keep with the commands):** the norms SQL embeds `;` inside the citation string literals (the derivation sentences are punctuated). This is proven safe on both consumers — node:sqlite (the test harness and the `--db-file` path) and wrangler's remote `--file` tokenizer, which respects quoted literals and does not split on statement-internal semicolons. **Fallback if `wrangler d1 execute --file` ever errors on the file:** re-run with `--command` passing one split statement at a time (the file is one multi-row INSERT plus its header comments — split on the top-level statement boundary only, never inside quotes), or replay through the `--db-file`-proven path (`tsx scripts/seed-d1.ts --db-file <path>`, node:sqlite). Any such failure surfaces loudly at the console (non-zero exit, error text) — it can never fail silently, so there is no "check if it half-applied" ambiguity: a loud failure means nothing to re-check, just re-run the file (idempotent).

### (b) Owner review — the 18 curated rows

Version `standard-drink-fi-2026.1`, effective `2026-01-01`, open-ended (`effective_to` NULL). Every row derives arithmetically from the Finnish standard drink (12 g pure ethanol = 15.2 ml, the national definition documented in the cited Wikipedia "Standard drink" reference, Finland row): **pacing (standard drinks/guest/hour) × 15.2 ml ÷ ABV% ≈ litres/guest/hour**, rounded to centilitres. Norm values are curated *estimates*; the citation makes the derivation auditable, not authoritative. Typical ABVs: beer 4.7, still wine 12, sparkling 11.5, intermediate 18, cider/long drink 5.5, spirits 40.

| Profile | Drink type | Drinks/guest/h | ABV % | **l/guest/hour** | Derivation citation |
|---|---|---|---|---|---|
| casual_gathering | beer | 1.0 | 4.7 | **0.32** | 1.0 × 15.2 ml ÷ 4.7 % ≈ 0.32 l |
| casual_gathering | other_fermented | 0.75 | 5.5 | **0.21** | 0.75 × 15.2 ÷ 5.5 ≈ 0.21 l |
| casual_gathering | wine_still | 0.5 | 12 | **0.06** | 0.5 × 15.2 ÷ 12 ≈ 0.06 l |
| casual_gathering | wine_sparkling | 0.25 | 11.5 | **0.03** | 0.25 × 15.2 ÷ 11.5 ≈ 0.03 l |
| casual_gathering | intermediate_products | 0.1 | 18 | **0.01** | 0.1 × 15.2 ÷ 18 ≈ 0.01 l |
| casual_gathering | spirits | 0.25 | 40 | **0.01** | 0.25 × 15.2 ÷ 40 ≈ 0.01 l |
| dinner_party | wine_still | 1.0 | 12 | **0.13** | 1.0 × 15.2 ÷ 12 ≈ 0.13 l |
| dinner_party | beer | 0.5 | 4.7 | **0.16** | 0.5 × 15.2 ÷ 4.7 ≈ 0.16 l |
| dinner_party | wine_sparkling | 0.25 | 11.5 | **0.03** | 0.25 × 15.2 ÷ 11.5 ≈ 0.03 l |
| dinner_party | other_fermented | 0.25 | 5.5 | **0.07** | 0.25 × 15.2 ÷ 5.5 ≈ 0.07 l |
| dinner_party | intermediate_products | 0.25 | 18 | **0.02** | 0.25 × 15.2 ÷ 18 ≈ 0.02 l |
| dinner_party | spirits | 0.15 | 40 | **0.01** | 0.15 × 15.2 ÷ 40 ≈ 0.01 l |
| celebration | wine_sparkling | 0.75 | 11.5 | **0.10** | 0.75 × 15.2 ÷ 11.5 ≈ 0.10 l |
| celebration | beer | 0.5 | 4.7 | **0.16** | 0.5 × 15.2 ÷ 4.7 ≈ 0.16 l |
| celebration | other_fermented | 0.5 | 5.5 | **0.14** | 0.5 × 15.2 ÷ 5.5 ≈ 0.14 l |
| celebration | wine_still | 0.5 | 12 | **0.06** | 0.5 × 15.2 ÷ 12 ≈ 0.06 l |
| celebration | spirits | 0.25 | 40 | **0.01** | 0.25 × 15.2 ÷ 40 ≈ 0.01 l |
| celebration | intermediate_products | 0.1 | 18 | **0.01** | 0.1 × 15.2 ÷ 18 ≈ 0.01 l |

Every row's full citation string (as stored in `source_citation`, verbatim shape the confirm guard requires non-blank): `Finnish standard drink = 12 g ethanol (15.2 ml); derivation: <drinks> drink(s)/guest/hour × 15.2 ml ÷ <abv> %ABV ≈ <litres> l/guest/hour — "Standard drink", Finland row (https://en.wikipedia.org/wiki/Standard_drink)`. Profile logic for the review: casual gathering is beer-forward with loose pacing; dinner party is wine-led across courses; celebration is toast-led (sparkling heaviest in the first hour), otherwise mixed. Source of truth: `CURATED_NORMS` in `packages/data-platform/src/seed/consumption-norms.seed.ts` — the table above is generated from it by the seed's pure builder, never hand-drifted (parity-tested, task 1.1).

### (c) Publication procedure

**How `opsAccess()` authenticates (verified from `apps/api-worker/src/middleware/ops-access.ts`, mounted on the whole `/ops/console/*` prefix in `middleware/guards.ts`):** the route requires a per-environment **`OPS_BEARER_TOKEN`** Cloudflare secret presented as `Authorization: Bearer <token>` (compared constant-time via SHA-256 digests) and/or an **`OPS_IP_ALLOWLIST`** (comma-separated IPs/IPv4 CIDRs) matched against the platform-attested `CF-Connecting-IP` header only — `X-Forwarded-For` is deliberately never honoured. Both configured → both must pass; neither configured → the route fails closed with 403. Every denial is a generic `403 Forbidden` with no hint which control failed. Secrets are set with `wrangler secret put OPS_BEARER_TOKEN` per environment (per `docs/ingestion-runbook.md` §2) and are **not** present in any local env file — a deliberate boundary: agent sessions never read or print the token.

**How the 2026-10-02 allowances publication was actually operated (the precedent, from commit 5171a80's change-notes addendum):** it did **not** use the console endpoint. The `eu-2007-74-2026.1` dataset and its 5 limit rows were generated verbatim from the seed module and applied to production via `wrangler d1 execute --remote`, and the `PENDING_CONFIRMATION → PUBLISHED` transition was executed as direct owner-directed SQL in the same session, with `confirmed_by: 'owner-directed (agent session 2026-10-02)'`. That is why the production row has `created_at == confirmed_at` (`2026-10-02T07:03:50.765Z`): the row landed already-published in one act. The addendum is explicit that no endpoint was used and the console-only lifecycle was still respected in spirit (the operator directed every statement). The repository-wide pattern is the same: when the ops token is unavailable to an agent session, direct `wrangler d1 execute DB --remote --env production` is the sanctioned owner-directed fallback, at the recorded cost of no `audit_events` entry (the console path writes one; direct D1 does not).

The owner has **both options** for the norms. Option (i) is the cleaner one whenever the token is at hand — it writes the audit trail automatically.

**Option (i) — ops console API (audited; requires the production `OPS_BEARER_TOKEN`):**

```bash
# 1. List the pending queue — groups rows by versionLabel, each row carries
#    its id and the citation to verify (against the table in §b above)
curl -s https://api.rajahinta.fi/ops/console/confirmations \
  -H "Authorization: Bearer $OPS_BEARER_TOKEN" | jq '.consumptionNorms'

# 2. Confirm each of the 18 rows by id (repeat per id; operator ≤128 chars,
#    note optional but recommended)
curl -s -X POST \
  "https://api.rajahinta.fi/ops/console/confirmations/consumption-norms/<id>/confirm" \
  -H "Authorization: Bearer $OPS_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"operator": "<your name>", "note": "Reviewed 18-row derivation table, standard-drink-fi-2026.1"}'
```

Semantics (verified in `ops.routes.ts`): unknown id → 404; already-published id → 409 `InvalidTransition` (PUBLISHED is terminal); blank citation → 409 `MissingNormSourceCitation` (cannot happen with this seed — every generated row carries the citation); success → `{"id", "versionLabel", "status": "PUBLISHED", "confirmedAt"}` plus an `audit_events` entry (entityType `consumption_norm`, action `confirmed`). If the request comes from an IP outside `OPS_IP_ALLOWLIST` (when configured), it 403s before anything else — run it from an allowlisted host.

**Option (ii) — the owner-directed path the allowances used (no endpoint, no token needed, no audit_events entry):**

```bash
cd apps/api-worker
# transition after reviewing §b — one statement, guarded so only pending rows move:
npx wrangler d1 execute DB --remote --env production --command "\
UPDATE consumption_norms SET status = 'PUBLISHED', confirmed_by = 'owner-directed (agent session <date>)', confirmed_at = '<ISO-UTC now>' WHERE version_label = 'standard-drink-fi-2026.1' AND status = 'PENDING_CONFIRMATION'"
# then verify:
npx wrangler d1 execute DB --remote --env production --command "SELECT status, COUNT(*) FROM consumption_norms GROUP BY status"
```

The `WHERE status = 'PENDING_CONFIRMATION'` guard mirrors the repository's publish semantics exactly; the CHECK constraint on `status` (only the two states exist) makes anything else reject. Record the deviation honestly if used: no `audit_events` row exists for a direct-D1 publication — the same recorded gap as the 2026-10-02 allowances act and the merchant-onboarding fallbacks before it.

### (d) Staging — self-populates on the next deploy

No manual act. The staging pipeline (`deploy-staging.yml`) already runs `db:seed:d1:staging` (migrations → seed → verify, ordering preserved), and task 1.1 registered both files in `SEED_SQL_FILES`, so the next staging deploy seeds the 18 norms + curated carrier boxes itself. Verification is the pipeline's, not a human's: `buildVerifySql()` now asserts `consumption_norms` ≥ 18 across pending/published and `carrier_box_types` ≥ the curated count, and `assertVerificationRow` **fails the deploy job loudly** on any mismatch (design D3) — a staging deploy that silently no-ops its seeding is now impossible. Green staging pipeline ⇒ the datasets are there.

### (e) Live checks (after publication)

The route is anonymous (per-IP CALCULATOR rate limit, 10/min — don't hammer it):

```bash
# per profile — casual_gathering, dinner_party, celebration:
curl -s -X POST https://api.rajahinta.fi/api/v1/event-calc \
  -H "Content-Type: application/json" \
  -d '{"guests": 12, "durationHours": 4, "eventProfile": "casual_gathering", "eventDate": "2026-12-31"}' | jq '{status, litres: .shoppingList.lines, normsVersion}'
```

Expected: HTTP 200, `status: "COMPUTED"`, per-drink-type litres equal to guests × hours × the §b norm, and the version label `standard-drink-fi-2026.1` on the result (`normsVersion` / `datasetVersions`), plus the structural norms-are-estimates disclaimer field. Before publication the same request returns 200 with `status: "NO_PUBLISHED_NORMS"` — the calm expected state, not an error.

UI: `/event` on the frontend (`https://rajahinta.fi/event`) renders the shopping list from the same endpoint.

V2 sourcing: toggle sourcing mode on `/event` (or POST a body with a `sourcing` section — `lines[]` with `drinkType`, `abvPercent`, `container`, `domesticPricePerLitreCents`, optional `foreign[]` prices, optional `packing: true`). Expected: plan assigning buy-here vs bring-from-<country> per line with the cheapest option under the documented tie-break, and — with `carrier_box_types` seeded from §a — the packing section computed against the **real curated carrier boxes** (box choice, fill, per-box breakdown). Event lines carry no product dimensions, so units degrade honestly to the `ESTIMATED`/`MISSING_DIMENSIONS` path; what must be real is the box catalogue, which §a provides.

### (f) Rollback / terminality

**`PUBLISHED` is immutable by design — there is no unpublish.** The schema admits exactly two states; the repository publishes only from `PENDING_CONFIRMATION`; and both seed paths (function seed and generated SQL) carry `DO UPDATE … WHERE status = 'PENDING_CONFIRMATION'`, so even re-applying the seed file after publication cannot rewrite a published row (proven by the task-1.1 idempotency test: re-apply over a seeded-then-published DB leaves PUBLISHED rows byte-identical). A wrong or outdated value is corrected by **appending a superseding version** (design D5 / spec): a new `version_label` with fresh effective-window rows, seeded and reviewed exactly like this one; the half-open window resolution makes the newest `effective_from` per drink type win, so old caches and old results stay reproducible under their version label while new calculations pick the correction up (event-calc cache keys embed the norms version — a publication makes old-version entries unreachable, never stale). Mass deletion of published rows is an owner-gated direct-D1 act outside routine operations; no tooling assumes it exists.
