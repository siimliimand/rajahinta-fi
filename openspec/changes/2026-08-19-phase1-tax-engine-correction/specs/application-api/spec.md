## ADDED Requirements

### Requirement: Ranking methodology endpoint

The API SHALL expose the ranking methodology, generated from (or kept in lockstep with) the actual Ranking & Sorting Module implementation, so the documented methodology cannot drift from real behavior.

#### Scenario: Methodology served from API

- **WHEN** a client requests the ranking methodology
- **THEN** the endpoint SHALL return the lockstep-tested ranking descriptions
- **WHEN** the endpoint is intentionally not provided
- **THEN** the frontend SHALL NOT make a dead request for it, and SHALL use the embedded, lockstep-tested text
