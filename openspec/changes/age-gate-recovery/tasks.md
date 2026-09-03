# Tasks: Age Gate Recovery

## 1. Backend error contract

- [x] 1.1 Add machine-readable `code: "AGE_GATE_REQUIRED"` / `"AGE_VERIFICATION_FAILED"` to the Hono age-gate middleware 403 payloads (object body passes through `ApiHttpError` unchanged) and update the middleware tests to assert the code <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/api-worker/src/middleware/age-gate.ts, apps/api-worker/src/middleware/__tests__/age-gate.test.ts] -->
- [x] 1.2 Mirror the same code fields in the NestJS `AgeGateGuard` 403s (`ForbiddenException` object body) and update the guard tests for Nest-parity <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/age-gate/age-gate.guard.ts, packages/application-api/src/age-gate/__tests__/age-gate.guard.test.ts] -->
- [x] 1.3 Extend the guard regression tests (calculator, historical) to assert the rejection body carries the machine-readable code <!-- agent: platform-engineer.fast, depends_on: [1.1, 1.2], touches: [packages/application-api/src/calculator/__tests__/calculator-guard-regression.test.ts] -->

## 2. Cookie as single source of truth

- [x] 2.1 Rewrite `AgeGate` state to derive confirmation solely from the `age_confirmed` cookie; introduce `AGE_CONFIRMATION_TTL_DAYS = 90` written into the cookie `max-age`; stop reading localStorage for the gate decision and remove the stale legacy key on mount; keep the decline flow clearing the cookie before the declined redirect <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/app/[locale]/components/AgeGate.tsx] -->
- [x] 2.2 Update the AgeGate tests: expired/missing cookie → prompt renders; confirm → cookie set with the 90-day TTL; deny → cookie cleared and declined redirect; stale legacy localStorage key ignored and removed; SSR placeholder behavior unchanged <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [apps/frontend/src/app/[locale]/components/AgeGate.test.tsx] -->

## 3. In-place recovery path

- [x] 3.1 Add optional `code` to the `ApiError` type; in the shared request path, on a 403 whose body code is `AGE_GATE_REQUIRED`, dispatch a window `age-gate:required` CustomEvent before throwing `ApiFetchError`; unit-test the dispatch (and that other 403s do not dispatch) <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/lib/types.ts, apps/frontend/src/lib/api.ts] -->
- [x] 3.2 Make `AgeGate` subscribe to the `age-gate:required` event and open the prompt in place (verified=false); confirming closes it and sets the cookie; test by dispatching the event with the gate verified <!-- agent: platform-engineer.build, depends_on: [2.1, 3.1], touches: [apps/frontend/src/app/[locale]/components/AgeGate.tsx, apps/frontend/src/app/[locale]/components/AgeGate.test.tsx] -->
- [x] 3.3 Add localized age-gate recovery strings (error title, description, recovery hint) to the message catalogs <!-- agent: platform-engineer.fast, depends_on: [], touches: [apps/frontend/src/messages/en.json, apps/frontend/src/messages/fi.json] -->
- [x] 3.4 In the calculator page error surface, map an age-gate 403 (detected via body code) to the localized recovery copy through `ErrorState` instead of the raw backend message; test the mapping <!-- agent: platform-engineer.build, depends_on: [3.1, 3.3], touches: [apps/frontend/src/app/[locale]/calculator/page.tsx, apps/frontend/src/app/[locale]/calculator/page.test.tsx] -->

## 4. Verification

- [ ] 4.1 Run typecheck, lint, the age-gate and calculator test suites, and the frontend build; fix any fallout <!-- agent: platform-engineer.fast, depends_on: [1.3, 2.2, 3.2, 3.4], touches: [] -->
- [ ] 4.2 Verify the staging flow end-to-end: confirm the prompt reappears when the cookie is absent (legacy localStorage-only state), force an age-gate 403 mid-session and confirm the modal opens in place, then confirm and retry the search successfully <!-- agent: platform-engineer.fast, depends_on: [4.1], touches: [] -->
