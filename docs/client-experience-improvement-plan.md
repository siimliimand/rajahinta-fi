# Client Experience Improvement Plan: Rajahinta.fi

**Date:** 2026-09-26
**Status:** Validated Against `master` Branch
**Target Audience:** Product Engineering, UX/Design, Legal & Operations

---

## 1. Executive Summary

Rajahinta.fi has a strong backend foundation — the tax engines, calculation logic, and data pipeline are well-engineered. The opportunity now is to make the frontend experience match that quality so that visitors feel **helped, not confused**.

A codebase audit of `master` found that the user-facing layer has trust-breaking patterns (a hero search bar that isn't a search bar, merchant names you can't click, a dead-end if you accidentally decline the age gate) alongside gaps that make the site feel incomplete (no search on the catalog page, manual €/l entry in calculators). These are fixable, and fixing them transforms Rajahinta from "interesting tool with rough edges" into "the place Finnish cross-border shoppers trust and recommend."

### Validation Matrix

| Area / Feature | Status on `master` | Impact |
|---|---|---|
| **Hero Search Bar** | ❌ Decorative `<div>`, not an input | **Trust-breaking.** Users feel tricked. |
| **Search on `/products`** | ❌ No search input on catalog page | Users can't find products where they expect to. |
| **Category + Search Combined** | ⚠️ Partially working | Filtering by category while searching is silently ignored. |
| **Sorting** | ❌ Returns HTTP 400 for price/ABV sort | UI offers options that crash the page. |
| **Merchant Links on Product Page** | ❌ Plain text, not clickable | Users can see a price but can't act on it. |
| **Trip & Event Calculator Inputs** | ❌ Manual €/l across 6 categories | Feels like a tax form, not a helpful tool. |
| **Trip Allowance Fill** | ❌ Requires login (401 for guests) | Blocks the core value proposition behind a wall. |
| **Basket Limit** | ❌ 10 items max | Too low for real event planning. |
| **Rate Limiting** | ❌ 10 req/min on calculators | Punishes normal interactive use. |
| **Age Gate Decline** | ❌ Dead end, no recovery | Accidental clicks lock users out. |

---

## 2. Understanding What Clients Actually Want

Before fixing individual issues, it helps to think about what brings someone to Rajahinta and what would make them come back or recommend it.

### 2.1 Who Are the Clients?

| Persona | What they want | What would make them love us |
|---|---|---|
| **Casual cross-border shopper** | "Is it actually cheaper to order from Estonia?" | A clear, instant answer with the total landed cost — no spreadsheet needed. |
| **Party / event planner** | "How much will drinks for 40 people cost, and where should I order?" | A tool that gives them a shopping list with the best combination of stores, including shipping. |
| **Annual bulk buyer** | "I'm driving to Tallinn — what should I bring back, and what's the allowance?" | Trip planning that knows the rules and suggests the optimal cart. |
| **Price-conscious Alko shopper** | "Is this wine cheaper to import or just buy at Alko?" | Side-by-side comparison with honest totals. |

### 2.2 The Emotional Journey We're Designing

```
ARRIVE → "This looks like it can help me"
  SEARCH → "I found what I'm looking for quickly"
    COMPARE → "I can clearly see the real cost difference"
      DECIDE → "I feel confident this is accurate"
        ACT → "I can click through to buy, or plan my trip"
          RETURN → "I'll use this again next time"
```

Every fix below is evaluated against this journey: does it move clients toward confidence and action, or does it create doubt and friction?

---

## 3. Core Problems & How Clients Experience Them

### 3.1 Broken Promises (Things That Actively Erode Trust)

These are the worst category — they make clients feel deceived or trapped.

1. **The Fake Hero Search Bar.** The homepage has a large, styled element that looks exactly like a search input with placeholder text *"Search products… e.g. Koskenkorva, IPA, Rioja."* It is not an input. Clicking it navigates to `/calculator` with nothing pre-filled. This is the single most damaging UX pattern on the site — it teaches visitors that the site's UI lies to them.

2. **Sort Options That Crash.** The product catalog exposes sort-by-price and sort-by-ABV controls. Clicking them produces a blank error state (HTTP 400). Offering controls that break is worse than not offering them at all.

3. **The Hostile Age Gate.** Clicking "No" on the age confirmation — which anyone might do accidentally, or if they're momentarily confused by the question — leads to a dead-end page with no way back. No "I made a mistake" link, no automatic timeout, no way to restart. The user must clear cookies manually to recover.

### 3.2 Missing Expectations (Things That Make the Site Feel Incomplete)

These don't actively deceive, but they disappoint users who expect standard e-commerce patterns.

1. **Unclickable Merchant Names.** On product detail pages (`/products/[id]`), offers show merchant names and prices, but the merchant names are plain text. The user sees a good price but has no way to act on it. (The `/compare` page does have clickable outbound links — this is an inconsistency, not an architectural gap.)

2. **No Search on the Product Catalog.** The `/products` page shows category pills and pagination, but no search input. To search by keyword, the user must navigate to `/calculator` — a different mental model entirely.

3. **No Stock Information.** Offers don't indicate availability. A user could plan an entire order around a product that's been out of stock for weeks.

### 3.3 Unnecessary Friction (Things That Make Users Work Too Hard)

1. **Manual €/Litre Entry in Calculators.** The Trip Calculator and Event Calculator require users to manually type domestic and foreign prices per litre for six excise categories, including bureaucratic labels like `intermediate_products` and `other_fermented`. Normal people don't know these categories, let alone the current €/l price of cider in Tallinn. This is Rajahinta's job — the site has the data, it should fill it in.

2. **Login Wall on Trip Allowance Fill.** The Trip Calculator's "Fill Mode" (which auto-populates allowance limits) requires authentication. This blocks anonymous visitors from the most useful feature of the calculator.

3. **10-Item Basket Cap.** Wedding planners and annual bulk buyers — high-value users — can't use the basket optimizer because it caps at 10 items. This turns away exactly the users who would become advocates.

4. **Aggressive Rate Limiting.** Calculator and basket endpoints are throttled to 10 requests per minute per IP. During normal interactive use (adjusting quantities, trying different products), users hit 429 errors. This punishes engagement.
---

## 4. Improvement Plan

### Phase 0: Stop Active Trust Damage (Do First — Days, Not Weeks)

These changes remove patterns that actively harm the relationship with every visitor. Ship them before anything else.

#### 0.1 Make the Hero Search Bar Real

* **File:** `apps/frontend/src/app/[locale]/page.tsx`
* **Change:** Replace the decorative `<div>` with an actual `<form>` containing a real `<input type="search">`. Submitting navigates to `/calculator?q={term}` with results pre-loaded.
* **Why first:** This is the first thing a new visitor interacts with. Every hour it stays fake, it breaks trust with every new user.

#### 0.2 Fix or Remove Broken Sort Controls

* **Files:** `apps/api-worker/src/routes/search.routes.ts`, `D1ProductSearchRepository`
* **Change:** Either implement `LOWEST_PRICE` and `ALCOHOL_PERCENTAGE` sorting (the D1 schema has the columns), or hide sort options that aren't implemented. Never show a control that produces an error.
* **Recommended approach:** Implement the sorting — it's a straightforward `ORDER BY` on existing columns and adds genuine value.

#### 0.3 Add Recovery to Age Gate Decline

* **File:** `apps/frontend/src/app/[locale]/age-gate/declined/page.tsx`
* **Change:** Add a clear "Painoin vahingossa — yritä uudelleen" / "I clicked by accident — try again" link that clears the decline cookie and re-presents the age confirmation.
* **Tone matters:** The message should be warm and non-judgmental, not legalistic. The user made a mistake, not a binding legal declaration.

---

### Phase 1: Meet Basic Expectations (1–2 Weeks)

These changes bring the site to baseline e-commerce standards.

#### 1.1 Add Search to the Product Catalog

* **File:** `apps/frontend/src/app/[locale]/products/page.tsx`
* **Change:** Add a search input at the top of the catalog page. Wire it to the existing search API, passing both `q` and `category` parameters.
* **Backend fix:** Update `repo.searchRanked` in `apps/api-worker/src/routes/search.routes.ts` to accept and apply `categoryParam` when `q` is present.

#### 1.2 Make Merchant Names Clickable on Product Pages

* **File:** `apps/frontend/src/app/[locale]/products/[id]/page.tsx`
* **Change:** Replace plain-text merchant names with clickable outbound links via `/api/v1/outbound/:offerId`, matching the existing implementation on `/compare`.
* **Detail:** Style the link as a clear call-to-action — "Katso kaupassa →" or "View at store →" — not just a blue underline on the merchant name. Users need to understand they're leaving Rajahinta.

#### 1.3 Remove Login Requirement from Trip Fill

* **File:** `apps/api-worker/src/routes/trip.routes.ts`
* **Change:** Remove `sessionAuth()` from `POST /api/v1/trip/fill`. Let anonymous users access allowance fill freely.
* **Rationale:** This feature is the Trip Calculator's core value. Gating it behind login before users have experienced the value puts the paywall before the proof.

#### 1.4 Increase Basket Capacity to 30 Items

* **Files:** `packages/core-domain/src/optimizer/optimizer.types.ts`, basket routes, basket frontend view
* **Change:** Raise `MAX_BASKET_ITEMS` from 10 to 30. Verify that `MAX_TOTAL_COMBINATIONS` pruning prevents exponential search time.
* **UX note:** Show a progress indicator ("12/30 items") so users know the limit exists without hitting it unexpectedly.

#### 1.5 Relax Rate Limits for Interactive Use

* **File:** `apps/api-worker/src/middleware/rate-limit.ts`
* **Change:** Increase `CALCULATOR` and `BASKET` profiles from 10 req/min to 60 req/min per IP. Keep strict limits on auth and submission endpoints.
* **Add a friendly 429 message:** If a user does hit the limit, show "Hetkinen — lasketaan vielä edellistä" ("Just a moment — still calculating the previous one") instead of a raw error.

---

### Phase 2: Reduce Friction & Add Intelligence (2–4 Weeks)

These changes make the calculators feel smart rather than demanding.

#### 2.1 Pre-Populate Calculators with Real Market Data

* **Files:** `TripForm.tsx`, `EventForm.tsx`, new API endpoint
* **Change:**
  1. Create `GET /api/v1/benchmarks/category-averages` that returns current average €/l per category from actual catalog data (Alko domestic average, cross-border webshop average).
  2. Pre-fill calculator forms with these benchmarks by default.
  3. Show a clear toggle: **"Käytä keskihintoja"** (Use average prices) vs **"Syötä omat hinnat"** (Enter custom prices).
  4. Replace bureaucratic category labels with consumer language:

| Current Label | New Label (FI) | New Label (EN) |
|---|---|---|
| `beer` | Olut | Beer |
| `wine_still` | Viini | Wine |
| `wine_sparkling` | Kuohuviini | Sparkling wine |
| `intermediate_products` | Väkevöidyt viinit (vermutti, portviini) | Fortified wines (vermouth, port) |
| `other_fermented` | Lonkerot ja siiderit | Long drinks & ciders |
| `spirits` | Väkevät | Spirits |

#### 2.2 Friendly Loading & Error States

* **Where:** All pages that fetch data
* **Change:**
  - **Loading:** Use the existing `LoadingSkeleton` component consistently. On calculator pages, show "Lasketaan…" (Calculating…) with a subtle animation — never a blank screen.
  - **Empty states:** When a search returns no results, suggest alternatives: "Emme löytäneet '${query}'. Kokeile laajempaa hakua tai selaa kategorioittain." ("We couldn't find '${query}'. Try a broader search or browse by category.")
  - **Errors:** Replace raw HTTP error codes with human messages. A 500 should show "Jokin meni pieleen — yritä hetken kuluttua uudelleen" ("Something went wrong — try again in a moment") with a retry button.

---

### Phase 3: Build Trust & Transparency (1–2 Months)

These changes make Rajahinta the authoritative and transparent source for cross-border pricing.

#### 3.1 Stock Availability

* **Change:** Ingest and surface stock status (`in_stock`, `low_stock`, `out_of_stock`) for every offer.
* **Display:** A small badge next to each offer. Out-of-stock offers stay visible (for price history context) but are visually de-emphasized and excluded from calculator defaults.

#### 3.2 Tax Status Guidance (Etämyynti vs Etäosto)

* **Context:** Finnish buyers worry about customs confiscation and back-taxes when ordering alcohol from abroad. Rajahinta can help them understand their obligations clearly.
* **Implementation:** Add a status badge next to each merchant offer:
  - 🟢 **Etämyynti** — The merchant handles Finnish alcohol tax. No extra steps for the buyer.
  - 🟡 **Etäosto** — The buyer arranges transport and is responsible for excise declaration. Link to a step-by-step guide (hosted on Rajahinta at `/guides/etaosto-ohje`).
* **Tone guidance:** Frame this as **empowering**, not scary. The message is "here's exactly what you need to do" — not "WARNING: you may face confiscation." People who feel informed make confident purchases. People who feel warned leave the site.
* **Legal note:** Label the guidance as general information, not legal advice. Rajahinta's disclaimer framework already supports this.

---

### Phase 4: Create Delight (Ongoing)

These are the things that make people *recommend* Rajahinta to friends. They're not urgent, but they're what separates a useful tool from a beloved one.

#### 4.1 "Paljonko säästät?" — Savings Summary

After any calculation, show a clear, prominent savings summary: *"Tilaamalla Virosta säästät arviolta **€47,20** verrattuna Alkon hintaan."* ("By ordering from Estonia, you save an estimated **€47.20** compared to Alko's price.") This is the emotional payoff of the entire service.

#### 4.2 Share Your Calculation

Let users share a calculation result via a link (the `shareSnapshots` infrastructure already exists in the backend). When a user finds a great deal, make it effortless to send it to a friend: "Katso, Karhu 24-pack on €15 halvempi Virosta!" This turns every satisfied user into a referral channel.

#### 4.3 Smart Trip Suggestions

In the Trip Calculator, after the user enters their destination and rough shopping list, show a compact suggestion: *"Tiesitkö? Viime kuussa Tallinnasta tilaajat säästivät keskimäärin 34% oluissa."* ("Did you know? Last month, people ordering from Tallinn saved an average of 34% on beer.") Use real data from the savings snapshots.

#### 4.4 Mobile-First Refinements

Finnish consumers compare prices on their phones — on the ferry, in a harbor shop, at home on the couch. Ensure:
- Calculator results are readable without horizontal scrolling
- Touch targets are ≥44px (especially category pills and quantity controls)
- The hero search bar is prominent and immediately tappable on mobile
- Product comparison tables collapse to a card layout on small screens

---

## 5. Anti-Patterns to Avoid

These are well-intentioned changes that would create new things clients hate. Keep this list visible during implementation.

| ❌ Don't | ✅ Do Instead | Why |
|---|---|---|
| Pop up a newsletter modal on first visit | Offer newsletter subscription on the blog and in the footer | First-visit popups are the #1 reason people bounce from new sites. |
| Require registration to use the calculator | Let anonymous users do everything; registration adds value (saved baskets, alerts) | Gating core value behind login destroys trust before it's built. |
| Add cookie consent banners that block content | Use a non-blocking bottom bar with clear accept/decline | Full-page cookie walls feel hostile, especially combined with the age gate. |
| Show scary legal warnings next to every price | Show a single, well-placed disclaimer per page | Over-disclaiming makes users feel the numbers are unreliable. |
| Auto-play video or animations | Use subtle transitions; let users control media | Unexpected movement feels cheap and slows the page. |
| Use dark patterns to encourage registration ("Only 3 free calculations left!") | Show the genuine benefits of registration | Finnish consumers are allergic to manipulation. |
| Redirect users away from their current page without explanation | Always explain where a link goes, and why | Unexpected redirects break trust — this is literally the hero search bar problem. |
| Show prices without tax context | Always show the total landed cost, not just the product price | A low sticker price that becomes expensive after taxes feels like a bait-and-switch. |

---

## 6. Success Metrics

How we'll know clients are happier:

| Metric | Current State (Estimated) | Target |
|---|---|---|
| Homepage bounce rate | High (fake search bar drives exits) | < 40% |
| Calculator completion rate | Low (manual input friction) | > 60% of started calculations completed |
| Basket abandonment at 10-item cap | Unknown, but cap is hit | < 5% of baskets hit the item cap |
| 429 rate-limit errors on calculator | Frequent during interactive use | < 0.1% of calculator requests |
| Outbound click-through to merchants | 0% on product pages (no links) | > 15% of product page views |
| Return visitor rate | Unknown | > 30% within 30 days |
| Age gate recovery | 0% (dead end) | 100% can recover from accidental decline |

---

## 7. Implementation Priority Summary

```
WEEK 1        Phase 0: Stop Trust Damage
              ├── 0.1 Real hero search bar
              ├── 0.2 Fix/remove broken sort controls
              └── 0.3 Age gate recovery

WEEKS 2-3     Phase 1: Meet Expectations
              ├── 1.1 Search on catalog page
              ├── 1.2 Clickable merchant links
              ├── 1.3 Remove trip fill login wall
              ├── 1.4 Basket capacity → 30
              └── 1.5 Relax rate limits

WEEKS 4-7     Phase 2: Reduce Friction
              ├── 2.1 Pre-populated calculators
              └── 2.2 Friendly loading/error states

MONTHS 2-3    Phase 3: Trust & Transparency
              ├── 3.1 Stock availability
              └── 3.2 Tax status guidance

ONGOING       Phase 4: Delight
              ├── 4.1 Savings summary
              ├── 4.2 Share calculations
              ├── 4.3 Smart trip suggestions
              └── 4.4 Mobile refinements
```
