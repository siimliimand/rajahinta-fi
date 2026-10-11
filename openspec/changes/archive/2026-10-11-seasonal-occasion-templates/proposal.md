# Seasonal occasion templates

## Why

The event calculator's occasion templates (spec: "wedding, birthday, company party, graduation among them") cover generic Anglo occasions but none of the Finnish seasonal moments when the "mitä juomia tarvitaan N hengelle" question actually peaks: vappu, juhannus, the rapujuhlat season, and talkoot. The consumption-norms machinery is live in production (standard-drink-fi dataset behind the manual publish gate), and the group-order ledger is live and accounting-only — but there is no path from the event estimate into a group order today, and occasion selection is not URL-addressable, so seasonal campaigns cannot deep-link.

Idea intake (#28 JuhannusSplit, #39 SnapsiSync, #23 TalkooTab) collapses into this change as template + dataset + handoff work over existing rails; no new product surface.

## What Changes

### Seasonal norm profiles (versioned dataset)

- Additive consumption-norm rows for juhannus, vappu, rapujuhlat, and talkoot as a new versioned dataset with per-row derivation citations, seeded through the established `PENDING_CONFIRMATION` guard and published only by the operator through the existing manual gate. Publication is an owner act; the change ships the machinery, the runbook notes the publication step.

### Occasion templates + shareable deep links

- Frontend occasion templates for the same four occasions (guest count, duration, drink-mix assumptions; editable on apply per the existing template contract).
- Occasion selection becomes URL-addressable (`/event?occasion=<slug>`): templates become shareable and campaign-linkable. Unknown slug values are ignored (default state), never an error.

### Event → group-order handoff

- The event result gains a "Jaa kustannukset" handoff action that opens the group-order creation flow with the estimated item list prefilled as **names and quantities only**. No prices, no payment-adjacent fields — the accounting-only boundary is untouched and pinned by test; prefill rows are ordinary editable ledger items.

### Follow-up content (operator acts, not code)

- Seasonal guide posts (guides-hub machinery exists) and a seasonal landing cadence are operator follow-ups recorded in the change notes.

## Non-goals (this change)

- No new norm-calculation logic — estimates derive from the existing profile machinery.
- No price or payment fields in the handoff; no settlement features (group order stays accounting-only by design).
- No project/task-tracking features (TalkooTab's task lists are out of scope — rajahinta is not a project tracker); no drinking-song booklets or gamification (SnapsiSync fluff is out of scope).
- No calendar/scheduling; no new routes beyond the occasion query parameter.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `event-calculator`: seasonal occasions join the templates requirement (values stay editable, estimates derive from inputs); occasion selection is URL-addressable with unknown-slug tolerance; result gains the estimate handoff action.
- `group-order-ledger`: create accepts an optional estimate-derived prefill (names + quantities only); the accounting-only boundary and its payment-field rejection are unchanged and pinned.

## Impact

- `packages/data-platform` (norm-profile seed rows + tests), `packages/core-domain` (`eventcalc` profile constants), `apps/frontend` (event templates, URL state, result CTA, group-order create intake), `apps/api-worker` (accounting-only pin test if the prefill path touches the create contract).
- Data: one new versioned norms dataset pending operator publication (no schema migration — additive rows through the existing seed path).
- Timing: ships ahead of vappu (Apr 30) and juhannus (midsummer eve, Jun 25) 2027 with comfortable lead; rapujuhlat profiles land for the July–August season.
