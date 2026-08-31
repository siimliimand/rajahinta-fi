/**
 * D1TaxRateRepository + D1TaxRuleRepositoryAdapter — real-SQLite tests
 * (task 2.5) on the node:sqlite harness with the committed migrations
 * applied. Ports the behavioral expectations of the pg tax-rate
 * repository: effective-window boundary semantics (D5 inclusive end),
 * history overlap reads, the adapter's exact→general fallback, ABV-tier
 * flattening, and active version labels.
 *
 * @module D1TaxRateRepositoryTest
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import {
  D1TaxRateRepository,
  D1TaxRuleRepositoryAdapter,
} from '../tax-rate.repository';

// A fresh migrated DB per test: the effective-window reads are keyed by
// (taxType, productCategory), so a shared database would let earlier
// tests' rules bleed into later categories' windows.
let d1: ReturnType<typeof openMigratedD1>['d1'];
let repo: D1TaxRateRepository;
let adapter: D1TaxRuleRepositoryAdapter;

beforeEach(() => {
  ({ d1 } = openMigratedD1());
  repo = new D1TaxRateRepository(d1);
  adapter = new D1TaxRuleRepositoryAdapter(d1);
});

function iso(day: string): string {
  return new Date(day).toISOString();
}

/** Seed one rule; rate is stored as the REAL the D1 driver returns. */
async function seedRule(overrides: {
  id: number;
  taxType?: string;
  productCategory?: string;
  rate?: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  exemptionConditions?: unknown;
  versionLabel?: string;
}): Promise<void> {
  d1.prepare(
    `INSERT INTO tax_rules (id, tax_type, product_category, rate, effective_from,
       effective_to, exemption_conditions, calculation_formula_reference,
       official_source, verification_date, version_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'FLAT_PER_LITRE', 'https://vero.fi', ?, ?)`,
  ).bind(
    overrides.id,
    overrides.taxType ?? 'excise',
    overrides.productCategory ?? 'wine_still',
    overrides.rate ?? 4.56,
    iso(overrides.effectiveFrom),
    overrides.effectiveTo == null ? null : iso(overrides.effectiveTo),
    overrides.exemptionConditions == null
      ? null
      : JSON.stringify(overrides.exemptionConditions),
    iso('2026-08-21'),
    overrides.versionLabel ?? 'v2024',
  ).run();
}

describe('D1TaxRateRepository', () => {
  describe('findEffectiveVersion', () => {
    it('returns null when no rule exists yet', async () => {
      await expect(repo.findEffectiveVersion(new Date('2024-06-01'))).resolves.toBeNull();
    });

    it('selects the inclusive end: a rule expiring exactly on asOf IS selected (D5)', async () => {
      await seedRule({ id: 1, rate: 4.56, effectiveFrom: '2024-01-01', effectiveTo: '2024-12-31', versionLabel: 'v1.0-2024' });
      await seedRule({ id: 2, rate: 4.56, effectiveFrom: '2025-01-01', effectiveTo: null, versionLabel: 'v2.0-2025' });

      const onLastDay = await repo.findEffectiveVersion(new Date('2024-12-31'));
      expect(onLastDay?.versionLabel).toBe('v1.0-2024');

      const nextDay = await repo.findEffectiveVersion(new Date('2025-01-01'));
      expect(nextDay?.versionLabel).toBe('v2.0-2025');
    });

    it('later effectiveFrom wins when two rules cover asOf', async () => {
      await seedRule({ id: 11, rate: 0.36, effectiveFrom: '2026-01-01', effectiveTo: '2026-03-31', versionLabel: 'band-1-A' });
      await seedRule({ id: 12, rate: 0.5, effectiveFrom: '2026-04-01', effectiveTo: null, versionLabel: 'band-1-B' });

      // Intra-year wine split: 0.36 until 31.3., 0.50 from 1.4.
      await expect(
        repo.findEffectiveVersion(new Date('2026-03-31')),
      ).resolves.toMatchObject({ versionLabel: 'band-1-A' });
      await expect(
        repo.findEffectiveVersion(new Date('2026-04-01')),
      ).resolves.toMatchObject({ versionLabel: 'band-1-B' });
    });
  });

  describe('pg-shape translation', () => {
    it('returns the pg contract shape: numeric rate text, Date instants, parsed jsonb', async () => {
      await seedRule({
        id: 21,
        rate: 0.51,
        effectiveFrom: '2025-01-01',
        exemptionConditions: {
          description: 'tier',
          appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 },
        },
        versionLabel: 'container-2025',
      });

      const row = await repo.findVersionById(21);
      expect(row).not.toBeNull();
      // pg numeric(12,6) rendering at the repository boundary.
      expect(row!.rate).toBe('0.510000');
      expect(row!.effectiveFrom).toEqual(new Date(iso('2025-01-01')));
      expect(row!.effectiveTo).toBeNull();
      expect(row!.verificationDate).toEqual(new Date(iso('2026-08-21')));
      // jsonb column parsed to the object shape, not TEXT.
      expect(row!.exemptionConditions).toEqual({
        description: 'tier',
        appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 },
      });
    });
  });

  describe('findHistoryRates', () => {
    it('returns rules whose window overlaps [from, to], ordered by effectiveFrom', async () => {
      await seedRule({ id: 31, rate: 28.35, productCategory: 'beer', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31', versionLabel: 'v2025' });
      await seedRule({ id: 32, rate: 36.71, productCategory: 'beer', effectiveFrom: '2026-01-01', effectiveTo: null, versionLabel: 'v2026' });
      await seedRule({ id: 33, rate: 4.56, productCategory: 'wine_still', effectiveFrom: '2025-01-01', effectiveTo: null, versionLabel: 'wine' });

      const rates = await repo.findHistoryRates(
        'excise',
        'beer',
        new Date('2025-06-01'),
        new Date('2026-06-01'),
      );
      expect(rates.map((r) => r.versionLabel)).toEqual(['v2025', 'v2026']);
    });

    it('does not match a different category', async () => {
      const rates = await repo.findHistoryRates(
        'excise',
        'spirits',
        new Date('2025-01-01'),
        new Date('2026-12-31'),
      );
      expect(rates).toEqual([]);
    });
  });

  describe('validateEffectiveRanges', () => {
    it('accepts adjacent gapless windows per band', async () => {
      await seedRule({ id: 41, rate: 0.36, effectiveFrom: '2026-01-01', effectiveTo: '2026-03-31', exemptionConditions: { appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 } } });
      await seedRule({ id: 42, rate: 0.5, effectiveFrom: '2026-04-01', effectiveTo: null, exemptionConditions: { appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 } } });

      await expect(
        repo.validateEffectiveRanges('excise', 'wine_still'),
      ).resolves.toBeUndefined();
    });

    it('rejects overlaps within a band with a descriptive error', async () => {
      await seedRule({ id: 43, rate: 0.36, effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' });
      await seedRule({ id: 44, rate: 0.5, effectiveFrom: '2026-06-01', effectiveTo: null });

      await expect(
        repo.validateEffectiveRanges('excise', 'wine_still'),
      ).rejects.toThrow(/Invalid effective ranges.*Overlap/);
    });

    it('validates candidate rows that are not yet persisted', async () => {
      await expect(
        repo.validateEffectiveRanges('excise', 'cider', [
          { effectiveFrom: new Date('2026-01-01'), effectiveTo: null },
        ]),
      ).resolves.toBeUndefined();
      await expect(
        repo.validateEffectiveRanges('excise', 'cider', [
          { effectiveFrom: new Date('2026-01-01'), effectiveTo: new Date('2026-06-30') },
          { effectiveFrom: new Date('2026-06-01'), effectiveTo: null },
        ]),
      ).rejects.toThrow('Overlap');
    });
  });
});

describe('D1TaxRuleRepositoryAdapter', () => {
  it('prefers the exact category, falls back to general, then null', async () => {
    await seedRule({ id: 51, productCategory: 'beer', rate: 36.71, effectiveFrom: '2026-01-01', versionLabel: 'beer-2026' });
    await seedRule({ id: 52, productCategory: 'general', rate: 1.0, effectiveFrom: '2026-01-01', versionLabel: 'general-2026' });

    const exact = await adapter.findApplicable('excise', 'beer', new Date('2026-06-01'));
    expect(exact?.id).toBe(51);

    const fallback = await adapter.findApplicable('excise', 'cider', new Date('2026-06-01'));
    expect(fallback?.id).toBe(52);

    const none = await adapter.findApplicable('container_duty', 'cider', new Date('2026-06-01'));
    expect(none).toBeNull();
  });

  it('flattens exemptionConditions to the ABV tier for the port', async () => {
    await seedRule({
      id: 53,
      rate: 0.36,
      effectiveFrom: '2026-01-01',
      exemptionConditions: {
        description: 'Still wine > 1.2 – 2.8 %ABV',
        appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 },
      },
    });

    const rule = await adapter.findApplicable('excise', 'wine_still', new Date('2026-06-01'));
    expect(rule).toMatchObject({
      id: 53,
      rate: '0.360000',
      exemptionConditions: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 },
    });
    // Port carries Date instants, not TEXT.
    expect(rule!.effectiveFrom).toBeInstanceOf(Date);
    expect(rule!.effectiveTo).toBeNull();
  });

  it('returns all applicable rules ordered by effectiveFrom descending', async () => {
    await seedRule({ id: 54, rate: 5.68, effectiveFrom: '2026-01-01', exemptionConditions: { appliesTo: { maxAlcoholByVolume: 15 } }, versionLabel: 'low' });
    await seedRule({ id: 55, rate: 8.74, effectiveFrom: '2026-06-01', exemptionConditions: { appliesTo: { minAlcoholByVolume: 15, maxAlcoholByVolume: 22 } }, versionLabel: 'high' });

    const rules = await adapter.findAllApplicable('excise', 'wine_still', new Date('2026-08-01'));
    expect(rules.map((r) => r.id)).toEqual([55, 54]);
    // Multiple ABV tiers coexist — the caller selects by tier.
    expect(rules[0]!.exemptionConditions).toEqual({ minAlcoholByVolume: 15, maxAlcoholByVolume: 22 });
    expect(rules[1]!.exemptionConditions).toEqual({ maxAlcoholByVolume: 15 });
  });

  it('mirrors the repository history read', async () => {
    await seedRule({ id: 57, rate: 5.68, effectiveFrom: '2026-01-01', effectiveTo: '2026-03-31', exemptionConditions: { appliesTo: { maxAlcoholByVolume: 15 } } });
    await seedRule({ id: 58, rate: 8.74, effectiveFrom: '2026-06-01', exemptionConditions: { appliesTo: { minAlcoholByVolume: 15, maxAlcoholByVolume: 22 } } });

    const rates = await adapter.findHistoryRates(
      'excise',
      'wine_still',
      new Date('2026-02-01'),
      new Date('2026-07-01'),
    );
    expect(rates.map((r) => r.id)).toEqual([57, 58]);
  });

  it('lists the distinct version labels of currently active rules', async () => {
    await seedRule({ id: 59, rate: 1, effectiveFrom: '2026-01-01', versionLabel: 'active-label' });
    await seedRule({ id: 60, rate: 1, effectiveFrom: '2026-01-01', effectiveTo: '2026-01-31', versionLabel: 'expired-label' });

    const labels = await adapter.findActiveVersionLabels();
    expect(labels).toContain('active-label');
    expect(labels).not.toContain('expired-label');
  });
});
