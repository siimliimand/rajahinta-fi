# Rajahinta.fi user guide

This guide explains how to use the Rajahinta.fi website: estimating what a beverage bought abroad actually costs once it lands in Finland, planning purchases and events, and tracking prices over time. It covers every page, how to read the results, and what the reliability and confidence labels mean.

Rajahinta.fi is an information service. It does not sell alcohol, does not process payments for alcohol, and does not place orders. It calculates estimates from published prices and official tax rates.

The site is in Finnish by default; an English version is available under `/en` (or the language switch in the header).

## Getting started

Open the site in any modern browser. The first screen is the age gate.

### The age gate

The site deals with alcohol-related content, so it asks whether you are 18 or older.

- Choose "Yes, I am 18+" to enter. Your answer is stored in a cookie for one year, so you will not be asked on every page. No date of birth is collected, only the confirmation.
- Choose "No" and you are redirected away from the site without seeing restricted content.

You can clear the confirmation at any time by clearing the site's cookies, and the gate will appear again.

### The home page and the header

The header on every page shows the main destinations:

- Calculator: estimate the total cost of one product
- Compare products: put several products side by side
- Basket: find the cheapest store split for a multi-product purchase
- My account: your calculation history, saved baskets, scenarios, and price alerts
- How ranking works: the public explanation of how sorting works and why it cannot be bought

When you are signed out, the header also shows **Log in** and **Register**. When you are signed in, it shows the account link and **Log out** instead.

Three planning calculators also appear in the header: **Event calculator**, **Trip calculator**, and **What-if calculator**. Two more features are reached by link rather than the header: **group orders** (via a share link or `/group-order`) and **curated lists** (via `/lists/<name>` links shared around or listed in the site's sitemap). The **blog** (`/blog`) and the **€/g value page** (`/value`) work the same way — direct addresses and links rather than header slots.

## The calculator

The calculator answers "what would this product cost in total, delivered to Finland?". The flow is search, select, set quantity, calculate.

### Step 1: search for a product

Type at least two characters of a product name and submit. Matching products appear in a list with brand, category, volume, and the lowest known price. When the package size and price are known, the results also show the **unit price** (euros per litre), which makes different bottle sizes directly comparable. Searching again clears the previous selection.

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

If the product has a current Alko domestic reference price, the result also shows a factual comparison against it: the Alko price, the difference in euros and percent, and, plainly stated, when importing is not cheaper. The comparison is informational only — it never changes any line of the estimate or its total.

Additional panels may appear depending on enabled features:

- Price history: a chart of past prices and landed costs for the product, optionally filtered to one merchant. You can switch between daily and weekly granularity. The chart covers up to one year at a time.
- Declaration guidance: a plain-language summary of how the excise on this calculation would be declared. It is guidance, not legal advice.
- Report export: download the calculation as JSON or CSV, or open a printable HTML report. Some export formats require a premium subscription.
- Correction flag: if a number looks wrong, press the flag control, say what looks wrong, and submit. Corrections go to a review queue; they do not change the data directly.
- Scenario controls: save the current inputs under a name so you can rerun the same calculation later against fresh data. Loading a scenario reruns the calculation; it never replays a stale stored result. If the product has disappeared since, you get a normal not-found error.

The result page has a permanent link of its own, so you can bookmark or share a specific calculation.

## Product pages

Every product has its own page (open one from search results, a comparison, or a list entry). The page collects everything known about that product in one place:

- **Product details**: brand, category, package size, container type, EAN.
- **Retail prices**: the currently known prices per merchant, with the country of the merchant and when the price was last observed. Prices are collected observations, not live shop offers.
- **Unit price**: euros per litre, when the package size and price are known.
- **Landed-cost shortcut**: a note linking to the calculator for the full Finnish cost estimate.
- **Products from the same manufacturer abroad**: an editorially curated panel of sibling products from the same producer in other markets. Every link is backed by a verified manufacturer and published with its source — these are not ads or affiliate links. The panel appears only for products that have reviewed entries, so most products show nothing there yet.
- **Price alert shortcut**: a control to set an alert for this product (see "Price alerts" below).

## Comparing products

The compare page puts multiple products side by side.

1. Press "+ Add product" and search, exactly like in the calculator.
2. Each added product gets a column with its landed-cost breakdown, confidence, and the merchants that currently offer it.
3. Change the sort order with the selector. The available orders are lowest landed cost, lowest per litre, lowest per unit, alcohol percentage, category, and alphabetical. All of them are objective and deterministic; the tiebreaker is always the product name.
4. "About this comparison" at the bottom restates the sort in use and links to the ranking methodology page.
5. Merchant freshness shows when each merchant's prices were last observed, so you know how current the columns are.
6. Merchant links lead to the merchant's product page through the site's redirect endpoint, which counts clicks. The site records only the click, never a purchase.

The page also includes a multi-store basket comparison section (see below).

## The basket optimizer

Buying several products? The basket page finds the cheapest split across stores, because one shop may be cheaper for wine while another is cheaper for beer, and shipping is priced per shipment.

1. Search and add products, set quantities, up to ten lines.
2. Choose the destination country and the transport arrangement (seller-arranged, independent carrier, or personal carry-across — the last one works with single-store combinations only).
3. The optimizer produces one or more combinations. Each combination groups the basket into shipments, one per merchant.
4. Each shipment shows its items, its consolidated transport estimate, the subtotal, and a threshold check. The threshold check tells you whether the order meets the store's minimum order value. Orders below a verified minimum are excluded as infeasible; when the threshold data is not verified, the combination is shown but with reduced confidence.
5. Combinations are ordered by total landed cost. The confidence badge and breakdown explain how much of the plan rests on estimated data.
6. A **packing suggestion** section may appear: an advisory view of how the haul could be packed (box fill levels, with warnings when glass/can unit counts or combined weight exceed thresholds). It is a suggestion only — the carrier determines the final packing method.

## The event calculator

Planning a party? The event calculator estimates how much drink you need and what it would cost. Open it from the header ("Event calculator").

1. Enter the **number of guests**, the **duration in hours**, and the **event type** (casual gathering, dinner party, celebration), plus the event date.
2. Press calculate. The result is a **shopping list**: for each drink type, how much you need, a suggested purchase, and the likely surplus.

### Comparing with foreign stores (V2)

Tick "Compare with foreign stores" to turn the estimate into a cross-border plan:

- Pick the **comparison country**: Estonia, Latvia, Lithuania, or Germany.
- Enter the **price per litre** for each drink type at home and abroad (at least one row; a foreign price always requires the domestic comparison price).
- Optionally enter a **budget** — the plan tells you explicitly if it overruns.
- Optionally tick the packing suggestion for the haul brought from abroad.

The result shows, per drink type, whether buying abroad for this event makes sense, and the totals for each option.

## The trip calculator

Driving or sailing abroad and wondering how much is worth bringing back? The trip calculator works out the break-even import volumes against the traveller allowances. Open it from the header ("Trip calculator").

1. Enter the practical facts: **number of passengers**, **vehicle** (car or van), total **ticket** cost, and total **fuel** cost.
2. For one or more drink categories (beer, still wine, sparkling wine, vermouth-type products, cider and long drink, spirits), enter the **price per litre in Finland and abroad**.
3. Press "Calculate break-even volume".

The result shows, per category:

- The **break-even import volume**: below it, buying abroad does not pay off once travel costs are shared in; above it, each litre saves money.
- The **allowance cap**: the official traveller limit for that category and how it cuts off further savings. The calculation always respects the caps — it never suggests bringing more than you may import.

If ferry operators have published offers relevant to the route, a separate **ferry offers** block appears below the results. It is provided for information only and is never part of the calculation.

### Fill mode: plan a basket inside your allowance

The trip page also has a fill mode. Instead of asking "when does importing pay off?", it asks "what should I buy with my duty-free allowance?":

1. Switch to the fill mode and enter your **allowance budget** and **travel date**.
2. Search and pick the candidate products you are considering.
3. Press calculate.

The result is a suggested basket of products and quantities whose total duty-free value fits inside the allowance that is in force **on your travel date** (not today's limit — the official limits are versioned, and the result names the version it used). Each line shows its contribution to the total and how much allowance is left. The ferry-offer block, if present, stays in its own section below and never affects the selection.

## The what-if calculator

Curious how a tax change would affect prices? The what-if calculator substitutes the Finnish alcohol excise rate with a value of your choice and recalculates. Open it from the header ("What-if calculator").

1. Set the **hypothetical excise rate** (0–1000 € per formula unit; the unit follows each category's formula, such as € per litre of pure alcohol).
2. Add product rows: category, alcohol by volume, volume, and the prices you want to compare against.
3. Press "Recalculate".

The result shows per product and in total: the excise and import total at the **current rate** versus the **hypothetical rate**, and the change between them. Every calculation is clearly labelled **hypothetical** and uses a fixed baseline rate dataset (the version is shown with the result).

The calculation itself is not stored anywhere. You can share it as a **link** that reopens the same scenario, or copy an **embed code** that shows the same calculation on another site without the site navigation — both carry the same disclaimer.

## Price alerts

Want to know when something about a product changes? Alerts watch a product and notify you by email. There are two kinds:

- **Price alerts** fire when the observed price drops below a threshold you set.
- **Tax-change alerts** fire when a confirmed change in official rates actually moves the product's estimated landed cost. They need no threshold — the trigger is the rate change itself.

To set either:

1. Open a product page and use the alert control, or go to **My account → "Manage price alerts"**.
2. Search and select the product. For a price alert, enter your **price threshold in euros** (0.01–10 000, at most two decimals). For a tax-change alert, just pick the tax-change kind.
3. Press "Add alert".

The site checks price alerts periodically after its data updates; tax-change alerts are checked when a new official rate version is confirmed — never while you browse. When your alert matches, you receive an email with the observed price or the old and new landed cost. All your alerts are listed in the account view, where you can pause or remove them. One product has one alert of each kind at a time; a duplicate attempt is reported instead of silently added.

Whatever the kind, you get at most one email per alert per 24 hours, even if the condition matches again within the window.

## Group orders

Splitting a purchase with friends? A group order is a shared session where everyone adds their items and Rajahinta divides the shared costs. Open `/group-order` (or a share link you received).

One person creates the session:

1. Press "Create session". You need to be signed in to your Rajahinta account.
2. You receive a **shareable link, valid for 7 days**. Give it to the participants.

Each participant:

1. Opens the link and picks a **nickname** (1–64 characters). Only the nickname is stored, with no contact details.
2. Adds items to the order under that nickname.

The session view shows the items with their valuations and a **transfers breakdown**: the minimal set of "who pays whom" steps that settles the shared costs fairly. A standing note reminds everyone that settlement itself happens **outside the tool** — Rajahinta keeps the ledger but never handles money. When the 7 days pass, the link stops working with a clear "session has expired" message.

## Curated lists

Curated lists are editorial collections: a themed set of products where every entry carries a written rationale and its evidence. Open them via `/lists/<name>` links (they are also listed in the site's sitemap for search engines).

Each list page shows:

- The **curation criteria**: the standard a product had to meet to qualify. The criteria are the list's editorial contract.
- The **entries**: each with a rationale and **evidence links** that open in a new tab and point to the source material behind the pick.
- A link to each product's own product page.

If a list has no published entries yet, the page says so and shows the criteria — the standard is public even before the picks are.

## Merchant warnings and reporting a shop

Some merchants are genuinely unreliable. When enough verified evidence exists against one — confirmed non-delivery by three or more independent reports, or a confirmed invalid business registration — a human operator publishes a warning, and that warning appears wherever the merchant's offers appear: product pages, search results, and comparisons. The warning names the merchant and links to the ranking-methodology page. It never removes an offer, changes a price, or reorders anything — you see the same numbers with or without it. An appeal by the merchant reopens the entry and the warning disappears until the appeal is resolved.

You can report a shop yourself:

1. Sign in and submit a report against the merchant's web address, including your **order reference** and a **summary of the correspondence** — the evidence fields are required.
2. Reports go to a human review queue, not to any automatic list. Nothing is published without operator review against the standard above.
3. Reports are rate-limited and the actions around them are logged, like the rest of the site's moderation trail.

A merchant with reports but no published warning shows no badge — publication is the gate, not the accusation.

## Reporting what your import actually cost

Every estimate on the site is exactly that — an estimate. If you bought the product, you can close the loop: within **60 days** of a calculation, open the record in **My account → History** and report the **actual total cost** you ended up paying. One report per calculation.

Aggregated, reported outcomes power the site's public accuracy statistic: how many outcomes were reported, and what share of them landed within 5% of the estimate. You can see it on the home page's trust row and on the methodology page. Three things about that number, always:

- It is based on **user-reported outcomes** — people telling the site what they paid, not verified receipts.
- The **sample size is shown** next to it.
- When nothing has been reported yet, the site says so plainly instead of showing a percentage over zero.

## The blog and the newsletter

When the site confirms a new version of the official tax rates, it drafts blog posts automatically — what changed, the effective date, and the estimated impact on a typical basket, in Finnish and English. Every post is reviewed and published by a human before it appears; drafts are never visible publicly. The blog lives at `/blog`, and published posts are also listed in the site's sitemap.

The **newsletter** is the low-frequency companion: an email when something worth announcing has been published. How it works:

1. Submit your address in the subscribe form (in the blog or the site footer). The form states plainly that you are subscribing to the newsletter — this consent is separate from any price alerts you may have.
2. You receive a confirmation email with a link. **Until you open that link, nothing is sent to the address** — no confirmation, no newsletter.
3. Once confirmed, you receive newsletter sends. Every newsletter email carries a one-click unsubscribe link; following it ends the subscription immediately.

## Sharing a calculation and embedding the calculator

A calculation result page has its own permanent link, but you can also create a **share link**: a frozen, public copy of the result under an unguessable address. Creating one needs an account; viewing one does not.

- The snapshot is copied at the moment you create the link. Later changes to the calculation — or its eventual deletion by retention — do not affect the shared page.
- The snapshot carries the same structural disclaimer as the result it came from: the total is an estimated cost in Finland, not a final legal tax liability.
- No account information is in the snapshot or the page around it — just the product, the numbers, and the disclaimer.
- A link that does not exist shows a normal not-found page; the site does not reveal which links do exist.

If you want the calculator on your own site, `/embed/calculator` is an embeddable version with the navigation stripped. It shows the same age gate and disclaimers as the main site, and calculations made through it go through exactly the same checks as the main application — embedding is not a shortcut around anything.

## The €/g value page

`/value` lists the products of one category by **euros per gram of pure alcohol** — a factual ratio of price to ethanol content, computed the same way as the €/g figure on product and compare pages. The order is strictly by the number (ties fall back to a stable secondary key), so the same data always produces the same list. Each row carries the reliability status of its underlying price, and products with no computable €/g are left out rather than guessed into a position.

The page is an informational listing. It does not call anything best or recommended, and it does not influence any other ordering or calculation on the site.

## Your account

Account features need a free Rajahinta account. You register with an email address and a password, and the email address is your username on the site. Calculating, comparing, and the planning tools stay open to everyone; an account is what carries your data from one visit to the next.

### Registering and the password policy

Press "Register" in the header, enter your email address, and choose a password. The password must be at least 12 characters and at most 128. There are no other composition rules (no forced symbols or capital letters), so a long passphrase of unrelated words works well. The email address is treated case-insensitively, and one address can have only one account.

Registration signs you in immediately, so the account is usable right away, and sends a verification link to your address. If the verification email cannot be sent at that moment, the registration still succeeds and the account view shows a "verification email pending" note with a way to request the mail again.

### The unverified badge

Until you open the verification link, the account is marked **unverified**. The badge is a status marker, not a lockout: history, saved baskets, scenarios, price alerts, and data export all work either way. It tells you honestly whether the address on file has been confirmed, which matters when emails from the site (price alerts, password reset) need to reach you. The verification link is valid for 24 hours and works once; if it expires, request a new one from the account view.

### Signing in and out

"Log in" in the header takes your email address and password. A wrong email address and a wrong password produce the same message; the site does not reveal which one failed. "Log out" ends your session on that device.

### Forgot your password?

Use the "Forgot password" link on the login page and enter your email address. You see a confirmation either way; a reset link is only actually sent when the address belongs to an account, so the form cannot be used to probe who has one. The reset link is valid for one hour and works once. Setting a new password signs you out on every device, and you sign in again with the new password.

### What the account holds

- Calculation history: your recent calculations, newest first. Open any entry to see the full result; records from the last 60 days invite you to report what the import actually cost (see above).
- Saved baskets: product collections you saved for repeat calculations.
- Saved scenarios: named calculator input sets (product, quantity, destination). Save the current calculator inputs from the calculator page, and load or delete them here.
- Price and tax-change alerts: add, review, pause, and remove your alerts (see above).
- Data export: download everything the site stores about your account as a JSON file. This is the GDPR access path.

Signing out ends the session on one device; resetting your password ends every session. Retention jobs purge inactive accounts and their data.

If account features are temporarily unavailable, the page degrades quietly; history and scenarios simply do not show.

## How ranking works

The ranking page publishes the sorting methodology: every sort order is objective, all inputs are factual product attributes, no merchant payment or manual boost can move a product, equal values fall back to alphabetical order, and the same data always produces the same order. The same text is available from the API as machine-readable JSON.

## Limits and error handling

To keep the service responsive, request limits apply per IP: roughly 60 requests per minute in general, 10 per minute for calculations, 30 for search and history charts. When you exceed a limit you get a "try again" message with the wait time.

Errors you may see:

- "Age confirmation required": the confirmation cookie is missing or expired. Reload the page and confirm again.
- "Product not found" or "no retail offers": the product was removed or has no current offers.
- "Product lacks regulatory classification": the product cannot be calculated safely, so it is excluded rather than guessed.
- "The session has expired": a group order link past its 7-day validity. Ask the session owner to create a new one.
- Some surfaces degrade quietly when the data behind them is temporarily unavailable — history and scenarios simply do not show until the service recovers.

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
For anything you save or submit, yes: history, saved baskets, scenarios, price and tax-change alerts, outcome reports, shop reports, share links, group orders, and data export need a free account. Calculating, comparing, the planning tools, reading the blog, viewing a share link, and the €/g ranking work without one. Registration asks for an email address and a password.

Why does my account show "unverified"?
You have not confirmed your email address yet. The account works normally, and the badge clears once you open the verification link from your email (valid 24 hours; you can request a new link from the account view).

Are the ferry offers or the "same manufacturer" links ads?
No. Ferry offers are displayed in a separate block that never affects any calculation, and manufacturer-sibling links are editorially curated with published evidence. Neither is a paid placement.

Does the group order take payments?
No. It is a shared ledger only: it divides costs and suggests who should pay whom. The actual settling happens outside the tool, and the session stores nothing but nicknames and items.

Is the what-if calculation a prediction?
No. It substitutes one number — the excise rate — with a hypothetical value on a fixed baseline. It shows a mechanical consequence, not a forecast, and it is labelled hypothetical everywhere it appears.

Why does the "same manufacturer" panel not show anything for my product?
The panel only lists reviewed entries. Products without reviewed entries show nothing yet, rather than guessing similar products.

How long does a group order link work?
Seven days from creation. After that the link expires and a new session is needed.

What does the accuracy percentage actually mean?
It is the share of **user-reported** outcomes that landed within 5% of the estimate, with the sample size shown next to it. It measures how the estimates have held up against what people said they actually paid — it is not a verified audit of anyone's purchase, and it says nothing about any individual future calculation.

Why does a shop show a warning badge?
An operator published a blacklist entry for that merchant after the evidence met the published standard (three or more independent confirmed non-delivery reports, or a confirmed invalid business registration). The badge is informational: your results, their order, and every number are identical with or without it. Merchants can appeal, and a reopened entry stops showing immediately.

Does subscribing to the newsletter sign me up for anything else?
No. Newsletter consent is stored separately from price alerts, nothing is sent until you confirm the subscription email, and every newsletter carries a one-click unsubscribe link that works immediately.

What does a share link reveal about me?
Nothing about your account. The share page renders a frozen copy of the calculation — product, numbers, disclaimer — under an unguessable address, with no session and no account identifiers.

Is the allowance-fill basket what I am allowed to bring in?
It is a plan that fits inside the traveller allowance in force on your travel date, resolved from the versioned official limits. It is a shopping plan, not a customs ruling; the allowance version used is shown with the result.
