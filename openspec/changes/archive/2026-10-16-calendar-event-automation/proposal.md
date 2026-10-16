# Calendar event automation

## Why

The tax-change calendar's value is its recurring rhythm, but V1 is maintained entirely by hand: every year a human must remember to add next year's event rows, upgrade EXPECTED windows to CONFIRMED dates, and watch the sources for announcements. The platform already has an automated detector for official excise rates (the daily 02:00 tax-dataset-review cron → manual operator confirmation) and an audited ops console — the calendar is simply not wired into them. This change automates the mechanical parts of calendar maintenance while keeping a human at the only point where a fact enters the system.

## What Changes

- **Layer 1 — rhythm skeleton:** a January cron auto-creates the next year's two `ALKO_PRICE_LIST` EXPECTED rows (expected windows `YYYY-03` and `YYYY-09`, per Alko's official late-March/late-September rhythm statement) — idempotent, skip-if-present; the rows are rhythm + disclaimer by status and never assert a fact.
- **Layer 2 — confirmation-gate fan-out:** confirming a rate-dataset version whose effective year is new auto-creates the `CONFIRMED` `FI_EXCISE_CHANGE` event (effective 1.1 of that year) from the same dataset diff the blog-draft builder already computes — fail-open (a failure never blocks the confirmation), idempotent, audited. `TAX_TABLE_PUBLICATION` and `RATE_DECISION` windows are deliberately NOT guessed from a single observation (2026's table was published in August, not at year end).
- **Layer 3 — source watcher:** a daily cron polls the source feeds verified in task 1.1, normalizes items into PENDING candidates in a new `calendarEventCandidates` table (URL-deduplicated, never public), and the ops console gains a review queue: accept (creates the event through the persistence validator) or reject (kept for dedup) — every action audited behind OpsAccessGuard.

## Capabilities

### New Capabilities
- `calendar-event-automation`: automatic rhythm-skeleton generation, automatic FI event creation at the manual rate-confirmation gate (fail-open), and the candidate detection → ops review → publish pipeline for source announcements.

### Modified Capabilities

## Impact

- `packages/core-domain`: calendar module gains the pure skeleton generator and the candidate state machine.
- `packages/data-platform`: new `calendarEventCandidates` table + migration + validator + repository.
- `apps/api-worker`: two new cron triggers in `wrangler.jsonc` (January skeleton, daily watcher), the confirmation-handler extension, and ops candidate routes.
- `apps/frontend`: ops console candidates section.
- Public contracts are unchanged: the calendar page, homepage widget, and public API respond only to `calendarEvents` rows exactly as before — automation changes how rows arrive, not how they are served.

## Non-goals

- Auto-publishing CONFIRMED facts without human confirmation (a candidate never becomes public without operator acceptance).
- LLM-assisted article extraction (possible later; the watcher stores link + title + date only).
- Automating Estonian excise events (no verified machine-readable feed in task 1.1's scope — stays manual via the ops console).
- Any change to the calendar page, widget, public API contracts, or excise math.
