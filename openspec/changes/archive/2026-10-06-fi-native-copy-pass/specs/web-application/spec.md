# web-application Delta

## ADDED Requirements

### Requirement: Canonical Finnish terminology and native register

Finnish UI copy SHALL carry exactly one canonical term per concept as defined in `docs/fi-copy-glossary.md`, and SHALL read in native consumer register: no malformed compounds, no coined feature names, no engineering or build-time vocabulary on consumer surfaces. The glossary SHALL be updated in the same change whenever a canonical term is introduced or replaced. English copy SHALL follow the same one-term-per-concept rule; its register MAY differ where spec-register language is conventional (per the glossary's documented asymmetry).

#### Scenario: One term per concept across surfaces

- **WHEN** any Finnish surface names a glossary concept (drink demand, basket feature, ranking page, allowance limits, ethanol unit price)
- **THEN** it uses the glossary's canonical term, and no superseded variant (`juonetarve`, `Ostoskorioptimointori`, `tullimäärärajat`, `Etanoli-€/g`) renders anywhere in the UI

#### Scenario: Consumer register on informational surfaces

- **WHEN** an informational note, dataset label, or explanation renders in Finnish
- **THEN** it uses the glossary's plain-Finnish phrasing (`vain tiedoksi`, `päivittäin päivitetty aineisto`, `aineiston versio`), and any informational-not-advice disclaimer remains stated with its legal intent intact

#### Scenario: Glossary updated with terminology changes

- **WHEN** a change replaces or introduces a canonical term in the catalogs
- **THEN** `docs/fi-copy-glossary.md` documents the term, its replaced variants, and its rationale
