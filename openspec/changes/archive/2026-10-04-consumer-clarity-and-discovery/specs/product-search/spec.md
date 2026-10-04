# product-search Delta

## MODIFIED Requirements

### Requirement: Zero-result suggestion

When a keyword query returns zero results, the response SHALL carry an optional `suggestion`: a deterministic candidate computed by bounded edit distance (≤ 2) between the query's most significant token (its longest token, first occurrence on ties) and a closed suggestion vocabulary — the union of distinct brand values (a multi-word brand keyed by its joined tokens), distinct product-name tokens (one entry per token, deduplicated), and the curated synonym-group members (multi-word members likewise keyed by joined tokens) — with diacritic folding (ä/ö/å → a/o/a) applied to the comparison keys only and returned values keeping the vocabulary's original spelling. A candidate matching on the folded key alone (edit distance 0) remains eligible. Candidate ordering SHALL be (edit distance, then alphabetical under the Finnish collation, then a byte-wise tiebreak for values the collation deems equal). No suggestion SHALL be returned when the query has results or no candidate is within the distance bound. The suggestion SHALL ride the 200 payload as an advisory field only: the original query SHALL remain the response's query, the suggestion is never applied implicitly, and no fuzzy result matching is performed against the catalog.

#### Scenario: Misspelled brand name yields a suggestion

- **WHEN** a zero-result query misspells a brand (`koskenkrova`)
- **THEN** the response carries `suggestion` = a product brand token within the distance bound (Koskenkorva)

#### Scenario: Misspelled category word yields a suggestion

- **WHEN** a zero-result query misspells a word that appears in product names and the synonym map but in no brand (`votka`)
- **THEN** the response carries `suggestion` = `vodka` (a vocabulary member within the distance bound), with the original query text unchanged in the response

#### Scenario: Multi-word brand reachable from a joined-token typo

- **WHEN** a zero-result query omits a multi-word brand's word boundaries (`jackdanels`)
- **THEN** the response carries `suggestion` = the brand's original stored value (`Jack Daniel's`), matched on the joined-token comparison key

#### Scenario: No suggestion when results exist

- **WHEN** a keyword query returns one or more products
- **THEN** the response carries no suggestion

#### Scenario: Deterministic ordering

- **WHEN** multiple candidates across the unioned vocabulary share the same edit distance
- **THEN** the suggestion is the alphabetically first among them under the Finnish collation — a byte-wise tiebreak deciding for values the collation deems equal — stable across requests
