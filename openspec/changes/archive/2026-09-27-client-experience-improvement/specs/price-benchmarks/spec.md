# price-benchmarks Specification

## ADDED Requirements

### Requirement: Category price benchmarks

`GET /api/v1/benchmarks/category-averages` SHALL return, per canonical excise category, the current average price per litre computed from observed catalog offers, split into the domestic Alko average and the cross-border webshop average. Each figure SHALL carry its as-of date and a reliability status; categories without covering data SHALL report honest absence rather than a substituted number. An unknown category parameter SHALL be rejected as a 400 contract error.

#### Scenario: Averages derive from observed offers

- **WHEN** the endpoint is called for a category with observed Alko and cross-border offers
- **THEN** each average equals the mean €/l of the covering offer set, with the as-of date and reliability status stated

#### Scenario: Category without data reports absence

- **WHEN** the endpoint is called for a category with no covering offers
- **THEN** the response reports the category as unavailable instead of a zero or guessed average

#### Scenario: Unknown category is a contract error

- **WHEN** the endpoint is called with a category outside the canonical set
- **THEN** the API responds 400 with the unified error envelope

### Requirement: Benchmarks are display-only

Benchmark data SHALL surface only as display fields and calculator form pre-fill defaults. Benchmarks SHALL NEVER enter a calculation total, a breakdown, or any ranking input, proven by compliance byte-identity tests across zero, one, and many benchmark rows. A calculation that runs with manually entered prices SHALL produce identical amounts to one with the same explicit values regardless of benchmark availability.

#### Scenario: Byte-identical results with and without benchmarks

- **WHEN** the same calculation input runs with benchmark data present and absent
- **THEN** the calculation outputs are byte-identical (compliance-pinned)

#### Scenario: Pre-fill is only a default

- **WHEN** a calculator pre-fills from benchmarks and the visitor submits unchanged
- **THEN** the calculation consumes the pre-filled values as ordinary explicit inputs, and the result carries no benchmark provenance beyond the display surfaces
