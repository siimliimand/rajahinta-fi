/**
 * Drizzle TaxRateRepository — concrete implementation of the abstract
 * TaxRateRepository class.
 *
 * Also provides TaxRuleRepositoryAdapter which adapts the Drizzle repository
 * to the domain-layer ITaxRuleRepositoryPort contract.
 *
 * @module DrizzleTaxRateRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { eq, and, lte, or, isNull, gte, desc } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import {
  TaxRateRepository,
} from '../abstracts';
import {
  taxRules,
} from '../schema';
import type {
  ITaxRuleRepositoryPort,
  TaxRuleRecordPort,
  AbvTierConditions,
} from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Pure helper — gap/overlap validation for effective date ranges
// ---------------------------------------------------------------------------

/**
 * Describes a single date-interval rule for validation.
 */
export interface EffectiveRangeInput {
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

/**
 * Validate that a set of effective-date intervals are non-overlapping and
 * gapless within a (taxType, productCategory) group.
 *
 * **Semantics:**
 *   - Intervals are [effectiveFrom, effectiveTo] (inclusive on both ends;
 *     null effectiveTo means "open-ended / currently active").
 *   - Adjacent ranges are **permitted**: if prev.effectiveTo is 2026-03-31,
 *     next.effectiveFrom may be 2026-04-01 (the day after). This supports
 *     the 2026 intra-year split where one rule ends 31.3. and the next
 *     starts 1.4.
 *   - Gaps (next.effectiveFrom > day after prev.effectiveTo) are rejected.
 *   - Overlaps (next.effectiveFrom ≤ prev.effectiveTo) are rejected.
 *
 * @returns A list of human-readable error descriptions. Empty array = valid.
 */
export function validateEffectiveRanges(
  rules: EffectiveRangeInput[],
): string[] {
  if (rules.length < 2) return [];

  const sorted = [...rules].sort(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
  );

  const errors: string[] = [];

  // Check for multiple open-ended rules — they'd overlap each other
  const openEnded = sorted.filter((r) => r.effectiveTo === null);
  if (openEnded.length > 1) {
    errors.push(
      `Multiple open-ended rules: ${openEnded.map((r) => r.effectiveFrom.toISOString()).join(', ')}`,
    );
    // Can't validate ordering among open-ended rules; return early
    return errors;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i];
    const next = sorted[i + 1];

    // If prev is open-ended, any later rule overlaps
    if (prev.effectiveTo === null) {
      errors.push(
        `Overlap: open-ended rule starting ${prev.effectiveFrom.toISOString()} overlaps with rule starting ${next.effectiveFrom.toISOString()}`,
      );
      continue;
    }

    // Overlap: next starts on or before prev's end date
    if (next.effectiveFrom.getTime() <= prev.effectiveTo.getTime()) {
      errors.push(
        `Overlap: rule [${prev.effectiveFrom.toISOString()} – ${prev.effectiveTo.toISOString()}] overlaps with rule starting ${next.effectiveFrom.toISOString()}`,
      );
      continue;
    }

    // Gap: next starts more than one day after prev's end date
    const dayAfterEnd = new Date(prev.effectiveTo);
    dayAfterEnd.setDate(dayAfterEnd.getDate() + 1);
    if (next.effectiveFrom.getTime() > dayAfterEnd.getTime()) {
      errors.push(
        `Gap: rule ending ${prev.effectiveTo.toISOString()} followed by rule starting ${next.effectiveFrom.toISOString()} (expected start ${dayAfterEnd.toISOString()})`,
      );
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Drizzle repository (extends abstract class)
// ---------------------------------------------------------------------------

@Injectable()
export class DrizzleTaxRateRepository extends TaxRateRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {
    super();
  }

  /** @inheritdoc */
  async findEffectiveVersion(
    asOf: Date,
  ): Promise<typeof taxRules.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(taxRules)
      .where(
        and(
          lte(taxRules.effectiveFrom, asOf),
          or(isNull(taxRules.effectiveTo), gte(taxRules.effectiveTo, asOf)),
        ),
      )
      .orderBy(desc(taxRules.effectiveFrom))
      .limit(1);
    return row ?? null;
  }

  /** @inheritdoc */
  async findVersionById(
    id: number,
  ): Promise<typeof taxRules.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(taxRules)
      .where(eq(taxRules.id, id))
      .limit(1);
    return row ?? null;
  }

  /** @inheritdoc */
  async findHistoryRates(
    taxType: string,
    productCategory: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<typeof taxRules.$inferSelect[]> {
    return this.db
      .select()
      .from(taxRules)
      .where(
        and(
          eq(taxRules.taxType, taxType),
          eq(taxRules.productCategory, productCategory),
          lte(taxRules.effectiveFrom, toDate),
          or(
            isNull(taxRules.effectiveTo),
            gte(taxRules.effectiveTo, fromDate),
          ),
        ),
      )
      .orderBy(taxRules.effectiveFrom);
  }

  /**
   * Validate that effective-date ranges for a given (taxType, productCategory)
   * are non-overlapping and gapless, including optional candidate rows that
   * have not yet been persisted.
   *
   * Adjacent ranges (e.g. prev ends 31.3., next starts 1.4.) are permitted.
   *
   * @throws {Error} with a descriptive message if gaps or overlaps are found.
   */
  async validateEffectiveRanges(
    taxType: string,
    productCategory: string,
    candidates?: EffectiveRangeInput[],
  ): Promise<void> {
    const existing = await this.db
      .select({
        effectiveFrom: taxRules.effectiveFrom,
        effectiveTo: taxRules.effectiveTo,
      })
      .from(taxRules)
      .where(
        and(
          eq(taxRules.taxType, taxType),
          eq(taxRules.productCategory, productCategory),
        ),
      );

    const allRules: EffectiveRangeInput[] = candidates
      ? [...existing, ...candidates]
      : existing;

    const errors = validateEffectiveRanges(allRules);

    if (errors.length > 0) {
      throw new Error(
        `Invalid effective ranges for taxType="${taxType}" productCategory="${productCategory}": ${errors.join('; ')}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Domain-port adapter — maps ITaxRuleRepositoryPort to the Drizzle repo
// ---------------------------------------------------------------------------

/**
 * Adapter that implements the domain-layer {@link ITaxRuleRepositoryPort}
 * by delegating to the Drizzle-backed repository.
 *
 * Registered under the {@code TAX_RULE_REPOSITORY_PORT} injection token so
 * that {@link AlcoholExciseService} and {@link ContainerDutyService} can
 * consume it without depending on the data-platform layer directly.
 */
@Injectable()
export class TaxRuleRepositoryAdapter implements ITaxRuleRepositoryPort {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {}

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
    const rows = await this.db
      .select()
      .from(taxRules)
      .where(
        and(
          eq(taxRules.taxType, taxType),
          eq(taxRules.productCategory, productCategory),
          lte(taxRules.effectiveFrom, asOf),
          or(
            isNull(taxRules.effectiveTo),
            gte(taxRules.effectiveTo, asOf),
          ),
        ),
      )
      .orderBy(desc(taxRules.effectiveFrom));

    return rows.map(this.toPortRecord);
  }

  /** @inheritdoc */
  async findHistoryRates(
    taxType: string,
    productCategory: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<TaxRuleRecordPort[]> {
    const rows = await this.db
      .select()
      .from(taxRules)
      .where(
        and(
          eq(taxRules.taxType, taxType),
          eq(taxRules.productCategory, productCategory),
          lte(taxRules.effectiveFrom, toDate),
          or(
            isNull(taxRules.effectiveTo),
            gte(taxRules.effectiveTo, fromDate),
          ),
        ),
      )
      .orderBy(taxRules.effectiveFrom);

    return rows.map(this.toPortRecord);
  }

  /** @inheritdoc */
  async findActiveVersionLabels(): Promise<readonly string[]> {
    const now = new Date();
    const rows = await this.db
      .select({ versionLabel: taxRules.versionLabel })
      .from(taxRules)
      .where(
        and(
          lte(taxRules.effectiveFrom, now),
          or(isNull(taxRules.effectiveTo), gte(taxRules.effectiveTo, now)),
        ),
      )
      .groupBy(taxRules.versionLabel);

    return rows.map((r) => r.versionLabel);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Return the most recent active rule for the given type and category
   * on the given date, or null if none exists.
   */
  private async findByCategory(
    taxType: string,
    productCategory: string,
    asOf: Date,
  ): Promise<typeof taxRules.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(taxRules)
      .where(
        and(
          eq(taxRules.taxType, taxType),
          eq(taxRules.productCategory, productCategory),
          lte(taxRules.effectiveFrom, asOf),
          or(
            isNull(taxRules.effectiveTo),
            gte(taxRules.effectiveTo, asOf),
          ),
        ),
      )
      .orderBy(desc(taxRules.effectiveFrom))
      .limit(1);
    return row ?? null;
  }

  private toPortRecord(
    row: typeof taxRules.$inferSelect,
  ): TaxRuleRecordPort {
    // The DB stores exemptionConditions as JSONB with a nested structure:
    //   { description: string, appliesTo: { minAlcoholByVolume?: number, maxAlcoholByVolume?: number } }
    // We flatten to AbvTierConditions for the port.
    const raw = row.exemptionConditions as Record<string, unknown> | null;
    let exemptionConditions: AbvTierConditions | null = null;
    if (raw && typeof raw.appliesTo === 'object' && raw.appliesTo !== null) {
      const appliesTo = raw.appliesTo as Record<string, unknown>;
      const min = typeof appliesTo.minAlcoholByVolume === 'number' ? appliesTo.minAlcoholByVolume : undefined;
      const max = typeof appliesTo.maxAlcoholByVolume === 'number' ? appliesTo.maxAlcoholByVolume : undefined;
      if (min !== undefined || max !== undefined) {
        exemptionConditions = { minAlcoholByVolume: min, maxAlcoholByVolume: max };
      }
    }

    return {
      id: row.id,
      taxType: row.taxType,
      productCategory: row.productCategory,
      rate: row.rate,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      calculationFormulaReference: row.calculationFormulaReference,
      officialSource: row.officialSource,
      verificationDate: row.verificationDate,
      versionLabel: row.versionLabel,
      exemptionConditions,
    };
  }
}