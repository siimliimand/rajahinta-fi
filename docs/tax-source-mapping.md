# Rajahinta.fi — Tax Source Mapping & Rule Inventory (T1.66)

> **Document purpose:** Definitive verification record for task **T1.66** under the Pre-Launch Legal & Tax Review gate (`LAUNCH_GATE_TAX_SOURCE_MAPPING`).
>
> This document maps every tax rule in the Rajahinta.fi versioned rule registry (`SEED_RULES`) to its authoritative Finnish Tax Administration (*Verohallinto*) source, verifies the rate progression from 2024 through 2026, details container-duty exemption mechanics, and provides the sign-off record.

---

## 1. Statutory & Official Sources

All excise duty and beverage-container duty rates implemented in Rajahinta.fi derive directly from Finnish law and official guidance published by the Finnish Tax Administration (*Verohallinto*):

| Domain | Finnish Act / Statutory Basis | Official Tax Administration Guidance & Rate Tables |
|---|---|---|
| **Alcohol Excise Duty** (*Alkoholijuomavero*) | *Laki alkoholi- ja alkoholijuomaverosta (1471/1994)* | • **Rate Table (FI):** [Verohallinto: Alkoholi- ja alkoholijuomaverotaulukko](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/)<br>• **English Guide:** [Verohallinto: Excise duty on alcohol and alcoholic beverages](https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-alcohol-and-alcoholic-beverages/)<br>• **Detailed Guidance (FI):** [Syventävät vero-ohjeet: Alkoholi- ja alkoholijuomaverotus (48734)](https://www.vero.fi/syventavat-vero-ohjeet/ohje-hakusivu/48734/alkoholi--ja-alkoholijuomaverotus/) |
| **Beverage Container Duty** (*Juomapakkausvero*) | *Laki eräiden juomapakkausten valmisteverosta (1037/2004)* | • **Rate Table (FI):** [Verohallinto: Juomapakkausverotaulukko](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/juomapakkausvero/juomapakkausverotaulukko/)<br>• **English Guide:** [Verohallinto: Excise duty on beverage containers](https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-beverage-containers/) |
| **Deposit-Return Exemption** (*Panttijärjestelmä*) | *Laki 1037/2004, 6 §* (Exemption for approved deposit systems) | • **Palpa (Suomen Palautuspakkaus Oy):** Membership in an approved, closed-loop deposit-return system qualifies the container for 100% statutory exemption from the €0.51/litre duty. |

---

## 2. Dataset Version Overview

The Rajahinta.fi engine enforces an **append-only, immutable versioning model** (`taxRules` table). Historical calculations resolve against the rate version effective at the observation date.

| Version Label | Total Rows | Effective Range | Key Statutory Changes | Official Source Descriptor |
|---|---|---|---|---|
| **`v1.0-2024`** | **27** | 2024-01-01 – 2024-12-31 | Baseline 2024 rate tables following 2024 alcohol tax index adjustments. | `Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)` / `... Beverage Containers, Rate 2024 (vero.fi)` |
| **`v2.0-2025`** | **28** | 2025-01-01 – 2025-12-31 | • Intermediate >15–22% adjusted to €8.74/l.<br>• Spirits >2.8% split into two tiers: >2.8–10% (€54.80/l pure alcohol) and >10% (€55.50/l pure alcohol). | `Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)` / `... Beverage Containers, Rates 2025 (vero.fi)` |
| **`v3.0-2026`** | **31** | 2026-01-01 – Current | • Rates updated to 2026 schedule (incl. 11.6.2026 Verohallinto table revision).<br>• Beer: 28.75 snt/cl (0.5–3.5%) and 36.71 snt/cl (>3.5%).<br>• Intra-year split on wine band 1 (>1.2–2.8%): €0.36/l through 2026-03-31; €0.50/l from 2026-04-01 (+3 rows across still, sparkling, other fermented).<br>• Wine/fermented general rates: 2.1902 €/l, 3.4070 €/l, 5.0497 €/l.<br>• Spirits: 31.33 snt/cl, 55.57 snt/cl, 56.28 snt/cl. | `Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)` / `... Beverage Containers, Rates 2026 (vero.fi)` |
| **Total** | **86** | | | |

---

## 3. Complete Tax Rule Inventory

### 3.1 `v1.0-2024` (27 Rules)

| # | Tax Type | Category | ABV Range | Rate | Unit Basis | Formula Reference | Official Source Page |
|---|---|---|---|---|---|---|---|
| 1 | excise | `beer` | ≤ 0.5% | 0.00 | snt / cl ethanol | `PER_DEGREE_PLATO` (alias) | [Vero.fi Alcohol Table](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/) |
| 2 | excise | `beer` | > 0.5 – 3.5% | 28.35 | snt / cl ethanol | `PER_DEGREE_PLATO` | [Vero.fi Alcohol Table](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/) |
| 3 | excise | `beer` | > 3.5% | 36.20 | snt / cl ethanol | `PER_DEGREE_PLATO` | [Vero.fi Alcohol Table](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/) |
| 4 | excise | `wine_still` | ≤ 1.2% | 0.00 | € / litre | `PER_LITRE_OF_PRODUCT` | [Vero.fi Alcohol Table](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/) |
| 5 | excise | `wine_still` | > 1.2 – 2.8% | 0.36 | € / litre | `PER_LITRE_OF_PRODUCT` | [Vero.fi Alcohol Table](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/) |
| 6 | excise | `wine_still` | > 2.8 – 5.5% | 1.98 | € / litre | `PER_LITRE_OF_PRODUCT` | [Vero.fi Alcohol Table](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/) |
| 7 | excise | `wine_still` | > 5.5 – 8% | 3.08 | € / litre | `PER_LITRE_OF_PRODUCT` | [Vero.fi Alcohol Table](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/) |
| 8 | excise | `wine_still` | > 8 – 15% | 4.56 | € / litre | `PER_LITRE_OF_PRODUCT` | [Vero.fi Alcohol Table](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/) |
| 9 | excise | `wine_still` | > 15 – 18% | 4.56 | € / litre | `PER_LITRE_OF_PRODUCT` | [Vero.fi Alcohol Table](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/) |
| 10–15 | excise | `wine_sparkling` | (6 tiers identical to `wine_still`) | 0.00 – 4.56 | € / litre | `PER_LITRE_OF_PRODUCT` | [Vero.fi Alcohol Table](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/) |
| 16 | excise | `intermediate_products` | > 1.2 – 15% | 5.68 | € / litre | `PER_LITRE_OF_PRODUCT` | [Vero.fi Alcohol Table](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/) |
| 17 | excise | `intermediate_products` | > 15 – 22% | 8.63 | € / litre | `PER_LITRE_OF_PRODUCT` | [Vero.fi Alcohol Table](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/) |
| 18 | excise | `spirits` | ≤ 1.2% | 0.00 | snt / cl ethanol | `PER_LITRE_OF_ALCOHOL` | [Vero.fi Alcohol Table](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/) |
| 19 | excise | `spirits` | > 1.2 – 2.8% | 30.90 | snt / cl ethanol | `PER_LITRE_OF_ALCOHOL` | [Vero.fi Alcohol Table](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/) |
| 20 | excise | `spirits` | > 2.8% | 54.80 | snt / cl ethanol | `PER_LITRE_OF_ALCOHOL` | [Vero.fi Alcohol Table](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/) |
| 21–26 | excise | `other_fermented` | (6 tiers identical to `wine_still`) | 0.00 – 4.56 | € / litre | `PER_LITRE_OF_PRODUCT` | [Vero.fi Alcohol Table](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/) |
| 27 | container_duty | `all_beverages` | All | 0.51 | € / litre | `FLAT_PER_LITRE` | [Vero.fi Beverage Containers](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/juomapakkausvero/juomapakkausverotaulukko/) |

### 3.2 `v2.0-2025` (28 Rules)

Includes all 2024 baseline rules with two statutory modifications:
1. **Intermediate products > 15–22% ABV:** Rate updated to **€8.74 / litre**.
2. **Spirits > 2.8% ABV split:**
   - `> 2.8 – 10% ABV`: **54.80 snt / cl ethanol** (€54.80 / l pure alcohol)
   - `> 10% ABV`: **55.50 snt / cl ethanol** (€55.50 / l pure alcohol)
3. **Container duty:** Unchanged at **€0.51 / litre**.

### 3.3 `v3.0-2026` (31 Rules — Currently Effective)

| # | Tax Type | Category | ABV Range | Rate | Effective Window | Formula Reference |
|---|---|---|---|---|---|---|
| 1 | excise | `beer` | ≤ 0.5% | 0.00 | 2026-01-01 – Open | `PER_DEGREE_PLATO` |
| 2 | excise | `beer` | > 0.5 – 3.5% | 28.75 | 2026-01-01 – Open | `PER_DEGREE_PLATO` |
| 3 | excise | `beer` | > 3.5% | 36.71 | 2026-01-01 – Open | `PER_DEGREE_PLATO` |
| 4 | excise | `wine_still` | ≤ 1.2% | 0.00 | 2026-01-01 – Open | `PER_LITRE_OF_PRODUCT` |
| 5 | excise | `wine_still` | > 1.2 – 2.8% | 0.36 | 2026-01-01 – 2026-03-31 | `PER_LITRE_OF_PRODUCT` |
| 6 | excise | `wine_still` | > 1.2 – 2.8% | 0.50 | 2026-04-01 – Open | `PER_LITRE_OF_PRODUCT` |
| 7 | excise | `wine_still` | > 2.8 – 5.5% | 2.1902 | 2026-01-01 – Open | `PER_LITRE_OF_PRODUCT` |
| 8 | excise | `wine_still` | > 5.5 – 8% | 3.4070 | 2026-01-01 – Open | `PER_LITRE_OF_PRODUCT` |
| 9 | excise | `wine_still` | > 8 – 15% | 5.0497 | 2026-01-01 – Open | `PER_LITRE_OF_PRODUCT` |
| 10 | excise | `wine_still` | > 15 – 18% | 5.0497 | 2026-01-01 – Open | `PER_LITRE_OF_PRODUCT` |
| 11–17 | excise | `wine_sparkling` | (7 tiers mirroring `wine_still` incl. 1.4.2026 split) | 0.00 – 5.0497 | 2026-01-01 – Open | `PER_LITRE_OF_PRODUCT` |
| 18 | excise | `intermediate_products` | > 1.2 – 15% | 5.7595 | 2026-01-01 – Open | `PER_LITRE_OF_PRODUCT` |
| 19 | excise | `intermediate_products` | > 15 – 22% | 8.8624 | 2026-01-01 – Open | `PER_LITRE_OF_PRODUCT` |
| 20 | excise | `spirits` | ≤ 1.2% | 0.00 | 2026-01-01 – Open | `PER_LITRE_OF_ALCOHOL` |
| 21 | excise | `spirits` | > 1.2 – 2.8% | 31.33 | 2026-01-01 – Open | `PER_LITRE_OF_ALCOHOL` |
| 22 | excise | `spirits` | > 2.8 – 10% | 55.57 | 2026-01-01 – Open | `PER_LITRE_OF_ALCOHOL` |
| 23 | excise | `spirits` | > 10% | 56.28 | 2026-01-01 – Open | `PER_LITRE_OF_ALCOHOL` |
| 24–30 | excise | `other_fermented` | (7 tiers mirroring `wine_still` incl. 1.4.2026 split) | 0.00 – 5.0497 | 2026-01-01 – Open | `PER_LITRE_OF_PRODUCT` |
| 31 | container_duty | `all_beverages` | All | 0.51 | 2026-01-01 – Open | `FLAT_PER_LITRE` |

---

## 4. Special Provisions & Engine Mechanics

### 4.1 Beverage Container Duty & Deposit Exemption
- **Standard Rate:** €0.51 / litre of beverage, enacted under *Laki eräiden juomapakkausten valmisteverosta 1037/2004*.
- **Deposit Exemption:** Under Section 6 of Act 1037/2004, packaging participating in an approved return system (Palpa) is exempt from container duty.
- **Tri-State Handling (`depositSystemStatus`):**
  - `true` → 100% exempt from container duty (€0.00); deposit amount applied separately.
  - `false` → Container duty levied at €0.51/litre.
  - `null` (unknown) → Flagged as `ESTIMATED` with an explicit caveat. The engine never silently assumes an exemption.

### 4.2 Small Brewery Relief (*Pienpanimoalennus*)
- Section 9 of the Alcohol Tax Act provides progressive 10%–50% tax deductions for independent small breweries producing under 15,000,000 litres annually.
- In Rajahinta.fi MVP, all cross-border commercial listings use the general tax rate. Small brewery relief is intentionally marked **UNAVAILABLE** in Phase 1 and tracked for Phase 2, as cross-border eCommerce pricing rarely has verifiable producer volume certificates attached to raw product listings.

### 4.3 Automated Rate Integrity
- The codebase enforces range continuity with zero gaps or overlaps via `validateEffectiveRanges()`.
- Seed composition tests in `packages/data-platform/src/seed/__tests__/seed-composition.test.ts` continuously assert:
  - Exact count of 86 official rules.
  - Absolute absence of placeholder or mock rates in production rule paths.
  - Distinct separation between official rules and testing seeds.

---

## 5. Verification Sign-Off Form

**Reviewer Name:** __________________________________  
**Role / Title:** __________________________________  
**Verification Date:** ______________________________  

| Checklist Item | Status | Notes |
|---|---|---|
| Complete inventory of 86 rules extracted and categorized | [ ] Confirmed | Full table documented in Section 3 |
| Alcohol excise rate tables verified against current Vero.fi pages | [ ] Confirmed | Checked against Verohallinto 11.6.2026 schedule |
| Beverage-container duty (€0.51/l) verified against Vero.fi | [ ] Confirmed | Act 1037/2004 rate confirmed |
| Deposit exemption logic (Palpa) confirmed compliant | [ ] Confirmed | Tri-state flag prevents unverified exemption |
| Multi-year progression (2024 -> 2025 -> 2026) verified append-only | [ ] Confirmed | No in-place row edits; clean version boundaries |
| Formal sign-off added to [docs/launch-signoff-record.md](file:///home/sim/www/rajahinta-fi/docs/launch-signoff-record.md) | [ ] Completed | Unblocks `LAUNCH_GATE_TAX_SOURCE_MAPPING` |

**Signature:** ___________________________________________
