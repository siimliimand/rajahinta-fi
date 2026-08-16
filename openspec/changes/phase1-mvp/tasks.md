## 1. Data Model & Data Platform

- [x] 1.1 Product Master entity — manufacturer, brand, category, ABV, unit volume, container type, regulatory classification, deposit-system status. One record per canonical product. <!-- agent: platform-engineer.build, depends_on: [], touches: [src/data-platform/schema/*] -->
- [x] 1.2 Retail Offer entity — merchant, country, linked product, current price, currency, availability, source URL, timestamp, reliability status. Many-to-one against Product Master. <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [src/data-platform/schema/*] -->
- [x] 1.3 Transport Offer entity — carrier, route, destination, weight tier, package tier, price, seller-involvement indicator, timestamp, reliability status. <!-- agent: platform-engineer.build, depends_on: [], touches: [src/data-platform/schema/*] -->
- [x] 1.4 Versioned Tax Rule entity — tax type (excise / container duty), product category, rate, effective date range, exemption conditions, calculation formula reference, official source, verification date. Versioned — never mutated in place. <!-- agent: platform-engineer.build, depends_on: [], touches: [src/data-platform/schema/*] -->
- [x] 1.5 Calculation Record entity — persist every landed-cost result shown to a user (or sampled subset), storing which Product Master, Retail Offer, Transport Offer, and Tax Rule versions were used, plus the resulting confidence level. Enables auditability and the correction mechanism. <!-- agent: platform-engineer.build, depends_on: [1.1,1.2,1.3,1.4], touches: [src/data-platform/schema/*] -->
- [x] 1.6 Apply data minimization at the schema level — do not add optional fields "for later" if no shipped feature uses them. <!-- agent: platform-engineer.fast, depends_on: [1.1,1.2,1.3,1.4,1.5], touches: [src/data-platform/schema/*] -->

## 2. Data Acquisition

- [x] 2.1 Build data acquisition pipeline for initial merchant set via permitted feeds/APIs (not broad scraping). <!-- agent: platform-engineer.build, depends_on: [1.1,1.2,1.3], touches: [src/data-acquisition/**] -->
- [x] 2.2 Implement Merchant & Source Governance module — track acquisition method (permitted feed, retailer API, structured merchant feed, licensed provider, compliant crawling, manual verification) and permission/compliance status per source. <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [src/data-acquisition/**, src/core-domain/governance/*] -->
- [x] 2.3 Enforce off-by-default — any new merchant or data source is off (not queried, not displayed) until it has a recorded permission status. <!-- agent: platform-engineer.build, depends_on: [2.2], touches: [src/data-acquisition/**] -->
- [x] 2.4 Implement source reliability status per data point: VERIFIED, STALE, UNAVAILABLE, ESTIMATED — attached to price, transport, and classification inputs. <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [src/core-domain/reliability/*, src/data-platform/schema/*] -->
- [x] 2.5 Build automated data-quality checks — flag any Retail Offer or Transport Offer older than its staleness threshold; verify STALE/UNAVAILABLE data is never silently presented as VERIFIED. <!-- agent: platform-engineer.build, depends_on: [2.4], touches: [src/data-acquisition/**] -->

## 3. Product Normalization

- [x] 3.1 Build normalization ingest — accept raw product data (name, brand, category, volume, ABV, packaging, images, description) from the data acquisition layer. <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [src/core-domain/normalization/*] -->
- [x] 3.2 Implement product matching/deduplication across merchants — the same physical product sold by multiple foreign retailers must resolve to one canonical Product Master with multiple linked Retail Offers. <!-- agent: platform-engineer.build, depends_on: [3.1,1.1], touches: [src/core-domain/normalization/*] -->
- [x] 3.3 Implement deterministic matching (GTIN/EAN barcode) combined with fuzzy matching (name, brand, volume, ABV) and a manual-review queue for low-confidence matches. <!-- agent: platform-engineer.build, depends_on: [3.2], touches: [src/core-domain/normalization/*] -->
- [x] 3.4 Enforce regulatory classification gating — every canonical product must carry a regulatory classification before appearing in a landed-cost calculation; unclassified products are excluded, never shown with a guessed classification. <!-- agent: platform-engineer.build, depends_on: [3.2,1.1], touches: [src/core-domain/normalization/*] -->

## 4. Transport Estimation

- [x] 4.1 Build Transport Estimation module — maintain transport offers by carrier, route, destination, weight tier, and package tier. <!-- agent: platform-engineer.build, depends_on: [1.3], touches: [src/core-domain/transport/*] -->
- [x] 4.2 Implement basket-level shipping-cost computation (not just single-item) — shipping thresholds and incremental charges are non-linear. Required for the Basket Optimizer in Phase 2. <!-- agent: platform-engineer.build, depends_on: [4.1], touches: [src/core-domain/transport/*] -->
- [x] 4.3 Distinguish retailer-arranged transport from independent-carrier transport — this distinction feeds directly into Transaction Classification. <!-- agent: platform-engineer.build, depends_on: [4.1], touches: [src/core-domain/transport/*] -->

## 5. Tax & Duty Calculation

- [x] 5.1 Build Alcohol Excise sub-engine — calculate excise duty based on product category, alcohol percentage, and volume, using official Finnish Tax Administration rate tables as the primary source. <!-- agent: platform-engineer.build, depends_on: [1.4], touches: [src/core-domain/tax/*] -->
- [x] 5.2 Build Beverage-Container Duty sub-engine — calculate container duty (general rate €0.51/litre) as a distinct calculation from alcohol excise. <!-- agent: platform-engineer.build, depends_on: [1.4], touches: [src/core-domain/tax/*] -->
- [x] 5.3 Implement deposit-return system exemption check — the container-duty engine must evaluate whether packaging participates in the Finnish deposit-return system before applying the duty. Where deposit status cannot be determined, flag the duty calculation as ESTIMATED (never silently assume either way). <!-- agent: platform-engineer.build, depends_on: [5.2,1.1], touches: [src/core-domain/tax/*] -->
- [x] 5.4 Populate the initial versioned Tax Rule dataset (excise + container duty) sourced exclusively from official Finnish Tax Administration data — never independently derived. <!-- agent: platform-engineer.build, depends_on: [1.4], touches: [src/data-platform/seed/*, src/data-platform/schema/*] -->
- [x] 5.5 Implement scheduled rate-review process — a recurring job checks for newly published official rate changes and creates a task for manual/legal confirmation before any new dataset version goes live. Rates are never auto-published. <!-- agent: platform-engineer.build, depends_on: [5.4], touches: [src/data-acquisition/**, src/core-domain/tax/*] -->
- [x] 5.6 Ensure historical rates remain queryable after a rate change — past calculations always resolve against the rate version effective on the relevant date. <!-- agent: platform-engineer.build, depends_on: [1.4,5.4], touches: [src/data-platform/schema/*, src/core-domain/tax/*] -->

## 6. Transaction Classification

- [x] 6.1 Build Transaction Classification Module as an isolated, independently testable module (the platform's most important proprietary logic). <!-- agent: platform-engineer.build, depends_on: [4.3], touches: [src/core-domain/classification/*] -->
- [x] 6.2 Implement three-way classification — Distance Selling, Distance Buying, Traveller Import (excluded from calculation) — with confidence level and human-readable evidence summary per result. <!-- agent: platform-engineer.build, depends_on: [6.1], touches: [src/core-domain/classification/*] -->
- [x] 6.3 Store classification rules as versioned, dated rule sets (mirroring the tax-rule versioning approach), since the rules are subject to legislative change (e.g., the 1 September 2024 joint-liability change). <!-- agent: platform-engineer.build, depends_on: [6.1], touches: [src/core-domain/classification/*] -->
- [x] 6.4 Output must never be a bare legal conclusion — always phrased as an observed pattern with supporting evidence (e.g., "likely distance selling, based on: retailer offers direct delivery to Finland"). <!-- agent: platform-engineer.build, depends_on: [6.2], touches: [src/core-domain/classification/*] -->

## 7. Confidence & Data-Reliability Framework

- [x] 7.1 Implement the cross-cutting Confidence & Data-Reliability Framework consumed by nearly every module. <!-- agent: platform-engineer.build, depends_on: [2.4], touches: [src/core-domain/reliability/*] -->
- [x] 7.2 Compute result confidence as a pure function of underlying data statuses (not a manually set field): HIGH (all material inputs verified), MEDIUM (one or more estimated), LOW (shipping or classification unverifiable). <!-- agent: platform-engineer.build, depends_on: [7.1], touches: [src/core-domain/reliability/*] -->
- [x] 7.3 Expose enough detail that the UI can show why a result has a given confidence level. <!-- agent: platform-engineer.build, depends_on: [7.2], touches: [src/core-domain/reliability/*] -->

## 8. Landed-Cost Calculator & Excise Declaration Assistant

- [x] 8.1 Build Landed-Cost Calculator — orchestrate the modules above: take product + quantity + destination (+ optional transport method), call Transport Estimation, Tax & Duty Calculation, and Transaction Classification, and assemble the itemized result. <!-- agent: platform-engineer.build, depends_on: [4.2,5.1,5.2,6.2,7.2], touches: [src/core-domain/calculator/*] -->
- [x] 8.2 Ensure the itemized breakdown includes: foreign retail price, transport cost, alcohol excise estimate, container duty estimate, other charges, total, calculation-status metadata, and confidence level. <!-- agent: platform-engineer.build, depends_on: [8.1], touches: [src/core-domain/calculator/*] -->
- [x] 8.3 Embed the standing disclaimer ("estimated total cost in Finland, not final legal tax liability") as a structural part of every result object, not as a UI-only string, so future API consumers inherit it automatically. <!-- agent: platform-engineer.build, depends_on: [8.2], touches: [src/core-domain/calculator/*] -->
- [x] 8.4 Build Excise Declaration Assistant — a read-mostly module that packages a completed calculation into a structured summary (product, ABV, volume, category, units, container info, transport info, estimated excise, advance-notice information) and links out to MyTax. <!-- agent: platform-engineer.build, depends_on: [8.2], touches: [src/core-domain/declaration/*] -->
- [x] 8.5 Excise Declaration Assistant must never attempt to submit anything on the user's behalf — it prepares information only. <!-- agent: platform-engineer.build, depends_on: [8.4], touches: [src/core-domain/declaration/*] -->

## 9. Ranking & Sorting

- [x] 9.1 Implement Ranking & Sorting Module with only the objective sort orders defined in the business plan: lowest estimated landed cost, lowest €/litre, lowest €/unit, alphabetical, alcohol percentage, product category. <!-- agent: platform-engineer.build, depends_on: [8.2], touches: [src/core-domain/ranking/*] -->
- [x] 9.2 Enforce neutrality structurally — the sorting function's input type must have no field available for a merchant payment, promotional flag, or manually curated boost. No code path may allow a paid or manual boost to a merchant's position. <!-- agent: platform-engineer.build, depends_on: [9.1], touches: [src/core-domain/ranking/*] -->
- [x] 9.3 Design the module so its logic can be described in plain language on a public "how ranking works" page without omitting any actual factor. <!-- agent: platform-engineer.build, depends_on: [9.2], touches: [src/core-domain/ranking/*] -->

## 10. Application / API

- [x] 10.1 Build consumer-facing API surface, grouped by module (not by database table): Search & Product Discovery, Landed-Cost Calculation, Excise Declaration Assistant, Account & Subscription. <!-- agent: platform-engineer.build, depends_on: [8.2,9.1,7.2], touches: [src/application-api/**] -->
- [x] 10.2 Ensure all calculation endpoints are idempotent for identical inputs given the same underlying dataset versions (results reproducible and cacheable). <!-- agent: platform-engineer.build, depends_on: [10.1], touches: [src/application-api/**] -->
- [x] 10.3 Implement caching keyed by (product, quantity, destination, transport assumption, tax-dataset version, transport-dataset version) — driven by dataset version changes, not arbitrary TTLs. <!-- agent: platform-engineer.build, depends_on: [10.1], touches: [src/application-api/**] -->
- [x] 10.4 Implement rate limiting and abuse protection on public-facing calculation endpoints (each calculation triggers real/cached external lookups — unit-economics risk). <!-- agent: platform-engineer.build, depends_on: [10.1], touches: [src/application-api/**] -->
- [x] 10.5 Implement shared Entitlement Module consulted by every relevant API endpoint to enforce free vs. premium feature access. <!-- agent: platform-engineer.build, depends_on: [10.1], touches: [src/application-api/**, src/core-domain/entitlement/*] -->

## 11. Presentation (Web Application)

- [x] 11.1 Build Landed-Cost Calculator UI: search, select product + quantity, display itemized breakdown with calculation-status metadata and confidence level. <!-- agent: platform-engineer.build, depends_on: [10.1], touches: [src/presentation/**] -->
- [x] 11.2 Build calculation explanation page — surface every figure's traceable inputs, rate dataset version, and timestamp. <!-- agent: platform-engineer.build, depends_on: [11.1,8.3], touches: [src/presentation/**] -->
- [x] 11.3 Build comparison views with neutral, objective ranking (enforce visual neutrality — no design element suggesting a paid/promoted position). <!-- agent: platform-engineer.build, depends_on: [9.2,10.1], touches: [src/presentation/**] -->
- [x] 11.4 Surface data-freshness indicators visibly: reliability status and timestamp for every externally sourced fact. <!-- agent: platform-engineer.build, depends_on: [7.2,11.1], touches: [src/presentation/**] -->
- [x] 11.5 Restrict content/copy to a controlled vocabulary — identification, classification, calculation, comparison — no subjective adjectives (no "best," "amazing," "top bargain"). Enforce via a lint/review step in the content pipeline. <!-- agent: platform-engineer.fast, depends_on: [11.1], touches: [src/presentation/**] -->
- [x] 11.6 Implement outbound merchant links as plain links recorded for basic analytics only (click-through counts) — no purchase tracking, no commission tracking infrastructure at launch. <!-- agent: platform-engineer.fast, depends_on: [11.3], touches: [src/presentation/**] -->

## 12. Compliance & Governance

- [x] 12.1 Implement audit logging for changes to tax-rule datasets, classification rule sets, and ranking logic (author, timestamp, reason). <!-- agent: platform-engineer.build, depends_on: [5.4,6.3,9.2], touches: [src/core-domain/audit/*, src/application-api/**] -->
- [x] 12.2 Build launch-gating configuration flag — keep alcohol price data and calculation features behind a non-public flag until legal opinion, tax-source mapping, and correction mechanism are all confirmed complete. <!-- agent: platform-engineer.fast, depends_on: [10.1], touches: [src/**/feature-flags/*] -->
- [x] 12.3 Build public ranking documentation page generated from (or kept in lockstep with) the actual Ranking & Sorting Module implementation. <!-- agent: platform-engineer.build, depends_on: [9.3], touches: [src/presentation/**] -->

## 13. Correction Mechanism

- [x] 13.1 Build correction mechanism — allow users or internal staff to flag a specific calculation or data point as incorrect. <!-- agent: platform-engineer.build, depends_on: [1.5,8.2], touches: [src/application-api/**, src/core-domain/correction/*] -->
- [x] 13.2 Flagged items create a tracked review item; once resolved, corrections can trigger a dataset fix and link back to affected historical Calculation Records. <!-- agent: platform-engineer.build, depends_on: [13.1], touches: [src/core-domain/correction/*] -->

## 14. Subscription & Billing

- [x] 14.1 Integrate with a third-party subscription billing provider for software subscriptions (Free / Premium €4.99/month / future Professional tier). <!-- agent: platform-engineer.build, depends_on: [10.5], touches: [src/application-api/billing/*] -->
- [x] 14.2 Enforce structural separation between the billing module and the Ranking & Sorting Module — no shared write path, so a merchant account (if ever introduced) cannot purchase better placement. <!-- agent: platform-engineer.build, depends_on: [14.1,9.1], touches: [src/application-api/billing/*, src/core-domain/ranking/*] -->

## 15. Age Gate, Accounts & Privacy

- [x] 15.1 Implement lightweight access-control age gate (simple confirmation, not identity verification) as the default, matching the minimal-data-collection preference. <!-- agent: platform-engineer.fast, depends_on: [11.1], touches: [src/presentation/**, src/application-api/age-gate/*] -->
- [x] 15.2 Design account system's identity/age-verification components as a pluggable module that can be upgraded to stronger verification if the legal opinion requires it. <!-- agent: platform-engineer.build, depends_on: [15.1], touches: [src/application-api/age-gate/*] -->
- [x] 15.3 Implement minimal account system — saved baskets, calculation history, subscription management, data export — not a gate on viewing publicly available comparison information. <!-- agent: platform-engineer.build, depends_on: [15.1,10.5], touches: [src/application-api/accounts/*] -->
- [x] 15.4 Ensure no storage of identity documents or unnecessary date-of-birth collection unless the legal review specifically mandates it. <!-- agent: platform-engineer.build, depends_on: [15.3], touches: [src/application-api/accounts/*, src/data-platform/schema/*] -->
- [x] 15.5 Default to anonymous usage; collect personal data only for account-based features. <!-- agent: platform-engineer.build, depends_on: [15.1], touches: [src/application-api/**, src/presentation/**] -->
- [x] 15.6 Define and implement retention limits for account data, calculation history, and analytics/telemetry, with automated deletion/anonymization jobs. <!-- agent: platform-engineer.build, depends_on: [15.3], touches: [src/application-api/accounts/*, src/data-acquisition/jobs/*] -->
- [x] 15.7 Implement data export functionality (supports user-requested export and GDPR data-portability obligations). <!-- agent: platform-engineer.build, depends_on: [15.3], touches: [src/application-api/accounts/*] -->

## 16. Pre-Launch Legal Review & Gating

- [ ] 16.1 Obtain written Finnish legal opinion covering: Alcohol Act marketing rules, price-list provisions, hyperlinks to foreign alcohol retailers, comparative advertising, search-engine indexing, subscription monetization, email notifications, personalization, rankings, strong vs. mild alcoholic beverages, user-generated content, age-gating. <!-- agent: none, depends_on: [], touches: [docs/legal/*] -->
- [ ] 16.2 Confirm that the official Finnish Tax Administration source is mapped to every tax rule. <!-- agent: none, depends_on: [5.4], touches: [] -->
- [ ] 16.3 Validate distance-selling / distance-buying logic with Finnish tax counsel. <!-- agent: none, depends_on: [6.4], touches: [] -->
- [ ] 16.4 Review outbound merchant links and subscription marketing for compliance. <!-- agent: none, depends_on: [11.6], touches: [] -->
- [ ] 16.5 Confirm all critical launch conditions (legal, tax, data, GDPR) are satisfied before toggling the launch-gating flag. <!-- agent: none, depends_on: [16.1,16.2,16.3,16.4,12.2,13.2], touches: [] -->

## 17. Testing — MVP

- [x] 17.1 Write unit tests for every tax/duty formula, classification rule, and confidence-computation function — highest-coverage bar for the highest-liability code paths. <!-- agent: platform-engineer.build, depends_on: [5.1,5.2,6.2,7.2], touches: [src/core-domain/**/*.test.ts] -->
- [x] 17.2 Build golden-dataset regression tests — a fixed set of known product/transport/tax input combinations with manually verified expected outputs, run on every deploy and every new tax-dataset version. <!-- agent: platform-engineer.build, depends_on: [17.1], touches: [tests/golden/*] -->
- [x] 17.3 Write compliance tests — automated checks that no ranking result correlates with any commercial/payment signal and that banned promotional vocabulary does not appear in generated product copy. <!-- agent: platform-engineer.build, depends_on: [9.2,11.5], touches: [tests/compliance/*] -->
- [x] 17.4 Write load/performance tests on the Landed-Cost Calculation endpoint specifically (highest-traffic, most computation-heavy path). <!-- agent: devops-engineer.build, depends_on: [10.1], touches: [tests/load/*, .github/workflows/*] -->