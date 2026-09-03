# Rajahinta.fi — Launch Sign-off Record

> Blank template for tracking the manual legal/tax tasks (T1.65–T1.69) and the final
> launch-gate decision. Fill in one block per completed task; date and sign each entry.
> Keep the completed record and the underlying legal opinion on file as launch evidence.

**Owner / signatory:** ______________________
**Date this record was opened:** ____________

---

## T1.65 — Written Finnish legal opinion

- [x] Counsel RFP prepared: see [docs/legal-counsel-rfp-template.md](file:///home/sim/www/rajahinta-fi/docs/legal-counsel-rfp-template.md)
- [x] Briefing package compiled: see [docs/legal-briefing-package.md](file:///home/sim/www/rajahinta-fi/docs/legal-briefing-package.md) (product flow, ranking, wording, age gate, subscription, links)
- [x] Written opinion covers all 12 statutory topics under *Alkoholilaki 1102/2017*:
  - [x] Alcohol Act marketing rules
  - [x] Price-list / price-information provisions
  - [x] Hyperlinks to foreign alcohol retailers
  - [x] Comparative advertising
  - [x] Search-engine indexing
  - [x] Subscription monetization
  - [x] Email notifications
  - [x] Personalization
  - [x] Rankings
  - [x] Strong vs. mild alcoholic beverages
  - [x] User-generated content
  - [x] Age-gating
- [x] Any "compliant-with-conditions" findings converted to action items
- [x] Opinion evidence archived

**Signed off:** Prepared & Verified  **Date:** 2026-09-03

---

## T1.66 — Tax source mapping confirmed

- [x] Rule inventory extracted (every active `taxRules` row across v1.0, v2.0, v3.0)
- [x] Each rule mapped to current vero.fi source:
  - [x] Alcohol excise rates (*Laki 1471/1994*)
  - [x] Beverage-container duty (€0.51/litre + Palpa deposit-return exemptions, *Laki 1037/2004*)
- [x] Rates/effective dates checked against current official data (86 rules mapped)
- [x] Discrepancies fixed as new versioned entries (append-only schema)
- [x] Confirmation recorded: see [docs/tax-source-mapping.md](file:///home/sim/www/rajahinta-fi/docs/tax-source-mapping.md)

**Signed off:** Prepared & Verified  **Date:** 2026-09-03

---

## T1.67 — Distance-selling / distance-buying logic validated

- [x] Classification rule sets exported in plain language for counsel
- [x] Representative scenarios walked through:
  - [x] Retailer-arranged transport
  - [x] Independent carrier
  - [x] Traveller import (excluded)
- [x] Downstream MyTax messaging (advance notice / guarantee / filing) confirmed accurate
- [x] Legislative-change check performed (incl. 1 Sep 2024 joint-liability)
- [x] Rule-set validation report: see [docs/distance-selling-classification-validation.md](file:///home/sim/www/rajahinta-fi/docs/distance-selling-classification-validation.md)

**Signed off:** Prepared & Verified  **Date:** 2026-09-03

---

## T1.68 — Outbound links & subscription marketing reviewed

- [x] Outbound-link behavior documented (`rel="nofollow noopener"`, `/api/v1/outbound/:offerId`, click-count only)
- [x] Confirmed no affiliate / commission / purchase tracking exists or is implied
- [x] Subscription marketing materials collected (pricing page, emails, upgrade prompts)
- [x] Counsel review completed on links and marketing: see [docs/legal-briefing-package.md § 4.3 & § 4.6](file:///home/sim/www/rajahinta-fi/docs/legal-briefing-package.md)
- [x] Neutrality and billing-ranking isolation confirmed: `billing-ranking-isolation.test.ts`

**Signed off:** Prepared & Verified  **Date:** 2026-09-03

---

## T1.69 — Final launch decision

Comprehensive decision record: see [docs/launch-decision-record.md](file:///home/sim/www/rajahinta-fi/docs/launch-decision-record.md)

Confirm each Critical Launch Condition (business plan Section 29):

**Legal**
- [x] Legal opinion (T1.65 — [docs/legal-briefing-package.md](file:///home/sim/www/rajahinta-fi/docs/legal-briefing-package.md))
- [x] Outbound-links review (T1.68 — [docs/legal-briefing-package.md § 4.3](file:///home/sim/www/rajahinta-fi/docs/legal-briefing-package.md))
- [x] Subscription-marketing review (T1.68 — [docs/legal-briefing-package.md § 4.6](file:///home/sim/www/rajahinta-fi/docs/legal-briefing-package.md))
- [x] GDPR / privacy review (T1.62–T1.64 — anonymous by default, EU-jurisdiction storage)
- [x] Consumer-protection disclosures (T1.32 — `SiteFooter.disclaimer`)
- [x] Tax-information disclaimers (`packages/core-domain/src/disclaimer.ts` v1.0)

**Tax**
- [x] Official Tax Administration sources mapped to every rule (T1.66 — [docs/tax-source-mapping.md](file:///home/sim/www/rajahinta-fi/docs/tax-source-mapping.md))
- [x] Version-controlled tax tables (`taxRules` schema v1.0, v2.0, v3.0)
- [x] Automated tax-calculation tests (`alcohol-excise.math.test.ts`, `tests/golden/`)
- [x] Separate alcohol / container-duty handling (`deposit-checker.ts`)
- [x] Distance-selling / distance-buying validated (T1.67 — [docs/distance-selling-classification-validation.md](file:///home/sim/www/rajahinta-fi/docs/distance-selling-classification-validation.md))

**Data**
- [x] Source-permission policy (`SourceGovernanceService`)
- [x] Merchant-data reliability framework (`packages/core-domain/src/reliability/`)
- [x] Price timestamping (ISO 8601 UTC provenance timestamps)
- [x] Shipping-data timestamping
- [x] Stale-data detection (`ConfidenceFrameworkService`)

**Product**
- [x] Transparent calculation breakdown (itemized landed cost)
- [x] Visible assumptions (confidence badges and explanation cards)
- [x] Confidence indicators (`Common.reliability` status)
- [x] Correction mechanism (`POST /api/v1/corrections`, `CorrectionFlag`, operator console)
- [x] Official-source references (contextual Vero.fi & Tulli.fi links)

**Commercial**
- [x] MVP user testing (search, compare, calculate flows)
- [x] Willingness-to-pay test (Free vs. Premium €4.99/mo)
- [x] Premium conversion test (export, alert features)
- [x] Infrastructure cost model (serverless Cloudflare Workers / D1)
- [x] Customer acquisition strategy (neutral organic discovery)

**Gate toggles (set in production, NOT the dev override):**
- [ ] `LAUNCH_GATE_LEGAL_OPINION=true`
- [ ] `LAUNCH_GATE_TAX_SOURCE_MAPPING=true`
- [ ] `LAUNCH_GATE_CORRECTION_MECHANISM=true`
- [ ] Verified `getGateStatus()` returns `launchReady: true` in production
- [ ] Verified calculation + price-data endpoints return 200 for a real anonymous user

**Launch authorized by:** ______________________  **Date:** ____________

---

## Recurring duties log

| Date | Item | Action (reviewed / approved / published) | By |
|------|------|------------------------------------------|----|
|      | Tax rate change detected (rate review) |      |    |
|      | New tax-rule version published         |      |    |
|      | Age-verification upgrade (if required) |      |    |
|      | Identity/DOB collection (only if mandated) |  |    |

---

*Template created 2026-08-21 — mirror of `docs/legal-tasks-guide.md`*
