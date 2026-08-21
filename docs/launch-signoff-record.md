# Rajahinta.fi — Launch Sign-off Record

> Blank template for tracking the manual legal/tax tasks (T1.65–T1.69) and the final
> launch-gate decision. Fill in one block per completed task; date and sign each entry.
> Keep the completed record and the underlying legal opinion on file as launch evidence.

**Owner / signatory:** ______________________
**Date this record was opened:** ____________

---

## T1.65 — Written Finnish legal opinion

- [ ] Counsel engaged (firm name): ______________________
- [ ] Briefing package sent (product flow, ranking, wording, age gate, subscription, links)
- [ ] Written opinion received and covers all 12 topics:
  - [ ] Alcohol Act marketing rules
  - [ ] Price-list / price-information provisions
  - [ ] Hyperlinks to foreign alcohol retailers
  - [ ] Comparative advertising
  - [ ] Search-engine indexing
  - [ ] Subscription monetization
  - [ ] Email notifications
  - [ ] Personalization
  - [ ] Rankings
  - [ ] Strong vs. mild alcoholic beverages
  - [ ] User-generated content
  - [ ] Age-gating
- [ ] Any "compliant-with-conditions" findings converted to action items
- [ ] Opinion archived (signed PDF, date): ______________________

**Signed off:** ______________________  **Date:** ____________

---

## T1.66 — Tax source mapping confirmed

- [ ] Rule inventory extracted (every active `taxRules` row)
- [ ] Each rule mapped to current vero.fi source:
  - [ ] Alcohol excise rates
  - [ ] Beverage-container duty (€0.51/litre + deposit-return exemptions)
- [ ] Rates/effective dates checked against current official data (no post-2024 changes missed)
- [ ] Discrepancies fixed as new versioned entries (not in-place edits)
- [ ] Confirmation recorded (reviewer, date, URL set)

**Signed off:** ______________________  **Date:** ____________

---

## T1.67 — Distance-selling / distance-buying logic validated

- [ ] Classification rule sets exported in plain language for counsel
- [ ] Representative scenarios walked through:
  - [ ] Retailer-arranged transport
  - [ ] Independent carrier
  - [ ] Traveller import (excluded)
- [ ] Downstream MyTax messaging (advance notice / guarantee / filing) confirmed accurate
- [ ] Legislative-change check performed (incl. 1 Sep 2024 joint-liability)
- [ ] Rule-set version validated: ______________________

**Signed off:** ______________________  **Date:** ____________

---

## T1.68 — Outbound links & subscription marketing reviewed

- [ ] Outbound-link behavior documented (nofollow/noopener, redirect endpoint, click-count only)
- [ ] Confirmed no affiliate / commission / purchase tracking exists or is implied
- [ ] Subscription marketing materials collected (pricing page, emails, upgrade prompts)
- [ ] Counsel opinion received on links and marketing
- [ ] Required changes recorded and handed to engineering

**Signed off:** ______________________  **Date:** ____________

---

## T1.69 — Final launch decision

Confirm each Critical Launch Condition (business plan Section 29):

**Legal**
- [ ] Legal opinion (T1.65)
- [ ] Outbound-links review (T1.68)
- [ ] Subscription-marketing review
- [ ] GDPR / privacy review
- [ ] Consumer-protection disclosures
- [ ] Tax-information disclaimers

**Tax**
- [ ] Official Tax Administration sources mapped to every rule (T1.66)
- [ ] Version-controlled tax tables
- [ ] Automated tax-calculation tests
- [ ] Separate alcohol / container-duty handling
- [ ] Distance-selling / distance-buying validated (T1.67)

**Data**
- [ ] Source-permission policy
- [ ] Merchant-data reliability framework
- [ ] Price timestamping
- [ ] Shipping-data timestamping
- [ ] Stale-data detection

**Product**
- [ ] Transparent calculation breakdown
- [ ] Visible assumptions
- [ ] Confidence indicators
- [ ] Correction mechanism
- [ ] Official-source references

**Commercial**
- [ ] MVP user testing
- [ ] Willingness-to-pay test
- [ ] Premium conversion test
- [ ] Infrastructure cost model
- [ ] Customer acquisition strategy

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
