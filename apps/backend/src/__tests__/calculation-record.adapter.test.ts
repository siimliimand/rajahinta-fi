/**
 * CalculationRecordAdapter alkoBenchmark round-trip tests (task 1.2,
 * change drop-sweden-eur-only-alko-benchmark).
 *
 * Pins the pg write-side forwarding the D1 twin
 * (D1CalculationRecordPort.create) already has:
 *
 * - the optional `alkoBenchmark` snapshot is forwarded verbatim into
 *   the `alko_benchmark` jsonb column (Drizzle serializes as-is);
 * - an absent benchmark forwards `undefined` — Drizzle drops the key
 *   and the column takes its NULL default (the legacy row shape);
 * - the pg read path (repository row → mapCalculationRecordToResult)
 *   emits the snapshot back byte-stable, and a NULL/legacy row reads
 *   back with NO key — absence is the render-nothing state, never null.
 *
 * Follows the project pattern — direct instantiation with a fake
 * repository, no vi.fn; the read side exercises the real mapper.
 *
 * @module CalculationRecordAdapterTest
 */

import { describe, it, expect } from 'vitest';
import { CalculationRecordAdapter } from '../adapters/calculation-record.adapter';
import type { CalculationRecordRepository } from '@rajahinta/data-platform';
import type { calculationRecords } from '@rajahinta/data-platform';
import type { CreateCalculationRecordInput } from '@rajahinta/core-domain';
// The pg read mapper lives in application-api (the backend tsconfig's
// rootDir bars source deep-imports, so consume the package's built
// surface — exactly what the backend uses in production).
import { mapCalculationRecordToResult } from '@rajahinta/application-api/dist/calculator/calculation-result.mapper';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The JSON-stable snapshot the orchestrator builds (ISO observedAt). */
const BENCHMARK_SNAPSHOT = {
  status: 'available',
  referencePriceCents: 300,
  differenceCents: -50,
  differencePercent: -16.7,
  reliabilityStatus: 'VERIFIED',
  observedAt: '2026-08-05T10:00:00.000Z',
} as const;

function recordInput(
  overrides: Partial<CreateCalculationRecordInput> = {},
): CreateCalculationRecordInput {
  return {
    productMasterId: 1,
    retailOfferIds: [11],
    transportOfferId: null,
    exciseRuleVersionId: null,
    containerDutyRuleVersionId: null,
    totalCents: 499,
    breakdown: [
      {
        label: 'Retail price',
        category: 'foreignRetailPrice',
        cents: 350,
        reliability: 'VERIFIED',
      },
    ],
    confidence: 'HIGH',
    quantity: 1,
    destination: 'FI',
    disclaimer: {
      text: 'Arvioitu kokonaiskustannus Suomessa.',
      language: 'fi',
      version: '1.0',
    },
    sessionId: null,
    ...overrides,
  };
}

/** Captures the insert values the adapter hands to the Drizzle repo. */
function adapterWithCapture(): {
  adapter: CalculationRecordAdapter;
  inserts: (typeof calculationRecords.$inferInsert)[];
} {
  const inserts: (typeof calculationRecords.$inferInsert)[] = [];
  const repo = {
    create: async (values: typeof calculationRecords.$inferInsert) => {
      inserts.push(values);
      return { id: inserts.length, calculatedAt: new Date() } as typeof calculationRecords.$inferSelect;
    },
  };
  return {
    adapter: new CalculationRecordAdapter(repo as unknown as CalculationRecordRepository),
    inserts,
  };
}

/** A persisted pg row exactly as the repository selects it. */
function persistedRow(
  overrides: Partial<typeof calculationRecords.$inferSelect> = {},
): typeof calculationRecords.$inferSelect {
  return {
    id: 1,
    productMasterId: 1,
    retailOfferIds: [11],
    transportOfferId: null,
    exciseRuleVersionId: null,
    containerDutyRuleVersionId: null,
    totalCents: 499,
    breakdown: recordInput().breakdown,
    confidence: 'HIGH',
    quantity: 1,
    destination: 'FI',
    disclaimer: JSON.stringify(recordInput().disclaimer),
    sessionId: null,
    calculatedAt: new Date('2026-08-20T12:34:56.789Z'),
    alkoBenchmark: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('CalculationRecordAdapter — alkoBenchmark round trip (task 1.2)', () => {
  it('forwards the benchmark snapshot verbatim into the pg insert', async () => {
    const { adapter, inserts } = adapterWithCapture();

    await adapter.create(recordInput({ alkoBenchmark: BENCHMARK_SNAPSHOT }));

    expect(inserts).toHaveLength(1);
    // Passed as-is — Drizzle serializes the object into the jsonb column.
    expect(inserts[0].alkoBenchmark).toEqual(BENCHMARK_SNAPSHOT);
    expect(
      (inserts[0].alkoBenchmark as { observedAt: string }).observedAt,
    ).toBe('2026-08-05T10:00:00.000Z');
  });

  it('forwards an absent benchmark as undefined — the column keeps its NULL default', async () => {
    const { adapter, inserts } = adapterWithCapture();

    await adapter.create(recordInput());

    expect(inserts).toHaveLength(1);
    expect(inserts[0].alkoBenchmark).toBeUndefined();
  });

  it('reads a persisted benchmark back through the mapper byte-stable', () => {
    const response = mapCalculationRecordToResult({
      record: persistedRow({ alkoBenchmark: BENCHMARK_SNAPSHOT }),
      product: null,
      exciseVersionLabel: null,
      containerVersionLabel: null,
    });

    expect(response.alkoBenchmark).toEqual(BENCHMARK_SNAPSHOT);
  });

  it('reads a legacy NULL row back with NO alkoBenchmark key', () => {
    const response = mapCalculationRecordToResult({
      record: persistedRow({ alkoBenchmark: null }),
      product: null,
      exciseVersionLabel: null,
      containerVersionLabel: null,
    });

    expect('alkoBenchmark' in response).toBe(false);
  });
});
