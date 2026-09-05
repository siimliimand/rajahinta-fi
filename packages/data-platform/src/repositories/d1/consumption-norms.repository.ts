/**
 * D1 ConsumptionNormsRepository — versioned consumption-norm reference
 * dataset for the event calculator (task 4.1, change
 * product-roadmap-phases-1-4, design R5), backed by the
 * `consumption_norms` table. Co-located abstract + concrete
 * (carrier-box-types precedent — a D1-only table with no pg
 * counterpart).
 *
 * Enforces the FX-dataset invariants at the storage boundary (the
 * lifecycle is reused from `fx_rate_datasets`, not reinvented):
 *
 * - **Versioned, append-only** — a norms version is the set of rows
 *   sharing a `versionLabel`, keyed by drinkType × eventProfile.
 *   Corrections append a new version; no method updates norm values and
 *   published rows are immutable.
 * - **Manual-only publication** — rows are created
 *   PENDING_CONFIRMATION; the only PENDING_CONFIRMATION → PUBLISHED
 *   transition is this class's explicit `publish` call, the same
 *   operator-confirmation path the FX datasets flow through.
 * - **Citation guard** — a norms row without a source citation can
 *   never reach PUBLISHED. The column is NOT NULL (a citation-less row
 *   is unrepresentable at rest); `publish` additionally refuses a
 *   blank/whitespace citation defensively, since NOT NULL alone would
 *   admit `''`.
 * - **Half-open effective window** — resolution matches
 *   `effective_from <= eventDate < effective_to` (null effective_to =
 *   open-ended/current) on ISO `YYYY-MM-DD` calendar dates, which
 *   compare chronologically as TEXT. When published versions overlap
 *   transiently, the newest effectiveFrom per drink type wins.
 *
 * Resolution returns the norms version identifier (`versionLabel`) with
 * every row so calculation results can name the dataset they used
 * (spec: event-calculator, "Norms version cited").
 *
 * @module D1ConsumptionNormsRepository
 */
import { Injectable } from '@nestjs/common';
import type { D1DatabaseLike } from '../../d1/executor';

/** Lifecycle states — the FX dataset value set, reused verbatim. */
export const CONSUMPTION_NORM_STATUSES = [
  'PENDING_CONFIRMATION',
  'PUBLISHED',
] as const;

export type ConsumptionNormStatus = (typeof CONSUMPTION_NORM_STATUSES)[number];

/**
 * Drink types — the canonical tax-rule category keys, so the event
 * calculator's per-type lines feed the landed-cost/tax engines without
 * a translation layer.
 */
export const CONSUMPTION_NORM_DRINK_TYPES = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'intermediate_products',
  'other_fermented',
  'spirits',
] as const;

/** Event profiles — the MVP simple mode's closed set. */
export const CONSUMPTION_NORM_EVENT_PROFILES = [
  'casual_gathering',
  'dinner_party',
  'celebration',
] as const;

/** Contract row — camelCase projection of the snake_case D1 row. */
export interface ConsumptionNormRecord {
  readonly id: number;
  /** Norms version identifier — named by calculation results as provenance. */
  readonly versionLabel: string;
  readonly drinkType: string;
  readonly eventProfile: string;
  /** Litres of finished beverage per guest per hour. */
  readonly normValuePerGuestPerHour: number;
  /** Verifiable source citation (publisher, derivation, URL). */
  readonly sourceCitation: string;
  readonly status: ConsumptionNormStatus;
  /** Effective window on calendar dates — half-open [effectiveFrom, effectiveTo). */
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly confirmedBy: string | null;
  readonly confirmedAt: Date | null;
  readonly createdAt: Date;
}

/** Input for appending a new pending norms version row. */
export interface ConsumptionNormInsert {
  readonly versionLabel: string;
  readonly drinkType: string;
  readonly eventProfile: string;
  readonly normValuePerGuestPerHour: number;
  readonly sourceCitation: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
}

/**
 * Thrown by `publish` when a row's citation is present but blank — the
 * defensive second guard behind the NOT NULL column (spec: a norms row
 * without a source citation SHALL never reach PUBLISHED).
 */
export class MissingNormSourceCitationError extends Error {
  constructor(id: number) {
    super(
      `consumption_norms row ${id} has a blank source citation — ` +
        'a norms row without a verifiable citation can never be published',
    );
    this.name = 'MissingNormSourceCitationError';
  }
}

/** Thrown by `createPendingVersion` when a batch spans version labels. */
export class NormVersionMismatchError extends Error {
  constructor(labels: readonly string[]) {
    super(
      `a norms version append must share one versionLabel — got: ${[...new Set(labels)].join(', ')}`,
    );
    this.name = 'NormVersionMismatchError';
  }
}

/** Raw D1 consumption_norms row. */
interface D1NormRow {
  readonly id: number;
  readonly version_label: string;
  readonly drink_type: string;
  readonly event_profile: string;
  readonly norm_value_per_guest_per_hour: number;
  readonly source_citation: string;
  readonly status: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly confirmed_by: string | null;
  readonly confirmed_at: string | null;
  readonly created_at: string;
}

/** Narrow the varchar column onto the lifecycle union — defense in depth. */
function toStatus(value: string): ConsumptionNormStatus {
  if (!(CONSUMPTION_NORM_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `consumption_norms.status "${value}" is not a known norms lifecycle state`,
    );
  }
  return value as ConsumptionNormStatus;
}

function toContractNorm(row: D1NormRow): ConsumptionNormRecord {
  return {
    id: row.id,
    versionLabel: row.version_label,
    drinkType: row.drink_type,
    eventProfile: row.event_profile,
    normValuePerGuestPerHour: row.norm_value_per_guest_per_hour,
    sourceCitation: row.source_citation,
    status: toStatus(row.status),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at === null ? null : new Date(row.confirmed_at),
    createdAt: new Date(row.created_at),
  };
}

const NORM_COLUMNS = `
  id, version_label, drink_type, event_profile, norm_value_per_guest_per_hour,
  source_citation, status, effective_from, effective_to, confirmed_by,
  confirmed_at, created_at`;

const FIND_BY_ID_SQL = `
  SELECT ${NORM_COLUMNS} FROM consumption_norms WHERE id = ?`;

const FIND_BY_VERSION_SQL = `
  SELECT ${NORM_COLUMNS} FROM consumption_norms
   WHERE version_label = ?
   ORDER BY event_profile ASC, drink_type ASC`;

const FIND_PENDING_SQL = `
  SELECT ${NORM_COLUMNS} FROM consumption_norms
   WHERE status = 'PENDING_CONFIRMATION'
   ORDER BY created_at ASC, version_label ASC, event_profile ASC, drink_type ASC`;

/**
 * Effective-window resolution for one (profile, date): PUBLISHED rows
 * where effective_from <= date < effective_to (null = open-ended) —
 * the STRICT upper bound is the half-open window's edge. Ordered so
 * the newest effectiveFrom per drink type can be picked first.
 */
const FIND_PUBLISHED_EFFECTIVE_SQL = `
  SELECT ${NORM_COLUMNS} FROM consumption_norms
   WHERE status = 'PUBLISHED'
     AND event_profile = ?
     AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
   ORDER BY drink_type ASC, effective_from DESC`;

/** Same window, one key — the per-drink-type read, newest version wins. */
const FIND_PUBLISHED_EFFECTIVE_FOR_KEY_SQL = `
  SELECT ${NORM_COLUMNS} FROM consumption_norms
   WHERE status = 'PUBLISHED'
     AND event_profile = ? AND drink_type = ?
     AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
   ORDER BY effective_from DESC
   LIMIT 1`;

/** Only a PENDING_CONFIRMATION row can flip — never-auto-publish guard. */
const PUBLISH_SQL = `
  UPDATE consumption_norms
     SET status = 'PUBLISHED', confirmed_by = ?, confirmed_at = ?
   WHERE id = ? AND status = 'PENDING_CONFIRMATION'
   RETURNING ${NORM_COLUMNS}`;

const INSERT_NORM_SQL = `
  INSERT INTO consumption_norms (
    version_label, drink_type, event_profile, norm_value_per_guest_per_hour,
    source_citation, status, effective_from, effective_to
  ) VALUES (?, ?, ?, ?, ?, 'PENDING_CONFIRMATION', ?, ?)`;

/**
 * Versioned norms reference contract — the storage-boundary shape the
 * event calculator (and the operator console's dataset-confirmation
 * path) consume. Append-only: there is deliberately no update path for
 * norm values.
 */
@Injectable()
export abstract class ConsumptionNormsRepository {
  /**
   * Append a new norms version as one all-or-nothing batch — every row
   * PENDING_CONFIRMATION, every row sharing one versionLabel. Never
   * auto-publishes.
   */
  abstract createPendingVersion(
    rows: readonly ConsumptionNormInsert[],
  ): Promise<ConsumptionNormRecord[]>;

  abstract findById(id: number): Promise<ConsumptionNormRecord | null>;

  /** Every row of a version — historical versions stay queryable after a new one is published. */
  abstract findByVersionLabel(versionLabel: string): Promise<ConsumptionNormRecord[]>;

  /** Rows awaiting operator confirmation, oldest first (the review queue). */
  abstract findPending(): Promise<ConsumptionNormRecord[]>;

  /**
   * PUBLISHED norms for a profile effective on the event date — one row
   * per drink type (newest effectiveFrom wins on transient overlap),
   * each naming its version. Half-open window: effectiveFrom ≤ date <
   * effectiveTo; null effectiveTo is open-ended.
   */
  abstract findPublishedEffectiveOn(
    eventProfile: string,
    eventDate: string,
  ): Promise<ConsumptionNormRecord[]>;

  /** Per-key resolution — same half-open window and newest-version rule. */
  abstract findPublishedEffectiveNorm(
    drinkType: string,
    eventProfile: string,
    eventDate: string,
  ): Promise<ConsumptionNormRecord | null>;

  /**
   * The manual publish transition (operator confirmation path). Returns
   * null when the row is unknown or not PENDING_CONFIRMATION
   * (PUBLISHED is terminal — republish is a no-op, FX parity); throws
   * {@link MissingNormSourceCitationError} when the citation is blank.
   */
  abstract publish(
    id: number,
    confirmedBy: string,
  ): Promise<ConsumptionNormRecord | null>;
}

@Injectable()
export class D1ConsumptionNormsRepository extends ConsumptionNormsRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async createPendingVersion(
    rows: readonly ConsumptionNormInsert[],
  ): Promise<ConsumptionNormRecord[]> {
    if (rows.length === 0) {
      return [];
    }
    const labels = rows.map((row) => row.versionLabel);
    if (new Set(labels).size !== 1) {
      throw new NormVersionMismatchError(labels);
    }

    // One batch = one implicit transaction: a version either lands whole
    // or not at all (the FX dataset+rates append shape). Plain INSERTs —
    // batch statements cannot consume a previous statement's RETURNING —
    // the version rows are read back after the batch commits.
    await this.d1.batch(
      rows.map((row) =>
        this.d1
          .prepare(INSERT_NORM_SQL)
          .bind(
            row.versionLabel,
            row.drinkType,
            row.eventProfile,
            row.normValuePerGuestPerHour,
            row.sourceCitation,
            row.effectiveFrom,
            row.effectiveTo ?? null,
          ),
      ),
    );

    const versionLabel = rows[0].versionLabel;
    return this.findByVersionLabel(versionLabel);
  }

  /** @inheritdoc */
  async findById(id: number): Promise<ConsumptionNormRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_ID_SQL)
      .bind(id)
      .first<D1NormRow>();
    return row ? toContractNorm(row) : null;
  }

  /** @inheritdoc */
  async findByVersionLabel(
    versionLabel: string,
  ): Promise<ConsumptionNormRecord[]> {
    const rows = (
      await this.d1
        .prepare(FIND_BY_VERSION_SQL)
        .bind(versionLabel)
        .all<D1NormRow>()
    ).results;
    return rows.map(toContractNorm);
  }

  /** @inheritdoc */
  async findPending(): Promise<ConsumptionNormRecord[]> {
    const rows = (
      await this.d1.prepare(FIND_PENDING_SQL).all<D1NormRow>()
    ).results;
    return rows.map(toContractNorm);
  }

  /** @inheritdoc */
  async findPublishedEffectiveOn(
    eventProfile: string,
    eventDate: string,
  ): Promise<ConsumptionNormRecord[]> {
    const rows = (
      await this.d1
        .prepare(FIND_PUBLISHED_EFFECTIVE_SQL)
        .bind(eventProfile, eventDate, eventDate)
        .all<D1NormRow>()
    ).results;
    // Newest effectiveFrom first per drink type (SQL ordering) — keep
    // the first row of each type; transient overlaps resolve like the
    // FX dataset read does, deterministically.
    const seen = new Set<string>();
    const effective: ConsumptionNormRecord[] = [];
    for (const row of rows) {
      if (!seen.has(row.drink_type)) {
        seen.add(row.drink_type);
        effective.push(toContractNorm(row));
      }
    }
    return effective;
  }

  /** @inheritdoc */
  async findPublishedEffectiveNorm(
    drinkType: string,
    eventProfile: string,
    eventDate: string,
  ): Promise<ConsumptionNormRecord | null> {
    const row = await this.d1
      .prepare(FIND_PUBLISHED_EFFECTIVE_FOR_KEY_SQL)
      .bind(eventProfile, drinkType, eventDate, eventDate)
      .first<D1NormRow>();
    return row ? toContractNorm(row) : null;
  }

  /** @inheritdoc */
  async publish(
    id: number,
    confirmedBy: string,
  ): Promise<ConsumptionNormRecord | null> {
    // Read BEFORE the transition: unknown/not-pending → null (FX
    // parity); a blank citation is a hard refusal, not a silent null.
    const existing = await this.findById(id);
    if (!existing || existing.status !== 'PENDING_CONFIRMATION') {
      return null;
    }
    if (existing.sourceCitation.trim() === '') {
      throw new MissingNormSourceCitationError(id);
    }

    const row = await this.d1
      .prepare(PUBLISH_SQL)
      .bind(confirmedBy, new Date().toISOString(), id)
      .first<D1NormRow>();
    // Only a concurrent publish could have consumed the pending state
    // between the read and the constrained UPDATE — still null, still
    // terminal-once semantics.
    return row ? toContractNorm(row) : null;
  }
}
