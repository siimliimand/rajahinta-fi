# price-alerts Specification

## Purpose
TBD - created by archiving change product-roadmap-phases-1-4. Update Purpose after archive.
## Requirements
### Requirement: Watchlist threshold management

The alert kind set SHALL be the closed set `PRICE | TAX_CHANGE | LANDED_COST | CATEGORY`. The kind-aware creation contract SHALL be: a PRICE row requires a `productId` and a positive threshold; a TAX_CHANGE row requires a `productId` and MUST NOT carry a threshold; a LANDED_COST row requires a `productId` and a positive threshold; a CATEGORY row requires a canonical product category and a positive threshold and MUST NOT carry a `productId`. A category value not in the canonical set SHALL be rejected with a contract-level 400 naming the valid categories, never silently ignored. Alerts remain account-scoped; list, update (threshold/status), pause/resume, and delete keep their existing semantics for every kind.

#### Scenario: LANDED_COST creation contract

- **WHEN** an account creates a LANDED_COST alert with a product and a positive threshold
- **THEN** the row is stored active with kind `LANDED_COST`, and the same request without a threshold is rejected

#### Scenario: CATEGORY creation contract

- **WHEN** an account creates a CATEGORY alert with a canonical category and a positive threshold
- **THEN** the row is stored active with kind `CATEGORY`, null `productId`, and the category value

#### Scenario: Unknown category is a 400

- **WHEN** a CATEGORY alert names a category outside the canonical set
- **THEN** the API answers 400 naming the valid categories and stores nothing

#### Scenario: TAX_CHANGE contract unchanged

- **WHEN** a TAX_CHANGE creation carries a threshold, or a LANDED_COST or CATEGORY creation omits its required threshold
- **THEN** the request is rejected with the kind-aware guard error

### Requirement: Scheduled evaluation off the request path

The cron sweep SHALL evaluate each active alert against the kind's reference series read from the materialized daily price-history summaries, with kind-guarded ownership (each alert is evaluated only by its kind's branch, skipped before any read or counter for foreign kinds). The reference series SHALL be: PRICE — latest product-wide `priceCloseCents`; TAX_CHANGE — rate-version publication events (no threshold); LANDED_COST — latest product-wide `landedCostCloseCents`; CATEGORY — the minimum product-wide `priceCloseCents` across the category's products having a summary within the freshness window, with the tripping product determined by lowest `productId` among tied minima. The 7-day summary-freshness lookback, the `observed <= threshold` trigger semantics, and the 24-hour delivered-row cooldown SHALL apply to every threshold kind identically. Evaluation stays on the cron path; no user-facing request performs alert evaluation.

#### Scenario: Landed-cost alert fires on composition drop

- **WHEN** the latest fresh daily product-wide landed-cost close for a watched product is at or below the alert's threshold
- **THEN** the LANDED_COST branch matches, and the notification is dispatched through the email Worker with the intent log and the 24-hour cooldown applied

#### Scenario: Stale summaries never trigger landed-cost alerts

- **WHEN** a watched product has no daily summary within the 7-day lookback
- **THEN** the LANDED_COST alert is skipped with no evaluation counter and no email

#### Scenario: Category alert fires on the category minimum

- **WHEN** the minimum fresh `priceCloseCents` across a watched category's products is at or below the alert's threshold
- **THEN** the CATEGORY branch matches and the email names the tripping product (lowest `productId` among tied minima), its price, the category, and the threshold

#### Scenario: Kind ownership guard

- **WHEN** the sweep runs over a mixed set of active PRICE, TAX_CHANGE, LANDED_COST, and CATEGORY rows
- **THEN** each row is evaluated exactly once by its own kind's branch, and the other branches skip it before any read or counter

### Requirement: Notification rate limit

The system SHALL send at most one notification per alert per 24-hour period, for both kinds. The cooldown SHALL be recorded on the notification row and enforced regardless of how many evaluation cycles occur within the window.

#### Scenario: Cooldown suppresses repeat sends

- **WHEN** an alert triggered within the last 24 hours matches its condition again
- **THEN** no new notification SHALL be sent and the suppression SHALL be visible in the job's counters

#### Scenario: Re-trigger after cooldown

- **WHEN** the condition is still met after the cooldown window has passed
- **THEN** a new notification MAY be sent and a new notification row SHALL record it

### Requirement: Delivery through the email Worker with an intent log

Alert emails SHALL be dispatched through the existing email Worker send path. The system SHALL write an `alertNotifications` row before sending and mark the outcome after, so a retried evaluation cannot double-send a notification whose row is already marked delivered.

#### Scenario: Crash-safe delivery

- **WHEN** the evaluation job retries after a failure mid-delivery
- **THEN** notifications already marked delivered SHALL be skipped and no duplicate email SHALL be sent for the same trigger

### Requirement: Landed-cost alert explainability

A LANDED_COST alert email SHALL state the observed landed cost, the threshold, and the composition facts that make the number explainable: the retail offer price, the transport offer and its route (carrier, origin, destination FI), the excise and container-duty dataset versions in effect, the confidence, and the observed-at timestamp. The email SHALL state that the figure is the quantity=1 baseline from the materialized summary, not a live quote. Every stated fact SHALL come from the stored observation/summary record; the email path SHALL NOT recompute any figure. All wording SHALL be factual (no advice phrasing).

#### Scenario: Email cites the full composition

- **WHEN** a LANDED_COST alert fires
- **THEN** the email carries the retail price, transport offer and route, both dataset versions, confidence, and observed-at from the materialized record, with the quantity=1 baseline statement

### Requirement: Category alert determinism

The CATEGORY sweep's minimum SHALL be computed by a deterministic query over the category's products and summaries; for tied minima the tripping product SHALL be the lowest `productId`. The query SHALL run only for active CATEGORY alerts and SHALL be bounded by the summary table's existing keys and the product category index. For equal observed values across sweep re-runs within one cooldown window, at most one email SHALL be delivered per alert.

#### Scenario: Deterministic tie-break

- **WHEN** two or more products in the watched category share the category minimum
- **THEN** the email names the product with the lowest `productId`, and a re-run within the cooldown window delivers no second email

