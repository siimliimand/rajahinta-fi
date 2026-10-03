# Spec Delta: web-application

## ADDED Requirements

### Requirement: Per-route message payload budget

Each route's client-side message bundle SHALL contain only the translation namespaces that route's client components use; the server retains access to the full catalog for server-rendered copy. `fi.json` and `en.json` SHALL remain the single source of truth — the per-route split SHALL happen at load time through an explicit namespace map, not by duplicating or relocating strings. A payload-budget test SHALL pin a ceiling on the uncompressed server-rendered HTML size of the catalog page in both locales, so a wholesale catalog inline cannot return silently.

#### Scenario: Catalog page ships only its namespaces

- **WHEN** the catalog page's RSC payload is inspected
- **THEN** translation keys from namespaces unrelated to the catalog page (for example ranking-transparency or event-calculator strings) are absent from the client bundle

#### Scenario: Budget ceiling is pinned

- **WHEN** the payload-budget test renders the catalog page locally in each locale
- **THEN** the uncompressed HTML stays under the pinned ceiling, and exceeding it fails the suite with the observed size in the failure message
