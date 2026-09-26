# web-application Specification

## MODIFIED Requirements

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
