# web-application Delta

## ADDED Requirements

### Requirement: Internal cache-revalidation endpoint

The frontend worker SHALL expose `POST /api/internal/revalidate` that
revalidates the frontend data-cache tags from a fixed allowlist (`guides`,
`blog`) after verifying a shared-secret header in constant time. With no
secret configured the endpoint SHALL answer 503 (feature off). The endpoint
SHOULD answer 401 on a missing or wrong secret, 400 on a body without an
allowlisted tag, and 405 on non-POST methods, and SHALL NOT echo the
secret.

#### Scenario: Authenticated revalidation

- **WHEN** a POST carries the correct secret and an allowlisted tag
- **THEN** the corresponding data-cache tag is revalidated and the response
  names only the revalidated tags

#### Scenario: Wrong or missing secret

- **WHEN** the secret header is missing or wrong
- **THEN** the endpoint answers 401 and revalidates nothing

#### Scenario: Unconfigured secret

- **WHEN** no secret is configured on the worker
- **THEN** the endpoint answers 503 and revalidates nothing
