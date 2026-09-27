# share-permalinks Specification

## ADDED Requirements

### Requirement: Share action on calculation results

The calculation result view SHALL offer a share action that creates a frozen share snapshot through the existing sharing module and presents the `/share/[publicId]` link for copying. The snapshot assembler's personal-data strip assertion and the public share page's contract are unchanged.

#### Scenario: Sharing a result

- **WHEN** a visitor activates the share action on a calculation result
- **THEN** a snapshot is created and the UI presents the public `/share/[publicId]` URL

#### Scenario: Shared link renders the frozen snapshot

- **WHEN** the copied link is opened
- **THEN** the public share page renders the frozen snapshot with the disclaimer banner intact
