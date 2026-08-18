# Phase 1 Remediation

## Why

Phase 1 code compiles, typechecks, and passes 734 tests across six packages, but an audit against the Phase 1 task list found that several tasks marked complete are only half-implemented. The most serious gap is the launch gate: `LaunchGateService`, `LaunchGateGuard`, and the `@LaunchGate` decorator all exist and are exported, yet no controller applies them. Alcohol price data and landed-cost calculations are therefore publicly reachable regardless of the flag, which defeats the entire pre-launch gating requirement. Other gaps: the correction mechanism has no API surface, the age gate is never enforced server-side, the rate-review check is a hardcoded mock, caching is in-memory only, billing is a stub, the account API exposes only data export, and the load test never exercises the HTTP endpoint.

## What Changes

1. Wire the launch gate onto the calculation and price-data endpoints so alcohol features are non-public until the legal opinion, tax-source mapping, and correction mechanism are confirmed.
2. Expose the correction mechanism through an API so users and internal staff can flag a calculation or data point and track its review.
3. Enforce the age gate server-side on alcohol-content endpoints, keeping landing and comparison pages public per the business plan.
4. Put the rate-review check on a real recurring job and replace the hardcoded "no new rates" mock with a real source check or an explicitly documented decision.
5. Replace the in-memory idempotency cache with a Redis-backed store keyed by dataset versions.
6. Record an explicit Phase 2 deferral for third-party subscription billing and keep the billing interface stable.
7. Expose saved-baskets, calculation-history, and subscription-status account endpoints.
8. Make the load test exercise the HTTP calculation endpoint, or document its orchestrator-only scope.
9. Resync `docs/tasks.md` and `ARCHITECTURE.md` to the true implementation state.
10. Correct the exception types thrown by the calculator controller's input validation.

## Capabilities

### New Capabilities

None — this change modifies existing Phase 1 capabilities; it introduces no new domain.

### Modified Capabilities

- `compliance-governance`: the launch gate is now enforced on endpoints, not merely defined.
- `correction-mechanism`: the flag/resolve flow is reachable via API.
- `accounts-age-gate`: the age gate is enforced server-side; account endpoints are exposed.
- `data-acquisition`: the rate review runs on a scheduled job rather than a stub.
- `application-api`: caching is Redis-backed and keyed by dataset versions; validation returns correct 4xx responses.
- `subscription-billing`: third-party billing is explicitly deferred to Phase 2.
- `mvp-testing`: the load test exercises the HTTP endpoint or documents its scope.

## Impact

- Closes the launch-gate compliance hole before any public exposure of alcohol data.
- Makes the correction mechanism usable, which is a stated launch condition.
- Changes the API surface (new correction and account endpoints, new age-gate enforcement on existing endpoints).
- Adds a Redis dependency to the idempotency/caching path (infrastructure already provisioned in `docker-compose.yml`).
- Does not change tax math, classification, ranking neutrality, or the declaration assistant's read-only contract.
- Legal review tasks remain external and unchanged; the launch flag stays off until they complete.

## Human-Process Tasks

None new. The pre-launch legal review (Phase 1 tasks 16.1–16.5) remains the gate that must complete before the launch flag is turned on.
