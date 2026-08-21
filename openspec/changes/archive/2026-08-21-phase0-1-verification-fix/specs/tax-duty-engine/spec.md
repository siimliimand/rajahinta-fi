# tax-duty-engine — Delta Spec

## ADDED Requirements

### Requirement: Official rate-table conformance

Every seeded excise rate SHALL match the official Finnish Tax Administration (vero.fi) alcohol excise duty table for its effective period — value, unit basis, and ABV band boundaries. Beer SHALL be taxed per centilitre of ethyl alcohol (numerically equal to cents per %-litre), with separate bands for > 0.5–3.5 % and > 3.5 %. Wine bands SHALL be > 1.2–2.8 %, > 2.8–5.5 %, > 5.5–8 %, > 8–15 %, and > 15–18 %, each per litre of product; the > 1.2–2.8 % band is taxable (not exempt). Sparkling wine SHALL carry no separate rate (wine bands apply). Spirits SHALL have separate > 1.2–2.8 % and > 2.8 % bands per centilitre of ethanol. Intermediate products SHALL be taxed per litre of product. Fermented beverages (cider, long drink, sake, mead) SHALL be taxed per litre of product under the wine bands; no per-pure-alcohol variant SHALL exist for them.

#### Scenario: Spirit duty matches official rate

- **WHEN** 0.7 l of 40 % ABV spirits is calculated with the 2024 dataset
- **THEN** the excise SHALL equal 0.7 × 0.40 × 54.80 € = €15.34 (54.80 snt/cl ethanol)

#### Scenario: Beer tier boundary

- **WHEN** a 3.5 % ABV beer and a 3.6 % ABV beer are calculated with the 2024 dataset
- **THEN** the 3.5 % beer SHALL use the 28.35 snt/cl band and the 3.6 % beer SHALL use the 36.20 snt/cl band

#### Scenario: Low-alcohol wine is taxable

- **WHEN** a 2.0 % ABV wine is calculated
- **THEN** the > 1.2–2.8 % band SHALL apply at its official per-litre rate, and the product SHALL NOT be treated as exempt

#### Scenario: Sparkling wine uses wine rates

- **WHEN** a 12 % ABV sparkling wine is calculated
- **THEN** the duty SHALL equal the still-wine rate for the > 8–15 % band, with no sparkling surcharge or discount

### Requirement: Multi-year dataset currency

The tax-rule dataset SHALL include a versioned rule set for every official rate period since the initial dataset, and the currently effective version SHALL match the official table as of the current date. A version claiming open-ended validity (`effectiveTo: null`) SHALL only exist for the most recent official period.

#### Scenario: Calculation as of today uses current law

- **WHEN** a calculation is performed with no explicit date in 2026
- **THEN** the 2026 rates SHALL apply (e.g. beer > 3.5 % at 36.71 snt/cl), not 2024 rates

#### Scenario: Intra-year rate change

- **WHEN** a wine > 1.2–2.8 % is calculated for 31.3.2026 and again for 1.4.2026
- **THEN** the first calculation SHALL use 36 snt/l and the second SHALL use 50 snt/l, resolved from two adjacent rule rows

### Requirement: Effective-range boundary semantics

A tax rule SHALL apply on its entire effective range, inclusive of both `effectiveFrom` and `effectiveTo` dates. Lookups SHALL use half-open start (> `effectiveFrom`) and closed end (≤ `effectiveTo`) semantics, matching the official "yli X mutta enintään Y" band phrasing.

#### Scenario: Rule applies on its expiry date

- **WHEN** a rule has `effectiveTo` equal to the calculation date
- **THEN** the rule SHALL still apply for that calculation

#### Scenario: Publish rejects gaps and overlaps

- **WHEN** a new rule-set version is published
- **THEN** the engine SHALL reject it if any (taxType, productCategory) timeline contains a gap or overlapping ranges, while permitting adjacent ranges (previous `effectiveTo` + 1 day = next `effectiveFrom` boundary continuity)

### Requirement: Small-producer relief correctness

Small-brewery relief SHALL reflect the official progressive scheme (reduced rate scaling with annual production volume, production ceiling per the Finnish Alcohol Act small-producer provisions), sourced from its own official vero.fi page. If progressive tiers cannot be evaluated, the system SHALL apply the general rate and mark the small-producer treatment UNAVAILABLE — never a silently wrong relief.

#### Scenario: Relief data is internally consistent

- **WHEN** a small-brewery rule row is seeded
- **THEN** its rate structure, production threshold, and description SHALL all match the same official source

#### Scenario: Unevaluable relief is explicit

- **WHEN** the engine cannot determine a product's eligibility for progressive relief
- **THEN** the general rate SHALL apply with the small-producer input marked UNAVAILABLE (affecting result confidence), not ESTIMATED-at-a-guess-rate

## MODIFIED Requirements

### Requirement: Alcohol excise calculation

The system SHALL calculate alcohol excise duty from product category, alcohol percentage, and volume, using official Finnish Tax Administration rate tables as the primary source rather than independently derived figures. The formula reference for beer and spirits SHALL be per centilitre of ethyl alcohol; no formula or documentation SHALL describe the beer basis as degrees Plato.

#### Scenario: Category-specific rate

- **WHEN** a product's category and ABV map to an official excise rate table
- **THEN** the excise SHALL equal the official rate applied to the product's volume

#### Scenario: Fallback never invents a rate

- **WHEN** no tax rule matches the calculation inputs
- **THEN** the calculation SHALL be marked ESTIMATED with rate UNAVAILABLE, and SHALL NOT silently substitute a hardcoded plausible rate

### Requirement: Versioned rate datasets

Rates SHALL never be edited in place. Each rate entry SHALL store tax type, product category, rate value, effective start and end dates, exemption conditions, formula reference, official source citation, and verification date. Correcting a wrong rate SHALL be performed by closing the erroneous version's effective range and publishing a corrected versioned entry through the manual rate-review gate. Each rule's `officialSource` SHALL cite the specific official page containing that rate (excise table, small-producer relief page, or container-duty page).

#### Scenario: Historical resolution

- **WHEN** a calculation is dated to a period covered by a prior rate version
- **THEN** the calculation SHALL resolve against the version effective on that date

#### Scenario: Wrong rate corrected by versioning

- **WHEN** a seeded rate is found to contradict the official table
- **THEN** the fix SHALL take the form of a new versioned entry with the official value and source, and the superseded entry SHALL be closed with an `effectiveTo` date — the erroneous value SHALL NOT be edited in place

#### Scenario: Source citation is specific

- **WHEN** any rule row is inspected
- **THEN** its `officialSource` SHALL name the exact official page that publishes that rate, and small-producer/container-duty rows SHALL not cite the general excise table they do not appear on
