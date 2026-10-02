# web-application Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.

## Requirements

### Requirement: Calculator UI

The calculator result view SHALL render an Alko benchmark line when the result carries the optional `alkoBenchmark` field: the Alko price, the difference in euros and percent, and the reference's reliability badge and timestamp. Wording SHALL be factual in both locales, including the plain statement when importing is not cheaper. The line SHALL NOT render when the field is absent, and SHALL never display as part of the total.

#### Scenario: Benchmark line rendering

- **WHEN** a result with a benchmark field is displayed, and a pre-change record without one is displayed
- **THEN** the first shows the factual benchmark line below the breakdown and the second shows the result unchanged with no placeholder

### Requirement: Explanation page

The application SHALL provide a calculation explanation page surfacing every figure's traceable inputs, rate dataset version, and timestamp.

#### Scenario: Trace a figure

- **WHEN** a user views the explanation for a result
- **THEN** each figure SHALL link back to its input value, dataset version, and timestamp

### Requirement: Neutral comparison views

Comparison views SHALL use neutral, objective ranking with no design element suggesting a paid or promoted position.

#### Scenario: No promoted styling

- **WHEN** results are ranked in a comparison view
- **THEN** no visual element SHALL indicate any paid or curated position

### Requirement: Freshness indicators

The UI SHALL surface reliability status and timestamp for every externally sourced fact.

#### Scenario: Stale price visible

- **WHEN** a price is stale
- **THEN** the UI SHALL visibly mark it stale with its timestamp, rather than presenting it like a verified figure

### Requirement: Plain outbound links

Outbound merchant links SHALL be plain links recorded for basic analytics only (click-through counts), with no purchase tracking or commission tracking infrastructure.

#### Scenario: Click recorded

- **WHEN** a user clicks a merchant link
- **THEN** the click SHALL be recorded as a count, and no purchase or commission data SHALL be collected

### Requirement: Controlled vocabulary

Product-listing copy SHALL be restricted to a controlled vocabulary (identification, classification, calculation, comparison) with no subjective adjectives. Enforcement SHALL run as an automated lint step in the content pipeline gating pull requests, not merely as a library available for ad-hoc use.

#### Scenario: Banned adjective in source

- **WHEN** generated copy or a source file contains a subjective adjective such as "best" or "amazing"
- **THEN** the content-policy lint step SHALL fail the build/CI with the offending word and context

#### Scenario: CI gate active

- **WHEN** a pull request is opened against the main branch
- **THEN** the content-policy check SHALL run as a gating job whose failure blocks the merge

### Requirement: Correction flag affordance

The calculator result page SHALL provide a "flag a problem" affordance that submits a correction request for the displayed calculation record (via `POST /api/v1/corrections`), and the ranking methodology page SHALL link to the correction flow. The affordance SHALL confirm to the user that a review item was created.

#### Scenario: User flags a result from the UI

- **WHEN** a user activates the flag affordance on a calculator result
- **THEN** the application SHALL submit the correction request referencing the calculation record and SHALL show confirmation

#### Scenario: Methodology page links the flow

- **WHEN** a user views the ranking methodology page
- **THEN** a link SHALL be present through which a correction can be raised

### Requirement: Historical charts in product views

The calculator result view and the compare page SHALL render a historical price chart and a historical landed-cost chart from the price-history API, with the tax-change attribution markers, reliability badges per series, and a statement of the earliest available observation date. Charts SHALL be hidden when the `enable_historical_price_intelligence` flag is disabled.

#### Scenario: Chart renders with attribution markers

- **WHEN** a user views a product whose history contains a TAX_RULE_CHANGE step
- **THEN** the chart SHALL mark that step and label it with the bounding rule version labels

#### Scenario: Flag hides charts

- **WHEN** the feature flag is disabled for the session
- **THEN** the historical charts SHALL not appear and no price-history request SHALL be made

### Requirement: Neutral, dependency-free chart rendering

Charts SHALL be implemented as SVG components with no new charting dependency, using neutral styling with no design element that suggests promotion of any merchant, and labels restricted to the controlled vocabulary (identification, classification, calculation, comparison).

#### Scenario: No promotional styling or vocabulary

- **WHEN** a chart renders merchant series
- **THEN** all series SHALL receive visually equal treatment and all labels SHALL come from the controlled vocabulary

### Requirement: Freshness indicators on historical data

Every chart series SHALL display the reliability status and the timestamp of the most recent observation it derives from.

#### Scenario: Stale series flagged

- **WHEN** a series derives from STALE observations
- **THEN** the chart SHALL show the STALE indicator rather than presenting the data as verified

### Requirement: Basket builder and optimization UI

The web application SHALL provide a basket UI to add multiple products with quantities (reusing the existing product search), select destination and transport arrangement, and display the optimization result: the recommended combination and up to three neutral cost-ordered alternatives, per-store cards with per-item breakdowns, reliability and freshness badges, the aggregated confidence level, and the structural disclaimer. The UI SHALL be hidden entirely when the `enable_basket_optimization` flag is off, and copy SHALL follow the controlled vocabulary.

#### Scenario: User optimizes a basket

- **WHEN** a user adds products with quantities and runs the optimization
- **THEN** the UI SHALL display the recommended combination, alternatives, and per-store breakdowns with confidence and freshness metadata

#### Scenario: Visual neutrality in alternatives

- **WHEN** multiple alternatives are displayed
- **THEN** no visual element SHALL suggest a promoted or preferred store beyond the objective cost ordering

#### Scenario: Flag off hides the feature

- **WHEN** the `enable_basket_optimization` flag is disabled
- **THEN** the basket UI SHALL not appear and no optimization request SHALL be made

### Requirement: Multi-store comparison view

The compare page SHALL offer a store-grouped comparison view showing how a basket's costs distribute across stores, with the same neutrality, freshness, and controlled-vocabulary rules, behind the same feature flag.

#### Scenario: Store-grouped comparison rendered

- **WHEN** a user views the multi-store comparison for a basket
- **THEN** the view SHALL group costs per store with per-item figures and reliability statuses, ordered objectively

### Requirement: Scenario controls in the calculator UI

The calculator UI SHALL provide a save-scenario control (name input plus save action) and a scenario picker to load a saved scenario; loading SHALL repopulate the calculator inputs and re-run the calculation against current data. The account page SHALL list the user's saved scenarios. These controls SHALL be hidden when the `enable_advanced_features` flag is off.

#### Scenario: Save and reload from the UI

- **WHEN** a user saves the calculator state under a name and later loads it
- **THEN** the inputs SHALL be repopulated and a fresh calculation SHALL run

#### Scenario: Flag off hides scenario controls

- **WHEN** the flag is disabled
- **THEN** the save/load controls SHALL not be rendered and no scenario request SHALL be made

### Requirement: Report export affordance

The calculator result view and the account calculation-history entries SHALL provide export actions for the report formats (JSON download, CSV download, print report). Export labels SHALL use controlled vocabulary.

#### Scenario: Export from a result

- **WHEN** a user activates an export action on a calculation result
- **THEN** the corresponding report SHALL be downloaded or opened for printing, carrying the disclaimer and per-line provenance

### Requirement: Merchant data-freshness display in comparisons

Where comparison results surface a merchant's offers, the UI SHALL display the merchant's factual data-reliability summary (counts/shares per status, freshest observation, governance status) with its timestamp, using controlled-vocabulary labels and neutral equal-treatment styling. The display SHALL NOT alter or suggest any change to the objective sort order.

#### Scenario: Factual freshness line

- **WHEN** a merchant's offers are shown in a comparison
- **THEN** a factual reliability summary with timestamp SHALL be visible near the offers, styled identically for every merchant

### Requirement: Declaration guidance panel

The calculator result detail page SHALL render the declaration assistant's advanced guidance (derivation, deadline, checklist, caveats) in a clearly bounded panel using observed-pattern phrasing, visible when the `enable_advanced_features` flag is on.

#### Scenario: Guidance rendered

- **WHEN** a user expands the declaration guidance panel on a result
- **THEN** the derivation, deadline, checklist, and any caveats SHALL be displayed with the standing disclaimer

### Requirement: Finnish default locale with English secondary

The frontend SHALL use a message-catalog localization setup (next-intl or equivalent) with Finnish as the default locale and English secondary. User-facing copy SHALL live in message catalogs, and the content-policy lint SHALL cover both locales. The rendered `lang` attribute SHALL match the active locale.

#### Scenario: Default renders Finnish

- **WHEN** a user visits without a locale preference
- **THEN** the UI SHALL render in Finnish with `lang="fi"`

#### Scenario: Lint polices both catalogs

- **WHEN** either the Finnish or English catalog introduces disallowed vocabulary
- **THEN** the content-policy lint SHALL fail

### Requirement: Shared navigation

The application SHALL provide a layout-level header with the five destinations (calculator, compare, basket, account, ranking) on every page, and a footer carrying the disclaimer and methodology link. Per-page hand-rolled back-links SHALL be removed. The header SHALL indicate the active destination, SHALL include the site logo linking home, and SHALL provide a keyboard-operable mobile menu at small viewports. The header SHALL also group the planning tools (trip, event, what-if) under one Planning dropdown alongside the existing primary group, and SHALL offer an `FI | EN` locale switcher that preserves the current path when changing locale. Dropdown and switcher SHALL be keyboard-operable with visible focus states.

#### Scenario: Navigation on every page

- **WHEN** a user lands on any route
- **THEN** the header SHALL offer the five destinations without returning home first

#### Scenario: Active destination is visible

- **WHEN** a user is on the calculator page
- **THEN** the header SHALL visually distinguish the calculator link from the others

#### Scenario: Mobile menu is keyboard operable

- **WHEN** a keyboard user focuses the mobile menu toggle at a small viewport
- **THEN** the toggle SHALL open and close the menu, and focus SHALL remain visible

#### Scenario: Planning dropdown opens by keyboard

- **WHEN** the visitor focuses the Planning trigger and presses Enter or Space
- **THEN** the dropdown lists trip, event, and scenario links, each reachable by Tab and activated by Enter

#### Scenario: Locale switch preserves path

- **WHEN** the visitor switches locale on `/en/calculator`
- **THEN** the browser navigates to `/calculator` (and vice versa) with content in the selected locale

### Requirement: Debounced search input

Search input SHALL debounce submissions by approximately 300 ms so rapid keystrokes do not queue requests.

#### Scenario: Rapid typing sends one request

- **WHEN** a user types quickly and pauses
- **THEN** one debounced search request SHALL be issued for the settled query

### Requirement: Feature flags inline in initial HTML

Feature-flag states SHALL be inlined in the initial HTML payload so gated UI renders with first paint and does not appear late after a client-side fetch.

#### Scenario: No gated-UI flash

- **WHEN** a page with flag-gated UI loads
- **THEN** the gated UI's visibility SHALL match its flag state in the first render, with no late appearance

### Requirement: SEO surface

The frontend SHALL provide a sitemap, robots rules, and per-page metadata: per-product pages draw metadata from product data, and every other public route SHALL declare its own title and meta description through `generateMetadata`. The tool pages `calculator`, `compare`, `basket`, `trip`, `event`, `what-if`, `ranking`, and `value` SHALL NOT inherit the site-default title. Routes that must not be indexed (account, group order, ops, age gate) keep their `noindex` treatment.

#### Scenario: Product page metadata

- **WHEN** a crawler fetches a product page
- **THEN** it SHALL receive title and description metadata specific to that product

#### Scenario: Each tool page has unique metadata

- **WHEN** the server renders any of the tool pages or `/value`
- **THEN** the HTML head carries that page's own title and description, distinct from the site default and from every other tool page

#### Scenario: Session-scoped pages stay unindexed

- **WHEN** the server renders account, group-order, ops, or age-gate pages
- **THEN** the noindex robots directive is present as before

### Requirement: Design token foundation

The frontend SHALL define its visual vocabulary as CSS variables mapped into the Tailwind theme: a semantic status palette, a neutral gray scale, radii, and shadows. The status palette SHALL map VERIFIED to green, ESTIMATED to blue, STALE to amber, and UNAVAILABLE to neutral gray; red SHALL be reserved for errors and destructive affordances. The rendered typography SHALL use the Inter webfont loaded via `next/font`, and euro amounts SHALL render with tabular numerals.

#### Scenario: Status colors are canonical

- **WHEN** any component renders a reliability or confidence indicator
- **THEN** the colors SHALL come from the shared token palette, not from per-component color literals

#### Scenario: Money renders stably

- **WHEN** a cost breakdown or total renders euro amounts
- **THEN** the digits SHALL use tabular numerals so columns align

### Requirement: Brand identity assets

The application SHALL ship a logo wordmark component, a favicon app icon, and an Open Graph image. The favicon and Open Graph image SHALL be served by the Next.js app so social shares and browser tabs identify the site.

#### Scenario: Social share identifies the site

- **WHEN** a page URL is shared to a service that reads Open Graph metadata
- **THEN** the share SHALL render the generated Open Graph image with the site wordmark

### Requirement: Shared UI primitives

Buttons, badges, cards, and inputs SHALL be shared React components under `components/ui/`, and pages SHALL compose them instead of duplicating utility class strings. The reliability status color maps SHALL exist in exactly one shared module.

#### Scenario: No duplicated status maps

- **WHEN** the codebase is searched for reliability badge color definitions
- **THEN** exactly one shared module SHALL define them and every consumer SHALL import from it

### Requirement: Homepage value proposition

The homepage value proposition and trust row SHALL describe the service without naming Sweden or Systembolaget: the landed-cost proposition in one sentence, the data model phrased as published retailer datasets plus the Alko domestic reference, the reliability model with its four statuses, and the methodology link. The homepage SHALL additionally render a static, server-rendered task section linking the existing task tools — basket, trip, event, what-if, and savings — styled from the design tokens, present in both locales, and introducing no new input surface: the hero search remains the homepage's only input. All copy SHALL exist in both locales and pass the content-policy lint.

#### Scenario: No residual market naming

- **WHEN** the fi and en message catalogs are linted
- **THEN** no homepage or trust-row string names Sweden, Systembolaget, or a Swedish market, and translation coverage is complete in both locales

#### Scenario: Task section links shipped tools

- **WHEN** a visitor loads the homepage
- **THEN** a server-rendered task section links the basket, trip, event, what-if, and savings pages, styled from the shared design tokens and fully rendered in the server HTML in both locales

#### Scenario: Single input surface

- **WHEN** the homepage is inspected for interactive inputs
- **THEN** the hero search is the only input; the task section contains navigational links only

### Requirement: Designed non-happy states

The application SHALL render designed states for empty search results, API errors, in-flight loading, and rate-limit responses. A 429 response SHALL surface the `Retry-After` value to the user. When the production launch gates are closed, the calculator page SHALL show an explanatory notice instead of an unexplained failure.

#### Scenario: Rate-limited user sees when to retry

- **WHEN** the calculator API responds 429
- **THEN** the UI SHALL display an error state that includes the `Retry-After` wait

#### Scenario: Closed launch gates are explained

- **WHEN** the production launch gates are closed and a user opens the calculator page
- **THEN** the page SHALL show a notice explaining the service is not yet calculating instead of an unexplained error

### Requirement: Accessibility baseline

New and restyled UI SHALL meet WCAG AA contrast, keep focus visible on all interactive elements, and operate the mobile menu by keyboard. Reliability status SHALL never be conveyed by color alone; every status indicator SHALL include its text label.

#### Scenario: Status survives without color vision

- **WHEN** a reliability badge is viewed in grayscale
- **THEN** the text label SHALL still identify the status

### Requirement: New flag-gated pages

The frontend SHALL provide pages for price-alert management (account area), the event calculator, the trip feasibility calculator, curated lists, the excise what-if simulator, and the group order session. Each page SHALL render only when its feature flag is on, with flag states inlined in the initial HTML payload so gated UI never appears late, and SHALL follow the design system (semantic tokens, status badges from the canonical status module, tabular numerals for euro amounts).

#### Scenario: Gated page hidden when flag off

- **WHEN** a feature flag is off and a user opens the corresponding page route
- **THEN** the page SHALL render the feature-unavailable state instead of the feature UI

#### Scenario: Finnish-first localization

- **WHEN** any new page renders
- **THEN** all strings SHALL come from the next-intl catalogs with Finnish as the default locale and English as the secondary

### Requirement: Product page extensions

Product pages SHALL embed the price-history chart (reusing the existing history components and series API), the producer dupe panel when curated links exist, and a set-alert action when the alerts flag is on. Each extension SHALL respect its own feature flag.

#### Scenario: History chart on product page

- **WHEN** a product page loads with the historical intelligence flag on
- **THEN** the price-history chart SHALL render from the materialized series with reliability metadata

### Requirement: Structural disclaimers on all new result surfaces

The event calculator, trip calculator, what-if simulator, and packing suggestion SHALL render their respective disclaimers as structural parts of the result presentation, sourced from the result objects, not as decorative footer text.

#### Scenario: Disclaimer rendered from result

- **WHEN** any new calculation result renders
- **THEN** its disclaimer text SHALL come from the result object and SHALL be visually prominent

### Requirement: Tool page server shells

Each tool page (`calculator`, `compare`, `basket`, `trip`, `event`, `what-if`, `ranking`) SHALL render a server shell containing the page's unique metadata, an intro section, and a "How this calculation works" summary, with the interactive client body hydrated beneath. The shell content SHALL be present in the server HTML without JavaScript.

#### Scenario: Intro renders before hydration

- **WHEN** a client requests a tool page without JavaScript
- **THEN** the server HTML contains the intro copy and the calculation-method summary

### Requirement: Homepage worked example

The homepage SHALL include a static, server-rendered worked-example section showing a Finland-versus-cross-border cost breakdown with figures explicitly labeled as an example. The section SHALL make no API call and SHALL NOT present example figures as observed or live data.

#### Scenario: Example is labeled and static

- **WHEN** the homepage renders
- **THEN** the worked-example section appears in the server HTML with example-labeled figures and no data fetch

### Requirement: About and Contact pages

The site SHALL serve About and Contact pages at `/about` and `/contact` (and `/en/about`, `/en/contact`), carrying unique metadata, included in the sitemap, and linked from the footer. The Contact page SHALL surface a real contact path and mention the correction mechanism for data errors.

#### Scenario: About and Contact are crawlable

- **WHEN** the sitemap is generated
- **THEN** it includes the About and Contact URLs for both locales, and both pages render their content in server HTML

### Requirement: Register benefits copy

The register surface SHALL state the concrete account benefits: saving baskets and calculations, tracking price changes, and managing price alerts.

#### Scenario: Benefits are stated before registration

- **WHEN** the register page renders
- **THEN** the copy lists saving, tracking, and alert benefits alongside the form

### Requirement: Homepage FAQ section

The homepage SHALL include a FAQ section linking published FAQ guide entries. Only PUBLISHED entries SHALL be linked; the section SHALL degrade to nothing when none exist.

#### Scenario: FAQ links published guides

- **WHEN** the homepage renders and at least one FAQ guide entry is PUBLISHED
- **THEN** the FAQ section lists links to those entries in server HTML

### Requirement: Product data display formatting

User-facing surfaces SHALL render product attributes through shared formatters:

- ABV SHALL be rendered as a percentage converted from the stored fraction (0.38 → "38 %"), with at most one decimal — raw float artifacts SHALL never be displayed.
- Unit volume SHALL be rendered with an explicit unit label from the canonical litre value, with trimmed decimals and sensible litre/centilitre rendering.
- Category and container-type enum values SHALL be rendered through localized message-catalog labels in every locale, never as raw storage keys.

#### Scenario: ABV fraction renders as percent

- **WHEN** a product with `alcoholByVolume = 0.38` is rendered
- **THEN** the UI shows "38 %"-style text and never "0.38% ABV"

#### Scenario: Float artifacts are rounded away

- **WHEN** a stored ABV fraction renders to more than one decimal (e.g. 14.499999999999998)
- **THEN** the UI shows at most one decimal (14.5 %)

#### Scenario: Volume renders with a unit

- **WHEN** a product with unit volume 0.5 litres is rendered
- **THEN** the UI shows a labelled value ("0.5 l" or "50 cl") and never a bare "500.0000"

#### Scenario: Enums render localized in both locales

- **WHEN** the products surfaces render category `other_fermented` or containerType `plastic`
- **THEN** both the Finnish and English locales show their localized labels, and the messages parity test pins the keys

### Requirement: Functional homepage hero search

The homepage hero SHALL render a real search form: an `<input type="search">` inside a `<form>` whose submission navigates to `/calculator?q={term}`. The calculator SHALL read the `q` query parameter and pre-fill (and run) its product search with that term. A purely decorative element that imitates an input SHALL NOT be used.

#### Scenario: Submitting the hero search

- **WHEN** a visitor types "koskenkorva" into the hero search and submits
- **THEN** the browser navigates to `/calculator?q=koskenkorva` and the calculator shows search results for that term without retyping

#### Scenario: Empty submission stays on the calculator

- **WHEN** a visitor submits the hero search with an empty query
- **THEN** the browser navigates to the calculator page without a `q` value and no failed search state appears

### Requirement: Human loading, empty, and error states

Every page that fetches data SHALL render a visible loading state (skeleton or "Lasketaan…" copy, never a blank screen), an empty state that suggests next steps when a search returns no results (broader-search hint and category links), and a human error message with a retry action in place of raw HTTP error codes. A rate-limit (429) response SHALL render as the friendly "Hetkinen — lasketaan vielä edellistä" message, not a generic failure.

#### Scenario: Empty search suggests alternatives

- **WHEN** a catalog or calculator search returns no rows
- **THEN** the page shows the localized not-found message naming the query together with a broader-search suggestion and category browsing links

#### Scenario: Server error shows a retry

- **WHEN** a data fetch fails with a 5xx response
- **THEN** the page renders "Jokin meni pieleen — yritä hetken kuluttua uudelleen" with a retry button and no raw status code

### Requirement: Mobile-first interaction standards

Interactive controls SHALL meet a ≥44 px effective touch-target size on small viewports (category pills, quantity controls, sort and filter controls). Calculation results SHALL be readable without horizontal scrolling, and the product comparison table SHALL collapse to a card layout below the small-screen breakpoint.

#### Scenario: Category pills are thumb-sized

- **WHEN** the products catalog renders on a 375 px viewport
- **THEN** each category pill and pagination control presents a touch target of at least 44 px in both dimensions

#### Scenario: Compare collapses to cards

- **WHEN** the comparison view renders below the small-screen breakpoint
- **THEN** products render as stacked cards instead of a horizontally scrolling table

### Requirement: Honest transport-unavailable state

The calculator result SHALL render an explicit "transport not included — dataset pending" state when the transport component's reliability is `UNAVAILABLE`, instead of displaying a €0.00 transport line. Result amounts are never altered; only the presentation of the unavailable component changes. The LOW-confidence indication SHALL carry explanatory copy (which inputs are missing) in Finnish and English.

#### Scenario: Empty transport dataset renders honestly

- **WHEN** a calculation returns transport with `reliability: UNAVAILABLE`
- **THEN** the transport line reads as not-included with the pending-dataset explanation and no €0.00 figure is displayed

#### Scenario: Real transport data renders as before

- **WHEN** a calculation returns transport with a usable estimate
- **THEN** the transport line renders the amount as before, with no pending-state copy

### Requirement: Homepage promise honesty

The homepage savings feature card SHALL reflect the actual savings-listing state: when the savings overview reports zero products with an Alko reference (`withReference: 0`), the card SHALL render an honest reference-data-pending state instead of linking into the empty listing. Copy passes the content lint; figures stay factual with as-of context.

#### Scenario: Empty savings listing is not advertised

- **WHEN** the savings overview reports `withReference: 0`
- **THEN** the homepage card shows the honest pending state and does not link into the empty listing

#### Scenario: Populated listing restores the CTA

- **WHEN** the savings overview reports a non-zero reference count
- **THEN** the homepage card renders the existing listing CTA without any code change

### Requirement: Buying-mode selection in the calculator

The calculator form SHALL offer a buying-mode choice between delivery (default, today's behavior) and traveller import (Otan itse mukaan). Selecting traveller mode SHALL send `transportArrangement: 'PERSONAL'` with the calculation request. Traveller-mode results SHALL render the within/surplus-allowance split with reliability statuses, the allowance dataset version, and the single-traveller assumption note. The no-dataset rejection SHALL render an honest unavailable state for the traveller mode with retry-later copy while the delivery mode stays usable; no invented figures are displayed.

#### Scenario: Toggle switches the request scenario

- **WHEN** the customer selects traveller import and calculates
- **THEN** the request carries `transportArrangement: 'PERSONAL'` and the result renders the allowance-aware breakdown with the dataset version

#### Scenario: Traveller mode without allowance data renders honestly

- **WHEN** the traveller-mode calculation rejects for lack of an effective allowance dataset
- **THEN** the form shows the honest unavailable explanation, the delivery mode remains selectable, and no figures are fabricated

#### Scenario: Finnish and English copy in parity

- **WHEN** any new calculator string is rendered
- **THEN** Finnish and English messages exist in parity and pass the content lint

### Requirement: Traveller callout on delivery results

Delivery-mode calculation results SHALL render the `travellerAlternative` estimate when present, as a clearly labeled estimate (allowance framing, dataset version) with a link into the trip calculator pre-filled with the product and quantity (`/trip?product={id}&quantity={n}`). Delivery-mode amounts render exactly as before; the callout never replaces or restyles them as uncertain.

#### Scenario: Callout links into a pre-filled trip

- **WHEN** a delivery result carries a non-null `travellerAlternative`
- **THEN** the page shows the labeled traveller estimate and the link opens the trip calculator with the product and quantity pre-seeded

#### Scenario: Trip page accepts the prefill

- **WHEN** the trip page is opened with `product` and `quantity` query parameters
- **THEN** the fill form is pre-seeded with that product and quantity and the existing validation applies unchanged

### Requirement: Search suggestion banner

The calculator product search and the product-listing search SHALL render the response's `suggestion` (when present) as a clickable "Tarkoititko: {suggestion}?" control that runs the suggested query. The banner SHALL NOT appear when the query returned results, and the customer's original query text SHALL remain displayed as entered.

#### Scenario: Zero-result query offers the correction

- **WHEN** a search returns zero results with a suggestion
- **THEN** the surface shows the Tarkoititko control and clicking it runs the suggested query

#### Scenario: Original query is preserved

- **WHEN** a suggestion banner is shown
- **THEN** the search input still contains the customer's original query, and no automatic rewriting has occurred

### Requirement: Product card unit price and single-seller framing

Product listing cards SHALL render the €/g chip when the listing embed is computed — value, status label, and per-offer provenance per the metric's presentation rules — and SHALL omit the chip entirely when the embed is unavailable (no placeholder, no zero). Cards SHALL NOT display a bare single-seller count: when the seller count is 1, the seller-count line SHALL be replaced by the tracked-price framing; multi-seller cards SHALL keep "Myyjiä: {count}". The wording SHALL pass the content-policy lint and exist in fi/en parity.

#### Scenario: Computed embed shows the chip

- **WHEN** a listing item's `eurPerGram` embed has status computed
- **THEN** the card renders the value with its reliability label, never color-alone

#### Scenario: Single-seller cards stop advertising thinness

- **WHEN** a card's seller count is 1
- **THEN** the card shows the tracked-price framing instead of "Myyjiä: 1", and cards with 2+ sellers keep the count

### Requirement: Accuracy presentation coverage mode

The accuracy presentation (homepage trust-row and ranking page) SHALL render a labeled catalog-coverage mode when the user-reported outcome count is below the floor: the coverage block's true values (products tracked, offer observations, last sync) with copy that names them as catalog coverage — visually distinct from the user-reported accuracy presentation. The user-reported presentation SHALL return, without any code change, once the count is non-zero. Neither mode SHALL present a fabricated or unlabeled number.

#### Scenario: Zero outcomes render labeled coverage

- **WHEN** the accuracy response reports count 0 with a coverage block
- **THEN** the row renders the coverage values labeled as catalog coverage, never as user-reported accuracy

#### Scenario: First outcome restores the user-reported presentation

- **WHEN** the accuracy response reports a non-zero count
- **THEN** the row renders the user-reported statistic as before, with no code or configuration change

### Requirement: Post-calculation outcome prompt

After a successful calculation, the result view SHALL render one dismissible prompt inviting the outcome report: authenticated users SHALL get a deep-link to the account outcome form with the calculation record preselected; anonymous users SHALL get the sign-in path. The prompt SHALL NOT block the result, SHALL NOT re-appear within the session after dismissal, and SHALL NOT send any data on its own. Copy SHALL pass the content-policy lint and exist in fi/en parity.

#### Scenario: Logged-in user gets the outcome deep-link

- **WHEN** an authenticated user's calculation completes
- **THEN** the prompt links to the outcome form with the record preselected

#### Scenario: Dismissal sticks

- **WHEN** the user dismisses the prompt
- **THEN** it does not re-render for the rest of the session, and the result view is otherwise unchanged
