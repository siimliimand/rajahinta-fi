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
import { eq, and, lte, or, isNull, gt, desc } from 'drizzle-orm';
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
          or(isNull(taxRules.effectiveTo), gt(taxRules.effectiveTo, asOf)),
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
            gt(taxRules.effectiveTo, fromDate),
          ),
        ),
      )
      .orderBy(taxRules.effectiveFrom);
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
            gt(taxRules.effectiveTo, asOf),
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
            gt(taxRules.effectiveTo, fromDate),
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
          or(isNull(taxRules.effectiveTo), gt(taxRules.effectiveTo, now)),
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
            gt(taxRules.effectiveTo, asOf),
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