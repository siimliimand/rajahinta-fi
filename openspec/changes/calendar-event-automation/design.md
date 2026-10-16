# Design

## Context

The tax-change calendar (archived change `tax-change-calendar`) is live on production but hand-maintained: rows arrive via the ops console only. The platform already runs a daily tax-dataset-review cron that detects newly published official rates and queues them for operator confirmation, an audited ops console with several review-queue precedents (match review, correction queue), and polite crawler infrastructure (sitemap-crawl adapter culture). The calendar simply was never wired into any of it. See proposal.md — Why.

## Goals / Non-Goals

**Goals:**
- Next year's rhythm skeleton (Alko pair) exists without anyone remembering to create it.
- A confirmed rate dataset produces its calendar event with zero extra operator work, using the exact diff already computed for blog drafts.
- Source announcements surface as review candidates in the ops console instead of requiring someone to watch vero.fi.

**Non-Goals:**
- Auto-publishing CONFIRMED facts without operator acceptance; LLM extraction; EE automation; any public-contract change.

## Decisions

- **Layer 1 covers only the Alko pair.** Alko's twice-yearly rhythm is an official, stable statement ("maalis- ja syyskuun loppuun"), so EXPECTED windows `YYYY-03`/`YYYY-09` are safe to generate. `TAX_TABLE_PUBLICATION`/`RATE_DECISION` windows are NOT generated: the verified 2026 pattern (publication in August, not year end) shows a single observation cannot define the rhythm, and a fabricated window would be a disguised claim. FI table events arrive through Layer 2, which keys off the existing daily detector.
- **Layer 2 reuses the content module's dataset diff** (the computation behind the rate-change blog drafts) as the single source of "what changed" — no second diff implementation to drift. The fan-out mirrors the blog-draft contract exactly: created at the manual confirmation gate, fail-open, idempotent, audited. Trigger condition: the confirmed dataset's effective year has no FI_EXCISE_CHANGE event yet.
- **Candidates live in their own `calendarEventCandidates` table**, not as statuses on `calendarEvents` — the public table stays free of internal workflow state, and the public API contract (serves only events) is untouched. URL is UNIQUE: dedup is structural, so a re-seen announcement can never re-enter the queue.
- **Accept goes through the existing persistence-boundary validator** — a candidate cannot become an event that the calendar contract would reject. Accept maps candidate → event fields chosen by the operator in the console form (type, status CONFIRMED/EXPECTED, date or window); the watcher only ever proposes link/title/date.
- **Watcher politeness mirrors the sitemap-crawl adapter culture**: daily schedule, bounded per-run item count, documented UA, failures collected and counted, never raised. Feed set comes from task 1.1's verified-feeds note — a source without a machine-readable feed is out of scope, not scraped ad hoc.
- **Cron placement**: `wrangler.jsonc` crons are UTC-only (existing header note); the skeleton cron runs `0 0 1 1 *` (1 Jan 00:00 UTC — Helsinki is 02:00 local, harmless), the watcher daily off-peak.

## Risks / Trade-offs

- [Feed availability is unverified until task 1.1] → Layer 3 degrades gracefully: sources without feeds drop out of scope, and the change stays valuable with Layers 1–2 alone; the spec's watcher requirements are conditioned on verified feeds.
- [Watcher noise: press releases that are not calendar-relevant] → Candidates are invisible publicly and cheap to reject; rejection is retained for dedup so the same noise never returns.
- [Confirmation fan-out doubles the surface that must stay idempotent] → Skip-if-present keyed on (year, event type) + re-confirmation no-op is pinned by route tests, mirroring the blog-draft idempotency tests.
- [A January cron misses if staging/production is down at 00:00 UTC] → Generation is idempotent and re-runnable; the ops console can also generate the skeleton manually if a run is missed (same pure generator exposed through the section).

## Migration Plan

1. Committed Drizzle migration adds `calendarEventCandidates` (additive).
2. Deploy staging (workflows order: migrations → seed → workers → frontend build) — the new crons register with the Worker deploy.
3. Verify: skeleton path on staging, watcher run against live feeds, ops accept/reject, public visibility of the accepted event.
4. Rollback is a revert deploy: new table and crons are inert to existing flows; PENDING rows are disposable.

## Open Questions

- Exact feed URLs and formats — resolved by task 1.1 before the watcher is built; if no source offers a machine-readable feed, Layer 3 is dropped and its spec requirements recorded as not-implemented-by-this-change.
