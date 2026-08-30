/**
 * D1 TaxRateRepository — the Cloudflare-side implementation of the
 * abstract {@link TaxRateRepository} contract (task 2.5, change
 * migrate-to-cloudflare), plus {@link D1TaxRuleRepositoryAdapter} which
 * bridges the same data to the domain-layer {@link ITaxRuleRepositoryPort}
 * — the exact pairing the pg `tax-rate.repository.ts` provides.
 *
 * Method signatures and result shapes match the pg
 * DrizzleTaxRateRepository exactly; the pg-shape translation happens
 * here at the repository boundary (design D2 — the pg numeric-coercion
 * layer is NOT ported): the pg driver returned `numeric(12,6)` as
 * decimal text and `timestamp` as Date, so this repository renders REAL
 * rates as fixed-scale decimal text and converts ISO-8601 TEXT columns
 * to Date objects. Date comparisons run as ISO-8601 TEXT comparisons in
 * SQL — the stored column values and the bound parameters share the
 * same `Date.toISOString()` shape, so lexicographic order equals
 * chronological order.
 *
 * Effective-window predicates preserve the pg boundary semantics
 * exactly: `findEffectiveVersion` treats `effectiveTo` as INCLUSIVE
 * (`effective_to >= asOf`), matching the D5 rule the pg repository and
 * the seed self-check rely on.
 *
 * @module D1TaxRateRepository
 */
import { Injectable } from '@nestjs/common';
import type { ITaxRuleRepositoryPort, TaxRuleRecordPort, AbvTierConditions } from '@rajahinta/core-domain';
import { TaxRateRepository } from '../../abstracts';
import type { D1DatabaseLike } from '../../d1/executor';
import { validateEffectiveRanges, type EffectiveRangeInput } from '../effective-range-validator';

// Re-exported for API stability — the pure helper lives in its own module
// (shared with the pg repository and the seed self-check).
export { validateEffectiveRanges, type EffectiveRangeInput } from '../effective-range-validator';
import { taxRules } from '../../schema';

/** Contract row type (canonical pg shape — numeric string, Date objects). */
type TaxRuleRecord = typeof taxRules.$inferSelect;

/** pg column scale: rate numeric(12,6). */
const RATE_SCALE = 6;

/** Raw D1 tax_rules row (snake_case, REAL rate, ISO-8601 TEXT instants). */
export interface D1TaxRuleRow {
  readonly id: number;
  readonly tax_type: string;
  readonly product_category: string;
  readonly rate: number;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly exemption_conditions: string | null;
  readonly calculation_formula_reference: string;
  readonly official_source: string;
  readonly verification_date: string | null;
  readonly version_label: string;
  readonly created_at: string;
}

/** Parse a jsonb-shaped TEXT column; drizzle pg jsonb returns parsed objects. */
function parseJsonColumn(value: string | null): unknown {
  return value === null ? null : JSON.parse(value);
}

function toInstant(value: string): Date {
  return new Date(value);
}

/**
 * Raw D1 row → the canonical pg-shaped contract record. Rate REAL → the
 * fixed-scale decimal text the pg numeric(12,6) driver returned.
 */
export function toContractTaxRule(row: D1TaxRuleRow): TaxRuleRecord {
  return {
    id: row.id,
    taxType: row.tax_type,
    productCategory: row.product_category,
    rate: row.rate.toFixed(RATE_SCALE),
    effectiveFrom: toInstant(row.effective_from),
    effectiveTo: row.effective_to === null ? null : toInstant(row.effective_to),
    exemptionConditions: parseJsonColumn(row.exemption_conditions),
    calculationFormulaReference: row.calculation_formula_reference,
    officialSource: row.official_source,
    verificationDate:
      row.verification_date === null ? null : toInstant(row.verification_date),
    versionLabel: row.version_label,
    createdAt: toInstant(row.created_at),
  };
}

const TAX_RULE_COLUMNS = `
  id, tax_type, product_category, rate, effective_from, effective_to,
  exemption_conditions, calculation_formula_reference, official_source,
  verification_date, version_label, created_at`;

/** The latest rule whose closed [effective_from, effective_to] window covers asOf. */
const FIND_EFFECTIVE_SQL = `
  SELECT ${TAX_RULE_COLUMNS} FROM tax_rules
   WHERE effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
   ORDER BY effective_from DESC
   LIMIT 1`;

const FIND_BY_ID_SQL = `
  SELECT ${TAX_RULE_COLUMNS} FROM tax_rules WHERE id = ?`;

/** Window-overlap read: [fromDate, toDate) intersects [effective_from, effective_to]. */
const FIND_HISTORY_SQL = `
  SELECT ${TAX_RULE_COLUMNS} FROM tax_rules
   WHERE tax_type = ? AND product_category = ?
     AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
   ORDER BY effective_from ASC`;

/** Existing rows for range validation, grouped per ABV band by the caller. */
const RANGE_VALIDATION_SQL = `
  SELECT effective_from, effective_to, exemption_conditions FROM tax_rules
   WHERE tax_type = ? AND product_category = ?`;

@Injectable()
export class D1TaxRateRepository extends TaxRateRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async findEffectiveVersion(asOf: Date): Promise<TaxRuleRecord | null> {
    const asOfText = asOf.toISOString();
    const row = await this.d1
      .prepare(FIND_EFFECTIVE_SQL)
      .bind(asOfText, asOfText)
      .first<D1TaxRuleRow>();
    return row ? toContractTaxRule(row) : null;
  }

  /** @inheritdoc */
  async findVersionById(id: number): Promise<TaxRuleRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_ID_SQL)
      .bind(id)
      .first<D1TaxRuleRow>();
    return row ? toContractTaxRule(row) : null;
  }

  /** @inheritdoc */
  async findHistoryRates(
    taxType: string,
    productCategory: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<TaxRuleRecord[]> {
    const rows = (
      await this.d1
        .prepare(FIND_HISTORY_SQL)
        .bind(taxType, productCategory, toDate.toISOString(), fromDate.toISOString())
        .all<D1TaxRuleRow>()
    ).results;
    return rows.map(toContractTaxRule);
  }

  /**
   * Validate that effective-date ranges for a given (taxType, productCategory)
   * are non-overlapping and gapless, including optional candidate rows that
   * have not yet been persisted — same contract as the pg repository, using
   * the shared pure validator. A category carries one CONCURRENT timeline
   * per ABV band; ranges are contiguous within a band, not across bands.
   *
   * @throws {Error} with a descriptive message if gaps or overlaps are found.
   */
  async validateEffectiveRanges(
    taxType: string,
    productCategory: string,
    candidates?: EffectiveRangeInput[],
  ): Promise<void> {
    const rows = (
      await this.d1
        .prepare(RANGE_VALIDATION_SQL)
        .bind(taxType, productCategory)
        .all<{
          effective_from: string;
          effective_to: string | null;
          exemption_conditions: string | null;
        }>()
    ).results;

    const byBand = new Map<string, EffectiveRangeInput[]>();
    const bandKey = (band: unknown): string => (band == null ? 'none' : JSON.stringify(band));
    for (const row of rows) {
      const band = parseJsonColumn(row.exemption_conditions);
      const key = bandKey(band);
      if (!byBand.has(key)) byBand.set(key, []);
      byBand.get(key)!.push({
        effectiveFrom: toInstant(row.effective_from),
        effectiveTo: row.effective_to === null ? null : toInstant(row.effective_to),
      });
    }
    if (candidates) {
      // Candidate rows without band context validate as one timeline.
      byBand.set('__candidates__', candidates);
    }

    const errors: string[] = [];
    for (const [key, bandRows] of byBand) {
      for (const err of validateEffectiveRanges(bandRows)) {
        errors.push(`[${taxType}:${productCategory} band=${key}] ${err}`);
      }
    }
    if (errors.length > 0) {
      throw new Error(
        `Invalid effective ranges for taxType="${taxType}" productCategory="${productCategory}": ${errors.join('; ')}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Domain-port adapter — maps ITaxRuleRepositoryPort onto the tax_rules data
// ---------------------------------------------------------------------------

/** Exact-match-then-general fallback lookup shared by findApplicable. */
const FIND_BY_CATEGORY_SQL = `
  SELECT ${TAX_RULE_COLUMNS} FROM tax_rules
   WHERE tax_type = ? AND product_category = ?
     AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
   ORDER BY effective_from DESC
   LIMIT 1`;

const FIND_ALL_BY_CATEGORY_SQL = `
  SELECT ${TAX_RULE_COLUMNS} FROM tax_rules
   WHERE tax_type = ? AND product_category = ?
     AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
   ORDER BY effective_from DESC`;

const ACTIVE_VERSION_LABELS_SQL = `
  SELECT DISTINCT version_label FROM tax_rules
   WHERE effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
   ORDER BY version_label ASC`;

/**
 * Adapter that implements the domain-layer {@link ITaxRuleRepositoryPort}
 * by reading the D1 `tax_rules` table — the D1 counterpart of the pg
 * TaxRuleRepositoryAdapter. Registered under the
 * {@code TAX_RULE_REPOSITORY_PORT} injection token so that
 * AlcoholExciseService and ContainerDutyService can consume it without
 * depending on the data-platform layer directly.
 */
@Injectable()
export class D1TaxRuleRepositoryAdapter implements ITaxRuleRepositoryPort {
  constructor(private readonly d1: D1DatabaseLike) {}

  /** @inheritdoc */
  async findApplicable(
    taxType: string,
    productCategory: string,
    asOf: Date,
  ): Promise<TaxRuleRecordPort | null> {
    // 1. Try exact productCategory match
    const exact = await this.findByCategory(taxType, productCategory, asOf);
    if (exact) {
      return this.toPortRecord(exact);
    }

    // 2. Fallback to a general / wildcard rule for the same taxType
    const general = await this.findByCategory(taxType, 'general', asOf);
    if (general) {
      return this.toPortRecord(general);
    }

    return null;
  }

  /** @inheritdoc */
  async findAllApplicable(
    taxType: string,
    productCategory: string,
    asOf: Date,
  ): Promise<TaxRuleRecordPort[]> {
    const rows = (
      await this.d1
        .prepare(FIND_ALL_BY_CATEGORY_SQL)
        .bind(taxType, productCategory, asOf.toISOString(), asOf.toISOString())
        .all<D1TaxRuleRow>()
    ).results;
    return rows.map((row) => this.toPortRecord(row));
  }

  /** @inheritdoc */
  async findHistoryRates(
    taxType: string,
    productCategory: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<TaxRuleRecordPort[]> {
    const rows = (
      await this.d1
        .prepare(FIND_HISTORY_SQL)
        .bind(taxType, productCategory, toDate.toISOString(), fromDate.toISOString())
        .all<D1TaxRuleRow>()
    ).results;
    return rows.map((row) => this.toPortRecord(row));
  }

  /** @inheritdoc */
  async findActiveVersionLabels(): Promise<readonly string[]> {
    const now = new Date().toISOString();
    const rows = (
      await this.d1
        .prepare(ACTIVE_VERSION_LABELS_SQL)
        .bind(now, now)
        .all<{ version_label: string }>()
    ).results;
    return rows.map((r) => r.version_label);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Most recent active rule for the given type and category, or null. */
  private async findByCategory(
    taxType: string,
    productCategory: string,
    asOf: Date,
  ): Promise<D1TaxRuleRow | null> {
    return this.d1
      .prepare(FIND_BY_CATEGORY_SQL)
      .bind(taxType, productCategory, asOf.toISOString(), asOf.toISOString())
      .first<D1TaxRuleRow>();
  }

  /**
   * Raw row → the port read model. The decimal-text rate passes through
   * (the port carries decimal strings by design); the JSONB-shaped
   * exemption conditions flatten to their ABV tier — the same mapping
   * the pg adapter performs on the driver's parsed jsonb.
   */
  private toPortRecord(row: D1TaxRuleRow): TaxRuleRecordPort {
    const raw = parseJsonColumn(row.exemption_conditions) as Record<string, unknown> | null;
    let exemptionConditions: AbvTierConditions | null = null;
    if (raw && typeof raw.appliesTo === 'object' && raw.appliesTo !== null) {
      const appliesTo = raw.appliesTo as Record<string, unknown>;
      const min =
        typeof appliesTo.minAlcoholByVolume === 'number'
          ? appliesTo.minAlcoholByVolume
          : undefined;
      const max =
        typeof appliesTo.maxAlcoholByVolume === 'number'
          ? appliesTo.maxAlcoholByVolume
          : undefined;
      if (min !== undefined || max !== undefined) {
        exemptionConditions = { minAlcoholByVolume: min, maxAlcoholByVolume: max };
      }
    }

    return {
      id: row.id,
      taxType: row.tax_type,
      productCategory: row.product_category,
      rate: row.rate.toFixed(RATE_SCALE),
      effectiveFrom: toInstant(row.effective_from),
      effectiveTo: row.effective_to === null ? null : toInstant(row.effective_to),
      calculationFormulaReference: row.calculation_formula_reference,
      officialSource: row.official_source,
      verificationDate:
        row.verification_date === null ? null : toInstant(row.verification_date),
      versionLabel: row.version_label,
      exemptionConditions,
    };
  }
}
