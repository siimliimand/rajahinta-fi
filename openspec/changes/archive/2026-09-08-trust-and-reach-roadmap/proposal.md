# Trust and reach roadmap

## Why

The calculator owns the cost estimate; these features extend it into the two directions exploration identified as worth building now: proving the estimates hold up after purchase, and giving users lightweight reasons to return and share. Every feature rides existing modules and existing data flows. The originally requested reputation index (1a) and yearly recap (3b) are deliberately excluded: the index has no foreign-merchant feed to score and no outcome data to score it with, and the recap's acquisition premise does not hold at current scale. Both stay parked with numeric revisit triggers. MyTax pre-filled declarations (2a) remain a separate future change pending tax-professional field mapping.

## What Changes

Seven features, grouped:

1. **Shop blacklist** — moderated, evidence-gated list of fraudulent or seriously unreliable merchants. User reports with evidence, manual review, published standard, appeal path. Warnings display wherever the merchant appears; results and rankings stay byte-identical.
2. **Verified outcomes** — after a calculation, an authenticated user can report what the import actually cost. One report per record per account, 60-day window. Public aggregate accuracy statistic (share of reported outcomes within 5% of estimate, with sample size), labeled user-reported everywhere.
3. **Rate-change blog + newsletter** — posts drafted automatically when a new official rate version is manually confirmed (template: what changed, effective date, estimated impact on a typical basket), published by a human. Newsletter with double opt-in, consent separate from price alerts, delivery through the email worker with an intent log.
4. **Tax-change alerts** — new TAX_CHANGE kind in the existing alert system: watch a product, get notified when a rate-version change moves its landed cost. Uses `TaxChangeAttributionService`, the existing intent-log delivery, and the 24-hour cooldown.
5. **Share permalinks + embed widget** — a calculation can be shared as a frozen snapshot under a public permalink with OG card metadata; the calculator gets an embeddable widget page following the what-if embed precedent.
6. **€/g value ranking** — public page listing products in a category by ethanol €/g, deterministic server-side sort, reliability status carried per row.
7. **Allowance-fill trip planner** — given a traveller allowance budget, the basket optimizer fills the best basket that fits inside the duty-free limit. Reuses the bounded search and versioned traveller-allowance datasets; ferry offers stay in their separate display-only block.

## Capabilities

### New

- `merchant-blacklist` — reporting, moderation, publication, appeal, warning display
- `calculation-outcomes` — user-reported outcome confirmations and the public accuracy statistic
- `content-publication` — rate-change blog posts and the opt-in newsletter
- `share-permalinks` — frozen share snapshots, public share page, calculator embed
- `allowance-fill-planner` — allowance-constrained basket fill for trip mode

### Modified

- `price-alerts` — alerts gain a `kind` (PRICE default, TAX_CHANGE); TAX_CHANGE alerts evaluate on rate-version publication instead of a price threshold
- `unit-price-metrics` — the €/g metric gains a public per-category ranking view

## Impact

- **Schema:** one migration adding `shopReports`, `blacklistEntries`, `calculationOutcomes`; one adding `blogPosts`, `newsletterSubscribers`, `shareSnapshots`, and `priceAlerts.kind`. `calculationOutcomes` carries its own retention, decoupled from the calculation-record age cap.
- **API:** new public routes (`/accuracy`, `/blog/*`, `/share/:publicId`, `/unitprice/ranking`), authenticated routes (`/reports`, `/calculations/:id/outcome`, tax-change alerts, `/trip/fill`), ops routes for moderation and subscriber notify. New rate-limit profiles.
- **Neutrality:** blacklist warnings, outcome statistics, and €/g rankings are display-only. A compliance test proves calculation and ranking output identical with zero, one, and many warnings present, extending the trip-affiliate-neutrality pattern.
- **Email:** newsletter and tax-change notifications ride the existing email worker `/internal/email/send` contract with intent-log rows before send.
- **No feature flags:** everything ships enabled per the 2026-09-07 owner decision.

## Non-goals

- Merchant reputation index (deferred: needs ingested foreign-merchant offers plus a material body of confirmed outcomes)
- Yearly savings recap (deferred: revisit at four-to-five-digit monthly active accounts)
- MyTax pre-filled declaration (separate change; blocked on tax-professional field mapping)
- Auto-submitting declarations, affiliate fields, or any paid/manual ordering influence
