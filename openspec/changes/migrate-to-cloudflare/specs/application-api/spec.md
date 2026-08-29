# application-api Specification Delta

## ADDED Requirements

### Requirement: Workers runtime API hosting

The API SHALL run as a Cloudflare Worker (`apps/api-worker`) preserving the module-grouped endpoint surface, paths, DTO validation, and the unified error envelope exactly as served today by the NestJS application. The NestJS application SHALL remain buildable and runnable until cutover so dual-run parity can be measured; after cutover the Worker is the only served implementation.

#### Scenario: Contract parity on ported endpoints

- **WHEN** any ported endpoint receives the same request as its NestJS predecessor
- **THEN** status code, response body shape, and error envelope match

#### Scenario: Dual-run parity

- **WHEN** sampled traffic is replayed against both implementations during the cutover window
- **THEN** calculator outputs agree on the sampled inputs

### Requirement: Durable Object sliding-window rate limiting

Rate limiting SHALL be enforced by a sliding-window Durable Object (`RateLimiterDO`) keyed by client identity derived from `CF-Connecting-IP`, preserving today's route limits and 429 semantics. `X-Forwarded-For` trust configuration SHALL be removed: Cloudflare's client IP header is authoritative.

#### Scenario: Shared limit across isolates

- **WHEN** requests arrive at different Worker isolates from the same client
- **THEN** the Durable Object enforces a single shared window for that client

### Requirement: Version-keyed idempotency on a Durable Object

Calculation idempotency SHALL be served by an `IdempotencyDO` preserving version-aware cache keys (tax, transport, and FX dataset versions remain part of the key). Entries SHALL invalidate when a dataset version changes, not on a timer.

#### Scenario: Dataset version change invalidates cache

- **WHEN** a tax dataset version changes
- **THEN** idempotent lookups for calculations computed under the previous version miss and recompute

## REMOVED Requirements

### Requirement: Redis-backed version-keyed cache

The Redis-backed idempotency cache implementation is removed. Its behavior survives as the version-keyed idempotency requirement backed by a Durable Object; Redis as a runtime dependency is fully retired by this change.

#### Scenario: No Redis dependency remains

- **WHEN** the Workers configuration is inspected
- **THEN** no Redis binding, connection string, or client library remains in any deployed component

### Requirement: Redis-backed rate limiting

The Redis sliding-window limiter (Lua script) implementation is removed. Its behavior survives as the Durable Object sliding-window rate-limiting requirement, which is exact rather than approximated.

#### Scenario: No Redis limiter remains

- **WHEN** rate limiting is exercised on the Worker
- **THEN** enforcement flows through `RateLimiterDO` with no Redis in the path
