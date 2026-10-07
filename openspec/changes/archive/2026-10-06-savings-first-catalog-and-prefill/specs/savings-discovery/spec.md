# savings-discovery Delta

## ADDED Requirements

### Requirement: Best deal per merchant listing

`GET /api/v1/savings/best-per-merchant` SHALL return, for the latest
materialized savings day, one row per cross-border merchant: that merchant's
observed row with the largest absolute gap in cents, ties broken by product id
ascending. Merchant `alko` SHALL be excluded (the domestic reference is not a
deal provider). Each row SHALL carry the same provenance fields as the savings
listing (product, category, merchant, merchant country, observed price,
landed total, Alko reference, gap in cents and basis points, reliability,
confidence, tax dataset version) plus the `asOf` day. The endpoint SHALL be
read-only and deterministic — the same D1 state yields a byte-identical body —
behind the same age gate and rate limiter as the savings listing. While no day
has materialized, it SHALL return 200 with an empty list and a null `asOf`
(the honest zero state). A newly onboarded merchant SHALL appear
automatically once its rows materialize; no registration or editorial step
exists.

#### Scenario: One row per cross-border merchant, biggest gap first provenance

- **WHEN** the latest day holds rows for alks, longero, kippis, and mydrink
- **THEN** the response lists exactly one row per merchant — that merchant's largest-|gap| row — and excludes alko

#### Scenario: Deterministic tie-break

- **WHEN** one merchant's two rows share the same absolute gap
- **THEN** the row with the lower product id is returned, and repeated requests return a byte-identical body

#### Scenario: Honest empty state before first materialization

- **WHEN** no savings day has been materialized
- **THEN** the endpoint responds 200 with an empty list and null asOf — never an error

#### Scenario: New merchant joins without an editorial step

- **WHEN** a newly onboarded merchant's offers materialize into the latest day
- **THEN** the merchant's best deal appears in the listing on the next read
