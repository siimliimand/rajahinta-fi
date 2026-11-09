# Spec Delta

## ADDED Requirements

### Requirement: Cache-compatible request correlation

Frontend server-side fetches with a positive revalidation window SHALL propagate W3C trace context without requiring a frontend-generated `x-request-id` before cache lookup. When an origin API request arrives without `x-request-id`, the API Worker SHALL generate a valid UUID, echo it in the response, and include it in structured request logs. Non-cacheable requests SHALL retain their existing frontend-generated request-ID behavior, and explicit caller-supplied request IDs SHALL pass through unchanged.

#### Scenario: Cacheable origin request remains correlated

- **WHEN** a positive-revalidation frontend fetch misses the cache and reaches the API Worker without a frontend-generated `x-request-id`
- **THEN** the request carries `traceparent`, and the API Worker generates and echoes a UUID request ID in its response and structured logs

#### Scenario: Non-cacheable behavior is unchanged

- **WHEN** the frontend makes a request without a positive revalidation window and without an explicit request ID
- **THEN** the frontend continues to generate and send a UUID `x-request-id`

#### Scenario: Explicit request IDs pass through

- **WHEN** a caller supplies an explicit request ID on a cacheable or non-cacheable request
- **THEN** that ID is preserved, and the API Worker echoes the same valid ID

#### Scenario: Service-binding behavior remains unchanged

- **WHEN** a public catalog read uses the `API_WORKER` service binding
- **THEN** its existing request-ID and trace-header behavior remains intact because that path does not use the Next fetch cache
