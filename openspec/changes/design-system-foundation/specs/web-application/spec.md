# web-application Specification Delta

## ADDED Requirements

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

The home page SHALL state in one sentence what the service calculates, offer the calculator as the primary call to action, and present trust content: the data sources, the reliability status model, and a link to the ranking methodology. The trust content SHALL be static catalog copy and SHALL NOT add backend API calls to the page. All homepage copy SHALL pass the content-policy lint in Finnish and English.

#### Scenario: First-time visitor understands the service

- **WHEN** a visitor opens the home page
- **THEN** the page SHALL explain what the calculator does and how to start without scrolling past a hero

#### Scenario: Copy passes content lint

- **WHEN** either locale catalog contains forbidden marketing vocabulary
- **THEN** `pnpm lint:content` SHALL fail

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

## MODIFIED Requirements

### Requirement: Shared navigation

The application SHALL provide a layout-level header with the five destinations (calculator, compare, basket, account, ranking) on every page, and a footer carrying the disclaimer and methodology link. Per-page hand-rolled back-links SHALL be removed. The header SHALL indicate the active destination, SHALL include the site logo linking home, and SHALL provide a keyboard-operable mobile menu at small viewports.

#### Scenario: Navigation on every page

- **WHEN** a user lands on any route
- **THEN** the header SHALL offer the five destinations without returning home first

#### Scenario: Active destination is visible

- **WHEN** a user is on the calculator page
- **THEN** the header SHALL visually distinguish the calculator link from the others

#### Scenario: Mobile menu is keyboard operable

- **WHEN** a keyboard user focuses the mobile menu toggle at a small viewport
- **THEN** the toggle SHALL open and close the menu, and focus SHALL remain visible
