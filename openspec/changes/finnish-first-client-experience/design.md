# Design — finnish-first-client-experience

## Context

Two independent workstreams share one change (owner decision): traveller mode in the main calculator, and Finnish search quality. Both are grounded in live-verified behavior recorded in the proposal. This document settles the design questions opened during exploration.

## Stream 1 — Traveller mode in the landed-cost calculator

### Current flow and where the branch goes

```
POST /api/v1/calculator { productId, quantity, destination,
                          transportArrangement? }        ← schema already accepts PERSONAL
        │
        ▼
landed-cost-calculator.service.calculate()
        │
        ├─ 1. classification gate (product regulatory class)   unchanged
        ├─ 2. resolve offers, best offer                        unchanged
        ├─ 3. transport estimation                              unchanged (delivery)
        ├─ 4. excise + container duty          ← BRANCH: PERSONAL zeroes the
        │                                         allowed portion, taxes surplus
        ├─ 5. classification (buyerIsTravelling = arrangement === 'PERSONAL')
        │      ← today labels-only; becomes load-bearing for the tax branch
        ├─ 6. import VAT (isImport)            ← BRANCH: allowed portion excluded
        └─ 7. assemble result + travellerAlternative callout (delivery mode only)
```

The engine default (`SELLER_ARRANGED` when the field is absent) is preserved: without the toggle the request byte-stream and result are identical to today, so golden fixtures and the idempotency cache keep working.

### Allowance resolution (design Q1, closed during exploration)

`D1TravellerAllowancesRepository.findPublishedEffectiveOn(date)` (exposed to core-domain through `ITravellerAllowancePort`, adapter already wired in the composition root for the optimizer) returns the dataset `versionLabel` plus per-category `volumeCapLitres` / `quantityCap` rows. The limits carry **no vehicle dimension** — they are per-person indicative caps by category (canonical tax-rule keys: `beer`, `wine_still`, `wine_sparkling`, `intermediate_products`, `other_fermented`, `spirits`). The main calculator resolves with the transaction date (or today when absent), one traveller, and labels the assumption in the result copy. Product → category mapping uses the same category key mapping the tax engines already use.

Resolution date uses the half-open window contract already implemented (`effectiveFrom ≤ date < effectiveTo`, newest `effectiveFrom` wins on transient overlap, version resolved as a unit — a category missing from the effective version resolves to null, which surfaces as "no cap for this category" and the within/over split does not apply to it).

### Within/over-allowance math (design Q2)

For the selected product with quantity *q*, unit volume *v* litres, and cap *c* (litres or units, per the limit row):

- allowed quantity `q_allowed = min(q, floor/ceiling per cap semantics)` — the trip-fill engine's cap semantics are the reference implementation; reuse its helper semantics rather than re-deriving (the fill engine already handles `WITHIN_ALLOWANCE` / `CAPPED` / volume-vs-quantity caps).
- taxed quantity `q_taxed = q − q_allowed`.
- `q_allowed` lines: retail price only. Excise, container duty, import VAT = 0 with reliability VERIFIED-where-verified (the cap is dataset fact, the application is arithmetic).
- `q_taxed` lines (when > 0): the existing engines compute excise, container duty, and import VAT on the surplus exactly as today — including the import-VAT base composition (retail + transport + excise + container duty of the taxed portion; transport only when a transport context exists, which for PERSONAL it normally does not).
- The itemized breakdown gains the split as labeled lines (e.g. "Alkoholijuonaverot (sallitun määrän ylittävä osa)") — no new cost categories; the existing `CostCategory` space suffices with per-line labels.
- Sanity rail keeps working unchanged: it reads computed line figures and downgrades labels only.

### Absent dataset (design Q3)

The port contract already refuses: no published effective dataset → `NO_ALLOWANCE_DATASET`. The service maps it to a dedicated error (sibling of `ClassificationGateRejectionError`), which `calculator.routes.ts` maps to the trip routes' 409-family message shape ("No published traveller allowance dataset is effective on {date} — …"). The delivery path is unaffected; the UI keeps the form usable and explains the traveller mode is temporarily unavailable.

### Response additions

- PERSONAL results: same `CalculatorResult` shape; itemized lines carry the within/over split; metadata carries the allowance `versionLabel`; classification evidence carries the allowance application note.
- Delivery results: additive optional `travellerAlternative: { estimatedTotalCents, withinAllowance: boolean, allowanceDatasetVersion, categoryKey } | null`. Computed in the same request (one allowance read + arithmetic — negligible; the port read is a single indexed query). Null when: no effective dataset, no cap row for the product's category, or the request was already PERSONAL.
- Idempotency cache: `idempotencyCacheKey` hashes the whole parsed input, which already includes `transportArrangement` — pinned by a test (PERSONAL and delivery of the same product must not collide).

## Stream 2 — Search speaks Finnish

### Query pipeline today

`tokenize()` (unicode-letter tokens, lowercased, ä/ö/å preserved) → `buildMatchExpression()` (adjacent phrase + prefix expansion on the final token, e.g. `"karhu" *`) → FTS5 bm25 ranking (name 10 / brand 5 / manufacturer 2) → `LIKE '%q%'` merge backfilling mid-token substrings. Both paths are total orders merged deterministically.

### Synonym expansion (D5)

- One static map in the data-platform repository module: `FINNISH_SYNONYM_GROUPS: readonly (readonly string[])[]` — each group a closed equivalence set (e.g. `['viski', 'whisky']`, `['olut', 'beer', 'oluet']`, `['viini', 'wine']`, `['punaviinit', 'red wine']`, `['kuohuviini', 'sparkling wine']`, `['siideri', 'cider']`, `['likööri', 'liqueur']`, `['konjakki', 'cognac', 'brandy']`, `['shampanja', 'champagne']`, `['vodka', 'viina']`).
- Expansion happens per token inside query construction: each token becomes an OR-group `"viski" OR "whisky"`; the final-token prefix expansion applies to every member (`"viski" * OR "whisky" *`). Phrase queries (multi-token) keep adjacency across groups.
- The map is intentionally closed and category-flavored. Brand-level misspellings (jackdanels) are did-you-mean territory, not synonyms — different failure class, different mechanism.
- Tests pin recall parity (viski ≈ whisky counts on fixtures) and that expansion never *narrows* a result set (OR is monotone here).

### LIKE-merge scarcity gate

The merge exists to recall mid-token fragments (`arhu` → Karhu); that value only matters when token matches are scarce. Gate: when the FTS candidate count ≥ page size (20), skip the LIKE merge entirely; below it, merge as today. Effects verified against live incidents: `olut` (FTS hits exist: "Olutpaja …", "Karhu Olut …") → Absolut rows disappear from the head; `arhu` (FTS 0) → merge still fires. Threshold = page size, pinned by test; no ranking semantics change beyond the gate (D6).

### Did-you-mean (design Q5)

- Trigger: `total === 0` for the query.
- Candidate vocabulary: distinct brand tokens from `product_master` (a small indexed DISTINCT query, hundreds of rows — loaded per request, no cache infrastructure).
- Comparison: Levenshtein ≤ 2 on diacritic-folded keys (ä→a, ö→o, å→a) so `likoori` also reaches `likööri`; the original query is displayed, the suggestion is a separate clickable value.
- Determinism: order candidates by (edit distance, alphabetical), take the first; ties are stable.
- Contract: additive optional `suggestion: string` on the search response when a candidate exists. No silent rewriting (trust posture; the customer decides).

## Frontend

- Calculator form: buying-mode radio (Toimitus default / Otan itse mukaan) next to quantity; selection adds `transportArrangement: 'PERSONAL'` to the request. PERSONAL results render the within/over split with the allowance dataset version and an explanatory one-traveller note; the no-dataset rejection renders the honest unavailable state with the retry-later copy.
- Delivery results render the `travellerAlternative` callout (labeled estimate + "Kokeile matkalaskuria" → `/trip?product={id}&quantity={n}`).
- Trip page reads the query params and pre-seeds the fill form (product + quantity; existing caps and validation apply unchanged).
- Search surfaces (calculator product search + product listing) render "Tarkoititko: {suggestion}?" as a clickable chip that runs the suggested query.
- All copy fi/en in parity, pinned by the messages test; content lint clean.

## Test strategy

Incident-shaped pins, the house pattern:

- 6×1 L Jameson (40%), spirits cap from the published dataset → PERSONAL result = shelf price only; over-cap quantity (e.g. 12×) → surplus taxed with the exact import-VAT base composition.
- Absent dataset → 409-family rejection; delivery result unaffected.
- Idempotency: same product/quantity, PERSONAL vs delivery → distinct cache entries.
- viski ≈ whisky recall; olut head without Absolut (the live incident); `arhu` → Karhu survives the gate.
- koskenkrova → Koskenkorva, jackdanels → Jack Daniel's suggestions; no suggestion when hits exist; determinism stable ordering.
- fi/en message parity for every new string.

## Risks

- Cap semantics (litres vs units per category) differ per limit row — mitigated by reusing the trip-fill helpers and pinning both shapes in tests.
- The callout's "€X" must never read as a promise: copy carries the dataset version + estimate framing (content lint + design review).
- Synonym groups that grow too chatty (e.g. `viina` matching vodkas the user didn't want) — mitigated by keeping the map category-flavored and small; each group ships with a recall test on real fixture names.
