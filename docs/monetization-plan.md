# Monetization plan

Working monetization strategy for Rajahinta.fi, consolidated from an advisory review of the
product's revenue model. Non-technical by design: it describes what customers get for free,
what they pay for, why the fence sits where it sits, and in what order to build it.
Numbers marked **illustrative** are structural examples pending real cost and traffic data;
they establish the shape of the economics, not the final figures.

---

## 1. The revenue principle

The service sells exactly one thing: **the service itself.** Never placement, never influence,
never merchant money. Payment buys the subscriber convenience and depth — it must never be
able to buy a better-sounding number.

Everything else follows from one fence rule:

> **Charge for ongoing convenience and depth. Never charge for the core honest answer.**

The landed-cost number, the comparison to Alko, and the market picture are the product's
credibility. They stay free and open, because they are also the marketing: every shared
permalink and search result is an acquisition channel that costs nothing.

## 2. Pricing decision: freemium, not a paywall

Gating the whole site behind a subscription was evaluated and **rejected**. The reasoning is
recorded so it is not re-litigated later:

- **Broken sharing loop.** The share-and-embed feature only works if the recipient can see
  the result. A shared calculation that lands on a paywall ends the conversation — and ends
  the referral.
- **Trust contradiction.** A price-transparency brand that hides the numbers behind a login
  is no longer a transparency brand. The brand promise is the acquisition engine; the paywall
  would shut the engine off.
- **Zero-trial conversion.** An unknown utility brand asking for payment before demonstrating
  value converts at close to zero, and would force paid advertising to even explain the
  product — reversing the acquisition economics.

**Price point:** €25–40 per year, annual billing emphasized. Monthly billing is deliberately
de-emphasized: usage is episodic (ferry trips, events, seasonal hauls), and annual pricing
matches how often the customer actually needs the product. A seasonal option ("trip season
pass") may be tested after the annual plan has real subscribers.

## 3. The tier fence

### Free — no account, unlimited

The open surface. Its job is acquisition and trust.

- Landed-Cost Calculator, Basket Optimizer, Trip Calculator, Event Calculator (basic)
- Product catalog, search, and comparison
- Price history for the last 30 days
- €/g value rankings and Savings Explorer
- Public permalinks and embeds
- Packing help and the Travel Allowances Explorer
- **Report Reality and the Corrections Channel stay free.** Community-contributed accuracy
  data is the moat; charging for it would strangle the source.

### Free — registered account (email capture fence)

Its job is turning visitors into an audience. Limits are generous; the goal is sign-ups, not
friction.

- Favorites
- Up to 3 saved scenarios or baskets
- Weekly digest (consent-first)
- What-If Simulator
- Group Order Ledger for small groups

### Paid — the subscription (€25–40/year)

Its job is retention and revenue. Every paid item is either a *continuous service* (something
that works while the user is not looking) or *depth* (more history, more capacity, more
control). This is deliberate: these are the features with real running costs and the clearest
willingness to pay.

- **Price Alerts — the anchor paid feature.** Unlimited alerts, category-level thresholds,
  landed-cost triggers, price-drop and category-move notifications. This is the flagship
  "works while you sleep" feature and the easiest to explain: *we watch, you get told.*
- Full 90-day and 365-day price history
- Unlimited saved scenarios and baskets
- Event-scale Group Order Ledger (larger groups, settlement exports)
- Data export (CSV) for personal records
- Everything in the free account, without limits

**Fence integrity rule:** the free tier is never retroactively reduced. A trust-branded
product that removes previously free features has broken its own pitch. Build the fence
correctly the first time; grow free features freely, but never claw them back.

## 4. The missing paid layer: proactive features

A gap analysis of the current feature set found one structural omission: **the product is
entirely reactive.** Every existing feature waits for the user to arrive. Recurring revenue
requires a layer that acts on the user's behalf without being asked. Three additions, in
order of value:

### 4.1 Restock Planner — the retention anchor

Many users buy roughly the same haul every few months. Saved baskets and favorites make that
rhythm visible. The Restock Planner models it and proactively tells the user:

> "Your restock is due around 10 March. Current basket: €184. After the January tax change:
> €203. The buy window is open now."

- Converts 4–6 accidental visits per year into 12–24 deliberate touchpoints.
- Gives the subscriber a standing, predictable answer to "what did this subscription do for
  me this year?" — which is the only question that matters at renewal time.
- Strictly opt-in: the consumption model is visible to the user, editable, and deletable.
  It infers only what the restock reminder requires.

### 4.2 Tax-change pre-buy alerts — monetizing the calendar

The Tax-Change Calendar already collects confirmed veromuutos dates with official sources.
Today it is passive reference material. As a paid alert it becomes a deadline:

> "The excise change confirmed for 1 January raises your three favorites by a combined €19.
> Buy before the change."

- Time-sensitive, concrete, and impossible for a free spreadsheet to replicate — proprietary
  data turned into a decision window.
- Demonstrable consumer surplus: a 5–10% excise change on a typical haul is €15–25 in real
  money. A feature that visibly protects that amount annually pays back the subscription
  price twice over.

### 4.3 Commercial data API — revenue diversification

The read-only data surface currently gives away the most durable asset: versioned rates,
price history, reliability scores, all with citations. A metered commercial tier adds a
second revenue line with no dependence on consumer viral growth.

- Target customers: journalists covering alcohol policy, researchers, aggregators, and
  agent/answer-engine platforms that want the truth straight from the source.
- **Illustrative concentration math:** twenty commercial customers at €100/month equal the
  revenue of roughly 600 consumer subscribers — acquired individually, and far stickier.
- Prerequisite: publish Report Reality accuracy statistics first. Commercial customers will
  ask one question — "how accurate is it?" — and the answer must already be public.

## 5. Illustrative unit economics

Real costs and traffic data will replace this section's numbers. The structure is the point:

| Assumption (illustrative) | Value |
|---|---|
| Planned price | €30/year (midpoint) |
| Monthly operating costs (feeds, hosting, email, maintenance) | €5,000 |
| Required active subscribers to break even | ~2,000 |
| Free-to-paid conversion (typical consumer freemium) | 1–3% |
| Registered users needed at 2% conversion | ~100,000 |
| Visitor-to-registration target | ~25% |
| Reachable Finnish cross-border-buying audience | a niche of ~5.6 million; must be measured, not assumed |

Reading of the table: the free tier's job is to make the top of that funnel as large and as
cheap as possible, because conversion is where freemium businesses die. If honest traffic
estimates cannot plausibly reach the required registered-user count, this is a lifestyle
project rather than a growth business — a conclusion to reach **consciously, before** major
investment, not after.

Two cost facts to verify with real data:

1. **Free-rider cost.** A one-shot calculation costs fractions of a cent; free riders on
   cheap features are affordable by design.
2. **Alert cost at scale.** Continuous monitoring and email delivery are cheap per user and
   expensive at ten thousand users. Alert counts are metered on the free tier from day one.

## 6. Metrics and go/no-go gates

Each phase has a gate. A missed gate is a product problem to diagnose, not a marketing
problem to spend through.

| Gate | Target (initial, revisable) |
|---|---|
| Demand validation | 100+ committed sign-ups at a stated price before paid build starts |
| Visitor → registered | ≥ 25% |
| Registered → paid | ≥ 2% |
| Alert engagement | ≥ 60% of sent alerts opened (below that: too many or too noisy) |
| Annual renewal | ≥ 70% (the number the Restock Planner exists to move) |

## 7. Sequencing

Build order, cheapest validation first. Nothing later in the list starts until its
predecessor's gate is met.

1. **Demand validation.** A stated price point and a signup list. No code.
2. **Free tier as described in §3.** Instrument activation: calculations per visitor,
   permalink shares, search rankings.
3. **Registration fence.** Free accounts with the limited-feature set; measure the
   visitor→registered gate.
4. **Paid launch with Price Alerts.** The anchor feature, annual billing emphasized.
   Measure the registered→paid gate.
5. **Tax pre-buy alerts.** Reuses calendar data already maintained; extends the paid tier.
6. **Restock Planner.** The retention anchor; requires the opt-in consumption model and a
   data-protection review before launch.
7. **Commercial API tier.** Last: requires published accuracy stats, stable data quality,
   and drafted usage terms before the first customer signs anything.

## 8. Risks and hard rules

- **Policy risk — the unhedgeable one.** The product's value depends on the Finnish–Estonian
  price gap, which is an artifact of excise politics. A Finnish tax cut or Estonian rate
  change can compress it overnight. The What-If Simulator shows users exactly how this works;
  the business plan must assume the gap can shrink and the subscription value must survive
  it (the proactive layer in §4 is that survival strategy).
- **Churn from episodic use.** Join before the trip, cancel after. Annual pricing, pre-buy
  deadlines, and the Restock Planner are the countermeasures; renewal rate is the metric.
- **Notification fatigue.** One ignored alert trains the user to ignore all alerts. Frequency
  caps are aggressive by default; every notification must be worth opening.
- **Sensitive profiling.** A model that infers how much alcohol a named person drinks is
  GDPR-relevant personal data with health-adjacent implications. Opt-in, user-visible,
  user-deletable, minimal by design. One mishandling incident and the trust brand is
  finished. Legal review is a prerequisite, not an afterthought.
- **Algorithmic integrity.** "Buy now" recommendations, rankings, and savings claims are
  provably independent of any commercial party. The rule is published, as with everything
  else.
- **Free-tier cost creep.** Generosity is priced, not accidental: alert metering, history
  depth, and saved-scenario limits are the levers that keep the free tier affordable at scale.

## 9. Explicit non-negotiables

1. No merchant pays for position, ranking, or presentation — ever.
2. The landed-cost answer stays free and open.
3. The community features (Report Reality, Corrections) stay free.
4. The fence is never moved retroactively against the user.
5. Payment buys convenience, depth, and monitoring — never influence.

## 10. Disclaimer

This plan was produced with AI assistance as strategic analysis, not certified counsel.
Before executing: validate pricing and conversion assumptions with real pilot data, and
review the subscription terms, the consumption-model data handling, and any commercial data
licensing with a qualified human advisor and a Finnish legal professional.
