/**
 * R2PriceObservationPort — the IPriceObservationPort adapter shell over
 * the R2 JSONL layout (task 2.3, design D4 amended). Unit-tested with a
 * fake ObservationLogStore; the R2 binding satisfies the same structural
 * interface once the wrangler wiring lands.
 *
 * @module R2ObservationPortTest
 */
import { describe, it, expect } from 'vitest';
import {
  defaultObservationId,
  R2PriceObservationPort,
  toObservationLogRecord,
} from '../price-observation.repository';
import {
  observationObjectKey,
  parseObservationLine,
  type ObservationLogRecord,
  type ObservationLogStore,
} from '../../../d1/observation-log';
import type { PriceObservation } from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Fixtures — a domain observation in the recorder's output shape
// ---------------------------------------------------------------------------

const OBSERVATION: PriceObservation = {
  productId: 7,
  merchant: 'systembolaget',
  retailOfferId: 101,
  observedAt: new Date('2026-08-15T10:30:00.000Z'),
  foreignRetailPriceCents: 1990,
  transportOfferId: 8,
  transportCostCents: 499,
  exciseRuleVersion: { ruleId: 3, versionLabel: '2024-01' },
  containerDutyRuleVersion: null,
  landedCostCents: 2531,
  inputReliability: {
    retailPrice: 'VERIFIED',
    transport: 'ESTIMATED',
    exciseRule: 'VERIFIED',
    containerDutyRule: 'STALE',
  },
  confidence: 'MEDIUM',
};

/** Fake store capturing the (key, line) appends — the injected R2 stand-in. */
function createFakeStore(): ObservationLogStore & {
  appends: { key: string; line: string }[];
} {
  const appends: { key: string; line: string }[] = [];
  return {
    appends,
    async appendLine(key: string, line: string): Promise<void> {
      appends.push({ key, line });
    },
  };
}

// ---------------------------------------------------------------------------
// Adapter behavior
// ---------------------------------------------------------------------------

describe('R2PriceObservationPort.append', () => {
  it('serializes to the R2 layout and delegates to the date-partitioned object', async () => {
    const store = createFakeStore();
    const port = new R2PriceObservationPort(store, () => 42);

    const result = await port.append(OBSERVATION);

    expect(result).toEqual({ id: 42 });
    expect(store.appends).toHaveLength(1);
    expect(store.appends[0].key).toBe('observations/2026-08-15.jsonl');

    // The line parses back into the exact pg-row field set with the
    // domain observation's values mapped the way the pg append mapped them.
    const record = parseObservationLine(store.appends[0].line);
    expect(record).toEqual({
      id: 42,
      product_id: 7,
      merchant: 'systembolaget',
      retail_offer_id: 101,
      observed_at: '2026-08-15T10:30:00.000Z',
      foreign_retail_price_cents: 1990,
      transport_cost_cents: 499,
      transport_offer_id: 8,
      excise_rule_version_id: 3,
      container_duty_rule_version_id: null,
      landed_cost_cents: 2531,
      input_reliability: OBSERVATION.inputReliability,
      confidence: 'MEDIUM',
    });
  });

  it('collapses rule-version snapshots to FK ids (null on engine fallback)', async () => {
    const store = createFakeStore();
    const port = new R2PriceObservationPort(store, () => 1);
    await port.append({
      ...OBSERVATION,
      exciseRuleVersion: null,
      containerDutyRuleVersion: { ruleId: 9, versionLabel: 'v2' },
    });
    const record = parseObservationLine(store.appends[0].line);
    expect(record.excise_rule_version_id).toBeNull();
    expect(record.container_duty_rule_version_id).toBe(9);
    // versionLabel is deliberately not logged — recoverable via taxRules.
    expect(JSON.stringify(record)).not.toContain('versionLabel');
  });

  it('partitions by the observation instant, not the append instant', async () => {
    const store = createFakeStore();
    const port = new R2PriceObservationPort(store, () => 1);
    // A late-arriving observation for an earlier day lands in THAT day's
    // object — the log is organized by observed_at (series time axis).
    await port.append({ ...OBSERVATION, observedAt: new Date('2026-08-01T05:00:00.000Z') });
    expect(store.appends[0].key).toBe('observations/2026-08-01.jsonl');
  });

  it('returns the injected generator id verbatim and appends are order-stable', async () => {
    const store = createFakeStore();
    let n = 100;
    const port = new R2PriceObservationPort(store, () => n++);
    const first = await port.append(OBSERVATION);
    const second = await port.append({ ...OBSERVATION, retailOfferId: 102 });
    expect(first.id).toBe(100);
    expect(second.id).toBe(101);
    expect(store.appends.map((a) => parseObservationLine(a.line).retail_offer_id)).toEqual([101, 102]);
  });

  it('the default generator is process-local monotonic and safe-integer', () => {
    const a = defaultObservationId();
    const b = defaultObservationId();
    expect(b).toBeGreaterThan(a);
    expect(Number.isSafeInteger(a)).toBe(true);
  });

  it('propagates store failures — the caller learns the append did not land', async () => {
    const failing: ObservationLogStore = {
      async appendLine(): Promise<void> {
        throw new Error('R2 unavailable');
      },
    };
    const port = new R2PriceObservationPort(failing, () => 1);
    await expect(port.append(OBSERVATION)).rejects.toThrow('R2 unavailable');
  });
});

// ---------------------------------------------------------------------------
// Layout mapping helpers
// ---------------------------------------------------------------------------

describe('toObservationLogRecord', () => {
  it('maps Date → ISO-8601 TEXT and keeps the id assignment external', () => {
    const record: ObservationLogRecord = toObservationLogRecord(OBSERVATION, 7);
    expect(record.observed_at).toBe('2026-08-15T10:30:00.000Z');
    expect(record.id).toBe(7);
    expect(observationObjectKey(record.observed_at)).toBe('observations/2026-08-15.jsonl');
  });
});
