# Ratify operator decisions

## Why

Two items in the launch-ops backlog have been waiting on an explicit operator call, and their "pending operator input" language implies open work where a decision has now been made:

1. **Anonymous calculation-record retention window** — the configured 30-day window is ratified as final. Verified before deciding: the retention sweep prunes anonymous-session rows only (`packages/data-platform/src/maintenance/calculation-record-retention.service.ts`), while the 60-day outcome-reporting window applies to account-owned records this worker never touches. The two windows are disjoint, so ratifying the value creates no spec tension — and the spec deliberately requires only "the configured retention window" (`openspec/specs/application-api/spec.md:168`), making the value a pure ops ratification.
2. **Viking Line ferry prices** — the designed empty state (zero rows; the onboard shop is bot-gated by Imperva/Distil and no price was reachable without circumvention, which the project never does) is accepted for now. The curation recipe is already proven on this dataset (tallink/eckero: runbook transcription + `MANUAL_VERIFICATION` grant), so "later" only needs a recorded trigger and path, not new design.

Both decisions were made in an explore session on 2026-10-11. This change records them where the open questions live so the docs stop advertising undecided items.

## What Changes

- **ARCHITECTURE.md** — §15: the anonymous-record retention line is marked ratified (30 days, decided 2026-10-11); the "final value is pending operator input" clause is removed. §16 status line: the viking follow-up is reworded from "pending operator input" to "gap accepted, revisit trigger recorded".
- **docs/ingestion-runbook.md** (ferry section) — a viking decision note: gap accepted 2026-10-11; revisit trigger = user demand for viking comparisons; curation path = the existing §10 transcription procedure plus a `MANUAL_VERIFICATION` grant for the `viking` operator key.
- **packages/data-acquisition/src/adapters/ferry-price.source.ts** — the module docblock gains a one-line decision pointer (comment only; zero behavior change).

## Impact

- Docs/comment-only. No code paths, no schemas, **no spec deltas** — both decisions conform to the specs as written: `application-api` requires pruning past "the configured retention window" (value-agnostic by design), and the `data-acquisition` spec carries no viking language at all.
- Affected: `ARCHITECTURE.md`, `docs/ingestion-runbook.md`, `packages/data-acquisition/src/adapters/ferry-price.source.ts`.
