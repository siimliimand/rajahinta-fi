# Change notes — onboard-longero-merchant

## Task 1.1 sweep findings

- **Date / method**: 2026-09-14, `scripts/longero-catalog-sweep.ts` (cloned from the alks sweep: sequential pages, `per_page=100`, first usable `X-WP-TotalPages` caps the walk, per-page/per-row errors collected never thrown, read-only GETs). Every raw row pushed through `parseAlksStoreProducts` unchanged.
- **Run**: `pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/longero-catalog-sweep.ts`
- **Verdict**: `sweep COMPLETE` — 0 page failures, raw rows > 0.

### Key numbers

| Metric | Value |
|---|---|
| X-WP-Total (page 1) | 994 (matches the proposal's expectation) |
| Pages fetched ok | 10/10, page failures 0 |
| Raw rows seen | 994 (= X-WP-Total, no pagination drift) |
| Records parsed | 985 (99.1%) |
| Rows dropped (all causes) | 9 (**0.9% drop-rate**) |
| ESTIMATED share (ABV null or volume 0) | 5 records (0.5%) |

Payload compatibility confirmed field-for-field: EAN-shaped SKUs (`de-…`), EUR minor-unit prices, name-embedded ABV/volume, `X-WP-TotalPages`/`X-WP-Total` headers, `is_in_stock`. No non-EUR price rows, no invalid price rows, no missing-name rows.

### Per-category error distribution

| Category | Count | Share of raw rows | Effect |
|---|---|---|---|
| category disagreement (name vs categories) | 2 | 0.2% | DROP |
| no canonical beverage category | 7 | 0.7% | DROP |
| non-EUR price | 0 | 0.0% | — |
| invalid minor-unit price | 0 | 0.0% | — |
| missing product name | 0 | 0.0% | — |
| non-matching SKU (record kept, no EAN) | 349 | 35.1% | KEPT, correction queue |

Every parse error matched a known category (no unclassified errors). Samples in dropped errors carry the parser's own `alks product …` label — expected, the parser is reused unchanged.

### SKU/EAN gap

- Rows with a SKU: 936; rows with no/empty SKU: 58 (5.8%).
- SKUs matching `^[a-z]{2}-\d{13}$`: **587 — 62.7% of SKUs present, 59.1% of all rows**.
- SKUs not matching: **349 (37.3% of SKUs present)** — worse than the ~32% the 100-row probe suggested, but same shape: `V2-…` internal codes (`V2-020620231`, `V2-26042024-1`), 12-digit EANs (`de-82896001453`), and bare `V2`. By design these records are kept EAN-less and correction-queued — no remediation in this change (non-goal).

### Finnish category-vocabulary coverage (raw category terms, case-insensitive substring)

| Candidate term | Rows | Share of raw rows | Already maps in `mapSourceCategory`? |
|---|---|---|---|
| Väkevä | 475 | 47.8% | yes → spirits |
| Kuohuviini | 46 | 4.6% | yes → sparkling-wine |
| Long drink | 35 | 3.5% | yes → long-drink (other_fermented) |
| Roseeviini | 37 | 3.7% | **no — NULL** |
| Juomasekoitus | 16 | 1.6% | yes → long-drink |
| Muut juomat | 9 | 0.9% | yes → other (explicit-other token) |
| Glögg | 2 | 0.2% | yes → fortified-wine |

Rows carrying at least one candidate term: 616 (62.0% of raw rows).

### Disposition of the 9 category-driven drops (read-only probe of the dropped rows)

- **id 1914** `Roseeviini` — "The Wanted Zin Zinfandel Rosé" — the only drop the candidate list fixes: adding `roseeviini` → wine recovers it.
- **id 1196, 1227** `Alkoholiton olut` — unmapped term **not in the candidate list**; would need `alkoholiton olut` → non-alcoholic (out of 1.2's stated scope; flagged for the lead).
- **id 1858, 1766, 1854, 1874** — empty `categories: []`; name-token gaps (Soave, Jaloviina, Merlot, bare "White" BIB boxes), not vocabulary-driven.
- **id 4281** (`Väkevä`/`Viski` + "Sherry Cask" whisky) and **id 1903** (`Long drink` + "VODKA-LIME") — name-token false positives vs correct category mapping; correction queue is the right outcome.

Country terms `Germany` / `USA` / `Italy` verified to return null from `mapSourceCategory` today — the 1.2 test guard already holds.

### Go/no-go for task 1.2

**GO** — the gate condition is met: the sweep shows real category-driven drops (9 rows, 0.9%), and at least one (id 1914, `Roseeviini`) is directly recoverable by the exact candidate list. **But scope 1.2 accordingly**: six of the seven candidates already map, so the effective extension is `roseeviini` → wine (consider the plural `roseeviinit` too — the mapper is exact-match); adding the other six as explicit keys is a no-op documentation choice, not a behavior change. The lead may also want to rule on `alkoholiton olut` → non-alcoholic (2 further drops), which is outside the listed candidates.

## Lead rulings (apply stage)

- Task 1.2 scope: `roseeviini`/`roseeviinit` → wine only (the six other probe candidates already mapped). `Alkoholiton olut` (2 drops) is outside the annotated candidate list — recorded as a follow-up; needs an owner decision before mapping (non-alcoholic → `non-alcoholic`/other_fermented is plausible but not plan-sanctioned).
- Task 2.2 touches drift: annotation says `packages/data-acquisition/src/pipeline.ts`, which does not exist; the data-acquisition-side composition site is `apps/api-worker/src/queues/pipeline.ts` (`composeIngestionPipeline`). Applied there.
- Note for 6.1: rebuild `@rajahinta/core-domain` before the full test sweep or stale `dist` causes false mapper failures (hit during 2.1 verification).
