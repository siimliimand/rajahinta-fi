# Rajahinta.fi user guide

This guide explains how to use the Rajahinta.fi website: estimating what a beverage bought abroad actually costs once it lands in Finland. It covers every page, how to read the results, and what the reliability and confidence labels mean.

Rajahinta.fi is an information service. It does not sell alcohol, does not process payments for alcohol, and does not place orders. It calculates estimates from published prices and official tax rates.

## Getting started

Open the site in any modern browser. The first screen is the age gate.

### The age gate

The site deals with alcohol-related content, so it asks whether you are 18 or older.

- Choose "Yes, I am 18+" to enter. Your answer is stored in a cookie for one year, so you will not be asked on every page. No date of birth is collected, only the confirmation.
- Choose "No" and you are redirected away from the site without seeing restricted content.

You can clear the confirmation at any time by clearing the site's cookies, and the gate will appear again.

### The home page

Four links:

- Open calculator: estimate the total cost of one product
- Compare products: put several products side by side
- How ranking works: the public explanation of how sorting works and why it cannot be bought
- My account: your calculation history, saved baskets, and scenarios

## The calculator

The calculator answers "what would this product cost in total, delivered to Finland?". The flow is search, select, set quantity, calculate.

### Step 1: search for a product

Type at least two characters of a product name and submit. Matching products appear in a list with brand, category, volume, and the lowest known price. Searching again clears the previous selection.

### Step 2: select a product

Pick one product from the results. The selection panel shows the product name, brand, category, and volume. Use "Change" to go back to the results.

### Step 3: set quantity and calculate

Set the quantity with the selector, then press "Calculate landed cost". The destination is Finland by default.

### Reading the result

The result is an itemized list. Each line shows the cost in euros and a reliability label:

| Line | What it is |
|---|---|
| Retail price | The current best foreign price for the product |
| Transport | Estimated carrier cost for the route and weight |
| Alcohol excise | Finnish alcohol excise duty for the category and alcohol content |
| Container duty | Finnish beverage-container duty per litre, zero when the packaging is in the Finnish deposit-return system |
| Total | The sum, in euros |

Every reliability label is one of:

- VERIFIED: confirmed against an authoritative source
- ESTIMATED: derived from incomplete or indirect data, treat as approximate
- STALE: the data passed its freshness threshold, refresh is pending
- UNAVAILABLE: no data exists for this component

The overall confidence grade (HIGH, MEDIUM, LOW) combines the reliability of all inputs. HIGH means all key inputs were verified. LOW means at least one important input was estimated or missing; the total is then a rough guide only.

Every result also carries the disclaimer: the total is an estimated cost in Finland, not a final legal tax liability. The estimate is based on published rates that can change and on data with the freshness shown.

Additional panels may appear depending on enabled features:

- Price history: a chart of past prices and landed costs for the product, optionally filtered to one merchant. You can switch between daily and weekly granularity. The chart covers up to one year at a time.
- Declaration guidance: a plain-language summary of how the excise on this calculation would be declared. It is guidance, not legal advice.
- Report export: download the calculation as JSON or CSV, or open a printable HTML report. Some export formats require a premium subscription.
- Correction flag: if a number looks wrong, press the flag control, say what looks wrong, and submit. Corrections go to a review queue; they do not change the data directly.
- Scenario controls: save the current inputs under a name so you can rerun the same calculation later against fresh data. Loading a scenario reruns the calculation; it never replays a stale stored result. If the product has disappeared since, you get a normal not-found error.

The result page has a permanent link of its own, so you can bookmark or share a specific calculation.

## Comparing products

The compare page puts multiple products side by side.

1. Press "+ Add product" and search, exactly like in the calculator.
2. Each added product gets a column with its landed-cost breakdown, confidence, and the merchants that currently offer it.
3. Change the sort order with the selector. The available orders are lowest landed cost, lowest per litre, lowest per unit, alcohol percentage, category, and alphabetical. All of them are objective and deterministic; the tiebreaker is always the product name.
4. "About this comparison" at the bottom restates the sort in use and links to the ranking methodology page.
5. Merchant freshness shows when each merchant's prices were last observed, so you know how current the columns are.
6. Merchant links lead to the merchant's product page through the site's redirect endpoint, which counts clicks. The site records only the click, never a purchase.

The page also includes a multi-store basket comparison section (see below) when the basket feature is enabled.

## The basket optimizer

Buying several products? The basket page finds the cheapest split across stores, because one shop may be cheaper for wine while another is cheaper for beer, and shipping is priced per shipment.

1. Search and add products, set quantities, up to ten lines.
2. The optimizer produces one or more combinations. Each combination groups the basket into shipments, one per merchant.
3. Each shipment shows its items, its consolidated transport estimate, the subtotal, and a threshold check. The threshold check tells you whether the order meets the store's minimum order value. Orders below a verified minimum are excluded as infeasible; when the threshold data is not verified, the combination is shown but with reduced confidence.
4. Combinations are ordered by total landed cost. The confidence badge and breakdown explain how much of the plan rests on estimated data.

## Your account

The account page works without registration. On your first visit the site creates an anonymous session identifier stored in a cookie. Nothing links it to your identity.

- Calculation history: your recent calculations, newest first. Open any entry to see the full result.
- Saved baskets: product collections you saved for repeat calculations.
- Saved scenarios: named calculator input sets (product, quantity, destination). Save the current calculator inputs from the calculator page, and load or delete them here.
- Data export: download everything the site stores about your session as a JSON file. This is the GDPR access path.
- Deleting the session cookie (or asking for deletion) removes the link to this data; retention jobs purge inactive sessions.

If account features are temporarily unavailable, the page degrades quietly; history and scenarios simply do not show.

## How ranking works

The ranking page publishes the sorting methodology: every sort order is objective, all inputs are factual product attributes, no merchant payment or manual boost can move a product, equal values fall back to alphabetical order, and the same data always produces the same order. The same text is available from the API as machine-readable JSON.

## Limits and error handling

To keep the service responsive, request limits apply per IP: roughly 60 requests per minute in general, 10 per minute for calculations, 30 for search and history charts. When you exceed a limit you get a "try again" message with the wait time.

Errors you may see:

- "Age confirmation required": the confirmation cookie is missing or expired. Reload the page and confirm again.
- "Product not found" or "no retail offers": the product was removed or has no current offers.
- "Product lacks regulatory classification": the product cannot be calculated safely, so it is excluded rather than guessed.
- Feature-off messages: some surfaces (history charts, reports, declaration guidance) are switched off by feature flags during review. The UI hides them rather than erroring.

## Using the API directly

Developers can call the same API the site uses. Interactive documentation is at `/api/docs` (Swagger) on the backend host.

Practical rules:

- Send the age confirmation on every request, either as the `x-age-confirmed` header or the `age_confirmed` cookie. Without it the API answers 403.
- Account-scoped routes (`/api/v1/account/...`) use the session cookie. The server issues the session: call `POST /api/v1/account/session` once, store the cookie it sets (`rajahinta_session`), and send it back on every account request. The cookie is httpOnly and the token is stored hashed, so it cannot be read from scripts. Do not invent your own session identifier; requests carrying a client-supplied user ID header are rejected with 401.
- Calculations accept an `x-idempotency-key` header. Replaying the same key returns the cached result and an `X-Cache: HIT` header instead of recalculating. Cache entries invalidate automatically when a tax-dataset version changes.
- Respect the rate limits above; exceeding them returns 429 with a `Retry-After` header.

Example calculation:

```bash
curl -X POST http://localhost:3000/api/v1/calculator \
  -H "Content-Type: application/json" \
  -H "x-age-confirmed: yes" \
  -d '{"productId": 1, "quantity": 6, "destination": "FI"}'
```

## Frequently asked questions

Is the total what I will actually pay?
It is an estimate. Retail prices and carrier rates change, and your actual tax liability depends on circumstances the calculator cannot see. The disclaimer exists for exactly this reason.

Why does a price say STALE?
The last verified observation is older than the freshness threshold for that data type. Prices go stale after 24 hours, transport rates after 7 days.

Why is a product excluded from calculation?
Products without a regulatory classification are excluded. A guessed classification could produce a wrong tax figure, which is worse than no figure.

Can a merchant pay for a better position?
No. The sorting input type physically has no field for promotion, and a compliance test suite fails the build if anyone tries to add one. The methodology page states this publicly.

Do I need an account?
No. The site works anonymously, and the session cookie is created for you automatically.
