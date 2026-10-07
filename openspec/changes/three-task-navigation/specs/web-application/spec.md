# web-application Delta

## MODIFIED Requirements

### Requirement: Shared navigation

The application SHALL provide a layout-level header presenting three task-based disclosure groups — "Mitä kannattaa ostaa?" (shopping), "Suunnittele matka" (trip), and "Suunnittele juhlat" (event) — plus account/auth actions and the `FI | EN` locale switcher as chrome. The shopping panel SHALL link savings (lead), value, products, calculator, and compare; the trip panel SHALL link trip (lead), basket, and allowances; the event panel SHALL link event (lead) and basket. Group triggers SHALL speak task language and panel items tool names. Each disclosure SHALL be keyboard-operable (Enter/Space toggles, ArrowUp/ArrowDown move focus among items, Escape and tab-out close) with visible focus states. When any child route of a group is active, the group trigger SHALL be visually distinguished, the active child SHALL carry `aria-current`, and active state SHALL never be carried by color alone. The scenario (what-if) tool and the ranking methodology SHALL NOT appear in the header; the scenario tool SHALL be linked from the footer's About column. The footer SHALL remain the complete tool sitemap. Routes SHALL NOT change: no redirect, sitemap, or share-permalink impact. Mobile SHALL present the same three groups plus chrome. The locale switcher SHALL preserve the current path when changing locale.

#### Scenario: Three task groups replace flat links

- **WHEN** a visitor loads any route
- **THEN** the header shows the three task disclosure groups plus account/auth and locale chrome, with no flat calculator, compare, basket, products, trip, event, scenario, or ranking links

#### Scenario: Panel membership matches the task map

- **WHEN** each disclosure is opened
- **THEN** the shopping panel lists savings, value, products, calculator, and compare; the trip panel lists trip, basket, and allowances; the event panel lists event and basket

#### Scenario: Keyboard-operable disclosures

- **WHEN** a keyboard user focuses a group trigger, presses Enter or Space, then uses ArrowDown/ArrowUp and Escape
- **THEN** the panel opens, focus cycles among the panel links, and Escape returns focus to the trigger with the panel closed

#### Scenario: Active state propagates to the group

- **WHEN** a visitor is on `/calculator`
- **THEN** the shopping group trigger is visually distinguished, the calculator panel item carries `aria-current`, and a deeper route such as `/account/saved-baskets` still activates its group

#### Scenario: Demoted tools live in the footer

- **WHEN** the header and footer are rendered on any page
- **THEN** the scenario tool and the ranking methodology are absent from the header, the scenario tool is linked from the footer's About column, and the footer's services column still links every tool route

#### Scenario: Mobile groups mirror desktop

- **WHEN** the mobile menu is opened at a small viewport
- **THEN** it presents the same three task groups with keyboard-operable disclosures plus the account/auth and locale controls

#### Scenario: Locale switch preserves path

- **WHEN** the visitor switches locale on `/en/calculator`
- **THEN** the browser navigates to `/calculator` (and vice versa) with content in the selected locale

### Requirement: Homepage value proposition

The homepage value proposition and trust row SHALL describe the service without naming Sweden or Systembolaget: the landed-cost proposition in one sentence, the data model phrased as published retailer datasets plus the Alko domestic reference, the reliability model with its four statuses, and the methodology link. The homepage SHALL additionally render a static, server-rendered task section whose cards mirror the three header task groups — shopping (linking the savings listing with its pending and unavailable state variants), trip, and event — styled from the design tokens, present in both locales, and introducing no new input surface: the hero search remains the homepage's only input. The what-if card SHALL NOT appear in the task section. All copy SHALL exist in both locales and pass the content-policy lint.

#### Scenario: No residual market naming

- **WHEN** the fi and en message catalogs are linted
- **THEN** no homepage or trust-row string names Sweden, Systembolaget, or a Swedish market, and translation coverage is complete in both locales

#### Scenario: Task section mirrors the header groups

- **WHEN** a visitor loads the homepage
- **THEN** a server-rendered task section shows one card per header task group — shopping linking the savings listing, trip, and event — styled from the shared design tokens, fully rendered in the server HTML in both locales, with the savings card degrading to its pending or unavailable variant when the listing is not published

#### Scenario: Single input surface

- **WHEN** the homepage is inspected for interactive inputs
- **THEN** the hero search is the only input; the task section contains navigational links only
