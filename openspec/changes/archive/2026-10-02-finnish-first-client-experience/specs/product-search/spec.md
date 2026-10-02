# product-search Specification

## ADDED Requirements

### Requirement: Finnish synonym recall

Product keyword search SHALL expand query tokens through a curated static Finnish↔English synonym map (category- and term-level equivalence groups, versioned in code). Expansion SHALL produce OR-groups inside the FTS5 MATCH expression so a query matches any group member, with prefix expansion applied to every member of the final token's group. Expansion SHALL never narrow a result set relative to the un-expanded query. The user's query text SHALL NOT be rewritten in the response.

#### Scenario: Finnish term recalls the English-language catalog

- **WHEN** the search query is `viski`
- **THEN** results include products matching `whisky`, with recall at least equal to the un-expanded match set for `viski`

#### Scenario: Expansion is monotone

- **WHEN** any synonym-expanded query is executed
- **THEN** the result set is a superset of the same query executed without expansion

### Requirement: Substring merge scarcity gating

The `LIKE '%q%'` mid-token merge SHALL be consulted only when the FTS token-match candidate count is below the listing page size; at or above it, the merge is skipped. Fragment recall SHALL be preserved when token matches are absent or scarce (e.g. `arhu` → Karhu). The gate SHALL NOT change the ranking semantics of the paths it does run.

#### Scenario: Common short word is not flooded by brand-substring noise

- **WHEN** the query `olut` returns FTS token matches at or above the page size
- **THEN** the result head contains token matches only — mid-token substring rows such as brand names merely containing the letters are absent

#### Scenario: Fragment recall survives the gate

- **WHEN** the query `arhu` produces no FTS token matches
- **THEN** the LIKE merge runs and returns the mid-token matches as before

### Requirement: Zero-result suggestion

When a keyword query returns zero results, the response SHALL carry an optional `suggestion`: a deterministic candidate computed by bounded edit distance (≤ 2) against the product brand-token vocabulary, with diacritic folding (ä/ö/å → a/o/a) applied to the comparison keys only. Candidate ordering SHALL be (edit distance, then alphabetical). No suggestion SHALL be returned when the query has results or no candidate is within the distance bound. The original query SHALL remain the response's query; the suggestion is advisory and never applied implicitly.

#### Scenario: Misspelled brand name yields a suggestion

- **WHEN** the query `koskenkrova` returns zero results
- **THEN** the response carries `suggestion` = a product brand token within the distance bound (Koskenkorva)

#### Scenario: No suggestion when results exist

- **WHEN** a query returns one or more results
- **THEN** the response carries no suggestion

#### Scenario: Deterministic ordering

- **WHEN** multiple candidates share the minimal edit distance
- **THEN** the suggestion is the alphabetically first among them, stable across requests
