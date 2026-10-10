# Seasonal occasion templates — Tasks

> Dataset tasks (1.x) gate everything consumer-visible: templates and handoff render nothing useful until the operator publishes the norms dataset (4.1). Frontend event tasks (2.1/2.2) share the event directory and run sequentially via `touches`; the handoff (3.1) touches both the event and group-order surfaces. The accounting-only pin (3.2) lands with the handoff, not after.

## 1. Norm profiles (dataset + domain)

- [x] 1.1 Seasonal consumption-norm profiles (juhannus, vappu, rapujuhlat, talkoot) as a new versioned dataset with per-row derivation citations; extend `consumption-norms.seed.ts` (byte-deterministic, `PENDING_CONFIRMATION` guard preserved) + seed tests (parity, immutability on re-apply) <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/seed/consumption-norms.seed.ts, packages/data-platform/src/seed/__tests__/**] -->
- [x] 1.2 Wire the seasonal profile constants in `packages/core-domain/src/eventcalc` (profile keys resolve against published norm rows only; unpublished → existing `NO_PUBLISHED_NORMS` contract) + module tests <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/core-domain/src/eventcalc/**] -->

## 2. Templates + deep links

> Discovered during 1.2 (recorded per the fluid-workflow rule): the api-worker event-calc route DTO validates `eventProfile` against its own local 3-value const — task 2.1 includes widening it to the seasonal slugs, or every seasonal template selection 400s at the API.

- [ ] 2.1 Occasion templates in `apps/frontend/src/app/[locale]/event/templates.ts` (guest count, duration, drink-mix; editable-on-apply contract) + `EventForm` wiring + component tests <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [apps/frontend/src/app/[locale]/event/templates.ts, apps/frontend/src/app/[locale]/event/components/EventForm.tsx, apps/frontend/src/app/[locale]/event/templates.test.tsx] -->
- [ ] 2.2 URL-addressable occasion selection (`/event?occasion=<slug>`; unknown slug → default state, no error surface) + FI/EN message copy through content lint + tests <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [apps/frontend/src/app/[locale]/event/**] -->

## 3. Event → group-order handoff

- [ ] 3.1 "Jaa kustannukset" handoff action on the event result (renders only with a completed estimate) → group-order create-view intake of names + quantities as ordinary editable rows + tests on both surfaces <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [apps/frontend/src/app/[locale]/event/**, apps/frontend/src/app/[locale]/group-order/create-view.tsx, apps/frontend/src/app/[locale]/group-order/page.tsx] -->
- [ ] 3.2 Pin the accounting-only boundary across the prefill path: payment-instrument fields rejected at the DTO with the field named; handoff payload asserted names+quantities-only <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [tests/compliance/group-order-accounting-only.test.ts] -->

## 4. Operator publication (owner-gated)

- [ ] 4.1 Publish the seasonal norms dataset via the operator path (ops console or owner-directed direct-D1 per seed doctrine); verify profiles answer live and record the executed procedure + seasonal-guide content follow-ups in notes <!-- agent: devops-engineer.fast, depends_on: [1.2, 2.1], touches: [openspec/changes/seasonal-occasion-templates/notes.md] -->

## 5. Verification

- [ ] 5.1 Full verification: typecheck, lint, content lint, unit suites, D1 suites, compliance green; deep-link + handoff journey verified end-to-end; notes record evidence and the vappu/juhannus 2027 campaign checklist <!-- agent: platform-engineer.fast, depends_on: [2.2, 3.2, 4.1], touches: [openspec/changes/seasonal-occasion-templates/notes.md] -->
