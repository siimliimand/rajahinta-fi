# content-vocabulary-linting Specification

## Purpose

Automated content-safety service that scans product names and descriptions for banned subjective/promotional adjectives and flags violations. This enforces the business plan's prohibition against promotional language in product listings (identification, classification, calculation, comparison only).

## ADDED Requirements

### Requirement: Banned vocabulary patterns

The content linting service SHALL maintain a configurable list of banned vocabulary patterns covering subjective and promotional adjectives in Finnish, English, and Swedish.

#### Scenario: English banned word detected

- **WHEN** a product description contains "best", "amazing", "top bargain", or similar promotional adjectives
- **THEN** the lint service SHALL flag the product with a violation

#### Scenario: Finnish banned word detected

- **WHEN** a product description contains "paras", "loistava", "huipputarjous", or similar Finnish promotional adjectives
- **THEN** the lint service SHALL flag the product with a violation

#### Scenario: Neutral vocabulary passes

- **WHEN** a product description contains only factual identifiers (brand, category, ABV, volume, container type)
- **THEN** the lint service SHALL NOT flag the product

### Requirement: Lint results as warnings, not rejections

The content linting step SHALL flag violations as warnings in the pipeline report and SHALL NOT reject or block products from entering the database. Flagged products SHALL be routed to the manual review queue.

#### Scenario: Flagged product enters database

- **WHEN** a product is flagged for banned vocabulary
- **THEN** it SHALL still be upserted into the database, and a review entry SHALL be created for manual inspection

#### Scenario: Clean product proceeds normally

- **WHEN** a product passes all lint checks
- **THEN** it SHALL proceed through the pipeline without any additional review steps

### Requirement: Pipeline integration

The content linting service SHALL be integrated as a step in the `PipelineOrchestratorService` data acquisition pipeline, executing after data mapping and before upsert.

#### Scenario: Pipeline run includes lint results

- **WHEN** the pipeline orchestrator runs for a merchant
- **THEN** the pipeline run report SHALL include content linting results (total checked, violations found, violation details)

### Requirement: Frontend vocabulary awareness

The frontend SHALL have access to the same banned-pattern list and SHALL filter or flag product descriptions rendered from any source, not only from the ingestion pipeline.

#### Scenario: API-sourced product with banned word

- **WHEN** a product from an API response contains a banned promotional adjective
- **THEN** the frontend SHALL render it with a content-safety warning indicator and SHALL NOT render the adjective as part of the UI's own copy