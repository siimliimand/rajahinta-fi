# Design: savings-cron-cursor-chunking

## Context

The savings pass walks every qualifying product (direct Alko-referenced ∪
CONFIRMED-linked) in one invocation, paying ~1 D1 query per skipped product
and ~6–10 per qualifying product (calculator reads + the by-design
calculation-record write + the snapshot upsert). Empirically the invocation
budget dies after ≈4,850 walk steps on today's catalog shape (9,494
products; 07:30 UTC 2026-10-04 tail: continuous subrequest failures from
product 4852, no completion line). Everything after the death line fails
instantly — including ALL linked products, which v2 appends after the
direct set.

## Decisions

### D1 — Cursor in the generic watermark table, raw-SQL access

`aggregation_watermarks (job_name UNIQUE, watermark TEXT, updated_at)` is
already the repo's job-cursor pattern (time-series aggregation). The pass
reads/writes `job_name = 'savings-snapshot-cursor'` storing the last
processed product id as TEXT. Access is two raw prepared statements inside
the cron module (the module already owns raw SQL for
`findQualifyingProductIds`) rather than bending the Date-typed
`AggregationWatermarkRepository` abstract. Write-then-advance ordering
mirrors the watermark doctrine: persist the new cursor only after the
chunk's upserts are attempted (per-product isolation already absorbs
individual failures — a chunk with a failed product still advances, the
failed product retries on the next day-pass; advancing past a poisoned
product prevents an eternal stall).

Alternative rejected: a new migration/table — the generic table exists
precisely for job cursors; a second cursor table would be its shadow.

### D2 — One total order, bounded chunk, wrap-around

The combined deduplicated qualifying list (direct ∪ linked) sorts by
product id ASCENDING — one total order; the cursor is a plain high-water
mark; each tick processes the next CHUNK = 300 ids above the cursor;
when none remain the cursor resets to 0 and the next tick begins the
day's pass anew (rows re-written idempotently — converging no-op
semantics unchanged from v2).

Budget math (documented, empirical): today's death line ≈4,850 steps ⇒
the budget comfortably covers a 300-product chunk at today's qualifying
density (~14 %): ≈42 qualifying × ~8 + 258 skips × 1 ≈ 600 subrequests —
half the budget, 2× safety even if qualifying density doubles. Capacity:
48 ticks × 300 = 14,400 products/day vs 9,494 catalog — 52 % headroom;
the design notes the density-vs-chunk recalibration point if the
catalog's qualifying share grows.

Alternative rejected: batching the calculator per-product reads — deep
surgery across tax/transport/product ports for a fraction of the win;
chunking is structural and matches the sibling aggregation's protocol.

Alternative rejected: raising the chunk to fill the budget — the budget
is consumed per invocation non-deterministically (other handlers share
the cron invocation via waitUntil siblings); half-budget chunks stay safe
under load.

### D3 — Linked products in the same sorted list (structural fix)

The v2 appended-tail is the bug class: anything appended after a
long enumeration is unreachable when the budget dies mid-walk. Sorting the
combined list puts every product — direct or linked — at a cursor address
proportional to its id; confirmation makes a product materializable within
the first chunks. A product inserted below the cursor mid-day is picked up
when the cursor wraps (next day-pass) — documented, same as v2's
enumeration-per-pass semantics.

### D4 — Budget regression pin

A test walks a synthetic 5,000-product catalog through multiple simulated
invocations (chunk loop) and asserts EVERY invocation's D1 statement count
stays ≤ the empirical budget (pinned at 1,000 with the chunk's computed
ceiling documented). This is the test that would have caught the incident:
v2's single-invocation full walk fails it by construction.

### D5 — Observability

The per-tick log line gains the chunk window and cursor position
(`chunk [cursor+1..cursor+N] of M qualifying; rows written X, skipped Y,
failed Z`) so budget death or stall is visible in tail/Grafana without
forensics. The existing per-product isolation, run-result counters shape,
and no-watermark-for-same-day convergence contract are preserved.

## Risks

- **Catalog growth beyond daily capacity** (14,400): recalibrate CHUNK
  upward (the budget math in D2 documents the 2× margin) or move the pass
  to a Queue/DO — noted as follow-up, not needed at 9,494.
- **Two ticks overlapping** (a pass running past 30 min): both process
  adjacent chunks from the same cursor — worst case one chunk is processed
  twice (idempotent) or skipped until the next wrap (next day). Accepted;
  same convergence argument as v2's same-day re-runs.
- **Watermark row absent** (first run): cursor defaults to 0 — a fresh
  pass. Same semantics as today's no-watermark start.
