/**
 * D1 TravellerAllowancesRepository — versioned EU personal-use
 * indicative allowance limits for the trip feasibility calculator
 * (task 5.1, change product-roadmap-phases-1-4, design R7), backed by
 * the `traveller_allowance_datasets` + `traveller_allowance_limits`
 * tables. Co-located abstract + concrete (consumption-norms precedent —
 * a D1-only table pair with no pg counterpart).
 *
 * Enforces the FX-dataset invariants at the storage boundary (the
 * lifecycle is reused from `fx_rate_datasets`, not reinvented):
 *
 * - **Versioned, append-only** — an allowance dataset VERSION is one
 *   dataset row plus the limit rows referencing it (the
 *   fx_rate_datasets/fx_rates shape). Corrections append a new version;
 *   no method updates caps or citations and published rows are
 *   immutable. Historical versions stay queryable.
 * - **Manual-only publication** — a version is created
 *   PENDING_CONFIRMATION; the only PENDING_CONFIRMATION → PUBLISHED
 *   transition is this class's explicit `publish` call, the same
 *   operator-confirmation path the FX datasets and consumption norms
 *   flow through. Status lives on the dataset — its limits publish with
 *   it atomically.
 * - **Citation guard** — an allowance dataset (or any of its limit
 *   rows) without a source citation can never reach PUBLISHED. The
 *   columns are NOT NULL (a citation-less row is unrepresentable at
 *   rest); `publish` additionally refuses a blank/whitespace citation
 *   defensively, since NOT NULL alone would admit `''`.
 * - **Half-open effective window** — resolution matches
 *   `effective_from <= travelDate < effective_to` (null effective_to =
 *   open-ended/current) on ISO `YYYY-MM-DD` calendar dates, which
 *   compare chronologically as TEXT, on BOTH the dataset and its limit
 *   rows. When published versions overlap transiently, the newest
 *   effectiveFrom wins. A version is resolved as a unit: if the newest
 *   effective dataset has no row for a category, that category
 *   resolves to null — a partial version is a curation error to fix,
 *   not something resolution papers over with an older version's cap.
 *
 * Resolution returns the dataset version identifier (`versionLabel`)
 * with every result so capped calculation results can name the dataset
 * they used (spec: trip-feasibility-calculator, "Allowance capping with
 * versioned datasets").
 *
 * @module D1TravellerAllowancesRepository
 */
import { Injectable } from '@nestjs/common';
import type { D1DatabaseLike } from '../../d1/executor';

/** Lifecycle states — the FX dataset value set, reused verbatim. */
export const TRAVELLER_ALLOWANCE_STATUSES = [
  'PENDING_CONFIRMATION',
  'PUBLISHED',
] as const;

export type TravellerAllowanceStatus =
  (typeof TRAVELLER_ALLOWANCE_STATUSES)[number];

/**
 * Allowance categories — the canonical tax-rule category keys, so the
 * trip calculator's per-category caps feed the landed-cost/tax engines
 * without a translation layer.
 */
export const TRAVELLER_ALLOWANCE_CATEGORIES = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'intermediate_products',
  'other_fermented',
  'spirits',
] as const;

/** Contract row — camelCase projection of the snake_case dataset row. */
export interface TravellerAllowanceDatasetRecord {
  readonly id: number;
  /** Dataset version identifier — named by capped calculation results as provenance. */
  readonly versionLabel: string;
  /** Verifiable official source citation (directive/regulation, URL). */
  readonly sourceCitation: string;
  readonly status: TravellerAllowanceStatus;
  /** Effective window on calendar dates — half-open [effectiveFrom, effectiveTo). */
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly confirmedBy: string | null;
  readonly confirmedAt: Date | null;
  readonly createdAt: Date;
}

/** Contract row — one category's caps inside a dataset version. */
export interface TravellerAllowanceLimitRecord {
  readonly id: number;
  readonly datasetId: number;
  readonly category: string;
  /** Volume cap in litres of finished beverage — null when quantity-only. */
  readonly volumeCapLitres: number | null;
  /** Quantity cap in units — null when volume-only. */
  readonly quantityCap: number | null;
  /** Verifiable official source citation for this limit (rule text, URL). */
  readonly sourceCitation: string;
  /** Effective window on calendar dates — half-open [effectiveFrom, effectiveTo). */
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

/** A dataset version as a unit: the dataset row plus its limit rows. */
export interface TravellerAllowanceDatasetWithLimits {
  readonly dataset: TravellerAllowanceDatasetRecord;
  readonly limits: readonly TravellerAllowanceLimitRecord[];
}

/** Input for appending a new pending dataset version. */
export interface TravellerAllowanceDatasetInsert {
  readonly versionLabel: string;
  readonly sourceCitation: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
}

/** Input for one category's limit row of a pending dataset version. */
export interface TravellerAllowanceLimitInsert {
  readonly category: string;
  readonly volumeCapLitres?: number | null;
  readonly quantityCap?: number | null;
  readonly sourceCitation: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
}

/**
 * Thrown by `publish` when the dataset's or any limit row's citation is
 * present but blank — the defensive second guard behind the NOT NULL
 * columns (spec: an allowance limit without a source citation SHALL
 * never reach PUBLISHED).
 */
export class MissingAllowanceSourceCitationError extends Error {
  constructor(id: number, category: string | null) {
    super(
      category === null
        ? `traveller_allowance_datasets row ${id} has a blank source citation — ` +
          'an allowance dataset without a verifiable citation can never be published'
        : `traveller_allowance_limits row ${id} (${category}) has a blank source ` +
          'citation — an allowance limit without a verifiable citation can never be published',
    );
    this.name = 'MissingAllowanceSourceCitationError';
  }
}

/** Raw D1 traveller_allowance_datasets row. */
interface D1DatasetRow {
  readonly id: number;
  readonly version_label: string;
  readonly source_citation: string;
  readonly status: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly confirmed_by: string | null;
  readonly confirmed_at: string | null;
  readonly created_at: string;
}

/** Raw D1 traveller_allowance_limits row. */
interface D1LimitRow {
  readonly id: number;
  readonly dataset_id: number;
  readonly category: string;
  readonly volume_cap_litres: number | null;
  readonly quantity_cap: number | null;
  readonly source_citation: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
}

/** Narrow the varchar column onto the lifecycle union — defense in depth. */
function toStatus(value: string): TravellerAllowanceStatus {
  if (!(TRAVELLER_ALLOWANCE_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `traveller_allowance_datasets.status "${value}" is not a known allowance lifecycle state`,
    );
  }
  return value as TravellerAllowanceStatus;
}

function toContractDataset(row: D1DatasetRow): TravellerAllowanceDatasetRecord {
  return {
    id: row.id,
    versionLabel: row.version_label,
    sourceCitation: row.source_citation,
    status: toStatus(row.status),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at === null ? null : new Date(row.confirmed_at),
    createdAt: new Date(row.created_at),
  };
}

function toContractLimit(row: D1LimitRow): TravellerAllowanceLimitRecord {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    category: row.category,
    volumeCapLitres: row.volume_cap_litres,
    quantityCap: row.quantity_cap,
    sourceCitation: row.source_citation,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

const DATASET_COLUMNS = `
  id, version_label, source_citation, status, effective_from, effective_to,
  confirmed_by, confirmed_at, created_at`;

const LIMIT_COLUMNS = `
  id, dataset_id, category, volume_cap_litres, quantity_cap, source_citation,
  effective_from, effective_to`;

const FIND_DATASET_BY_ID_SQL = `
  SELECT ${DATASET_COLUMNS} FROM traveller_allowance_datasets WHERE id = ?`;

const FIND_DATASET_BY_VERSION_SQL = `
  SELECT ${DATASET_COLUMNS} FROM traveller_allowance_datasets
   WHERE version_label = ?`;

const FIND_PENDING_SQL = `
  SELECT ${DATASET_COLUMNS} FROM traveller_allowance_datasets
   WHERE status = 'PENDING_CONFIRMATION'
   ORDER BY created_at ASC, version_label ASC`;

/** Limit rows of one version whose own effective window covers the date. */
const FIND_LIMITS_FOR_DATASET_ON_SQL = `
  SELECT ${LIMIT_COLUMNS} FROM traveller_allowance_limits
   WHERE dataset_id = ?
     AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
   ORDER BY category ASC`;

/** All limit rows of one version — the full version view. */
const FIND_LIMITS_FOR_DATASET_SQL = `
  SELECT ${LIMIT_COLUMNS} FROM traveller_allowance_limits
   WHERE dataset_id = ?
   ORDER BY category ASC`;

/**
 * Effective-dataset resolution for one travel date: the PUBLISHED
 * dataset where effective_from <= date < effective_to (null =
 * open-ended) — the STRICT upper bound is the half-open window's edge.
 * Ordered so the newest effectiveFrom wins on transient overlap.
 */
const FIND_PUBLISHED_EFFECTIVE_DATASET_SQL = `
  SELECT ${DATASET_COLUMNS} FROM traveller_allowance_datasets
   WHERE status = 'PUBLISHED'
     AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
   ORDER BY effective_from DESC
   LIMIT 1`;

/**
 * Per-category resolution: the newest effective PUBLISHED dataset first,
 * then its limit row for the category (the limit's own window must also
 * cover the date). The version is resolved as a unit — no fallback to an
 * older dataset that happens to carry the category.
 */
const FIND_PUBLISHED_EFFECTIVE_LIMIT_FOR_KEY_SQL = `
  SELECT ${LIMIT_COLUMNS} FROM traveller_allowance_limits
   WHERE dataset_id = ? AND category = ?
     AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
   LIMIT 1`;

/** Only a PENDING_CONFIRMATION dataset can flip — never-auto-publish guard. */
const PUBLISH_DATASET_SQL = `
  UPDATE traveller_allowance_datasets
     SET status = 'PUBLISHED', confirmed_by = ?, confirmed_at = ?
   WHERE id = ? AND status = 'PENDING_CONFIRMATION'
   RETURNING ${DATASET_COLUMNS}`;

const INSERT_DATASET_SQL = `
  INSERT INTO traveller_allowance_datasets (
    version_label, source_citation, status, effective_from, effective_to
  ) VALUES (?, ?, 'PENDING_CONFIRMATION', ?, ?)`;

const INSERT_LIMIT_SQL = `
  INSERT INTO traveller_allowance_limits (
    dataset_id, category, volume_cap_litres, quantity_cap, source_citation,
    effective_from, effective_to
  ) VALUES (
    (SELECT id FROM traveller_allowance_datasets WHERE version_label = ?),
    ?, ?, ?, ?, ?, ?
  )`;

/**
 * Versioned traveller allowance reference contract — the
 * storage-boundary shape the trip feasibility calculator (and the
 * operator console's dataset-confirmation path) consume. Append-only:
 * there is deliberately no update path for caps or citations.
 */
@Injectable()
export abstract class TravellerAllowancesRepository {
  /**
   * Append a new allowance dataset version as one all-or-nothing batch —
   * the dataset and every limit row PENDING_CONFIRMATION. Never
   * auto-publishes.
   */
  abstract createPendingVersion(
    dataset: TravellerAllowanceDatasetInsert,
    limits: readonly TravellerAllowanceLimitInsert[],
  ): Promise<TravellerAllowanceDatasetWithLimits>;

  /** One version as a unit (dataset + all its limit rows), or null. */
  abstract findDatasetById(
    id: number,
  ): Promise<TravellerAllowanceDatasetWithLimits | null>;

  /** One version by its label — historical versions stay queryable after a new one is published. */
  abstract findDatasetByVersionLabel(
    versionLabel: string,
  ): Promise<TravellerAllowanceDatasetWithLimits | null>;

  /** Datasets awaiting operator confirmation, oldest first (the review queue). */
  abstract findPending(): Promise<TravellerAllowanceDatasetWithLimits[]>;

  /**
   * The PUBLISHED allowance dataset effective on the travel date (newest
   * effectiveFrom wins on transient overlap), with its limits — null
   * when no published version covers the date. Half-open window:
   * effectiveFrom ≤ date < effectiveTo; null effectiveTo is open-ended.
   */
  abstract findPublishedEffectiveOn(
    travelDate: string,
  ): Promise<TravellerAllowanceDatasetWithLimits | null>;

  /**
   * Per-category resolution — the effective dataset's cap for one
   * category (the limit row's own window must also cover the date).
   * Returns null when no published version covers the date OR the
   * effective version has no row for the category (a version is
   * resolved as a unit — partial coverage is a curation error, not a
   * fallback to an older version).
   */
  abstract findPublishedEffectiveLimit(
    category: string,
    travelDate: string,
  ): Promise<{
    dataset: TravellerAllowanceDatasetRecord;
    limit: TravellerAllowanceLimitRecord;
  } | null>;

  /**
   * The manual publish transition (operator confirmation path). Returns
   * null when the dataset is unknown or not PENDING_CONFIRMATION
   * (PUBLISHED is terminal — republish is a no-op, FX parity); throws
   * {@link MissingAllowanceSourceCitationError} when the dataset's or
   * any limit row's citation is blank.
   */
  abstract publish(
    id: number,
    confirmedBy: string,
  ): Promise<TravellerAllowanceDatasetWithLimits | null>;
}

@Injectable()
export class D1TravellerAllowancesRepository extends TravellerAllowancesRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async createPendingVersion(
    dataset: TravellerAllowanceDatasetInsert,
    limits: readonly TravellerAllowanceLimitInsert[],
  ): Promise<TravellerAllowanceDatasetWithLimits> {
    if (limits.length === 0) {
      throw new Error(
        `allowance dataset "${dataset.versionLabel}" cannot be appended without limit rows`,
      );
    }

    // One batch = one implicit transaction: a version either lands whole
    // or not at all (the FX dataset+rates append shape). Batch statements
    // cannot consume a previous statement's RETURNING, so each limit row
    // resolves its dataset FK with a scalar subquery on the shared
    // version_label (statements execute in order inside the batch); the
    // version rows are read back after the batch commits.
    await this.d1.batch([
      this.d1
        .prepare(INSERT_DATASET_SQL)
        .bind(
          dataset.versionLabel,
          dataset.sourceCitation,
          dataset.effectiveFrom,
          dataset.effectiveTo ?? null,
        ),
      ...limits.map((limit) =>
        this.d1
          .prepare(INSERT_LIMIT_SQL)
          .bind(
            dataset.versionLabel,
            limit.category,
            limit.volumeCapLitres ?? null,
            limit.quantityCap ?? null,
            limit.sourceCitation,
            limit.effectiveFrom,
            limit.effectiveTo ?? null,
          ),
      ),
    ]);

    const version = await this.findDatasetByVersionLabel(dataset.versionLabel);
    if (!version) {
      throw new Error(
        `allowance dataset "${dataset.versionLabel}" vanished after its batch append`,
      );
    }
    return version;
  }

  /** @inheritdoc */
  async findDatasetById(
    id: number,
  ): Promise<TravellerAllowanceDatasetWithLimits | null> {
    const row = await this.d1
      .prepare(FIND_DATASET_BY_ID_SQL)
      .bind(id)
      .first<D1DatasetRow>();
    if (!row) {
      return null;
    }
    return this.toDatasetWithLimits(toContractDataset(row), false, null);
  }

  /** @inheritdoc */
  async findDatasetByVersionLabel(
    versionLabel: string,
  ): Promise<TravellerAllowanceDatasetWithLimits | null> {
    const row = await this.d1
      .prepare(FIND_DATASET_BY_VERSION_SQL)
      .bind(versionLabel)
      .first<D1DatasetRow>();
    if (!row) {
      return null;
    }
    return this.toDatasetWithLimits(toContractDataset(row), false, null);
  }

  /** @inheritdoc */
  async findPending(): Promise<TravellerAllowanceDatasetWithLimits[]> {
    const rows = (
      await this.d1.prepare(FIND_PENDING_SQL).all<D1DatasetRow>()
    ).results;
    const pending: TravellerAllowanceDatasetWithLimits[] = [];
    for (const row of rows) {
      pending.push(
        await this.toDatasetWithLimits(toContractDataset(row), false, null),
      );
    }
    return pending;
  }

  /** @inheritdoc */
  async findPublishedEffectiveOn(
    travelDate: string,
  ): Promise<TravellerAllowanceDatasetWithLimits | null> {
    const row = await this.d1
      .prepare(FIND_PUBLISHED_EFFECTIVE_DATASET_SQL)
      .bind(travelDate, travelDate)
      .first<D1DatasetRow>();
    if (!row) {
      return null;
    }
    return this.toDatasetWithLimits(toContractDataset(row), true, travelDate);
  }

  /** @inheritdoc */
  async findPublishedEffectiveLimit(
    category: string,
    travelDate: string,
  ): Promise<{
    dataset: TravellerAllowanceDatasetRecord;
    limit: TravellerAllowanceLimitRecord;
  } | null> {
    const datasetRow = await this.d1
      .prepare(FIND_PUBLISHED_EFFECTIVE_DATASET_SQL)
      .bind(travelDate, travelDate)
      .first<D1DatasetRow>();
    if (!datasetRow) {
      return null;
    }
    const limitRow = await this.d1
      .prepare(FIND_PUBLISHED_EFFECTIVE_LIMIT_FOR_KEY_SQL)
      .bind(datasetRow.id, category, travelDate, travelDate)
      .first<D1LimitRow>();
    // The version resolves as a unit: a missing category row is a
    // curation error surfaced as null — never an older version's cap.
    if (!limitRow) {
      return null;
    }
    return {
      dataset: toContractDataset(datasetRow),
      limit: toContractLimit(limitRow),
    };
  }

  /** @inheritdoc */
  async publish(
    id: number,
    confirmedBy: string,
  ): Promise<TravellerAllowanceDatasetWithLimits | null> {
    // Read BEFORE the transition: unknown/not-pending → null (FX
    // parity); a blank citation (dataset or any limit row) is a hard
    // refusal, not a silent null.
    const version = await this.findDatasetById(id);
    if (!version || version.dataset.status !== 'PENDING_CONFIRMATION') {
      return null;
    }
    if (version.dataset.sourceCitation.trim() === '') {
      throw new MissingAllowanceSourceCitationError(id, null);
    }
    // A version without cap rows would cap nothing while appearing
    // authoritative — refuse it as the curation error it is.
    if (version.limits.length === 0) {
      throw new Error(
        `allowance dataset ${id} ("${version.dataset.versionLabel}") has no limit rows — ` +
          'a version without caps is a curation error and can never be published',
      );
    }
    for (const limit of version.limits) {
      if (limit.sourceCitation.trim() === '') {
        throw new MissingAllowanceSourceCitationError(limit.id, limit.category);
      }
    }

    const row = await this.d1
      .prepare(PUBLISH_DATASET_SQL)
      .bind(confirmedBy, new Date().toISOString(), id)
      .first<D1DatasetRow>();
    // Only a concurrent publish could have consumed the pending state
    // between the read and the constrained UPDATE — still null, still
    // terminal-once semantics. Limits carry no status: they published
    // with their dataset atomically.
    if (!row) {
      return null;
    }
    return this.toDatasetWithLimits(toContractDataset(row), false, null);
  }

  /**
   * Attach a dataset row's limit rows — window-filtered when resolving
   * for a travel date, unfiltered for the full version view.
   */
  private async toDatasetWithLimits(
    dataset: TravellerAllowanceDatasetRecord,
    filterByDate: boolean,
    travelDate: string | null,
  ): Promise<TravellerAllowanceDatasetWithLimits> {
    const rows = filterByDate
      ? (
          await this.d1
            .prepare(FIND_LIMITS_FOR_DATASET_ON_SQL)
            .bind(dataset.id, travelDate!, travelDate!)
            .all<D1LimitRow>()
        ).results
      : (
          await this.d1
            .prepare(FIND_LIMITS_FOR_DATASET_SQL)
            .bind(dataset.id)
            .all<D1LimitRow>()
        ).results;
    return { dataset, limits: rows.map(toContractLimit) };
  }
}
