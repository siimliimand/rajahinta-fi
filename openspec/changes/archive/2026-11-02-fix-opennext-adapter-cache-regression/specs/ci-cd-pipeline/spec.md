# ci-cd-pipeline delta

## ADDED Requirements

### Requirement: Frontend adapter freshness on Next.js upgrades

When a pull request modifies the frontend's `next` dependency version, the
OpenNext adapter pair (`@opennextjs/cloudflare` and its `@opennextjs/aws`
dependency) SHALL resolve to the latest published releases at upgrade time,
and CI SHALL fail the PR when either resolves behind latest — adapter cache
regressions are the known failure mode of pairing a new Next.js with a stale
adapter.

#### Scenario: Adapter lag caught at PR time

- **WHEN** a PR changes the `next` version while the resolved adapter pair is
  behind the latest published release
- **THEN** CI SHALL fail with a message pointing at the adapter release notes

#### Scenario: Current pairing passes

- **WHEN** a PR bumps `next` and the adapter pair resolves to latest
- **THEN** CI SHALL pass the freshness check without manual override

### Requirement: Cache-behavior gate before production promotion of Next.js upgrades

The production deploy of a frontend change that modifies the `next` version
SHALL be preceded by a staging verification that exercises the adapter's
cache paths: ISR routes SHALL answer with cache-HIT indicators, and rendered
content on a cached route SHALL match the live API after one revalidate
window. The production gate SHALL NOT run before the staging matrix is green.

#### Scenario: Staging cache matrix green

- **WHEN** the staging deploy of a `next`-version change answers ISR routes
  from cache and rendered data matches the API after one revalidate window
- **THEN** the production deploy may be dispatched

#### Scenario: Cache path regressed

- **WHEN** staging ISR routes show per-request re-render or stale rendered
  data persists past its revalidate window
- **THEN** the production deploy SHALL NOT be dispatched and the adapter
  pairing SHALL be investigated
