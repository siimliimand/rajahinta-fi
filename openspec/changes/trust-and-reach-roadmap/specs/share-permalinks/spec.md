# share-permalinks Specification

## ADDED Requirements

### Requirement: Frozen share snapshots

An authenticated user SHALL be able to create a share link for one of their calculation records. The system SHALL copy the result into a snapshot row under a random public identifier at share time. The snapshot SHALL contain no account identifiers, and later changes to the original record SHALL NOT affect the snapshot.

#### Scenario: Snapshot created

- **WHEN** a user requests a share link for their calculation
- **THEN** a snapshot SHALL be stored under a new public identifier and the identifier SHALL be returned

#### Scenario: Snapshot is frozen

- **WHEN** the original calculation record is later pruned or modified
- **THEN** the shared snapshot SHALL continue to render its own copied content

### Requirement: Public read-only share page

The share identifier SHALL resolve on a public page rendering the snapshot result with the structural disclaimer, without authentication. The page SHALL emit Open Graph metadata derived from the snapshot. No personal data SHALL be included in the page or its metadata.

#### Scenario: Anonymous view

- **WHEN** anyone opens a share link
- **THEN** the snapshot result SHALL render with the disclaimer and OG metadata, and no session SHALL be required

#### Scenario: Unknown identifier

- **WHEN** a share link references a nonexistent identifier
- **THEN** the page SHALL return a not-found response without leaking whether identifiers exist

### Requirement: Embeddable calculator widget

The frontend SHALL expose an embeddable calculator page with minimal chrome and iframe-friendly headers, following the existing what-if widget pattern. Embedding SHALL NOT require a session and SHALL NOT bypass the age gate or disclaimers.

#### Scenario: Widget renders in an iframe

- **WHEN** the embed page is loaded inside an iframe from a third-party site
- **THEN** the calculator SHALL render with disclaimers intact and without requiring authentication

#### Scenario: Embed is not a calculation bypass

- **WHEN** a calculation is submitted from the embedded widget
- **THEN** it SHALL pass through the same API guards, rate limits, and idempotency as the main application
