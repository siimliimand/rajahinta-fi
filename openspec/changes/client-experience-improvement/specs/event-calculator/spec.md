# event-calculator Specification

## ADDED Requirements

### Requirement: Benchmark pre-fill with consumer labels

The event calculator SHALL pre-fill per-category €/l price inputs from the category price benchmarks behind an explicit toggle: "Käytä keskihindoja" (benchmark defaults) vs "Syötä omat hinnat" (manual entry). Excise category labels SHALL render in consumer language through the message catalogs in both locales (e.g. `other_fermented` as "Lonkerot ja siiderit", `spirits` as "Väkevät"); raw storage keys SHALL NOT be user-visible.

#### Scenario: Benchmark defaults pre-fill the form

- **WHEN** a visitor opens the event calculator with benchmarks available
- **THEN** the €/l fields pre-fill from the category averages and the active "Käytä keskihintoja" state is visible

#### Scenario: Custom prices override

- **WHEN** the visitor switches to "Syötä omat hinnat"
- **THEN** the fields become editable from the current values and the shopping-list calculation consumes the entered prices

#### Scenario: Storage keys never render

- **WHEN** a category label renders in either locale
- **THEN** the text comes from the message catalog and never the raw category key
