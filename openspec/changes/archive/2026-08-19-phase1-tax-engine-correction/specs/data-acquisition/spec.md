## MODIFIED Requirements

### Requirement: Scheduled rate review

The rate-review process SHALL run on a recurring scheduled job that checks for newly published official rate changes by reading the configured source snapshot and comparing it against the last-known rate set, rather than a hardcoded stub that always reports no changes.

#### Scenario: New rates detected

- **WHEN** the configured source snapshot contains rates that differ from the last-known set
- **THEN** the check SHALL report `newRatesDetected: true` and a manual/legal review entry SHALL be created before any dataset version goes live

#### Scenario: No auto-publish

- **WHEN** a rate change is detected
- **THEN** it SHALL never be published automatically; a confirmed review step is required

#### Scenario: No source configured

- **WHEN** no source snapshot is configured
- **THEN** the check SHALL report no changes (documented no-op), never a fabricated detection
