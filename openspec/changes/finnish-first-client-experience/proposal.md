# Finnish-first client experience

## Why

A live evidence walk (2026-10-01, real API paths) found two Tier-1 pains with the same shape: the product answers a question the archetypal Finnish customer is not asking, in a language they are not speaking.

- **Default calculation is the wrong scenario** — `POST /api/v1/calculator` for 6×1 L Jameson returns €379.66 (€190 excise + €77 import VAT) because every request is classified Distance Buying: the frontend never sends `transportArrangement`, and the engine computes excise and import VAT unconditionally. The archetypal customer is a ferry traveller carrying bottles in the car boot within traveller allowances (matkustajatuonti) — their honest out-of-pocket figure is the €107.94 shelf price. The allowance math already exists (`/api/v1/trip/fill` fills products into versioned per-person allowance caps), but `/trip` is linked from exactly one homepage task card; a customer who lands in the hero search → `/calculator` funnel sees the overstated number and never learns the alternative exists. Verified: the request schema already accepts `transportArrangement: 'PERSONAL'` (→ Rule 1 TravellerImport), but the engine treats classification as labels only — even a PERSONAL request would print full taxes under a TravellerImport stamp.
- **Search does not speak Finnish** — live production counts: `viski` → 1 result vs `whisky` → 100; `viini` → 16 vs `wine` → 57; `olut` → 47 with dozens of Absolut Vodka rows (the `LIKE '%olut%'` mid-token merge matching Abs**olut**); `koskenkrova` → 0 and `jackdanels` → 0 (no typo tolerance). On a site whose default locale is Finnish this is the daily experience. The mechanics: FTS5 unicode61 exact-phrase + final-token prefix matching, bm25-weighted, plus a deliberate `LIKE '%q%'` merge that exists to backfill mid-token fragments — the same merge is the noise channel. There is no synonym layer and no fuzzy mechanism anywhere in the path.

Both pains are trust failures of the same kind as the archived `data-quality-and-publication-trust` change's four: a headline number (the landed-cost total, the result count) published without the scenario or the language the customer brings to it.

## What Changes

### Traveller mode in the main calculator (engine + frontend)

- A buying-mode toggle in the calculator form: Toimitus (delivery, today's default) / Otan itse mukaan (traveller import). The frontend sends `transportArrangement: 'PERSONAL'` when the traveller mode is selected — the API schema already accepts it.
- An allowance-aware branch in the landed-cost calculator: when the buyer carries the goods, resolve the published traveller-allowance dataset effective on the transaction date via the existing `ITravellerAllowancePort`, and compute within-allowance quantities as shelf price only (excise, container duty, and import VAT zeroed for the allowed portion) and any over-allowance surplus as a taxed remainder using the existing engines with the established import-VAT base composition. Classification evidence records the allowance application and the dataset `versionLabel` (R7 provenance precedent).
- No published allowance dataset effective on the date → the calculation rejects with the same honest 409-family message the trip routes use; the delivery path stays available. Caps are never invented (the port's refuse-to-run contract).
- An additive `travellerAlternative` field on delivery-mode results: when the product's category has an effective cap, the labeled estimate of the traveller scenario ("laivalla mukaan sallituin määrin ≈ €X — vain hyllyhinta") with a pre-filled link into the trip calculator. Delivery-mode amounts are never altered.

### Search speaks Finnish (query space only)

- A curated static Finnish↔English synonym/category map, expanded at query time into OR-groups of the FTS5 MATCH expression (viski↔whisky, viini↔wine, olut↔beer, siideri↔cider, likööri↔liqueur, konjakki↔cognac/brandy, shampanja↔champagne, and the platform category names), versioned in code with tests.
- Substring-merge gating: the `LIKE '%q%'` mid-token merge is consulted only when FTS token matches are scarce (below the page size) — it stays the recall net for fragments (`arhu` → Karhu) and stops flooding short common words with brand-name substring noise (olut → Absolut gone).
- Did-you-mean suggestions: when a query returns zero results, a bounded edit-distance candidate (≤ 2, with ä/ö→a/o folded comparison key) is computed against the product brand-token vocabulary and returned as an additive `suggestion` field (deterministic: distance, then alphabetical); the calculator and product-listing search surfaces render "Tarkoititko: X?" as a clickable suggestion. The user's query is never silently rewritten.

## Decisions

- **D1: Traveller mode is engine math, not marketing copy.** The PERSONAL path runs a real allowance-aware calculation inside the same reliability framework — every line keeps a status, the classification evidence names the allowance dataset it applied, and the result carries the dataset `versionLabel`. A labeled callout alone would leave the main funnel's headline wrong for anyone who selects the traveller mode.
- **D2: Single-traveller assumption, labeled.** The allowance datasets are per-person indicative limits keyed by category; the main calculator resolves one traveller's caps and says so. Multi-traveller, vehicle, ticket/fuel framing remains the trip calculator's job — no feature overlap is introduced.
- **D3: Absent dataset rejects honestly.** The traveller path reuses the port's refuse-to-run contract (`NO_ALLOWANCE_DATASET` → 409-family, trip-route parity). The delivery path is always available. This is the house pattern (D1 of `data-quality-and-publication-trust`): reject to absence, never fabricate.
- **D4: Delivery results are never altered.** The callout is an additive labeled estimate; the delivery-mode result's amounts, statuses, and confidence are untouched. Precedent: D4 of `data-quality-and-publication-trust` (labels change, amounts never) applied from the other side — amounts change only in the scenario the customer explicitly chose.
- **D5: Synonyms are a curated static map.** A closed beverage domain with a handful of category terms does not need an ops-editable governance surface; the map is versioned, tested, and reviewed like code. Expansion is per-token OR-groups, never a silent query rewrite.
- **D6: Query space only.** Synonym expansion, merge gating, and suggestions operate on queries; no product-identity similarity scoring is introduced (the dedupe boundary from `data-quality-and-publication-trust` D5 holds — that change remains queued separately).
- **D7: No feature flags.** Everything ships enabled; rollback is `wrangler rollback`.

## Non-goals (this change)

- Trip calculator feasibility math (ticket/fuel/break-even) — untouched; the only `/trip` change is the prefill handshake (`?product=&quantity=` seeds the fill form).
- Cross-feed dedupe/matching — remains the separately-queued change fed by `spike-notes.md`.
- Swedish-language synonyms (Finland is bilingual; Finnish + English is the scoped first step).
- Silent fuzzy matching or a trigram index — did-you-mean is chosen deliberately (trust posture); a trigram secondary index is the fallback if suggestion hit-rate disappoints, not a task here.
- Declaration-guidance integration for over-allowance surplus (the read-only declaration assistant already renders from results; no changes to it).
- Brand-level synonym curation beyond the category/term map (jackdanels → Jack Daniel's is handled by did-you-mean, not synonyms).
