# Rajahinta.fi — Distance-Selling & Distance-Buying Classification Validation (T1.67)

> **Document purpose:** Definitive verification and legal briefing dossier for task **T1.67** under the Pre-Launch Legal & Tax Review gate (`LAUNCH_GATE_TAX_SOURCE_MAPPING`).
>
> This document exports the classification rules of the Rajahinta.fi platform in plain language, details the statutory foundation under Finnish excise legislation (including the 1 September 2024 joint-liability reform under Act 432/2024), walks through representative transaction scenarios with their evidence outputs, reviews downstream MyTax guidance, and provides a structured sign-off record for Finnish tax counsel.

---

## 1. Executive Summary & Regulatory Purpose

The Rajahinta.fi platform provides cross-border landed cost calculations for Finnish consumers purchasing alcoholic beverages abroad. In Finnish and EU excise duty law, the legal regime governing a transaction depends strictly on **who arranges the transportation of the goods**:

1. **Distance Selling (*Etämyynti*)**: The seller arranges or directly/indirectly participates in the transport of the goods to Finland.
   - *Statutory liability:* The seller is primarily liable for Finnish excise duty and beverage container duty before dispatch.
   - *Reform impact (1 Sep 2024):* Under Finnish Act 432/2024 (*Valmisteverotuslain muuttaminen*), the Finnish buyer is **jointly and severally liable** (*yhteisvastuullinen verovelvollisuus*) if the seller fails to file the advance notice, submit the transport identifier, or pay the excise duties.
2. **Distance Buying (*Etäosto*)**: The Finnish consumer/buyer purchases goods and independently contracts a third-party carrier to transport them to Finland without the seller's direct or indirect involvement in transport arrangements.
   - *Statutory liability:* The buyer is solely liable for Finnish excise duties.
   - *Statutory obligation:* The buyer **must file an advance notice and lodge a guarantee/security (*vakuus*)** with the Finnish Tax Administration (*Verohallinto*) prior to dispatch. Unnotified shipments risk seizure and penalty tax by Finnish Customs (*Tulli*).
3. **Traveller Import (*Matkustajatuonti*)**: The consumer physically travels across the border and personally carries the goods into Finland.
   - *Statutory liability:* Duty-free within quantitative personal-use guidelines (*Alkoholilaki 1102/2017*, chapter 5). Excluded from the landed-cost excise calculator.

The platform implements this logic via `TransactionClassificationService` and `ClassificationRuleEngine`. In compliance with consumer protection and legal safety rules, **the platform never issues bare legal advice or categorical legal rulings**; instead, it provides an observed-pattern classification accompanied by factual evidence indicators and confidence levels.

---

## 2. Statutory & Official Sources

| Jurisdiction / Body | Statutory Instrument / Official Source | Subject & Application |
|---|---|---|
| **European Union** | **Council Directive (EU) 2020/262**, Articles 33 & 34 | EU general excise framework establishing definitions of distance selling of excise goods released for consumption. |
| **Finland (Parliament)** | **Excise Taxation Act (*Valmisteverotuslaki 182/2010*)**, § 72, § 73, § 74 | Foundational Finnish provisions defining *etämyynti* (distance selling), *etäosto* (distance buying), and tax representative requirements. |
| **Finland (Parliament)** | **Act 432/2024 (*Laki valmisteverotuslain muuttamisesta*)** / HE 45/2024 vp | Enacted 1 September 2024: introduces buyer joint liability in distance sales if seller neglects filing/payment, and tightens advance notice/guarantee requirements. |
| **Finland (Parliament)** | **Alcohol Act (*Alkoholilaki 1102/2017*)**, § 43 & Chapter 5 | Cross-border commercial distance sales provisions and traveller personal-import allowances. |
| **Verohallinto (Tax Admin)** | **Guidance VH/5088/00.01.00/2021** (*Alkoholin etämyynti ja etäosto*) | Tax Administration interpretation on carrier arrangements, seller involvement indicators, and filing obligations. |
| **Verohallinto (Tax Admin)** | **Syventävät vero-ohjeet: Valmisteverojen ilmoittaminen ja maksaminen** | Detailed guidance on advance notice (*ennakkoilmoitus*), security (*vakuus*), and MyTax (*OmaVero*) declaration steps. |

---

## 3. Plain-Language Rule Set Export

The classification engine maintains immutable, version-controlled rule sets evaluated on transaction date.

### 3.1 Input Parameters

The classification engine consumes a strictly minimized data schema (`ClassificationInput`):

```typescript
interface ClassificationInput {
  sellerInvolvementIndicator: boolean; // true if seller selected, paid, or facilitated carrier
  carrierId: string;                  // identifier of carrier (e.g. 'posti', 'dhl', 'ups', or '')
  sellerCountry: string;              // ISO 3166-1 alpha-2 code of seller (e.g. 'DE', 'EE')
  buyerCountry: string;               // ISO 3166-1 alpha-2 code of buyer (always 'FI')
  buyerIsTravelling: boolean;         // true if buyer physically transports goods
  sellerId: string;                   // merchant identifier/name for confidence verification
}
```

### 3.2 Evaluation Priority Pipeline

Rules are evaluated in strict hierarchical order. The first rule whose precondition is met determines the outcome:

```
[Input received]
       │
       ▼
 [Rule 1: buyerIsTravelling == true?] ──── YES ───► TravellerImport (Excluded, HIGH confidence)
       │ NO
       ▼
 [Rule 2: sellerInvolvementIndicator == true?] ─ YES ───► DistanceSelling (Seller liable + Joint liability warning, HIGH confidence)
       │ NO
       ▼
 [Rule 3: carrierId identified?] ──────── YES ───► DistanceBuying (Buyer liable, advance notice required; HIGH if sellerId known, else MEDIUM)
       │ NO
       ▼
 [Rule 4: Default Fallback] ────────────────────► DistanceBuying (LOW confidence, caveat that transport is indeterminate)
```

### 3.3 Rule Set Versions

#### Set A: `v1.0` (Effective: 2024-01-01 to 2024-08-31)
- Historical baseline for transactions occurring before the 1 September 2024 reform.
- In Distance Selling: Seller sole liability under original § 72.
- In Distance Buying: Buyer liable upon import under original § 73; 4-day administrative guidance.
- Archived as an immutable historical record; used to re-evaluate historical calculation audits.

#### Set B: `v2.0-2026.1` (Effective: 2024-09-01 to Present)
- Reflects the enactment of **Act 432/2024 (HE 45/2024 vp)**.
- **Distance Selling**: Seller remains statutory tax debtor, but downstream messaging alerts the Finnish buyer to **joint liability** if the seller defaults on advance notice or duty payment.
- **Distance Buying**: Buyer is notified that they **must submit an advance notice and deposit a guarantee (*vakuus*) in MyTax before goods are dispatched from the origin country**.
- **Traveller Import**: Confirmed as excluded from excise calculation; exempt within personal allowances.

### 3.4 Handling Merchant-Recommended Carriers (KHO 2021:159 & KHO 2022:84)

In cross-border alcohol trade, foreign online retailers frequently state in their terms of service that they *"do not arrange transport to Finland"* and direct buyers to independently book a courier from a suggested list or embedded widget.

Under established Finnish legal precedent (**KHO 2021:159**, **KHO 2022:84**) and Verohallinto guideline **VH/5088/00.01.00/2021**:
* If the seller in any way coordinates, negotiates rates, pre-selects, or facilitates transport with a specific transport company (even if the contract is nominally entered into between the consumer and the carrier), the Finnish Tax Administration and Finnish courts classify the arrangement as **distance selling (*etämyynti*)**.
* **Platform implementation rule:** The platform's ingestion and transport classification modules set `sellerInvolvementIndicator = true` not only when the retailer charges for shipping directly on their invoice, but also when the seller provides integrated or partnered courier checkout options. This ensures Finnish consumers are never misled into assuming they are in pure distance buying when Finnish tax authorities would treat the transaction as distance selling with joint liability exposure.

---

## 4. Representative Scenario Walkthroughs

Below are the five canonical scenarios verified against `ClassificationRuleEngine` and `TransactionClassificationService`:

### Scenario 1: Merchant-Arranged Delivery (Classic Distance Selling)
* **Real-world case:** German online wine retailer arranges DHL Express delivery directly to the buyer's home address in Helsinki.
* **Input Parameters:**
  * `sellerInvolvementIndicator`: `true`
  * `carrierId`: `'dhl'`
  * `sellerCountry`: `'DE'`, `buyerCountry`: `'FI'`
  * `buyerIsTravelling`: `false`
  * `sellerId`: `'weingut-mueller-de'`
* **Rule Triggered:** `DistanceSelling` (Rule 2)
* **Classification Output:** `DistanceSelling`
* **Confidence Level:** `HIGH`
* **Generated Evidence Summary:**
  > *"Retailer offers direct delivery to buyer's country (seller country: DE, buyer country: FI, carrier: dhl)."*
* **Downstream Guidance Emitted:**
  * `buyerMustFileAdvanceNotice`: `false`
  * `buyerJointlyLiable`: `true` (Joint liability warning under Act 432/2024)

### Scenario 2: Consumer Contracts Carrier with Verified Merchant (Distance Buying)
* **Real-world case:** Finnish consumer buys whiskey from a French merchant's webstore on ex-works terms. The consumer separately books and pays UPS to pick up the parcel and deliver it to Finland.
* **Input Parameters:**
  * `sellerInvolvementIndicator`: `false`
  * `carrierId`: `'ups'`
  * `sellerCountry`: `'FR'`, `buyerCountry`: `'FI'`
  * `buyerIsTravelling`: `false`
  * `sellerId`: `'distillerie-du-nord-fr'`
* **Rule Triggered:** `DistanceBuyingKnownCarrier` (Rule 3)
* **Classification Output:** `DistanceBuying`
* **Confidence Level:** `HIGH` (verified merchant + identified carrier)
* **Generated Evidence Summary:**
  > *"Buyer arranged transport via independent carrier (carrier: ups). Seller did not arrange transport (seller country: FR, buyer country: FI). Seller identity confirmed (seller: distillerie-du-nord-fr)."*
* **Downstream Guidance Emitted:**
  * `buyerMustFileAdvanceNotice`: `true`
  * `buyerJointlyLiable`: `false` (Buyer is sole primary debtor)
  * Clear instruction that advance notice & guarantee must be completed in MyTax prior to parcel dispatch.

### Scenario 3: Consumer Contracts Carrier with Unverified Merchant (Distance Buying)
* **Real-world case:** Consumer purchases cider from an obscure foreign marketplace and arranges freight through a parcel forwarder without verified merchant credentials.
* **Input Parameters:**
  * `sellerInvolvementIndicator`: `false`
  * `carrierId`: `'posti'`
  * `sellerCountry`: `'EE'`, `buyerCountry`: `'FI'`
  * `buyerIsTravelling`: `false`
  * `sellerId`: `''` (empty)
* **Rule Triggered:** `DistanceBuyingKnownCarrier` (Rule 3)
* **Classification Output:** `DistanceBuying`
* **Confidence Level:** `MEDIUM` (carrier known, but seller unverified)
* **Generated Evidence Summary:**
  > *"Buyer arranged transport via independent carrier (carrier: posti). Seller did not arrange transport (seller country: EE, buyer country: FI). Seller identity is unverified, reducing confidence (no seller identifier provided)."*
* **Downstream Guidance Emitted:**
  * `buyerMustFileAdvanceNotice`: `true`
  * `buyerJointlyLiable`: `false`

### Scenario 4: Personal Import / Ferry Trip (Traveller Import)
* **Real-world case:** Finnish resident travels by ferry to Tallinn, buys alcoholic beverages at a supermarket, and transports them back in their own luggage or vehicle.
* **Input Parameters:**
  * `sellerInvolvementIndicator`: `false`
  * `carrierId`: `''`
  * `sellerCountry`: `'EE'`, `buyerCountry`: `'FI'`
  * `buyerIsTravelling`: `true`
  * `sellerId`: `'superalko-tallinn'`
* **Rule Triggered:** `TravellerImport` (Rule 1)
* **Classification Output:** `TravellerImport`
* **Confidence Level:** `HIGH`
* **Generated Evidence Summary:**
  > *"Buyer indicated they are physically carrying goods across the border (destination: EE, buyer country: FI). Personal import allowance applies — excluded from landed-cost calculator (transport arrangement: personal transport)."*
* **Downstream Guidance Emitted:**
  * Calculator excludes excise assessment; directs user to Finnish Customs personal import allowance guidelines.

### Scenario 5: Indeterminate / Ambiguous Transport Arrangement
* **Real-world case:** Incomplete user enquiry where the seller is not involved in transport, but no carrier details have been provided.
* **Input Parameters:**
  * `sellerInvolvementIndicator`: `false`
  * `carrierId`: `''`
  * `sellerCountry`: `'DE'`, `buyerCountry`: `'FI'`
  * `buyerIsTravelling`: `false`
  * `sellerId`: `''`
* **Rule Triggered:** `DistanceBuyingUnknownTransport` (Rule 4 Fallback)
* **Classification Output:** `DistanceBuying`
* **Confidence Level:** `LOW`
* **Generated Evidence Summary:**
  > *"Transport arrangement could not be determined (seller country: DE, buyer country: FI, no carrier identified, seller not involved in shipping)."*
* **Downstream Guidance Emitted:**
  * Displays a cautionary banner advising the buyer to determine transport arrangements before dispatch, defaulting safely to distance-buying compliance guidance.

---

## 5. Downstream Messaging & Excise Declaration Assistant

In the user interface, the **Excise Declaration Assistant** (`DeclarationGuidancePanel`) translates the classification result into actionable, read-only guidance.

### 5.1 Factual & Non-Advisory Posture
1. **No Automated Submission**: Rajahinta.fi never connects to Vero APIs to submit tax returns or notices on behalf of users. It provides calculation transcripts and entry aids only.
2. **Observed-Pattern Phrasing**:
   - The UI states: *"Records observed in similar Finnish excise filings begin from the transaction classification..."*
   - Avoids prescriptive mandates: instead of saying "You are legally required to file form X", it states: *"Under Finnish Excise Taxation Act 182/2010, distance buying requires the buyer to submit an advance notice and guarantee in MyTax before dispatch."*
3. **Official Links**: Directs users only to official Verohallinto portals:
   - MyTax Portal: `https://www.vero.fi/asioi-verkossa/mytax/`
   - Alcohol Excise Guide: `https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisterverot/alkoholi/`

### 5.2 Joint Liability Disclosure (Act 432/2024)
For `DistanceSelling` transactions, the guidance explicitly informs the user:
> *"Vaikka myyjä on ensisijainen verovelvollinen etämyynnissä, 1.9.2024 voimaan tulleen lainmuutoksen (Laki 432/2024) mukaan ostaja voi olla yhteisvastuussa valmisteveroista, mikäli myyjä laiminlyö ennakkoilmoituksen, kuljetustunnisteen tai verojen maksun."*

### 5.3 Outbound Links & Valvira Neutrality (Alcohol Act 1102/2017 Chapter 7)
To ensure the service remains classified as an informational price-comparison tool rather than illegal promotion of alcohol (particularly strong beverages >22% under Chapter 7):
* **No Sales Calls-to-Action:** Outbound links are labeled neutrally as *"Katso myyjältä {merchant}"* / *"View at {merchant}"*, never *"Osta nyt"* ("Buy now").
* **No Affiliate / Commercial Tracking:** Links route through `/api/v1/outbound/:offerId` for raw click counts only. No affiliate IDs, commissions, or sales conversion tracking exist.
* **Technical Isolation:** Links enforce `rel="nofollow noopener" target="_blank"`.
* **Algorithmic Neutrality:** Product ordering in comparisons is strictly mathematical (lowest cost, alphabetical, or ABV), completely isolated from any merchant billing.

---

## 6. Legislative Audit & 2026 Verification

As of the current date in 2026:
* **Act 432/2024 (*Laki valmisteverotuslain muuttamisesta*)**: In full effect since 1 September 2024. No subsequent amendments have altered the definitions of distance selling or distance buying under § 72 and § 73.
* **EU Directive 2020/262**: Remains the governing Union framework.
* **Append-Only Protocol**: Should tax counsel advise any wording or classification adjustments, the platform will register a new dated rule set version (`v3.0-...`), preserving `v2.0-2026.1` and `v1.0` for historical calculations.

---

## 7. Counsel Review Questionnaire & Sign-Off Record

### 7.1 Questions for Finnish Tax Counsel

1. **Classification Boundary**: Does counsel confirm that distinguishing *etämyynti* vs. *etäosto* based on `sellerInvolvementIndicator` (whether the retailer arranges/contracts transport directly or indirectly, including KHO 2021:159 / 2022:84 partner links) aligns with Verohallinto guidance VH/5088/00.01.00/2021 and § 72–73 of the Excise Taxation Act?
2. **Evidence & Confidence Phrasing**: Does counsel agree that presenting classification as an observed pattern with confidence levels and factual evidence summaries (rather than a categorical legal ruling) appropriately minimizes platform liability?
3. **Post-1 Sep 2024 Joint Liability**: Does the statutory summary of Act 432/2024 and the buyer warning accurately reflect the joint liability exposure for Finnish consumers in distance sales?
4. **Advance Notice & Guarantee**: Is the downstream MyTax guidance for distance buyers (mandatory advance notice and security before goods dispatch) accurate and compliant?
5. **Neutrality & Valvira Posture**: Does counsel agree that the neutral phrasing of outbound links (*"Katso myyjältä"*), absence of affiliate commissions, and purely mathematical ranking keep the platform within permissible informational comparison boundaries under Alcohol Act Chapter 7?

---

### 7.2 Sign-Off Record (T1.67)

This sign-off confirms that the transaction classification rules, representative scenarios, and downstream user guidance of Rajahinta.fi have been reviewed and validated by qualified Finnish legal/tax counsel.

| Review Item | Verified By Counsel | Notes / Conditions |
|---|:---:|---|
| **Classification rule sets export (`v1.0` & `v2.0-2026.1`)** | [ ] Yes &nbsp; [ ] No | |
| **Scenario 1: Retailer-arranged transport (*Etämyynti*)** | [ ] Yes &nbsp; [ ] No | |
| **Scenario 2 & 3: Independent carrier (*Etäosto*)** | [ ] Yes &nbsp; [ ] No | |
| **Scenario 4: Traveller personal import (*Matkustajatuonti*)** | [ ] Yes &nbsp; [ ] No | |
| **Downstream MyTax guidance & advance notice logic** | [ ] Yes &nbsp; [ ] No | |
| **1 Sep 2024 joint-liability reform messaging (Act 432/2024)** | [ ] Yes &nbsp; [ ] No | |

<br>

**Rule-Set Version Validated:** `2.0-2026.1` (Current)

**Counsel Name / Law Firm:** __________________________________________________

**Counsel Signature:** __________________________________________________

**Date of Validation:** __________________________________________________
