# application-api Specification

## ADDED Requirements

### Requirement: Interactive-use rate limits

The `CALCULATOR` and `BASKET` rate-limit profiles SHALL allow 60 requests per minute per client so normal interactive use (adjusting quantities, retrying calculations) does not hit 429s. The `AUTH` profile SHALL keep its stricter limit unchanged, and rejected requests SHALL continue to carry the 429 envelope with `Retry-After`. The Worker middleware and the legacy test-harness parity profiles SHALL agree.

#### Scenario: Normal interactive use completes without 429

- **WHEN** a client performs 55 calculator requests within one minute from one IP
- **THEN** no request is rejected for rate limiting

#### Scenario: Sixty-first request is rejected cleanly

- **WHEN** a 61st calculator request arrives within the same window from the same IP
- **THEN** it is rejected with 429, a `Retry-After` header, and the unified error envelope

#### Scenario: Auth surface keeps its strict profile

- **WHEN** the rate profiles are updated
- **THEN** register, login, and password-reset requests remain limited by the unchanged `AUTH` profile (10 per 5 minutes per IP)
