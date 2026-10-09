# Spec Delta

## ADDED Requirements

### Requirement: Curated carrier rate fidelity

A curated carrier dataset SHALL transcribe every published price verbatim
from the carrier's own price page — never reconstructed from an inferred
formula — and each row SHALL trace to a source page and a dataset-level
observation timestamp set to the transcription date, so the freshness
threshold measures the data's age, not the refresh's. When a carrier prices
a transport tier by destination sub-zone (postal-code zone) and the transport
offer model has no zone dimension, the transcription SHALL use the most
expensive offered zone so the stored price is conservative, never optimistic,
for any destination within the route. A curated dataset refresh SHALL diff
the new transcription against the incumbent dataset and SHALL NOT append
rows when no published price has changed, keeping the append-only offer
history free of no-op generations.

#### Scenario: Zone-priced pallet transcribes at worst-case zone

- **WHEN** a carrier publishes one pallet price table per FI postal-code zone and the dataset is transcribed
- **THEN** each weight bracket is stored once at the most expensive zone's price, and no zone column or per-zone row duplication is introduced

#### Scenario: Observation timestamp reflects the source

- **WHEN** a dataset is first transcribed or later repriced
- **THEN** the dataset's observation constant is set to that transcription date, and the appended offer rows carry it as `observed_at` regardless of when the refresh cron runs

#### Scenario: Unchanged re-transcription appends nothing

- **WHEN** a refresh re-transcribes a carrier's price page and every price equals the incumbent dataset
- **THEN** the refresh skips the carrier for that cycle and no new rows are appended
