# Rajahinta.fi — Legal & Tax Tasks Guide

> Manual, owner-led tasks required before public launch.
> Derived from `docs/tasks.md` (Section 1Q: Pre-Launch Legal Review & Gating) and
> `docs/Rajahinta-FI.docx` (Sections 10.5 and 29 — Critical Launch Conditions).
>
> These tasks are marked `[ ]` with `agent: none` in the audit: they require engaging
> qualified Finnish counsel and making go/no-go decisions, so they cannot be completed
> by engineering alone.

---

## Why these tasks block launch

The codebase enforces a technical launch gate (`LaunchGateService`) that keeps the
calculation and price-data endpoints **publicly inaccessible** until three conditions
are signed off. All gates default to OFF.

| Gate (env var) | Unblocked by | Engineering status |
|---|---|---|
| `LAUNCH_GATE_LEGAL_OPINION` | T1.65 + T1.68 | waiting on you |
| `LAUNCH_GATE_TAX_SOURCE_MAPPING` | T1.66 + T1.67 | waiting on you |
| `LAUNCH_GATE_CORRECTION_MECHANISM` | T1.54 / T1.55 | already built & tested |

`LaunchGateService.isCalculationEnabled()` returns `true` only when **all three** gates
are confirmed. Until then the endpoints return 403.

---

## T1.65 — Obtain a written Finnish legal opinion

### What is needed

A formal **written opinion from Finnish counsel** covering **12 specific topics**
(from the business plan Section 10.5):

1. Alcohol Act marketing rules
2. Price-list / price-information provisions
3. Hyperlinks to foreign alcohol retailers
4. Comparative advertising
5. Search-engine indexing
6. Subscription monetization
7. Email notifications
8. Personalization
9. Rankings
10. Strong vs. mild alcoholic beverages
11. User-generated content
12. Age-gating

The business plan is explicit that the label *"neutral price index"* is **not** treated
as legal protection in itself. The opinion must assess the **actual operation** (what is
displayed, the wording, links, rankings, notifications), not just the branding.

### Step-by-step

1. **Select counsel** — a Finnish law firm with Alcohol Act (Alkoholilaki 1102/2017)
   and alcohol-marketing expertise. If they do not also cover tax, engage separate tax
   counsel for T1.66 / T1.67.
2. **Prepare a briefing package** describing the actual product. Include at minimum:
   - Platform positioning: an independent cross-border **landed-cost calculator**, not a
     shop (no checkout, no alcohol payment, no orders, no transport arrangement).
   - The exact user flow: search → product → quantity → landed-cost breakdown → outbound
     merchant link.
   - The ranking methodology (objective sort orders only — no paid boost).
   - The wording/tone used on the site and in any notifications.
   - The age gate as implemented (lightweight confirmation, not identity verification).
   - The subscription model (Free / Premium €4.99/month — the only commercial transaction).
   - Any planned email notifications, personalization, or user-generated content
     (disclose the roadmap even if deferred).
   - The outbound-links design (plain links, click-count analytics only, no
     affiliate/commission tracking).
   - The 1 Sep 2024 joint-liability messaging shown to users.
3. **Ask for a written opinion** answering each of the 12 topics with a clear
   **compliant / compliant-with-conditions / not-compliant** conclusion, plus any
   required mitigating changes.
4. **Convert "compliant-with-conditions" findings into action items** and feed them back
   to engineering (e.g. stronger age verification → the pluggable module from T1.59;
   wording changes → a content-lint rule).
5. **Archive the opinion** (dated, signed PDF) in a compliance folder — this is evidence
   for the T1.69 launch decision.

**Deliverable:** signed written opinion + internal sign-off "legal opinion obtained."

---

## T1.66 — Confirm the Tax Administration source is mapped to every tax rule

### What is needed

Every rule in the versioned `taxRules` dataset must carry a correct, verifiable
reference to the official **Finnish Tax Administration (Verohallinto)** source. The code
already enforces an `officialSource` + `verificationDate` field per rule and the seeded
v1.0-2024 rates already cite the vero.fi "Excise Duty on Alcohol and Alcoholic
Beverages" page. **This task is the human verification that those citations are correct
and complete** — including the container-duty engine, not just excise.

### Step-by-step

1. **Extract the rule inventory.** Produce a table of every active `taxRules` row:
   tax type (excise / container duty), product category, rate, effective range, formula
   reference, `officialSource`, `verificationDate`, `versionLabel`.
2. **Map each row to the current official page** on vero.fi:
   - Excise duty on alcohol & alcoholic beverages (rates table).
   - Beverage-container duty (€0.51/litre + deposit-return exemptions).
   Confirm rate, effective date, and that the recorded URL is current. **Check for any
   rate change since the v1.0-2024 seed** — if rates changed, the T1.23 rate-review flow
   exists to catch it (see Recurring Duties).
3. **Flag discrepancies** (wrong rate, stale date, dead link, missing container-duty
   source). Corrections are applied as a **new versioned entry** (append-only), never an
   in-place edit.
4. **Record the confirmation**: date of check, reviewer name/role, set of URLs verified.

**Deliverable:** confirmed mapping table (rule → official source URL) + sign-off that
every rule has a live, correct official source.

---

## T1.67 — Validate distance-selling / distance-buying logic with tax counsel

### What is needed

The `TransactionClassificationModule` decides per calculation whether a transaction is
**Distance Selling**, **Distance Buying**, or **Traveller Import (excluded)**. These
determine which party owes Finnish excise duty and what the user is told about advance
notices/guarantees (including the 1 Sep 2024 joint-liability rules). The module is
deliberately phrased as observed-pattern + evidence ("likely distance selling, based
on…"), never a bare legal conclusion. **Confirm with tax counsel that the classification
logic is legally correct.**

### Step-by-step

1. **Give tax counsel the classification rules** — export the versioned, dated rule sets
   in plain language: inputs (who books/pays carrier, delivery-to-Finland signals,
   seller-involvement indicator) and the three outputs.
2. **Walk through representative scenarios**: retailer-arranged transport, independent
   carrier, personal import/traveller case. Confirm each maps to the correct legal
   classification and that the confidence/evidence phrasing is defensible.
3. **Confirm downstream messaging** in the Excise Declaration Assistant: for *distance
   buying*, the guidance toward MyTax for advance-notice, guarantee, and excise filing
   must be accurate.
4. **Check for legislative changes** since the rules were written. If counsel flags a
   change, rules are updated as a **new dated version** (append-only), never edited.
5. **Record the sign-off**: rule-set version validated, by whom, on what date.

**Deliverable:** tax counsel's confirmation that classification rules and user guidance
are legally accurate for the current rule-set version.

---

## T1.68 — Review outbound merchant links and subscription marketing

### What is needed

Two commercial surfaces need compliance review before launch:

1. **Outbound merchant links** — a service that *systematically directs consumers to
   alcohol merchants* may raise different issues from a purely informational
   publication. Currently designed as **plain links with click-count analytics only**
   (no purchase/commission/affiliate tracking — T1.50).
2. **Subscription marketing** — the *only* commercial transaction is the software
   subscription (Free / Premium €4.99). Its marketing copy must not cross into
   alcohol-marketing or promotional language.

### Step-by-step

1. **Document the outbound-link behavior**: link rendering, `rel="nofollow noopener"
   target="_blank"`, the redirect endpoint (`/api/v1/outbound/:offerId`), and what is
   logged (click count only — no purchase tracking, no commission, no affiliate ID).
   Include the neutrality-isolation guarantee (ranking module has no billing/payment
   inputs).
2. **Have counsel opine** on whether this link pattern is compliant (and under what
   conditions — e.g. labeling, nofollow, no commission).
3. **Collect subscription marketing materials** (pricing page, email templates, upgrade
   prompts) for review against Alcohol Act marketing rules — ensure no promotional
   alcohol language leaks into the subscription pitch.
4. **Record required changes** and hand them to engineering.
5. **Sign off** once links and marketing are compliant.

**Deliverable:** counsel's confirmation that outbound links and subscription marketing
are compliant, plus a record that no affiliate/commission mechanism exists.

---

## T1.69 — Confirm all launch conditions and toggle the flag

### What is needed

The **final go/no-go decision**, made by the project owner. Manual counterpart to the
technical launch gate: confirm all Critical Launch Conditions (business plan Section 29)
are satisfied, then open the gate.

### Step-by-step

1. **Re-read the Critical Launch Conditions** (Section 29) and confirm each category:
   - **Legal** — opinion (T1.65), outbound-links review (T1.68), subscription-marketing
     review, GDPR/privacy review, consumer-protection disclosures, tax-information
     disclaimers.
   - **Tax** — Tax Administration sources mapped (T1.66), version-controlled tax tables,
     automated tax tests, separate alcohol/container-duty handling, distance-selling/buying
     validated (T1.67).
   - **Data** — source-permission policy, merchant reliability framework, price/shipping
     timestamping, stale-data detection (engineering-complete per T1.8–T1.11).
   - **Product** — transparent breakdown, visible assumptions, confidence indicators,
     correction mechanism, official-source references (per T1.32–T1.55).
   - **Commercial** — MVP user testing, willingness-to-pay test, premium conversion test,
     infrastructure cost model, customer-acquisition strategy.
2. **Assemble evidence** for the three technical gates:
   - `LAUNCH_GATE_LEGAL_OPINION` → T1.65 + T1.68 sign-offs.
   - `LAUNCH_GATE_TAX_SOURCE_MAPPING` → T1.66 + T1.67 sign-offs.
   - `LAUNCH_GATE_CORRECTION_MECHANISM` → already built (T1.54/T1.55); verify deployed.
3. **Record the decision** — a dated, written launch-authorization note listing each
   condition as satisfied.
4. **Open the gate** by setting env vars in the **production** config (NOT the dev
   override):
   - `LAUNCH_GATE_LEGAL_OPINION=true`
   - `LAUNCH_GATE_TAX_SOURCE_MAPPING=true`
   - `LAUNCH_GATE_CORRECTION_MECHANISM=true`
   - Do **not** rely on `LAUNCH_GATES_OVERRIDE=true` (dev/demo only).
5. **Verify** the gate is open in production (`getGateStatus()` returns
   `launchReady: true`) and that calculation + price-data endpoints return 200 (not 403)
   for a real anonymous user.
6. **Keep the opinion and all sign-offs on file** as ongoing evidence.

**Deliverable:** dated launch-authorization record + all three gate env vars set `true`
in production.

---

## Recurring / conditional manual duties

**T1.23 — Rate-review legal confirmation (recurring).** The rate-review job detects
official rate changes via a SHA-256 snapshot diff but **never auto-publishes** — it
creates a *pending review entry for manual/legal confirmation*. Whenever Verohallinto
changes excise or container-duty rates, **you** (or tax counsel) must review and approve
before a new `taxRules` version goes live. Standing process: detect → review → approve →
publish as a new versioned entry.

**T1.59 / T1.61 — Conditional outcomes of the legal opinion.** Final form depends on
T1.65:
- If the opinion says simple age confirmation is insufficient, commission the stronger
  verification flow (the pluggable module already has an upgrade path — T1.59).
- If counsel mandates identity/DOB collection (unlikely, against the minimal-data
  principle), that requires schema changes — currently zero identity/DOB fields exist
  (T1.61 audited). **Do not introduce them unless the opinion explicitly requires it.**

---

## Suggested execution order

```
1. Engage Finnish counsel (alcohol law + tax)          → unblocks T1.65, T1.66, T1.67, T1.68
2. T1.66 (tax source mapping) + T1.67 (classification) → parallel, tax-counsel work
3. T1.65 (legal opinion) + T1.68 (links/marketing)     → parallel, alcohol-law counsel work
4. T1.69 (launch decision)                             → only after 1–3, plus commercial tests
5. Toggle the three LAUNCH_GATE_* env vars in prod
```

Critical dependency: **T1.69 cannot complete until T1.65–T1.68 are signed off**, and the
technical launch gate keeps the product dark until then — by design, since the business
plan ranks regulatory/tax risk as the highest-severity risk.

---

*Last updated: 2026-08-21 — derived from tasks.md and Rajahinta-FI.docx*
