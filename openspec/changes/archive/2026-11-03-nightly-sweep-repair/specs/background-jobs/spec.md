# background-jobs delta

## ADDED Requirements

### Requirement: Retention sweeps resolve configuration from deployment config, never the Node process environment

Scheduled retention sweeps running on Workers SHALL resolve their configuration (retention windows, batch sizes) from explicit deployment config (wrangler vars passed by the cron handler) or from code fallbacks, and SHALL NOT reference the Node `process` global. A sweep SHALL complete successfully when no configuration vars are set, applying the code-default windows; wrangler vars, when present, SHALL override the defaults.

#### Scenario: Sweep completes with no vars set

- **WHEN** the retention sweep runs in an environment where no retention configuration vars exist (the production shape)
- **THEN** the sweep completes and prunes rows past the code-default windows, and no handler log carries a `process is not defined` error

#### Scenario: Deployment vars override the defaults

- **WHEN** a wrangler var carrying a valid positive day count is set
- **THEN** the sweep applies that window instead of the code default
