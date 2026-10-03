# product-normalization Specification

## ADDED Requirements

### Requirement: Alko reference linking

The system SHALL provide an operator-driven matching pass that links foreign products to their Alko domestic equivalents as explicit product reference links, so that cross-merchant comparisons (the savings surface) can pair a foreign offer with the Alko reference price. Candidate retrieval SHALL block on canonical category, alcohol-by-volume, and unit volume (with bounded tolerance windows) before fuzzy scoring on name, brand, volume, and ABV; scoring SHALL reuse the deterministic-then-fuzzy matcher with its confidence grades. Every scored candidate SHALL be routed to the manual-review queue with both sides' identity fields visible for review; the pass SHALL NOT create a CONFIRMED link autonomously, and only an operator confirm through the guarded operator console (authenticated, attributed, audited) SHALL promote a queued candidate to CONFIRMED. The pass SHALL be idempotent per candidate pair: re-runs SHALL refresh PENDING queue entries in place and SHALL never modify CONFIRMED or REJECTED decisions. Statistics SHALL be reportable without writing.

#### Scenario: Blocked candidates scored and queued

- **WHEN** the matching pass evaluates a foreign product against the Alko side
- **THEN** only products within the category and numeric tolerance windows are scored, and the best candidates land in the review queue with confidence, method, score, and both sides' names

#### Scenario: No autonomous publication

- **WHEN** the pass completes
- **THEN** no product reference link is in CONFIRMED status as a result of the pass alone

#### Scenario: Operator confirms a link

- **WHEN** an operator confirms a queued candidate through the operator console
- **THEN** the link becomes CONFIRMED with the operator attribution and time, and the savings surface may pair the two products

#### Scenario: Re-run preserves decisions

- **WHEN** the matching pass re-runs over already-reviewed candidates
- **THEN** PENDING entries are refreshed in place, CONFIRMED and REJECTED decisions are untouched, and no duplicate queue entries exist
