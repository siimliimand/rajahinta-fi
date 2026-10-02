# Design — honest-trust-surfaces

## Context

Four trust surfaces, one theme: they either show nothing (accuracy count 0, empty blog/guides), show a metric nobody can see (€/g on listings), or show copy that advertices thinness ("Myyjiä: 1") — and underneath one of them sits a live correctness bug (pack-notation `unit_volume` corruption feeding the calculator). Live evidence in `proposal.md`; this design records the decisions an implementer needs that the proposal states only as outcomes.

## Decisions

### D1 — The listing €/g embed derives from one specific offer

The old rule (`search.routes.ts::searchItemUnitPrice`) passed `Number.NaN` as the price on every listing path because `lowestPriceCents` is an aggregate ("not any single offer's price"). The reversal: the minimum over current-available offers **is** one specific offer. The repository aggregate for the listing therefore resolves, alongside `lowestPriceCents`/`merchantCount`, the cheapest current-available offer's price provenance, and the route computes `eurPerGram(price, unitVolumeL, alcoholFraction)` with that provenance attached.

- "Current" = the same freshness/availability semantics the detail route uses when it lists offers — the listing embed and the detail page must never disagree for the same product.
- Unavailable keeps its meaning: no current-available offer → unavailable (honest absence, not NaN); missing/invalid physicals → the existing domain reasons; abv = 0 → `ZERO_ETHANOL` (D2).
- The embed never reorders results or feeds ranking (the per-offer embed precedent holds).

### D2 — ZERO_ETHANOL: a reason that states the physics

`eur-per-gram`'s validation order becomes: missing volume → missing fraction → invalid volume → invalid fraction → zero ethanol (abv = 0, present and valid) → invalid price. Alcohol-free products (`Karhu 0,0`) are legitimately undefined in cents per gram of ethanol; the reason string says so instead of claiming the fraction is invalid. Zero stays rejected as a fraction value only when it arrives where a fraction is required and the product is not declared alcohol-free — the domain distinction is `alcoholFraction === 0` (valid data, undefined metric) vs. non-numeric/out-of-range (invalid data).

### D3 — Pack correction: backfill before deploy

`unit_volume` participates in the Tier-2 identity compound key `(name, brand, containerType, unit_volume)`. Changing it re-keys rows; the cron/ingestion must not resurrect corrupted volumes by re-matching against old keys. Ordering is pinned in the runbook (change-notes):

1. Merge the code (normalizer + backfill script, deploy-gated).
2. Run `scripts/backfill-unit-volume.mts --stats` → `--sample` → `--dry-run` → real run against production D1 (operator-run, token from the environment, never echoed).
3. Deploy. The daily 00:00 UTC cron then re-ingests with the normalizer and matches corrected keys.
4. Post-deploy verification: product 2900 shows `unit_volume 0.33`, detail €/g in the sane beer band, listing embeds present.

The script follows `backfill-brand.mts` precedent (`--stats/--sample/--dry-run`, generated SQL artifact in `/tmp/opencode` for reproducibility). The correction deliberately changes landed-cost inputs for affected rows — it is a correction of stored physical facts, not a re-pricing.

### D4 — Trust-row: coverage is a labeled mode, never a substitute masquerade

`AccuracyStat` gains a coverage mode triggered when the user-reported count is below the floor (today: always). It renders the true catalog coverage block — products tracked, offer observations, last sync — with copy that names it as catalog coverage ("seurattu valikoima"), visually distinct from the user-reported accuracy presentation. The island keeps both modes permanently; the mode is data-driven, so the first real outcome report flips the row back to the user-reported statistic with no code change. No seeded outcomes, ever.

### D5 — Visibility gating, not deletion (no feature flags)

Blog/guides pages and footer links consult publication counts at request time. Zero published for the locale → the page calls `notFound()` (a crawler-honest 404, no soft-404 empty shell) and the footer omits the links. Counts come from the existing public endpoints; on API failure the default is hidden (the honest direction). Publishing the first post/guide restores page + links on the next request — no flag, no deploy, no stale empty shell for crawlers. The empty-state components stay in the codebase for the >0-but-fetch-failed path inside authenticated operator surfaces where they remain meaningful.

### D6 — Single-seller cards: presentation only

When `merchantCount === 1` the card's seller-count line is replaced by the tracked-price framing ("Seurattu hinta" / tracked price, merchant-agnostic); multi-seller cards keep "Myyjiä: N". No new endpoints, no new data. Merchant acquisition stays a business task and is explicitly out of scope.

### D7 — Post-calculation nudge: one prompt, account-aware, dismissible

The result view renders one dismissible prompt after a successful calculation: logged-in → deep-link to the account page's `OutcomeReportForm` with the calculation record preselected (the form already validates ownership + margin rules); anonymous → the sign-in path. The prompt never blocks the result, never re-renders after dismissal within the session, and its copy stays inside the content-policy lint.

## Risks

- **Identity re-keying (D3)** — the whole reason for backfill-before-deploy. Mitigated by the runbook ordering, `--dry-run` review, and post-deploy spot checks.
- **Listing €/g cost** — one more aggregate resolution per listing page. The repository change stays inside the existing offer-aggregate query (same table, same freshness rules); the load suite (in-process Artillery) pins the budget.
- **Compare sort behavior change** — EUR_PER_GRAM stops being id-order; that is the fix, but golden fixtures pin ordering determinism (metric value, then id tiebreaker — spec `unit-price-metrics` unchanged on that point).
- **Footer/page gating vs. caches** — ISR layers must not pin a zero-publication 404 after first publication; verification includes a publish-cycle check or an explicit revalidation exemption for zero/non-zero transitions.
