/**
 * ExciseDeclarationService guidance tests (Phase 2C).
 *
 * High-liability coverage: the guidance object surfaces deadline arithmetic
 * and uncertainty caveats that a consumer may rely on when preparing a
 * declaration.  A wrong due date or a silently-missing caveat could cause a
 * missed customs deadline or an estimate presented as certain.
 *
 * Covers:
 *   - derivation         product facts, volume × quantity, rate lines from
 *                        the persisted record; factual degradation when the
 *                        record carries no rate provenance
 *   - deadline           TravellerImport due date = timestamp + 4 days (UTC);
 *                        distance classifications → null; unparseable
 *                        timestamp → null (never an invented date)
 *   - caveats            LOW confidence, unknown deposit status, FALLBACK
 *                        rule-version labels, missing rate provenance;
 *                        clean record → no caveats
 *   - checklist          ordered, non-empty, observed-pattern phrasing
 *   - officialSources    vero.fi links; MyTax link unchanged
 *
 * @module ExciseDeclarationGuidanceTest
 */

import { describe, it, expect, vi } from 'vitest';
import { ExciseDeclarationService } from '../excise-declaration.service';
import type {
  CalculationRecordData,
  ICalculationRecordQueryPort,
} from '../declaration.types';
import type { ConfidenceLevel } from '../../reliability/confidence-framework.types';
import type { ClassificationLabel } from '../../classification/classification.types';

// ---------------------------------------------------------------------------
// Fixtures (mirrors excise-declaration-service.test.ts)
// ---------------------------------------------------------------------------

const DEFAULT_TIMESTAMP = '2026-06-15T10:30:00.000Z';

function createRecord(
  overrides?: Partial<CalculationRecordData>,
): CalculationRecordData {
  const defaults: CalculationRecordData = {
    id: 1,
    productName: 'Olut',
    productBrand: 'Karhu',
    productCategory: 'Beer',
    alcoholByVolume: 4.5,
    volumeLitres: 0.5,
    containerType: 'Can',
    depositSystemStatus: true,
    quantity: 24,
    transportCarrier: 'Posti',
    transportOrigin: 'DE',
    transportDestination: 'FI',
    alcoholExciseCents: 360,
    containerDutyCents: 48,
    totalCents: 408,
    confidence: 'HIGH' as ConfidenceLevel,
    classification: 'TravellerImport' as ClassificationLabel,
    disclaimerText: 'Tämä on laskelma, ei sitova päätös.',
    disclaimerLanguage: 'fi',
    disclaimerVersion: '1.2.0',
    calculationTimestamp: DEFAULT_TIMESTAMP,
  };
  return { ...defaults, ...overrides, id: overrides?.id ?? defaults.id };
}

/** Full guidance provenance — every optional record field populated. */
const FULL_PROVENANCE: Partial<CalculationRecordData> = {
  alcoholExciseRatePerUnit: 38.05,
  containerDutyRatePerLitre: 0.51,
  exciseRuleVersionLabel: '2025.1',
  containerDutyRuleVersionLabel: '2025.1',
  exciseFormulaReference: 'PER_CENTILITRE_ETHANOL',
};

function createService(record: CalculationRecordData): ExciseDeclarationService {
  const port: ICalculationRecordQueryPort = {
    findById: vi.fn().mockResolvedValue(record),
  };
  return new ExciseDeclarationService(port);
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

describe('guidance.derivation', () => {
  it('carries the product facts from the record', async () => {
    const result = await createService(createRecord(FULL_PROVENANCE)).prepareDeclaration(1);

    expect(result.guidance.derivation.category).toBe('Beer');
    expect(result.guidance.derivation.abvPercent).toBe(4.5);
    expect(result.guidance.derivation.volumePerUnitLitres).toBe(0.5);
    expect(result.guidance.derivation.quantity).toBe(24);
  });

  it('computes totalVolumeLitres as volume per unit × quantity', async () => {
    const result = await createService(
      createRecord({ volumeLitres: 0.33, quantity: 6, ...FULL_PROVENANCE }),
    ).prepareDeclaration(1);

    expect(result.guidance.derivation.totalVolumeLitres).toBeCloseTo(1.98, 10);
  });

  it('reports applied rates with rule version labels and formula references', async () => {
    const result = await createService(createRecord(FULL_PROVENANCE)).prepareDeclaration(1);

    const [excise, containerDuty] = result.guidance.derivation.appliedRates;

    expect(excise.kind).toBe('alcoholExcise');
    expect(excise.amountCents).toBe(360);
    expect(excise.ratePerUnit).toBe(38.05);
    expect(excise.rateUnit).toBe('centilitre of ethyl alcohol');
    expect(excise.ruleVersionLabel).toBe('2025.1');
    expect(excise.formulaReference).toBe('PER_CENTILITRE_ETHANOL');
    expect(excise.formulaExpression).toContain('excise =');

    expect(containerDuty.kind).toBe('containerDuty');
    expect(containerDuty.amountCents).toBe(48);
    expect(containerDuty.ratePerUnit).toBe(0.51);
    expect(containerDuty.rateUnit).toBe('litre of product');
    expect(containerDuty.ruleVersionLabel).toBe('2025.1');
    expect(containerDuty.formulaReference).toBe('FLAT_PER_LITRE');
  });

  it('marks every unavailable rate datum null — never reconstructed — and emits a caveat', async () => {
    // No provenance fields on the record (adapter predates the feature).
    const result = await createService(createRecord()).prepareDeclaration(1);

    const [excise, containerDuty] = result.guidance.derivation.appliedRates;

    expect(excise.ratePerUnit).toBeNull();
    expect(excise.rateUnit).toBeNull();
    expect(excise.ruleVersionLabel).toBeNull();
    expect(excise.formulaReference).toBeNull();
    expect(excise.formulaExpression).toBeNull();
    // Recorded cents totals are still shown.
    expect(excise.amountCents).toBe(360);

    expect(containerDuty.ratePerUnit).toBeNull();
    expect(containerDuty.ruleVersionLabel).toBeNull();

    expect(result.guidance.caveats.join(' | ')).toContain(
      'does not persist every applied rate',
    );
  });

  it('degrades the formula wording to null for an unrecognised formula reference', async () => {
    const result = await createService(
      createRecord({ ...FULL_PROVENANCE, exciseFormulaReference: 'UNKNOWN_FORMULA' }),
    ).prepareDeclaration(1);

    const [excise] = result.guidance.derivation.appliedRates;
    expect(excise.formulaReference).toBe('UNKNOWN_FORMULA');
    expect(excise.rateUnit).toBeNull();
    expect(excise.formulaExpression).toBeNull();
  });

  it('maps the PER_LITRE_OF_PRODUCT formula reference to its unit and expression', async () => {
    const result = await createService(
      createRecord({ ...FULL_PROVENANCE, exciseFormulaReference: 'PER_LITRE_OF_PRODUCT' }),
    ).prepareDeclaration(1);

    const [excise] = result.guidance.derivation.appliedRates;
    expect(excise.rateUnit).toBe('litre of product');
    expect(excise.formulaExpression).toBe('excise = rate × litres of product');
  });

  it('maps the PER_LITRE_OF_ALCOHOL formula reference to its unit and expression', async () => {
    const result = await createService(
      createRecord({ ...FULL_PROVENANCE, exciseFormulaReference: 'PER_LITRE_OF_ALCOHOL' }),
    ).prepareDeclaration(1);

    const [excise] = result.guidance.derivation.appliedRates;
    expect(excise.rateUnit).toBe('litre of pure alcohol');
    expect(excise.formulaExpression).toBe(
      'excise = rate × volume × ABV (litres of pure alcohol)',
    );
  });

  it('treats explicitly-null provenance fields identically to absent ones', async () => {
    // Adapters that SELECT the new columns on pre-guidance rows persist
    // SQL NULLs, not missing keys — the degradation must be identical.
    const result = await createService(
      createRecord({
        ...FULL_PROVENANCE,
        alcoholExciseRatePerUnit: null,
        containerDutyRatePerLitre: null,
        exciseRuleVersionLabel: null,
        containerDutyRuleVersionLabel: null,
        exciseFormulaReference: null,
      }),
    ).prepareDeclaration(1);

    const [excise, containerDuty] = result.guidance.derivation.appliedRates;

    expect(excise.ratePerUnit).toBeNull();
    expect(excise.rateUnit).toBeNull();
    expect(excise.ruleVersionLabel).toBeNull();
    expect(excise.formulaReference).toBeNull();
    expect(excise.formulaExpression).toBeNull();

    expect(containerDuty.ratePerUnit).toBeNull();
    expect(containerDuty.ruleVersionLabel).toBeNull();

    expect(result.guidance.caveats.join(' | ')).toContain(
      'does not persist every applied rate',
    );
  });
});

// ---------------------------------------------------------------------------
// Deadline
// ---------------------------------------------------------------------------

describe('guidance.deadline', () => {
  it('computes the due date as timestamp + 4 days (UTC) for TravellerImport', async () => {
    const result = await createService(createRecord(FULL_PROVENANCE)).prepareDeclaration(1);

    expect(result.guidance.deadline.required).toBe(true);
    expect(result.guidance.deadline.deadlineDays).toBe(4);
    expect(result.guidance.deadline.calculatedFrom).toBe(DEFAULT_TIMESTAMP);
    expect(result.guidance.deadline.dueDate).toBe('2026-06-19');
  });

  it('rolls the due date across a month boundary', async () => {
    const result = await createService(
      createRecord({
        calculationTimestamp: '2026-08-30T23:00:00.000Z',
        ...FULL_PROVENANCE,
      }),
    ).prepareDeclaration(1);

    expect(result.guidance.deadline.dueDate).toBe('2026-09-03');
  });

  it('rolls the due date across a year boundary', async () => {
    const result = await createService(
      createRecord({
        calculationTimestamp: '2026-12-30T23:00:00.000Z',
        ...FULL_PROVENANCE,
      }),
    ).prepareDeclaration(1);

    expect(result.guidance.deadline.dueDate).toBe('2027-01-03');
  });

  it('rolls the due date across a leap-year February (2028-02-27 → 2028-03-02)', async () => {
    const result = await createService(
      createRecord({
        calculationTimestamp: '2028-02-27T00:00:00.000Z',
        ...FULL_PROVENANCE,
      }),
    ).prepareDeclaration(1);

    expect(result.guidance.deadline.dueDate).toBe('2028-03-02');
  });

  it('returns a null due date when notice is not required (DistanceSelling)', async () => {
    const result = await createService(
      createRecord({ classification: 'DistanceSelling', ...FULL_PROVENANCE }),
    ).prepareDeclaration(1);

    expect(result.guidance.deadline.required).toBe(false);
    expect(result.guidance.deadline.deadlineDays).toBeNull();
    expect(result.guidance.deadline.dueDate).toBeNull();
  });

  it('returns a null due date when notice is not required (DistanceBuying)', async () => {
    const result = await createService(
      createRecord({ classification: 'DistanceBuying', ...FULL_PROVENANCE }),
    ).prepareDeclaration(1);

    expect(result.guidance.deadline.required).toBe(false);
    expect(result.guidance.deadline.dueDate).toBeNull();
  });

  it('states an unknown due date rather than inventing one on an unparseable timestamp', async () => {
    const result = await createService(
      createRecord({ calculationTimestamp: 'not-a-timestamp', ...FULL_PROVENANCE }),
    ).prepareDeclaration(1);

    expect(result.guidance.deadline.required).toBe(true);
    expect(result.guidance.deadline.dueDate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Caveats
// ---------------------------------------------------------------------------

describe('guidance.caveats', () => {
  it('is empty for a clean record (HIGH confidence, known deposit, no fallback)', async () => {
    const result = await createService(createRecord(FULL_PROVENANCE)).prepareDeclaration(1);

    expect(result.guidance.caveats).toEqual([]);
  });

  it('surfaces a caveat for LOW confidence', async () => {
    const result = await createService(
      createRecord({ ...FULL_PROVENANCE, confidence: 'LOW' as ConfidenceLevel }),
    ).prepareDeclaration(1);

    expect(result.guidance.caveats.join(' | ')).toContain('confidence is LOW');
  });

  it('surfaces a caveat for unknown deposit status (tri-state null)', async () => {
    const result = await createService(
      createRecord({ ...FULL_PROVENANCE, depositSystemStatus: null }),
    ).prepareDeclaration(1);

    expect(result.guidance.caveats.join(' | ')).toContain(
      'Deposit-return system participation is unknown',
    );
  });

  it('surfaces a fallback-dataset caveat for a FALLBACK excise rule version', async () => {
    const result = await createService(
      createRecord({ ...FULL_PROVENANCE, exciseRuleVersionLabel: 'FALLBACK' }),
    ).prepareDeclaration(1);

    expect(result.guidance.caveats.join(' | ')).toContain(
      'engine fallback dataset',
    );
  });

  it('surfaces a fallback-dataset caveat for a FALLBACK container-duty rule version', async () => {
    const result = await createService(
      createRecord({ ...FULL_PROVENANCE, containerDutyRuleVersionLabel: 'FALLBACK' }),
    ).prepareDeclaration(1);

    expect(result.guidance.caveats.join(' | ')).toContain(
      'engine fallback dataset',
    );
  });

  it('fires exactly one missing-provenance caveat when only container-duty provenance is absent', async () => {
    // Excise provenance fully populated; the container-duty columns are
    // missing — the record is partially provenanced, not clean.
    const result = await createService(
      createRecord({
        alcoholExciseRatePerUnit: 38.05,
        exciseRuleVersionLabel: '2025.1',
        exciseFormulaReference: 'PER_CENTILITRE_ETHANOL',
      }),
    ).prepareDeclaration(1);

    expect(result.guidance.caveats).toHaveLength(1);
    expect(result.guidance.caveats[0]).toContain(
      'does not persist every applied rate',
    );

    // The populated excise line still carries its full provenance.
    const [excise, containerDuty] = result.guidance.derivation.appliedRates;
    expect(excise.ratePerUnit).toBe(38.05);
    expect(excise.ruleVersionLabel).toBe('2025.1');
    expect(containerDuty.ratePerUnit).toBeNull();
  });

  it('does not surface the LOW-confidence caveat for MEDIUM confidence', async () => {
    const result = await createService(
      createRecord({ ...FULL_PROVENANCE, confidence: 'MEDIUM' as ConfidenceLevel }),
    ).prepareDeclaration(1);

    expect(result.guidance.caveats).toEqual([]);
  });

  it('accumulates independent caveats without duplicates', async () => {
    const result = await createService(
      createRecord({
        confidence: 'LOW' as ConfidenceLevel,
        depositSystemStatus: null,
        exciseRuleVersionLabel: 'FALLBACK',
        containerDutyRuleVersionLabel: 'FALLBACK',
      }),
    ).prepareDeclaration(1);

    // LOW + unknown deposit + two FALLBACK labels + missing rate provenance.
    expect(result.guidance.caveats).toHaveLength(5);
    expect(new Set(result.guidance.caveats).size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Checklist and official sources
// ---------------------------------------------------------------------------

describe('guidance.checklist and officialSources', () => {
  it('returns an ordered, non-empty checklist of observed-pattern steps', async () => {
    const result = await createService(createRecord(FULL_PROVENANCE)).prepareDeclaration(1);

    const { checklist } = result.guidance;
    expect(checklist.length).toBeGreaterThanOrEqual(5);
    for (const step of checklist) {
      expect(step.length).toBeGreaterThan(0);
    }
    // Observed-pattern phrasing — no imperative instructions.
    for (const step of checklist) {
      expect(step).toMatch(/observed|Observed/);
    }
  });

  it('links official vero.fi sources and keeps the MyTax link unchanged', async () => {
    const result = await createService(createRecord(FULL_PROVENANCE)).prepareDeclaration(1);

    expect(result.guidance.officialSources.length).toBeGreaterThanOrEqual(2);
    for (const source of result.guidance.officialSources) {
      expect(source.url).toMatch(/^https:\/\/www\.vero\.fi\//);
      expect(source.title.length).toBeGreaterThan(0);
      expect(source.description.length).toBeGreaterThan(0);
    }
    expect(result.myTaxLink).toBe('https://www.vero.fi/asioi-verkossa/mytax/');
  });
});
