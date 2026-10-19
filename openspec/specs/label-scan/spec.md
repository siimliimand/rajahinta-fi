# label-scan Specification

## Purpose
TBD - created by archiving change label-scan-product-lookup. Update Purpose after archive.

## Requirements

### Requirement: Label photo submission endpoint

The API SHALL expose `POST /api/v1/products/scan-label` accepting exactly one image body (JPEG, PNG, or WebP; ≤ 4 MB) and SHALL process it in memory only: the image bytes MUST NOT be written to R2, KV, Durable Object storage, or any log. The endpoint SHALL sit behind the age gate and an anonymous per-IP scan quota enforced via RateLimiterDO, answering the unified error envelope with `AGE_GATE_REQUIRED` (403) and `RATE_LIMITED` (429) respectively. Oversized or wrong-type bodies SHALL be rejected with a validation error before any model invocation.

#### Scenario: In-memory processing only

- **WHEN** a scan-label request completes, fails, or is rejected
- **THEN** no image bytes or derived transcriptions exist in any persistent store or log sink

#### Scenario: Caps rejected before model invocation

- **WHEN** a request carries an image above 4 MB or of an unsupported type
- **THEN** the endpoint answers a validation error envelope and the Workers AI model is never called

#### Scenario: Anonymous quota

- **WHEN** an unauthenticated client exceeds the configured scan quota within its window
- **THEN** further scan-label requests answer 429 until the window resets, while authenticated flows are unaffected elsewhere on the API

### Requirement: Structured label extraction

The route SHALL invoke the pinned Workers AI vision model (`@cf/mistralai/mistral-small-3.1-24b-instruct`) with a prompt that first transcribes all visible label text and then emits a single JSON object with `brand`, `product`, `abv_percent`, `volume_l`, `category`, and `vintage_year` fields. The parser SHALL tolerate fenced or noisy model output (code-fence stripping, zod-validated with numeric coercion and null-on-absent). Model failure, timeout, or unparseable output SHALL answer a typed 502 error envelope carrying a retryable flag; the pinned model identifier SHALL be a single named constant so substitution is a one-line change.

#### Scenario: Legible label yields structured fields

- **WHEN** the model returns fenced JSON with `brand: "Żołądkowa"`, `abv_percent: 37.5`, `volume_l: 0.7`
- **THEN** the response's `extracted` object carries those values with diacritics preserved for display and folded forms used for retrieval

#### Scenario: Unparseable model output is a typed 502

- **WHEN** the model responds with prose that yields no valid JSON after fence stripping
- **THEN** the endpoint answers a 502 envelope marked retryable and renders no candidates

### Requirement: Token-AND candidate funnel

The funnel SHALL retrieve candidates with a token-AND `MATCH` over `product_master_fts` (not phrase-adjacency), query tokens produced by lowercasing, stripping punctuation, and folding diacritics from the extracted brand and product text. Candidates SHALL be scored by ABV band distance (0.5 percentage-point buckets) and volume band distance (0.05 l buckets) following the ingestion matcher's widening discipline: a null extraction field SHALL drop its band term entirely rather than fabricate a value. Retrieval SHALL be bounded to the visible catalog universe (`name_quality = 'ok'`, `review_hold_reason IS NULL`) and SHALL return at most five candidates ordered by band score then product id, each carrying id, name, ABV, unit volume, category, and lowest observed price where available.

#### Scenario: Mid-name numbers do not break matching

- **WHEN** extracted tokens `gran`, `mirador`, `brandy` are queried against a catalog row named "GRAN MIRADOR 7 Brandy 0.7L 36%"
- **THEN** the row is retrieved despite the non-adjacent `7` token

#### Scenario: Bands discriminate sibling variants

- **WHEN** extraction yields `abv_percent: 45`, `volume_l: 0.7` among sibling rows of identical brand
- **THEN** rows whose ABV/volume deviate from the extraction rank behind exact matches, and a genuine tie surfaces both for user confirmation

#### Scenario: Diacritic folding

- **WHEN** extraction yields `żołądkowa` and the catalog name is `Zoladkowa`
- **THEN** the folded query token matches the ASCII catalog token

#### Scenario: Null extraction widens instead of fabricating

- **WHEN** the model returns `abv_percent: null`
- **THEN** the ABV band term is omitted and candidates are ordered by the remaining terms only

### Requirement: Scan page experience

The frontend SHALL provide a locale-aware `/scan` route (fi default, en translation) that captures a single photo via `getUserMedia` with capture guidance (fill-the-frame affordance), downsizes it client-side (longest edge ~1024 px, JPEG) before upload, and renders one of four states: extracting, candidates, no-result, or camera-denied/unsupported. The candidate state SHALL present at most three cards (name, ABV, unit volume, lowest observed price) and SHALL navigate to `/products/[id]` only on explicit tap — never by auto-redirect. The no-result state SHALL offer a manual catalog search seeded with the transcribed brand text. The page SHALL display a privacy notice stating the photo is processed in memory and never stored, and SHALL NOT render camera output until permission is granted.

#### Scenario: Confirm-before-navigate

- **WHEN** the funnel returns three candidates
- **THEN** all three render as tappable cards and no navigation occurs without a user tap

#### Scenario: No-result hands off to search

- **WHEN** the funnel returns zero candidates for a successfully extracted label
- **THEN** the no-result state links to the catalog search with the extracted brand prefilled as the query

#### Scenario: Camera permission denied

- **WHEN** `getUserMedia` rejects or the media devices API is unavailable
- **THEN** the page renders a recovery state (retry prompt, link to the products page) without calling the scan-label endpoint

### Requirement: Scan surface protection

The scan feature SHALL reuse the age gate before any model cost is incurred, SHALL expose the scan entry point only through the products-page search area and the `/scan` route (no app-wide navigation changes), and SHALL document the in-memory processing claim in the user-facing privacy copy (footer) before launch.

#### Scenario: Age gate precedes model cost

- **WHEN** an age-unconfirmed client calls scan-label
- **THEN** the request answers 403 `AGE_GATE_REQUIRED` and the Workers AI model is never invoked
