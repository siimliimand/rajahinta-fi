# Design: alko-reference-matching-pipeline

## Context

The savings pipeline is architecturally complete and data-structurally
starved: the cron, calculator, repository, route, and page all implement the
specified behavior, but the product-identity bridge the design assumes
("one physical product, offers from many merchants") does not exist in the
data. Production is two disjoint product universes (4,257 Alko-referenced /
4,442 foreign, zero overlap, zero Alko-side EANs). The matching engine and
manual-review service exist in `core-domain/src/normalization/` with zero
consumers and no D1 persistence. This change wires the bridge as an explicit,
reviewable link — not a data merge — and makes CONFIRMED links the only trust
level the savings surface reads.

## Decisions

### D1 — Reference link, not product merge

A CONFIRMED link is a row in `product_reference_links`
(`foreign_product_id` → `alko_product_id`, unique per side, status
`CONFIRMED`/`REJECTED`/`SUPERSEDED`, attribution + timestamps). Offers,
price history, alerts, and calculation records stay on their existing product
ids — nothing is rewritten. Retrofitting a true merge (the spec's
cross-merchant dedup end-state) would rewrite identities across
`retail_offers`, `price_history_summaries`, alerts, and snapshots: massive
blast radius, irreversible, and unnecessary for the savings pair — the
comparison needs an EDGE, not a union.

The spec's merge end-state remains the right model for FUTURE ingestion;
this change adds the retrofit edge and leaves ingestion-time dedup to a later
slice that can reuse the same matcher + review infrastructure.

Alternative rejected: computing matches at materialization time (cron runs
the matcher over both universes daily) — non-deterministic rows that silently
shift as scoring evolves, 8,700-product fuzzy work per tick, and no owner
gate on what the page claims.

### D2 — First run queues everything; the owner is the trust gate

The matching pass writes every scored candidate to `match_review` with
confidence, method, score, and both sides' name/brand/ABV/volume for
side-by-side review. Nothing becomes a CONFIRMED link without an operator
confirm through the bearer-guarded console endpoint (attribution required,
audit row written) — the exact trust pattern of the consumption-norms queue.
Rationale: the matcher's own tests declare scoring HIGH-LIABILITY; the Alko
side has no EANs, so every link is fuzzy; and a wrong link is a false claim
on a public compliance-sensitive page. Volume makes review feasible (expected
hundreds, not thousands).

`EXACT`-grade auto-accept is designed for but initially inert: with zero
Alko-side EANs the EAN path cannot fire for reference linking. The threshold
constants are exported so a later slice can open auto-accept deliberately.

### D3 — Blocked candidate retrieval, reusing the existing port shape

`IProductMasterQuery.findCandidates({brand, category, volumeLitres, abv})`
maps to a D1 query that blocks on `category` equality (indexed,
`product_master_category_idx`), ABV rounded to the nearest 0.5 percentage
points on both sides, and unit volume rounded to the nearest 0.05 l — with
tolerance windows (±1 ABV bucket, ±1 volume bucket) so scrape noise like the
German `"0. 7 l"` (parsed 0.7) and missing volumes degrade to larger
candidate sets instead of missed pairs. The fuzzy scorer (`scoreProduct`)
then ranks within each small set. 18.9M naive pairs collapse to tens of
candidates per product.

Foreign rows with unusable numeric fields (e.g. `unit_volume = 0`, present in
the sample) are still queued — scored on name/brand/category alone with the
numeric mismatch visible to the reviewer, never silently dropped: the queue
is the honesty surface.

### D4 — Reference resolution extends the calculator, not the cron

The cron must compute a foreign product's landed cost AND resolve the linked
Alko product's reference. The benchmark-selection predicate (newest
`observedAt`, ties to higher offer id) already lives in the calculator's
`resolveAlkoBenchmark`; duplicating it in the cron invites drift. The
calculator gains an optional `alkoReferenceProductId` input: when present,
the benchmark resolves from THAT product's Alko offers while the retail best
offer is selected from the target product's own. The calculation record
gains the reference-product id, keeping the explainability invariant (every
figure traceable to its inputs). Snapshot rows carry `reference_link_id` for
the same reason.

Alternative rejected: cron-side reference resolution via raw offer reads —
one more copy of a selection rule the spec pins, one more place to drift.

### D5 — The pass is a script, not a cron (for now)

Precedent: `scripts/reclassify-category.mts` (one-shot, `--stats`, explicit
operator execution). Matching is an occasional, review-fed act while the
review queue is small — not a daily autonomous job. The script is
idempotent per (foreign product, alko candidate): re-runs refresh PENDING
rows in place, never duplicate, never touch CONFIRMED/REJECTED decisions.
Wiring scheduled re-matching (new foreign products arrive continuously) is a
follow-up once the review throughput is known.

### D6 — Savings route contract unchanged in shape, honest in content

Coverage counts already exist (`products evaluated / with a reference / rows
listed`) and now count linked evaluation truthfully. Ordering, age gate,
rate limit, display-only isolation, and the byte-identical computation
outputs compliance test are untouched — the isolation test gains a fixture
with links present to prove linkage does not leak into any computed ordering.

## Risks

- **Fuzzy yield quality.** German scrape noise (embedded `%`/`l`, split
  decimals, empty volumes) will produce false candidates; the review gate is
  the mitigation, and REJECTED rows become scorer-calibration data.
- **Thesis risk made visible.** Once honest pairs exist, some categories may
  STILL show net losses after German/Estonian landed costs — that is the
  pipeline working, not failing; the page's labeling already renders either
  polarity factually.
- **Queue growth.** Foreign products arrive continuously; without scheduled
  re-matching the queue stales. Accepted for this slice (D5); scheduled
  passes are the follow-up.
