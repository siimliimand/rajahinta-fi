# product-search Delta

## MODIFIED Requirements

### Requirement: Zero-result suggestion

When a keyword query returns zero results, the response SHALL carry an optional `suggestion`: a deterministic candidate computed by bounded edit distance (≤ 2) against the product vocabulary — the union of distinct brand tokens, distinct product-name tokens, and the curated synonym-group members — with diacritic folding (ä/ö/å → a/o/a) applied to the comparison keys only. Candidate ordering SHALL be (edit distance, then alphabetical). No suggestion SHALL be returned when the query has results or no candidate is within the distance bound. The original query SHALL remain the response's query; the suggestion is advisory and never applied implicitly.

#### Scenario: Misspelled brand name yields a suggestion

- **WHEN** a zero-result query misspells a brand (`koskenkrova`)
- **THEN** the response carries `suggestion` = a product brand token within the distance bound (Koskenkorva)

#### Scenario: Misspelled category word yields a suggestion

- **WHEN** a zero-result query misspells a word that appears in product names or the synonym map but in no brand (`votka`)
- **THEN** the response carries `suggestion` = a vocabulary member within the distance bound

#### Scenario: No suggestion when results exist

- **WHEN** a keyword query returns one or more products
- **THEN** the response carries no suggestion

#### Scenario: Deterministic tie-breaking across widened vocabulary

- **WHEN** multiple candidates across the unioned vocabulary share the same edit distance
- **THEN** the suggestion is the alphabetically first among them, stable across requests
