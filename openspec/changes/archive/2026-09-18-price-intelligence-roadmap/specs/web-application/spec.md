# web-application Specification

## MODIFIED Requirements

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

## ADDED Requirements

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
