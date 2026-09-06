# data-acquisition Specification

## REMOVED Requirements

### Requirement: Currency normalization at ingestion

**Reason:** EUR-only makes conversion-at-ingestion obsolete. The ECB rate source and the FX review service are deleted, and the ingestion pipeline performs no currency operations.

**Migration:** Delete the ECB source adapter, FX review service, and their exports; the pipeline composition in the api-worker loses the FX service dependency.

## MODIFIED Requirements

### Requirement: Permitted-source ingestion

The pipeline SHALL ingest only merchants with `GRANTED` governance status, as before. After this change the adapter registry SHALL contain exactly one live feed adapter: the Alko domestic reference feed. The Systembolaget adapter and merchant SHALL be removed entirely: no adapter, no registry seed row, no governance records, and a purge of its queryable products, offers, and price-history summaries in existing environments. The R2 append-only observation log SHALL be retained untouched.

#### Scenario: Registry holds only the domestic reference feed

- **WHEN** the ingestion scheduler enumerates permitted merchants
- **THEN** only `alko` is returned and no `systembolaget` adapter, seed row, or governance record exists anywhere in the codebase or seeds

#### Scenario: Purged merchant leaves no queryable rows

- **WHEN** the purge script runs against an environment that previously ingested Systembolaget data
- **THEN** products, retail offers, and price-history summaries for merchant `systembolaget` are deleted while the R2 observation log partitions remain in place
