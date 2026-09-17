# basket-optimization Specification

## MODIFIED Requirements

### Requirement: Sticky basket summary

On desktop viewports the basket page SHALL render a summary card that stays visible while the basket is edited: Finland total, cross-border total, estimated difference, and (when trip costs are present) the net difference after trip costs.

#### Scenario: Summary persists during editing

- **WHEN** the visitor adds, removes, or edits basket rows on a desktop viewport
- **THEN** the summary card remains visible and its totals reflect the current basket
