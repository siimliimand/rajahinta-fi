# Rajahinta.fi

## 1. What the service is

Rajahinta.fi is a cross-border beverage **price index and landed-cost calculator** aimed
at consumers in Finland. The user selects an alcoholic beverage found in a foreign
(retail) assortment, and the service estimates the **total cost of getting that product
to Finland**: foreign retail price + transport + estimated Finnish alcohol excise duty +
estimated beverage-container duty. Each figure is an estimate carrying a reliability
label and timestamp.

It is **not a shop**:

- No checkout and no payment collection for alcohol or any physical good.
- No order management, no warehousing, no transport arrangement — the platform never
  buys, ships, or resells alcohol. The user transacts directly with the foreign merchant.
- The only commercial transaction on the platform is the software subscription
  (Free / Premium €4.99/month, Section 4.6).

Infrastructure facts counsel may need: the production stack runs on Cloudflare Workers
with all data stores pinned to the **EU jurisdiction** (D1 database and R2 buckets created
with `--jurisdiction=eu`, `infra/environments/prod.yaml`). Accounts are anonymous by
default; no email address or name is required (`apps/frontend/src/messages/fi.json`,
`Account.anonymousBody`: *"Sähköpostia tai henkilötietoja ei vaadita."*).

Launch status: the calculation and price-data endpoints are **not publicly accessible
yet**. A technical launch gate (`LaunchGateService`) returns 403 until the legal opinion
(this engagement), the tax-source mapping (T1.66–T1.67), and the correction mechanism are
confirmed. Visitors currently see: *"Laskuri ei ole vielä käytössä."*
(`apps/frontend/src/messages/fi.json`, `GateClosed`).

## 2. Data sources and provenance shown to users

| Fact | Implementation |
|---|---|
| Foreign prices come from Systembolaget's published assortment (SE) and an Alko domestic reference feed (FI), ingested through a per-merchant permission gate | `packages/data-acquisition/src/adapters/systembolaget.adapter.ts`, `alko.adapter.ts`; `SourceGovernanceService` (`packages/core-domain/src/governance/`) — a merchant must have permission status `GRANTED` before any of its data is fetched; new merchants default to `PENDING` (off) |
| SEK prices are converted to EUR at ingestion using a published, dated FX dataset built on ECB reference rates; the original amount and currency are kept as provenance | `ecb-rate.source.ts`; FX module `packages/core-domain/src/fx/` |
| Every displayed number carries a reliability status (`VERIFIED` / `ESTIMATED` / `STALE` / `UNAVAILABLE`), a timestamp, and the dataset versions used | `fi.json` `Common.reliability`; `ConfidenceFrameworkService` (`packages/core-domain/src/reliability/`) |
| Tax rates are versioned and never overwritten (seeded from official Tax Administration tables, v1.0-2024 … v3.0-2026); a past calculation resolves against the rate version effective on its date | `packages/data-platform/src/seed/tax-rules.seed.ts` |
| Product pages state that prices are collected observations, not live merchant offers | `fi.json` `ProductPage.dataNote`: *"Hinnat ovat kerättyjä havaintoja, eivät myyjien tarjouksia."* |

## 3. The user flow as implemented

1. **Age gate (first visit).** A modal asks *"Tämä sivusto sisältää alkoholiin liittyvää
   sisältöä. Oletko vähintään 18-vuotias?"* with buttons *"Olen 18 vuotta täyttänyt"* and
   *"En"*. Self-attestation only — see Section 4.12.
2. **Home page.** Value proposition: *"Laske alkoholijuomien tuonnin kokonaiskustannus
   Ruotsista ja muualta Euroopasta Suomeen: ulkomainen vähittäishinta, kuljetus sekä arviot alkoholin
   valmisteverosta ja pakkausverosta."* A static trust section names the data sources,
   the reliability labels, and the open methodology.
3. **Calculator.** The user searches a product (search over the ingested assortment),
   selects one product, a quantity, a destination country (default FI; 15 countries
   listed), and a transport arrangement: *"Myyjän järjestämä"* (seller-arranged),
   *"Riippumaton kuljetuspalvelu"* (independent carrier), or *"Oma kuljetus"* (personal,
   carried across the border by the buyer).
4. **Result.** An itemized estimate: foreign retail price, transport cost, estimated
   alcohol excise, estimated container duty, total. The structural disclaimer (below) is
   part of the result object itself, rendered on every result. The transaction
   classification and its evidence are shown. Premium-tier results add export and
   declaration guidance (Section 4.6).
5. **Outbound merchant link.** Each offer can be followed with a link labelled
   *"Katso myyjältä {merchant}"* ("view at merchant") which redirects to the merchant's
   own product page — see Section 4.3.
6. **Correction.** Every result has an *"Ilmoita virheestä"* ("report an error") action
   that files a tracked correction request for internal review (Section 4.11).

Footer on every page: *"Rajahinta.fi on riippumaton hintavertailu- ja
kokonaiskustannuslaskuri. Kaikki hinnat, verot ja maksut ovat arvioita eivätkä virallisia
tietoja. Palvelu ei tarjoa vero- tai tullineuvontaa. Tarkista ajantasaiset tiedot aina
viranomaislähteistä."* (`SiteFooter.disclaimer`)

Structural disclaimer on every calculation result, in Finnish and English
(`packages/core-domain/src/disclaimer.ts`, version 1.0):

> *"Arvioitu kokonaiskustannus Suomessa. Ei ole lopullinen verovelvollisuuden määrä.
> Lopullinen verovelvollisuus määräytyy Tullin ja Verohallinnon vahvistamien verokantojen
> ja säännösten mukaan."*

("Estimated total cost in Finland. Not final legal tax liability. Final tax liability is
determined by the tax rates and regulations established by Finnish Customs and the Tax
Administration.")

## 4. Facts for the twelve opinion topics

### 4.1 Alcohol Act marketing rules

- The service presents **factual, comparative cost data**, not promotional content.
- A banned-vocabulary linter screens ingested product names and descriptions for
  promotional or subjective wording (Finnish/English/Swedish: *"paras"*, *"edullisin"*,
  *"laadukas"*, *"best"*, *"cheapest"*, *"premium"*, *"exclusive"*, *"guaranteed"*, …).
  Violations are surfaced as a visible policy badge, not displayed as clean copy:
  `apps/frontend/src/lib/content-lint.ts`, backend `ContentLintService`, and the
  content-policy CI job (task T1.72 in `docs/tasks.md`).
- No alcohol-related advertising is sold or displayed anywhere on the platform; large-scale
  merchant advertising is explicitly deferred as a violation of the neutrality policy
  (`docs/tasks.md`, Explicit Deferrals).
- The only marketing copy on the site describes the calculator itself (Section 3) and the
  subscription (Section 4.6); neither describes alcohol products in promotional terms.

### 4.2 Price-list / price-information provisions

- Displayed prices are **collected observations** from public assortment data, each with
  a merchant, country, observation date, reliability status, and freshness labelling
  (stale data is labelled *"Vanhentunut"*, never silently shown as current).
- Product pages repeat that these are collected observations, not offers (Section 2).
- The estimate is always broken into its components so the price, transport, and each tax
  are visible and traceable separately; every result can be exported with per-line
  provenance (`ReportExportService`, `packages/application-api/src/reports/`).
- The platform does not sell alcohol and does not publish its own price list; it reports
  observed third-party prices. **Question for counsel:** whether this observation-based
  presentation satisfies price-information provisions that assume an offer to sell.

### 4.3 Hyperlinks to foreign alcohol retailers

- Links render through a redirect endpoint: `GET /api/v1/outbound/:offerId`
  (`apps/api-worker/src/routes/analytics.routes.ts`; legacy Nest equivalent
  `packages/application-api/src/analytics/outbound-redirect.controller.ts`). It looks up
  the offer, records a click count, and issues a **302 redirect** to the merchant's own
  product URL. 404 for unknown offers; rate-limited.
- Link markup on the site: `rel="nofollow noopener" target="_blank"`
  (`apps/frontend/src/app/[locale]/compare/components/MerchantLink.tsx`), standard link
  styling, no prominent call-to-action.
- What is logged: a **click count per offer** (in a durable counter,
  `apps/api-worker/src/do/click-counter.do.ts`, snapshotted to the database). No affiliate
  IDs, no tracking parameters, no purchase tracking, no commission. The affiliate/commission
  mechanism is on the explicit deferral list (`docs/tasks.md`, Explicit Deferrals).
- Link labels are neutral (*"Katso myyjältä {merchant}"*).

### 4.4 Comparative advertising

- Comparison views place products side by side with **equal visual weight**; the UI states:
  *"Mikään tuotteen asema ei perustu kaupallisiin tekijöihin — jokainen tuote saa saman
  visuaalisen painon."* (`fi.json`, `Compare.aboutBody`)
- All ordering is objective and deterministic (Section 4.9). There are no ratings, awards,
  editor picks, superlatives, or "recommended" labels; the basket view's *"Suositeltu
  yhdistelmä"* ("recommended combination") is the deterministic output of the cost
  optimizer, presented together with cost-ordered alternatives.
- The only merchant-level assessment is a **factual** reliability score (per-status
  observation counts/shares, freshest observation date, governance status) — no letter
  grades or subjective labels, and a compliance test proves it never alters sort order
  (`MerchantReliabilityScoreService`, `tests/compliance/`).

### 4.5 Search-engine indexing

- `apps/frontend/src/app/robots.ts`: all user agents are **allowed** on public comparison
  surfaces (home, calculator, product pages, methodology), with `/account` and `/age-gate`
  disallowed for every locale. A sitemap is published at `/sitemap.xml`.
- Per-product pages are public and carry neutral metadata (*"{name} — hintatiedot"*).
- Outbound merchant links carry `rel="nofollow"` (Section 4.3), so the platform neither
  accumulates nor conveys endorsement through links.
- **Question for counsel:** whether crawlable product-level price pages constitute
  "marketing" under the Alcohol Act, and whether any indexing restrictions are advisable.

### 4.6 Subscription monetization

- Plans: **Free** (browsing and landed-cost calculations) and **Premium €4.99/month**
  (detailed declaration guidance, report export). A Professional/API tier is future scope.
  Source: `packages/application-api/src/billing/billing.service.ts`.
- State of charging: **no real payment processing exists.** Third-party billing was
  explicitly deferred to Phase 2 (task T1.56); Phase 1 `BillingService` returns simulated
  responses. The account page labels subscription management *"Tulossa pian"* ("coming
  soon"). No subscription marketing materials exist yet beyond the account-page feature
  list.
- Entitlement gating only unlocks **software features** of the calculator; publicly
  available comparison information is not gated behind an account (task T1.60,
  `docs/tasks.md`).
- Neutrality isolation: the billing module has no input into ranking or comparison results;
  a source-level isolation test guards this (`billing-ranking-isolation.test.ts`, task
  T1.57). Premium status cannot change what an estimate says, only what tooling surrounds it.
- The Premium pitch references the subscription itself, never alcohol products; the word
  "premium" is additionally banned from ingested product copy by the content linter
  (Section 4.1).

### 4.7 Email notifications

- **None to consumers at launch.** The only email consumer is an internal operations
  freshness alert (stale-data thresholds) sent to the operator
  (`apps/email-worker/`, `ARCHITECTURE.md` §8).
- An email-verification endpoint exists as groundwork for accounts, but is not required;
  accounts without a verified email are documented as disposable
  (`ARCHITECTURE.md` §9, `/api/v1/account/verify-email`).
- Roadmap disclosure: promotional notifications and alcohol recommendations are on the
  explicit deferral list as violations of the neutrality/promotional-content policy
  (`docs/tasks.md`, Explicit Deferrals). If counsel requires conditions on any future
  transactional email, the platform can commit to transactional-only messaging.

### 4.8 Personalization

- No algorithmic personalization exists: no behavioral profiling, no recommendation
  engine, no personalized ordering. Sort orders are always explicit user selections from
  the objective list (Section 4.9).
- What exists instead is user-initiated persistence for logged-in (anonymous) accounts:
  saved baskets, saved calculation scenarios, and calculation history — private to the
  account, excluded from search indexing, and subject to automatic retention
  (accounts deleted after 12 months of inactivity, anonymized at 6 months; history deleted
  at 24 months; analytics anonymized at 12 months; `fi.json` `Account.retention*`).
- Roadmap disclosure: recommendations and promotional personalization are deferred as
  policy violations (Section 4.7).

### 4.9 Rankings

- One ranking module serves the whole product: `RankingService`
  (`packages/core-domain/src/ranking/ranking.service.ts`). It accepts exactly one input
  type, `NeutralSortInput`, whose allowed fields are: total cost, volume, quantity,
  product name, alcohol percentage, category. Nothing else.
- Six sort orders, all objective: lowest landed cost, lowest cost per litre, lowest cost
  per unit, alphabetical, alcohol percentage (descending), category. Alphabetical
  product name breaks ties; ordering is deterministic — the same data always produces the
  same order.
- Enforcement is layered: a type-system boundary, a compile-time assertion that a type
  with a `paidBoost` field cannot be passed in, and a runtime guard that rejects any input
  carrying undeclared properties. A compliance test suite
  (`pnpm test:compliance`, `tests/compliance/`) fails the build if any ranking result can
  correlate with a commercial or payment signal.
- The methodology is published: a public page ("Miten järjestäminen toimii") and
  `GET /api/v1/ranking/methodology`, kept in lockstep with the implementation (task
  T1.53). The page states: *"Rajahinta käyttää tuotteiden järjestämiseen vain
  objektiivisia, ei-kaupallisia tekijöitä. Mikään myyjän maksu, mainoslippu tai
  manuaalinen korostus voi vaikuttaa tuotteen sijaintiin."*

### 4.10 Strong vs. mild alcoholic beverages

- The calculator treats all beverages through the same pipeline; excise is computed from
  the official category/ABV-dependent rate tables (versioned v1.0-2024 … v3.0-2026), so a
  strong and a mild product differ only through the official rates that apply to them.
- No content, ranking, or marketing treats strong beverages differently; the one
  ABV-related sort order is a neutral numeric sort. The age gate is a uniform 18+
  self-attestation for the whole site, regardless of beverage strength.
- **Question for counsel:** whether the uniform 18 gate is sufficient for higher-strength
  products, and whether any display differences are required (see also Section 4.12).

### 4.11 User-generated content

- **None is published.** There are no reviews, comments, forums, or social features;
  these are on the explicit deferral list (`docs/tasks.md`, Explicit Deferrals).
- The one user input channel is the correction report (*"Ilmoita virheestä"*): free-text
  feedback on a specific calculation, filed to an internal review queue, visible only to
  operators, resolved with an audited decision. User text is never displayed to other
  users (`CorrectionFlag` UI; `CorrectionService`, `packages/core-domain/src/correction/`).

### 4.12 Age-gating

- Implemented as **self-attestation**, not identity verification. The modal text, buttons,
  and disclosure are quoted in Section 3; the note states: *"Henkilötietoja ei kerätä.
  Vahvistus tallennetaan selaimeesi paikallisena merkintänä."* ("No personal data is
  collected. The confirmation is stored locally in your browser.")
- Mechanics (`apps/frontend/src/app/[locale]/components/AgeGate.tsx`): a localStorage flag
  mirrored to a 24-hour `age_confirmed` cookie. Server-side rendering outputs an inert
  placeholder, so restricted content is absent from the initial HTML; the gate applies
  after mount. Declining clears the stored answer and routes to an in-house neutral page
  `/age-gate/declined` — never an external origin.
- Server side: `AgeGateService` with `SimpleConfirmationProvider`
  (`packages/application-api/src/age-gate/`) records only that a confirmation happened.
  The provider is a pluggable interface (`IVerificationProvider`) designed so a stronger
  verification method can replace it if counsel requires (task T1.59).
- **No identity documents or dates of birth exist anywhere in the schema** (audited, task
  T1.61). They will be introduced only if this opinion explicitly requires it.
- **Question for counsel:** whether self-attestation satisfies Finnish requirements for
  this kind of service, and whether the conditions in Section 4.10 apply.

## 5. Transaction classification and the joint-liability messaging

Every calculation classifies the transaction as **Distance Selling**, **Distance Buying**,
or **Traveller Import (excluded)** — the party who owes Finnish excise duty differs by
class. This logic is isolated in `packages/core-domain/src/classification/` with
versioned, dated rule sets.

What users actually see:

- The classification with its **evidence**, phrased as observed patterns, never bare legal
  conclusions. Examples from the declaration assistant
  (`packages/core-domain/src/declaration/excise-declaration.service.ts`): *"Entries
  observed in comparable MyTax excise declarations list the product category, alcohol by
  volume, container volume, and quantity as separate fields…"* and a closing line that
  observed declarations end with the filer reviewing each figure before submitting.
- Advance-notice guidance: *"Tämä luokittelu edellyttää ennakkilmoituksen tekemistä."* or
  *"Tämä luokittelu ei edellytä ennakkilmoitusta."*, with a computed deadline where
  applicable (`fi.json` `DeclarationGuidance`), plus per-class statutory obligation
  disclosures carrying counsel's formulations (advance-notice duty and the 1.9.2024
  joint-liability warning for Distance Selling).
- Official-source links (vero.fi) and a read-only MyTax reference checklist. The assistant
  **never submits anything** on the user's behalf (enforced by type-level tests).
- The engine implements versioned rule sets selected by transaction date:
  - **Version `1.0`** (effective 2024-01-01 to 2024-08-31) describes **pre-September-2024**
    legislation: Distance Selling as seller-liable (Alcohol Act 1102/2017, section 43),
    Distance Buying as buyer-liable on import (Tax Administration guidance VH/5088/00.01.00/2021),
    and Traveller Import excluded with duty-free allowances (Alcohol Act chapter 5).
  - **Version `2.0-2026.1`** (effective from 2024-09-01) implements the **post-1 Sep 2024
    joint-liability reform** (Excise Taxation Act 182/2010 as amended by Act 432/2024 / HE 45/2024 vp):
    in Distance Selling, the seller remains primary payer but the Finnish buyer is jointly
    liable if the seller defaults; in Distance Buying, the buyer must file an advance notice
    and lodge a guarantee prior to dispatch.
- **Disclosure:** Rule sets are append-only and never modified in place; past calculations resolve
  against the rule set effective on their calculation date (`createDefaultRuleSet()` and
  `createPostReformRuleSet()` in `classification-rule-engine.service.ts`). Legal validation of this
  classification logic and downstream MyTax guidance is tracked in parallel under T1.67.

## 6. Deferred and excluded features (full disclosure)

From `docs/tasks.md`, Explicit Deferrals — none of these exist in the product:

| Deferred item | Stated reason |
|---|---|
| Social features, reviews | Not in MVP scope |
| Alcohol recommendations, promotional notifications | Violates neutrality/promotional-content policy |
| Affiliate sales, commission tracking | Violates "no affiliate incentives at launch" policy |
| Loyalty systems | Not in MVP scope |
| Automated tax filing | Legal risk — platform prepares information only |
| Large-scale merchant advertising | Violates neutrality policy |
| Identity document storage | Not legally required for MVP; minimal data by design |
| Purchase tracking on outbound links | Violates "no purchase tracking at launch" policy |
| Third-party subscription billing | Deferred to Phase 2 (T1.56) |

## 7. Verification pointers

Counsel can verify any statement above against the repository (commit `dd47ece`):

| Topic | Primary sources |
|---|---|
| Positioning, architecture, EU residency | `ARCHITECTURE.md` §§1, 5, 8; `infra/environments/prod.yaml` |
| User flow and all Finnish UI strings | `apps/frontend/src/messages/fi.json` (English mirror: `en.json`) |
| Disclaimers | `packages/core-domain/src/disclaimer.ts`; `apps/frontend/src/app/[locale]/calculator/components/DisclaimerBanner.tsx` |
| Outbound links and click analytics | `apps/api-worker/src/routes/analytics.routes.ts`; `apps/frontend/src/app/[locale]/compare/components/MerchantLink.tsx`; `apps/api-worker/src/do/click-counter.do.ts` |
| Ranking and neutrality | `packages/core-domain/src/ranking/`; `tests/compliance/`; `GET /api/v1/ranking/methodology` |
| Content lint | `apps/frontend/src/lib/content-lint.ts`; backend `ContentLintService` |
| Age gate | `apps/frontend/src/app/[locale]/components/AgeGate.tsx`; `packages/application-api/src/age-gate/` |
| Subscription | `packages/application-api/src/billing/billing.service.ts` |
| Classification rule sets | `packages/core-domain/src/classification/services/classification-rule-engine.service.ts` |
| Declaration assistant phrasing | `packages/core-domain/src/declaration/excise-declaration.service.ts` |
| Indexing | `apps/frontend/src/app/robots.ts`; `apps/frontend/src/app/sitemap.ts` |
| Deferrals and task status | `docs/tasks.md` (Explicit Deferrals; tasks T1.56–T1.72) |
| Launch gate | `packages/application-api/src/feature-flags/` (`LaunchGateService`, `LaunchGateGuard`) |

Staging access for a live walkthrough can be arranged on request. `Siim Liimand`

---

*Prepared 2026-09-03 from commit dd47ece as the briefing package required by step 2 of
T1.65 in `docs/legal-tasks-guide.md`. Owner sign-off before sending: ______________________*
