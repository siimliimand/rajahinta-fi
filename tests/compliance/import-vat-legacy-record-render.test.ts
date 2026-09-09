/**
 * Import-VAT backward compatibility — pre-change records render (task 4.4).
 *
 * Records persisted before change alks-feed-and-import-vat carry no
 * `importVatEstimate` line and no `rateVersionId`/`calculatedAt` provenance
 * keys.  GET /api/v1/calculator/result/:id must reconstruct them into the
 * live response shape with NO error, NO placeholder line, and NO flat VAT
 * key — absence is the render-nothing state, exactly like the pre-change
 * `alkoBenchmark` NULL column.
 *
 * The test drives the production mapper (`mapCalculationRecordToResult`)
 * over a record fixture written by the pre-change orchestrator:
 *
 *   - the mapped result serialises without any VAT key anywhere,
 *   - every persisted figure is verbatim (total, itemised lines),
 *   - the shape is consumable line-by-line by the result renderer
 *     (every category resolves against the live cost vocabulary),
 *   - a post-change record through the SAME mapper keeps its VAT line and
 *     provenance — the two eras coexist in one endpoint.
 *
 * @module ImportVatLegacyRecordRenderTests
 */

import { describe, it, expect } from 'vitest';
import type { ItemizedCost } from '@rajahinta/core-domain';
import type {
  calculationRecords,
  productMaster,
} from '../../packages/data-platform/src/index';
import { mapCalculationRecordToResult } from '../../packages/application-api/src/calculator/calculation-result.mapper';

// ---------------------------------------------------------------------------
// Fixtures — a record exactly as the PRE-CHANGE orchestrator wrote it
// (four cost categories; import VAT did not exist yet)
// ---------------------------------------------------------------------------

const CALCULATED_AT = new Date('2026-08-20T12:34:56.789Z');

const PRE_CHANGE_BREAKDOWN: ItemizedCost[] = [
  {
    label: 'Retail price',
    category: 'foreignRetailPrice',
    cents: 2460,
    reliability: 'VERIFIED',
    breakdown: [
      {
        label: 'Unit price (x2)',
        category: 'foreignRetailPrice',
        cents: 2460,
        reliability: 'VERIFIED',
      },
    ],
  },
  { label: 'Transport', category: 'transportCost', cents: 1490, reliability: 'ESTIMATED' },
  { label: 'Alcohol excise', category: 'alcoholExciseEstimate', cents: 1160, reliability: 'VERIFIED' },
  { label: 'Container duty', category: 'containerDutyEstimate', cents: 34, reliability: 'VERIFIED' },
];

const DISCLAIMER = {
  text: 'Arvioitu kokonaiskustannus Suomessa. Ei ole lopullinen verovelvollisuuden määrä.',
  language: 'fi',
  version: '1.0',
} as const;

function makeRecord(
  overrides: Partial<typeof calculationRecords.$inferSelect> = {},
): typeof calculationRecords.$inferSelect {
  return {
    id: 42,
    productMasterId: 7,
    retailOfferIds: [100],
    transportOfferId: 900,
    exciseRuleVersionId: 3,
    containerDutyRuleVersionId: 4,
    totalCents: 5144,
    breakdown: PRE_CHANGE_BREAKDOWN,
    confidence: 'HIGH',
    quantity: 2,
    destination: 'FI',
    disclaimer: JSON.stringify(DISCLAIMER),
    sessionId: 'session-abc',
    calculatedAt: CALCULATED_AT,
    alkoBenchmark: null,
    ...overrides,
  };
}

function makeProduct(
  overrides: Partial<typeof productMaster.$inferSelect> = {},
): typeof productMaster.$inferSelect {
  return {
    id: 7,
    name: 'Koff III 0.33L',
    manufacturer: 'Sinebrychoff',
    brand: 'Koff',
    category: 'beer',
    alcoholByVolume: '0.047',
    unitVolume: '0.33',
    ...overrides,
  } as typeof productMaster.$inferSelect;
}

/** The mapper input the controller assembles (labels resolved by rule ID). */
function mapWith(
  record: typeof calculationRecords.$inferSelect,
): ReturnType<typeof mapCalculationRecordToResult> {
  return mapCalculationRecordToResult({
    record,
    product: makeProduct(),
    exciseVersionLabel: 'v1.0-2024',
    containerVersionLabel: 'v1.0-2024',
  });
}

// ---------------------------------------------------------------------------
// Pre-change record: absence of the VAT line is the normal state
// ---------------------------------------------------------------------------

describe('Pre-change calculation records without a VAT line', () => {
  const record = makeRecord();
  const result = mapWith(record);

  it('reconstructs without error and emits NO importVatEstimate key', () => {
    expect('importVatEstimate' in result).toBe(false);
    // Absence survives serialisation — no null, no 0, no placeholder.
    expect(JSON.stringify(result)).not.toContain('"importVatEstimate"');
    expect(JSON.stringify(result)).not.toContain('importVat');
  });

  it('renders no VAT placeholder line among the itemised costs', () => {
    expect(result.itemizedCosts).toHaveLength(4);
    for (const line of result.itemizedCosts) {
      expect(line.category).not.toBe('importVatEstimate');
    }
    // The persisted breakdown travels verbatim — byte-for-byte.
    expect(JSON.stringify(result.itemizedCosts)).toBe(
      JSON.stringify(PRE_CHANGE_BREAKDOWN),
    );
  });

  it('keeps every pre-change figure verbatim — nothing recomputed', () => {
    expect(result.totalCents).toBe(5144);
    expect(result.foreignRetailPrice).toBe(2460);
    expect(result.transportCost).toBe(1490);
    expect(result.alcoholExciseEstimate).toBe(1160);
    expect(result.containerDutyEstimate).toBe(34);
  });

  it('carries no VAT dataset version in metadata.datasetVersions', () => {
    // Provenance comes from the resolved excise/container rule labels
    // only — identical labels de-duplicate to a single entry.
    expect(result.metadata.datasetVersions).toEqual(['v1.0-2024']);
  });

  it('is consumable line-by-line by the result renderer', () => {
    // What the result page does: one row per line, category into the
    // i18n lookup, cents formatted.  A legacy record must survive every
    // step without a VAT branch or a missing-translation fallback.
    const LIVE_COST_CATEGORIES = [
      'foreignRetailPrice',
      'transportCost',
      'alcoholExciseEstimate',
      'containerDutyEstimate',
      'importVatEstimate',
    ] as const;

    const rows = result.itemizedCosts.map((line) => ({
      categoryKey: `CalculatorResult.category.${line.category}`,
      amount: line.cents,
      known: (LIVE_COST_CATEGORIES as readonly string[]).includes(
        line.category,
      ),
    }));
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.known).toBe(true);

    // Round-trip: the response serialises to pure JSON for the client.
    expect(() => JSON.parse(JSON.stringify(result))).not.toThrow();
  });

  it('unchanged legacy degradation: foreign sub-lines and missing product still render', () => {
    // A pre-change record whose product row is gone must still render —
    // the VAT change may not regress the factual-degradation path.
    const orphan = mapCalculationRecordToResult({
      record: makeRecord({ id: 43 }),
      product: null,
      exciseVersionLabel: null,
      containerVersionLabel: null,
    });
    expect(orphan.metadata.productName).toBe('Unknown product (ID 7)');
    expect(orphan.metadata.datasetVersions).toEqual([]);
    expect('importVatEstimate' in orphan).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Post-change record through the SAME mapper: the two eras coexist
// ---------------------------------------------------------------------------

describe('Post-change records keep VAT provenance through the same mapper', () => {
  /**
   * The itemised VAT line the post-change orchestrator persists (task
   * 4.3): amount, rate-version identity, computation timestamp, and the
   * four named base components.
   */
  const POST_CHANGE_BREAKDOWN: ItemizedCost[] = [
    ...PRE_CHANGE_BREAKDOWN,
    {
      label: 'Import VAT (estimated)',
      category: 'importVatEstimate',
      cents: 1311,
      reliability: 'VERIFIED',
      rateVersionId: 'import-vat-2024.2',
      calculatedAt: '2026-09-09T10:00:00.000Z',
      breakdown: [
        { label: 'Retail price', category: 'foreignRetailPrice', cents: 2460, reliability: 'VERIFIED' },
        { label: 'Transport', category: 'transportCost', cents: 1490, reliability: 'VERIFIED' },
        { label: 'Alcohol excise', category: 'alcoholExciseEstimate', cents: 1160, reliability: 'VERIFIED' },
        { label: 'Container duty', category: 'containerDutyEstimate', cents: 34, reliability: 'VERIFIED' },
      ],
    },
  ];

  const result = mapWith(
    makeRecord({ breakdown: POST_CHANGE_BREAKDOWN, totalCents: 6455 }),
  );

  it('emits the flat importVatEstimate figure exactly when the line exists', () => {
    expect(result.importVatEstimate).toBe(1311);
  });

  it('preserves the VAT line verbatim — provenance keys included', () => {
    const vatLine = result.itemizedCosts.find(
      (l) => l.category === 'importVatEstimate',
    );
    expect(vatLine).toEqual(POST_CHANGE_BREAKDOWN[4]);
    expect(vatLine?.rateVersionId).toBe('import-vat-2024.2');
    expect(vatLine?.calculatedAt).toBe('2026-09-09T10:00:00.000Z');
    // Base breakdown survives the JSON round-trip as nested sub-lines.
    expect(vatLine?.breakdown).toHaveLength(4);
  });

  it('keeps totalCents verbatim from the record', () => {
    expect(result.totalCents).toBe(6455);
  });
});
