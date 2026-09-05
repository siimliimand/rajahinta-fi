# Design: Product Roadmap, Phases 1–4

## Context

The runtime is the Cloudflare Workers composition: Hono API Worker with D1 (Drizzle `sqliteTable` schema in `packages/data-platform/src/d1/schema.ts`), R2 observation log, Durable Objects, Cron/Queues/Workflows, and the OpenNext frontend Worker. Background work runs off the request path. Every externally sourced fact carries a reliability status and timestamp. Tax, FX, and observation data are versioned or append-only. These properties are load-bearing for several roadmap features and the design leans on them instead of inventing parallel mechanisms.

## Decisions

### R1: €/g ethanol as a derived read-time metric, not a stored column
`eurPerGram` is computed by a pure function in `packages/core-domain/src/unitprice/` from offer price, `unitVolume`, and `alcoholByVolume` (ethanol density 789 g/l). It is never persisted: prices change per observation, and a stored column would go stale or duplicate truth. The function returns a status alongside the value: computed when both inputs are present, ESTIMATED when the offer price is not VERIFIED, and unavailable when alcohol percentage or volume is missing. Read APIs attach the metric with its status; the compare view sorts on it deterministically (value, then product id) and explains the formula in a tooltip consistent with the VERIFIED/ESTIMATED presentation.

### R2: Alerts as scheduled evaluation over materialized data
Alert evaluation is a cron handler triggered after ingestion cycles. It reads materialized summaries (never scans the raw R2 observation log), compares each active alert's threshold, applies a 24-hour per-product-per-account cooldown recorded on the notification row, and dispatches email through the existing email Worker path behind its shared-secret header. Every send writes an `alertNotifications` row first (intent log), so a crashed run can resume without double-sending: a send whose row is already marked delivered is skipped. Alert evaluation exposes counters (evaluated, matched, notified, failures) through the existing observability module.

### R3: Physical dimensions as governed reference data
`productDimensions` rows carry weight, height, diameter, and a packaging material enum (GLASS, CAN, PLASTIC, OTHER), each with source, reliability status, and observedAt, because dimensions are externally sourced facts. Absence of a row is a normal state: packing results flag the affected items ESTIMATED and omit them from breakage-risk reasoning rather than guessing. Initial data is curated manually; the operator console is the update path.

### R4: First-fit-decreasing is the intended packing heuristic
Bin packing does not need to be optimal here; a deterministic FFD pass over items sorted by decreasing height, then diameter, is explainable and stable, which matters more than the last few percent of fill rate. Box selection iterates the `carrierBoxTypes` seed per carrier and reports fill rate and per-box grouping. The glass-and-metal warning fires from explicit thresholds (mixed-material count or combined weight) so the warning is explainable and testable, not a heuristic vibe.

### R5: Consumption norms are a versioned dataset, not constants
Norms live in `consumptionNorms` rows keyed by drink type and event profile with an effective window, a cited source per row, and the PENDING_CONFIRMATION to PUBLISHED lifecycle reused from the FX dataset flow. Seeding requires citations; a row without a source cannot reach PUBLISHED. The calculator resolves the published version effective on the event date and attaches the version to the result so every output names the norms it used.

### R6: One event engine, two interfaces
The core module computes per-type consumption from guests, duration, and profile with minimal-surplus rounding to realistic retail units. The MVP page exposes the simple mode. V2 country sourcing reuses the existing landed-cost engines per candidate country and returns a plan (buy here, bring from there) under an optional budget, ordered deterministically by total cost. Packing recommendations, when requested, delegate to the R4 module.

### R7: Traveller allowances follow the tax-dataset discipline
`travellerAllowanceDatasets` with per-limit rows (category, volume or quantity cap, source citation, effective window) are append-only and never mutated; publication requires the same manual review gate as tax and FX datasets. The trip module resolves the dataset effective on the travel date and caps break-even volumes by the applicable limits. The disclaimer states these are indicative personal-use figures, not legal advice.

### R8: The affiliate slot is data, not ranking
`ferryOffers` is a curated table (operator, route label, url, status) managed through the operator console with audit. The trip API returns the block separately from the calculation result; the frontend renders it in a visually distinct container labeled as partner links. A compliance test asserts that calculation output is byte-identical whether or not affiliate rows exist. Click tracking reuses the existing outbound redirect controller.

### R9: Dupe links require evidence at the schema level
`producerLinks` NOT NULL evidence columns (producer key, manufacturer, source URL) plus reviewer and review date make an unevidenced row unrepresentable. The matching path is an exact lookup on normalized producer keys; no scoring, no similarity, no fuzzy path exists in the module. The curated seed (50 to 100 cases) loads via an import script that validates every source URL. The API and UI present the evidence with each sibling product.

### R10: Curated lists are operator-managed content
`curatedEntries` rows belong to a list slug, carry a mandatory rationale and evidence links, and move through draft/published states via the audited operator console, so content updates need no deploys. The public endpoint serves only published entries of a listed slug. Curation criteria are documented in docs/ and shown on the page, keeping the editorial standard explicit.

### R11: What-if is pure, ephemeral, and loudly hypothetical
The module substitutes a hypothetical excise rate into the existing excise math, recomputes the gap between Alko and import prices for selected products, and cites the baseline dataset version it started from. No scenario state is persisted server-side; sharing works by encoding inputs into an opaque token that the embed route decodes read-only. The result object carries a structural HYPOTHETICAL disclaimer field, and the UI wording avoids forecast language. The endpoint is rate-limited and anonymous.

### R12: Group order boundary enforced at three layers
Schema: no payment-adjacent columns exist. API: DTOs reject payment-instrument fields explicitly. Docs and UI: the ledger states that settlement happens outside the system and names common user-side methods only as examples. Allocation is proportional to item value share, with a documented deterministic remainder rule (largest fractional remainder receives the cent). The share token grants write access to one session and expires; sessions carry no personal data beyond participant nicknames.

### R13: Feature flags and rollout
Nine flags, one per feature, default off, declared in `apps/api-worker/wrangler.jsonc` and `infra/environments/*.yaml`, resolved by the existing flag middleware and inlined into the initial HTML payload so gated UI never appears late. Each feature's API and UI check the flag independently, allowing per-feature rollout and instant rollback.

### R14: Test posture
High-liability modules (unit price, packing, allocation, what-if, break-even) get pure-function unit tests with exact numeric expectations. Versioned datasets get lifecycle tests (no publish without confirmation, effective-date resolution). Alert evaluation gets idempotency and cooldown tests. The compliance suite gains the affiliate-neutrality and payment-boundary cases. Integration tests cover flag-off rejection and API validation. Golden-style fixtures use real engine implementations, not mocks.

## Risks

- Manual curation (dimensions, norms, allowances, producer links, list entries) is the schedule risk; every seed task is scoped to a validated import path so content work can continue after the code ships.
- The what-if simulator is politically sensitive; the structural disclaimer, neutral wording review, and shareable-widget framing mitigate misreading.
- Allowance figures drift with EU and national rules; effective-dated datasets plus the freshness alert pattern keep review obligations visible.

## Implementation decisions recorded during apply (group 2)

These were fixed while implementing the alert group; later work in the same area treats them as binding.

- **Threshold comparison is `<=`.** An evaluation matches when the observed price is at or below the threshold; equality triggers. A unit test pins the equality case.
- **The 24-hour cooldown is a half-open window.** A delivered notification suppresses re-sends while it is strictly younger than 24 hours; a row exactly 24 hours old has elapsed and re-notifies. Boundary tests pin 24h-1ms (suppressed) and exactly 24h (sent).
- **One alert per account and product.** `price_alerts` carries a unique constraint and a duplicate create is rejected with 409 (scenario added to the price-alerts spec). R2's per-product-per-account cooldown scope assumes this integrity rule.
- **Account-deletion cascade lives in the D1 schema, not `account.repository.ts`.** That repository is the pg-side implementation typed against the pg schema, which a D1-only table cannot join. The guarantee is enforced where the D1 tables are declared: `price_alerts.account_id` and `alert_notifications.alert_id` are `ON DELETE cascade`, matching the `savedScenarios` precedent that erasure cannot orphan rows even if the repository layer is bypassed.
- **Bounded duplicate-send window.** A crash between email dispatch and `markDelivered` leaves the notification row `pending`, so the next tick re-attempts the send. Closing the window would need a delivery acknowledgement from the mail path; the job accepts the same bounded window as the freshness-alert suppression marker. The spec's intent-log semantics (delivered rows are never re-sent) hold exactly.
