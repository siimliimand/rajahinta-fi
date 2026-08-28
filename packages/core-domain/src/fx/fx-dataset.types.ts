/**
 * FX-rate-dataset domain types.
 *
 * The domain mirror of the `fx_rate_datasets` / `fx_rates` storage (design
 * D2, change technical-assessment-remediation): dated, versioned,
 * append-only rate datasets with source provenance and a lifecycle whose
 * only PENDING_CONFIRMATION → PUBLISHED transition is an explicit human
 * confirmation. These types carry no ORM or storage concerns — the port
 * adapter in the composition root maps persisted rows onto them.
 *
 * @module FxDatasetTypes
 */

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Dataset lifecycle states.
 *
 * - `PENDING_CONFIRMATION` — ingested, awaiting a human operator's
 *   confirmation task. Every new dataset starts here; no code path may
 *   create a dataset in any other state.
 * - `PUBLISHED` — confirmed by an operator, effective, resolvable for
 *   conversion. Terminal: a published version is never edited or
 *   unpublished; corrections append a new version.
 */
export const FX_DATASET_STATUSES = [
  'PENDING_CONFIRMATION',
  'PUBLISHED',
] as const;

export type FxDatasetStatus = (typeof FX_DATASET_STATUSES)[number];

// ---------------------------------------------------------------------------
// Dataset version
// ---------------------------------------------------------------------------

/** A versioned FX-rate dataset as the domain sees it. */
export interface FxDatasetVersion {
  readonly id: number;
  /**
   * Human-readable unique version label (e.g. "ecb-2026-08-28.1") — the
   * dataset identity used for provenance records and cache invalidation.
   */
  readonly versionLabel: string;
  /** Provenance: source adapter that fetched the payload (e.g. "ecb-reference-rates"). */
  readonly sourceName: string;
  /** Provenance: link to the source publication, when the source provides one. */
  readonly sourceUrl: string | null;
  /**
   * Date the source published the rates, ISO-8601 (`YYYY-MM-DD`) — the
   * "as of" date of the payload, distinct from the effective window.
   */
  readonly referenceDate: string;
  readonly status: FxDatasetStatus;
  /** Start of the effective window (inclusive). */
  readonly effectiveFrom: Date;
  /** End of the effective window (exclusive, null = open-ended/current). */
  readonly effectiveTo: Date | null;
  /** Operator who confirmed publication — null while PENDING_CONFIRMATION. */
  readonly confirmedBy: string | null;
  /** When the dataset was published — null while PENDING_CONFIRMATION. */
  readonly confirmedAt: Date | null;
  readonly createdAt: Date;
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

/** A single currency-pair rate inside a dataset version. */
export interface FxRateEntry {
  /** Base currency (ISO 4217, uppercase) — 1 unit of base = rate units of quote. */
  readonly baseCurrency: string;
  /** Quote currency (ISO 4217, uppercase). */
  readonly quoteCurrency: string;
  /**
   * Units of quote per 1 unit of base. Always positive; stored in the
   * source's direction — inversion is a domain-policy decision, never a
   * storage-level one (see {@link resolveRateFromEntries}).
   */
  readonly rate: number;
}

/** Input for creating a new pending dataset version. */
export interface NewFxDataset {
  readonly versionLabel: string;
  readonly sourceName: string;
  readonly sourceUrl?: string;
  readonly referenceDate: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date | null;
  readonly rates: readonly FxRateEntry[];
}

/**
 * A conversion rate resolved for an observation date.
 *
 * Carries the dataset version so every converted amount can record the
 * FX dataset version used as provenance (spec: fx-rate-dataset,
 * "Conversion at ingestion with provenance").
 */
export interface ResolvedFxDatasetRate {
  /** The published dataset version the rate belongs to (provenance). */
  readonly dataset: FxDatasetVersion;
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  /** Units of quote per 1 unit of base, already inverted when needed. */
  readonly rate: number;
  /** True when the source stored the pair in the opposite direction. */
  readonly inverted: boolean;
}
