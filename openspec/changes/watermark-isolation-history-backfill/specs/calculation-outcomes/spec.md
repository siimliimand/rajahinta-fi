# calculation-outcomes Delta

## MODIFIED Requirements

### Requirement: Catalog coverage block on the accuracy response

The public accuracy response SHALL carry an additive `coverage` block computed read-time from stored catalog state: the distinct product count, the total offer observation count, and the last ingestion watermark timestamp. The watermark value SHALL be read from the time-series aggregation job's own row (`job_name = 'time-series-aggregation'`), never from a table-wide aggregate over all `aggregation_watermarks` rows — rows belonging to other jobs (numeric cursors, non-ISO values) SHALL NOT influence the coverage watermark. The block SHALL contain only true stored values — no estimates, no seeded counters. The user-reported statistic's shape and semantics SHALL be unchanged; the coverage block is additive and display-only, and SHALL NOT feed the calculator, ranking, or any basket input. The rendering side SHALL treat a watermark that does not match the ISO-8601 instant shape as absent (no sync row), regardless of whether `Date.parse` accepts it.

#### Scenario: Coverage block present and true

- **WHEN** the accuracy endpoint is requested with zero stored outcomes
- **THEN** the response carries `count: 0` exactly as before, plus the coverage block whose values equal the corresponding D1 counts and the time-series aggregation job's watermark

#### Scenario: Non-ISO watermark rows cannot shadow the read

- **WHEN** `aggregation_watermarks` contains both an ISO watermark for `time-series-aggregation` and a lexicographically greater non-ISO row for another job (e.g. the savings cursor `"9194"`)
- **THEN** the coverage block's `lastIngestAt` equals the ISO watermark, and the rendered sync date is the real last-ingestion date

#### Scenario: Corrupt watermark renders no sync row

- **WHEN** the coverage watermark for the aggregation job is present but not ISO-8601-shaped
- **THEN** the trust-row and section renderings omit the sync row entirely and never render a fabricated date

#### Scenario: Additive, display-only

- **WHEN** the coverage block is added to the response
- **THEN** calculator, ranking, and basket responses remain byte-identical (compliance-pinned), and no coverage value feeds any calculation input
