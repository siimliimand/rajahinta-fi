# Design: trust-and-reach-roadmap

## Context

Seven features landing on an existing Cloudflare Workers stack: Hono API worker, D1 (Drizzle, sqliteTable schema in `packages/data-platform/src/d1/schema.ts`), R2 observation log, Durable Objects, cron/queues, email worker, Next.js 15 frontend with `[locale]` routing and content lint. The change introduces no new infrastructure; every feature composes existing modules.

## Goals

- Prove calculator accuracy over time (outcomes), protect users from fraudulent shops (blacklist), and give users reasons to return and share (blog, alerts, share links, rankings, allowance fill)
- Keep every display addition outside the calculation and ranking paths
- Expand personal data as little as possible; each new table states its retention at schema level

## Non-goals

- Reputation scoring of merchants, social-login, payments, auto-submission of declarations, feature flags

## Decisions

### D1. Outcomes outlive estimates in their own table

`calculationOutcomes` references the calculation record id and snapshots the fields it needs (inputs digest, estimated total cents, reported total cents, reported-at). It is NOT swept by the calculation-record retention job; its own cap is 24 months. One outcome per (record, account). The 60-day submission window runs from the record's calculation timestamp. Public statistic is computed read-time from outcomes: count, share within the 5% margin, as-of date. All user-facing copy says "user-reported"; no word implying verified orders.

### D2. Blacklist is warnings-only, evidence-gated, human-published

Merchant identity normalizes to domain plus normalized name so reports match without a merchant-registry row (foreign shops are not ingested yet). `shopReports` holds evidence fields (order number, correspondence digest, reporter account) and a moderation state machine: OPEN → PUBLISHED or REJECTED; an appeal moves a published entry to REOPENED for re-review. Publication requires the published standard (constants in the module: confirmed non-delivery by 3+ independent reports, or confirmed invalid business registration) and an operator action in the ops console, audited. Display joins add a `merchantWarnings` block to product/search/compare responses; a compliance test proves response bytes identical with zero, one, and many warnings. Warnings never exclude, reorder, or annotate totals.

### D3. Blog drafts attach to the manual rate gate

The tax-dataset-review cron already detects rate changes and creates manual-review tasks; confirmation is a human action. The draft hook runs at that same confirmation point: it creates a `blogPosts` row (status DRAFT, locale FI + EN bodies, linked `rateDatasetVersion`, impact summary computed from the versioned rate delta). Publication is an operator action. Post bodies pass the existing content-policy lint. No auto-publish path exists.

### D4. Newsletter is a separate consent with double opt-in

`newsletterSubscribers` is independent of accounts and of price-alert consent (different purpose, different audience). Subscribe records a pending row, sends a confirmation token through the email worker, and only confirmation activates the subscription. Unsubscribe is one click from every mail. The ops "notify subscribers" action reuses the alert intent-log pattern: write the notification intent, send, mark outcome, skip already-delivered on retry.

### D5. Tax-change alerts extend the existing alert row

`priceAlerts.kind` (TEXT, default 'PRICE', CHECK in PRICE|TAX_CHANGE). TAX_CHANGE alerts carry no threshold. Evaluation hooks where rate-version publication is observable: the same confirmation path as D3 enqueues an evaluation, `TaxChangeAttributionService` supplies per-product deltas, and alerts whose watched product moved get a notification through the shared intent-log + 24-hour cooldown machinery.

### D6. Share snapshots are frozen copies, not references

`POST /calculations/:id/share` copies the result into `shareSnapshots` under a 22-character random public id. The snapshot contains no account identifiers, so it does not need a retention exception; a 12-month hygiene sweep applies anyway. `GET /share/:publicId` is public and cached; the share page renders OG metadata from the snapshot and cross-links the accuracy statistic. The embed page (`/embed/calculator`) follows the what-if widget: minimal chrome, iframe-friendly headers, no session requirements.

### D7. €/g ranking is deterministic server-side sort

`GET /unitprice/ranking?category=` orders by `eurPerGram` ascending using the existing pure function (density 789 g/l); rows carry VERIFIED/ESTIMATED status and unavailable entries are omitted, not nulled into place. Copy is informational ("per-euro-gram listing"), no best/wording that reads editorial, per the content-lint neutral-tone rule.

### D8. Allowance fill is an optimizer mode, not a new engine

The bounded exhaustive search gains an objective: maximize filled value (or units) subject to the traveller-allowance limit for the route, resolved from the versioned `travellerAllowanceDatasets`/`travellerAllowanceLimits` datasets with effective-date resolution. Result shape mirrors the basket optimize response; `ferryOffers` remain a separate display-only section and the byte-identical compliance pattern covers them unchanged.

## Risks / Trade-offs

- Self-reported outcomes are honor-system data; mitigated by labeling, one-report-per-record, the 60-day window, and sample-size display. Deferred merchant verification would expand personal data sharply for little gain.
- Blacklist moderation is a standing human SLA, not code. The feature is only as good as the review discipline; the audit trail and published standard exist to keep it defensible.
- Draft-generation adds a write path to the rate-confirmation flow; it is fail-open (a draft failure never blocks a rate confirmation).
- Seven features in one change is wide; the task graph keeps them mergeable independently, and each section maps to its own spec delta.

## Migration plan

Two forward-only D1 migrations (trust tables; content/share/alert tables). No data backfill: all new tables start empty, `priceAlerts.kind` defaults to PRICE for existing rows.

## Open questions

None blocking. The published-blacklist standard wording and the accuracy margin (5%) are constants in the modules and trivially tunable after launch.
