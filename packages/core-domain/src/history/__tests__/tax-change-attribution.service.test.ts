/**
 * TaxChangeAttributionService smoke tests.
 *
 * The service is pure, so no mocks are needed — plain fixtures in, plain
 * classifications out. The full behavioural suite is change task 6.2; these
 * colocated checks pin the four classifications, the evidence shape, the
 * retroactive-window property, and the series contract.
 */

import { describe, it, expect } from 'vitest';
import { TaxChangeAttributionService } from '../services/tax-change-attribution.service';
import type {
  PriceObservation,
  TaxRuleVersionSnapshot,
} from '../price-observation.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T0 = new Date('2026-08-01T12:00:00.000Z');
const T1 = new Date('2026-08-08T12:00:00.000Z');
const T2 = new Date('2026-08-15T12:00:00.000Z');

/** Window pair with a v1 → v2 boundary at 2026-08-04 (exclusive effectiveTo), between T0 and T1. */
const EXCISE_WINDOWS = [
  { ruleId: 1, versionLabel: 'v1', effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: new Date('2026-08-04T00:00:00Z') },
  { ruleId: 2, versionLabel: 'v2', effectiveFrom: new Date('2026-08-04T00:00:00Z'), effectiveTo: null },
];

/** Single open-ended window — stable across the whole fixture range. */
const NO_BOUNDARY_WINDOWS = [
  { ruleId: 1, versionLabel: 'v1', effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: null },
];

/** Duty windows with a c1 → c2 boundary at 2026-08-04 — inside the T0→T1 step. */
const DUTY_WINDOWS_ALIGNED = [
  { ruleId: 11, versionLabel: 'c1', effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: new Date('2026-08-04T00:00:00Z') },
  { ruleId: 12, versionLabel: 'c2', effectiveFrom: new Date('2026-08-04T00:00:00Z'), effectiveTo: null },
];

/** Excise window that only becomes effective mid-series (2026-08-05) — a null → version transition. */
const LATE_EXCISE_WINDOWS = [
  { ruleId: 2, versionLabel: 'v2', effectiveFrom: new Date('2026-08-05T00:00:00Z'), effectiveTo: null },
];

/** Excise window closed mid-series with no successor — a version → null transition. */
const CLOSED_EXCISE_WINDOWS = [
  { ruleId: 1, versionLabel: 'v1', effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: new Date('2026-08-05T00:00:00Z') },
];

/** Two open-ended windows overlapping from 2026-08-05 — tiebreak by latest effectiveFrom. */
const OVERLAPPING_WINDOWS = [
  { ruleId: 1, versionLabel: 'v1', effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: null },
  { ruleId: 2, versionLabel: 'v2', effectiveFrom: new Date('2026-08-05T00:00:00Z'), effectiveTo: null },
];

const RULE_V1: TaxRuleVersionSnapshot = { ruleId: 1, versionLabel: 'v1' };

function observation(
  observedAt: Date,
  overrides: Partial<PriceObservation> = {},
): PriceObservation {
  return {
    productId: 7,
    merchant: 'test-merchant-de',
    retailOfferId: 100,
    observedAt,
    foreignRetailPriceCents: 200,
    transportOfferId: 50,
    transportCostCents: 900,
    exciseRuleVersion: RULE_V1,
    containerDutyRuleVersion: RULE_V1,
    landedCostCents: 1400,
    inputReliability: {
      retailPrice: 'VERIFIED',
      transport: 'VERIFIED',
      exciseRule: 'VERIFIED',
      containerDutyRule: 'VERIFIED',
    },
    confidence: 'HIGH',
    ...overrides,
  };
}

function createService(): TaxChangeAttributionService {
  return new TaxChangeAttributionService();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaxChangeAttributionService', () => {
  it('classifies a crossed excise boundary with unchanged merchant price as TAX_RULE_CHANGE with bounding labels', () => {
    const steps = createService().attribute({
      // Both snapshots say v1 — recorded before the successor version landed
      // retroactively. The window join, not the snapshots, decides.
      observations: [observation(T0), observation(T1, { exciseRuleVersion: RULE_V1 })],
      exciseRuleWindows: EXCISE_WINDOWS,
      containerDutyRuleWindows: NO_BOUNDARY_WINDOWS,
    });

    expect(steps).toHaveLength(1);
    expect(steps[0]!.classification).toBe('TAX_RULE_CHANGE');
    expect(steps[0]!.movedInputs).toEqual({
      exciseRule: true,
      containerDutyRule: false,
      merchantPrice: false,
      transport: false,
    });
    expect(steps[0]!.exciseRuleBoundary).toEqual({
      fromVersionLabel: 'v1',
      toVersionLabel: 'v2',
    });
    expect(steps[0]!.containerDutyRuleBoundary).toBeNull();
    expect(steps[0]!.fromObservedAt).toEqual(T0);
    expect(steps[0]!.toObservedAt).toEqual(T1);
  });

  it('classifies a retail-price move with stable rule windows as MERCHANT_PRICE_CHANGE', () => {
    const steps = createService().attribute({
      observations: [observation(T0), observation(T1, { foreignRetailPriceCents: 250 })],
      exciseRuleWindows: NO_BOUNDARY_WINDOWS,
      containerDutyRuleWindows: NO_BOUNDARY_WINDOWS,
    });

    expect(steps[0]!.classification).toBe('MERCHANT_PRICE_CHANGE');
    expect(steps[0]!.movedInputs.merchantPrice).toBe(true);
    expect(steps[0]!.exciseRuleBoundary).toBeNull();
  });

  it('classifies a transport-cost move as TRANSPORT_CHANGE', () => {
    const steps = createService().attribute({
      observations: [observation(T0), observation(T1, { transportCostCents: 1200 })],
      exciseRuleWindows: NO_BOUNDARY_WINDOWS,
      containerDutyRuleWindows: NO_BOUNDARY_WINDOWS,
    });

    expect(steps[0]!.classification).toBe('TRANSPORT_CHANGE');
    expect(steps[0]!.movedInputs.transport).toBe(true);
  });

  it('classifies simultaneous price move and rule boundary as MIXED', () => {
    const steps = createService().attribute({
      observations: [observation(T0), observation(T1, { foreignRetailPriceCents: 250 })],
      exciseRuleWindows: EXCISE_WINDOWS,
      containerDutyRuleWindows: NO_BOUNDARY_WINDOWS,
    });

    expect(steps[0]!.classification).toBe('MIXED');
    expect(steps[0]!.movedInputs.exciseRule).toBe(true);
    expect(steps[0]!.movedInputs.merchantPrice).toBe(true);
  });

  it('classifies a step where nothing moved as UNCHANGED', () => {
    const steps = createService().attribute({
      observations: [observation(T0), observation(T1)],
      exciseRuleWindows: NO_BOUNDARY_WINDOWS,
      containerDutyRuleWindows: NO_BOUNDARY_WINDOWS,
    });

    expect(steps[0]!.classification).toBe('UNCHANGED');
  });

  it('returns one step per consecutive pair, in series order', () => {
    const steps = createService().attribute({
      observations: [observation(T0), observation(T1), observation(T2)],
      exciseRuleWindows: NO_BOUNDARY_WINDOWS,
      containerDutyRuleWindows: NO_BOUNDARY_WINDOWS,
    });

    expect(steps.map((step) => step.fromObservedAt)).toEqual([T0, T1]);
    expect(steps.map((step) => step.toObservedAt)).toEqual([T1, T2]);
  });

  it('returns no steps for a series shorter than two observations', () => {
    const steps = createService().attribute({
      observations: [observation(T0)],
      exciseRuleWindows: NO_BOUNDARY_WINDOWS,
      containerDutyRuleWindows: NO_BOUNDARY_WINDOWS,
    });

    expect(steps).toEqual([]);
  });

  it('rejects out-of-order and mixed-series input', () => {
    const service = createService();
    const input = {
      exciseRuleWindows: NO_BOUNDARY_WINDOWS,
      containerDutyRuleWindows: NO_BOUNDARY_WINDOWS,
    } as const;

    expect(() =>
      service.attribute({ ...input, observations: [observation(T1), observation(T0)] }),
    ).toThrowError(/ascending/);

    expect(() =>
      service.attribute({
        ...input,
        observations: [observation(T0), observation(T1, { merchant: 'other-merchant' })],
      }),
    ).toThrowError(/one \(productId, merchant\) series/);
  });

  // -----------------------------------------------------------------
  // Full behavioural suite (task 6.2) — evidence per rule type,
  // null transitions, overlapping-window tiebreak, boundary instants.
  // -----------------------------------------------------------------

  it('evidences a container-duty boundary with its own bounding labels', () => {
    const steps = createService().attribute({
      observations: [observation(T0), observation(T1)], // price, transport stable
      exciseRuleWindows: NO_BOUNDARY_WINDOWS,
      containerDutyRuleWindows: DUTY_WINDOWS_ALIGNED,
    });

    expect(steps[0]!.classification).toBe('TAX_RULE_CHANGE');
    expect(steps[0]!.movedInputs).toEqual({
      exciseRule: false,
      containerDutyRule: true,
      merchantPrice: false,
      transport: false,
    });
    expect(steps[0]!.containerDutyRuleBoundary).toEqual({
      fromVersionLabel: 'c1',
      toVersionLabel: 'c2',
    });
    expect(steps[0]!.exciseRuleBoundary).toBeNull();
  });

  it('counts excise and container-duty boundaries together as ONE tax driver — TAX_RULE_CHANGE, not MIXED', () => {
    const steps = createService().attribute({
      // Both boundaries (2026-08-04) fall inside the T0→T1 step; price and
      // transport are stable.
      observations: [observation(T0), observation(T1)],
      exciseRuleWindows: EXCISE_WINDOWS,
      containerDutyRuleWindows: DUTY_WINDOWS_ALIGNED,
    });

    expect(steps[0]!.classification).toBe('TAX_RULE_CHANGE');
    expect(steps[0]!.movedInputs.exciseRule).toBe(true);
    expect(steps[0]!.movedInputs.containerDutyRule).toBe(true);
    // Each rule type carries its own bounding labels.
    expect(steps[0]!.exciseRuleBoundary).toEqual({
      fromVersionLabel: 'v1',
      toVersionLabel: 'v2',
    });
    expect(steps[0]!.containerDutyRuleBoundary).toEqual({
      fromVersionLabel: 'c1',
      toVersionLabel: 'c2',
    });
  });

  it('treats a version appearing mid-series (null → version) as a boundary with a null fromLabel', () => {
    const steps = createService().attribute({
      // T0 (Aug 1) predates every window; T1 (Aug 8) is covered by v2.
      observations: [observation(T0), observation(T1)],
      exciseRuleWindows: LATE_EXCISE_WINDOWS,
      containerDutyRuleWindows: NO_BOUNDARY_WINDOWS,
    });

    expect(steps[0]!.classification).toBe('TAX_RULE_CHANGE');
    expect(steps[0]!.exciseRuleBoundary).toEqual({
      fromVersionLabel: null,
      toVersionLabel: 'v2',
    });
  });

  it('treats a retroactively closed window without successor (version → null) as a boundary with a null toLabel', () => {
    const steps = createService().attribute({
      // T0 (Aug 1) is covered by v1; T1 (Aug 8) falls after v1's effectiveTo.
      observations: [observation(T0), observation(T1)],
      exciseRuleWindows: CLOSED_EXCISE_WINDOWS,
      containerDutyRuleWindows: NO_BOUNDARY_WINDOWS,
    });

    expect(steps[0]!.classification).toBe('TAX_RULE_CHANGE');
    expect(steps[0]!.exciseRuleBoundary).toEqual({
      fromVersionLabel: 'v1',
      toVersionLabel: null,
    });
  });

  it('reports no boundary across a full coverage gap (null → null), not a fabricated one', () => {
    const steps = createService().attribute({
      observations: [observation(T0), observation(T1)],
      exciseRuleWindows: [],
      containerDutyRuleWindows: [],
    });

    expect(steps[0]!.classification).toBe('UNCHANGED');
    expect(steps[0]!.exciseRuleBoundary).toBeNull();
    expect(steps[0]!.containerDutyRuleBoundary).toBeNull();
  });

  it('resolves overlapping windows to the latest effectiveFrom', () => {
    const service = createService();

    // Step entirely after 2026-08-05: BOTH windows cover both instants, but
    // the later effectiveFrom (v2) wins at each — no boundary.
    const stable = service.attribute({
      observations: [observation(T1), observation(T2)],
      exciseRuleWindows: OVERLAPPING_WINDOWS,
      containerDutyRuleWindows: NO_BOUNDARY_WINDOWS,
    });
    expect(stable[0]!.classification).toBe('UNCHANGED');
    expect(stable[0]!.exciseRuleBoundary).toBeNull();

    // Step crossing 2026-08-05: v1 before, v2 after (despite v1 still
    // covering the later instant) — a genuine v1 → v2 boundary.
    const crossing = service.attribute({
      observations: [observation(T0), observation(T1)],
      exciseRuleWindows: OVERLAPPING_WINDOWS,
      containerDutyRuleWindows: NO_BOUNDARY_WINDOWS,
    });
    expect(crossing[0]!.classification).toBe('TAX_RULE_CHANGE');
    expect(crossing[0]!.exciseRuleBoundary).toEqual({
      fromVersionLabel: 'v1',
      toVersionLabel: 'v2',
    });
  });

  it('resolves an observation at the exact boundary instant to the successor version (from inclusive, to exclusive)', () => {
    const steps = createService().attribute({
      // T1 sits exactly on v2.effectiveFrom === v1.effectiveTo.
      observations: [observation(T0), observation(new Date('2026-08-04T00:00:00.000Z'))],
      exciseRuleWindows: EXCISE_WINDOWS,
      containerDutyRuleWindows: NO_BOUNDARY_WINDOWS,
    });

    expect(steps[0]!.exciseRuleBoundary).toEqual({
      fromVersionLabel: 'v1',
      toVersionLabel: 'v2',
    });
  });

  it('accepts equal consecutive observedAt instants as one ordered step', () => {
    const steps = createService().attribute({
      observations: [observation(T1), observation(T1, { foreignRetailPriceCents: 250 })],
      exciseRuleWindows: NO_BOUNDARY_WINDOWS,
      containerDutyRuleWindows: NO_BOUNDARY_WINDOWS,
    });

    expect(steps).toHaveLength(1);
    expect(steps[0]!.classification).toBe('MERCHANT_PRICE_CHANGE');
    expect(steps[0]!.fromObservedAt).toEqual(T1);
    expect(steps[0]!.toObservedAt).toEqual(T1);
  });
});
