# accounts-age-gate Specification

## ADDED Requirements

### Requirement: Age-gate decline recovery

The age-gate declined page SHALL offer a clearly labelled recovery action ("Painoin vahingossa — yritä uudelleen" / "I clicked by accident — try again") that clears the decline state and re-presents the age confirmation. The copy SHALL be warm and non-judgmental, and the crawlable soft-gate contract is unchanged: page content stays in server HTML and the API boundary remains the enforcement point.

#### Scenario: Accidental decline recovers without clearing cookies

- **WHEN** a visitor who declined the age confirmation activates the recovery action on the declined page
- **THEN** the decline state clears and the age confirmation re-presents without requiring manual cookie removal

#### Scenario: Gate behavior is otherwise unchanged

- **WHEN** the recovery action is added
- **THEN** unconfirmed visitors still see the overlay over fully rendered server HTML, and gated API endpoints still answer 403 `AGE_GATE_REQUIRED`
