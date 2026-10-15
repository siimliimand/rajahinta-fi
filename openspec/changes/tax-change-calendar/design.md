# Design

## Context

The platform already versions Finnish excise rules in D1 (`taxRules` with `effectiveFrom`/`effectiveTo` and `versionLabel` v1.0-2024…v3.0-2026), gates new official datasets through an operator confirmation that generates FI/EN rate-change blog drafts, and sweeps product-scoped TAX_CHANGE alerts against rate-version publication events. What does not exist is a surface for the *rhythm* — when changes land during the year. Those rhythm facts (Alko's twice-yearly price lists, Verohallinto's year-end table publication, the 2027 government-decision window, Estonia's January excise step) are not tax rates and do not belong in `taxRules`; they are calendar data with provenance. The site is Finnish-default with an English locale, age-gates alcohol content, and enforces no-forecast language on hypothetical outputs (structural disclaimer constants in the what-if module) — this change inherits all three disciplines. See proposal.md — Why for motivation.

## Goals / Non-Goals

**Goals:**
- One sourced, closed-vocabulary event store that renders a year timeline and a next-change fact without annual code edits.
- Honest framing: confirmed changes vs annual rhythm, structurally separated in data and copy.
- Reuse house conventions end to end: Drizzle migration flow, domain port + repository, Hono route shape (zod DTO, age gate, rate limit, error envelope), next-intl locale routing, ops guard + audit.

**Non-Goals:**
- Deriving FI events automatically from rate-dataset confirmations (deferred follow-up).
- Geographic/border visualizations; alert subscriptions on calendar events.
- Any change to excise math, ranking, or commercial inputs.

## Decisions

- **New `calendarEvents` table instead of extending `taxRules`.** Rhythm facts have different cardinality, different locales of truth (alko.fi, vero.fi, maksu- ja tolliamet), and can exist before any rate is known (the 2027 decision window). Alternative rejected: shoe-horning EXPECTED rows into `taxRules` would corrupt the gap/overlap-validated rate timeline the excise engine depends on.
- **Status `CONFIRMED | EXPECTED` + precision split (`occurrenceDate` vs `expectedWindow`) instead of a single date column.** Makes the honest-framing requirement representable in data: rendering cannot invent precision the row does not carry. Alternative rejected: a free-form date string — untestable precision.
- **Closed event-type set in the schema layer, validated at the persistence boundary** (same contract style as alert kinds and canonical categories): unknown types get a contract-level 400 naming valid values.
- **Pure `calendar` module in core-domain** (ordering, next-event selection, disclaimer constants) mirroring `whatif`/`digest` module conventions: deterministic, unit-tested, no persistence. Next-event rule: nearest period wins; within the same period, CONFIRMED day precision beats EXPECTED window; ties break by type then id.
- **Seed + ops CRUD instead of automation in V1.** The dataset-confirmation flow stays untouched; wiring an auto-created `FI_EXCISE_CHANGE` on confirmation is a deliberate follow-up so this change ships without touching the confirmation path. Ops path is create/update only — no delete, so public URLs never dangle mid-year.
- **Disclaimer as versioned FI/EN constant pair selected by explicit language** (default `fi`), composed nowhere at request time — the exact discipline the what-if spec mandates, reused here so the two surfaces read consistently.
- **Facts verified before seed (task 1.1).** The proposal's dates and figures come from the requester's source list; the implementer re-verifies against vero.fi, alko.fi, and the Estonian Tax and Customs Board and records exact dates + URLs before any seed row is written. Source URL is NOT NULL — no unsourced rows can exist.

## Risks / Trade-offs

- [Alko's exact price-list dates are not stable public facts year to year] → Seed them as EXPECTED window rows unless a dated official announcement is found; the ops path upgrades them to CONFIRMED when announced.
- [2027 mechanism wording ("confirmed by decision") could shift with legislation] → The RATE_DECISION event is seeded EXPECTED with quarter precision and a source URL; updating it is an ops edit, not a deploy.
- [Homepage widget adds a per-request dependency] → The next-event read is a single indexed query on a tiny table; render it with the page's existing data-fetch pattern and cache semantics rather than adding client-side calls.
- [Near-duplicate capability name risk (`price-alerts` TAX_CHANGE vs this calendar)] → Tax-change *alerts* remain product-scoped; the calendar exposes no subscription surface in this change, so no contract overlap.

## Migration Plan

1. Committed Drizzle migration adds `calendarEvents` (additive; no existing table touched).
2. Seed inserts the 2026 set; deploy staging; smoke `/veromuutokset`, `/api/v1/calendar/next`, homepage widget, ops create+audit.
3. Rollback is a revert deploy: the new table and routes are inert to existing flows.

## Open Questions

- Final FI slugs for the two Alko events in 2026 (spring/autumn exact windows) — resolved by task 1.1 source verification before the seed is written; does not affect the contract.
