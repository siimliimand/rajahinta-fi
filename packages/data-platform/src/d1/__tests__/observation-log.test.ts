/**
 * R2 observation-log layout unit tests (task 2.3, design D4 amended) —
 * pure module, no bindings.
 *
 * @module ObservationLogTest
 */
import { describe, it, expect } from 'vitest';
import {
  OBSERVATION_LOG_PREFIX,
  observationObjectKey,
  observationPartitionDay,
  observationKeysToScan,
  parseObservationLine,
  parseObservationLog,
  serializeObservationLine,
  serializeObservationLog,
  type ObservationLogRecord,
} from '../observation-log';

const RECORD: ObservationLogRecord = {
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
  input_reliability: {
    retailPrice: 'VERIFIED',
    transport: 'ESTIMATED',
    exciseRule: 'VERIFIED',
    containerDutyRule: 'STALE',
  },
  confidence: 'MEDIUM',
};

describe('observationObjectKey — date-partitioned key scheme', () => {
  it('partitions by the observed_at UTC calendar day', () => {
    expect(observationObjectKey('2026-08-15T10:30:00.000Z')).toBe(
      'observations/2026-08-15.jsonl',
    );
    expect(observationObjectKey(new Date('2026-08-15T23:59:59.999Z'))).toBe(
      'observations/2026-08-15.jsonl',
    );
    expect(observationObjectKey(new Date('2026-01-01T00:00:00.000Z'))).toBe(
      'observations/2026-01-01.jsonl',
    );
  });

  it('uses UTC — a Finnish evening is still the same UTC day', () => {
    // 23:30 EEST = 20:30 UTC in summer.
    expect(observationObjectKey('2026-08-15T20:30:00.000Z')).toBe(
      'observations/2026-08-15.jsonl',
    );
  });

  it('rejects unparseable instants', () => {
    expect(() => observationObjectKey('not-a-date')).toThrow(TypeError);
    expect(() => observationObjectKey(new Date('nope'))).toThrow(TypeError);
  });
});

describe('serializeObservationLine / parseObservationLine', () => {
  it('round-trips the exact pg row field set', () => {
    const parsed = parseObservationLine(serializeObservationLine(RECORD));
    expect(parsed).toEqual(RECORD);
  });

  it('emits one JSON object with the 13 pg-row fields in canonical order', () => {
    const line = serializeObservationLine(RECORD);
    expect(line.split('\n')).toHaveLength(1);
    const keys = Object.keys(JSON.parse(line));
    expect(keys).toEqual([
      'id',
      'product_id',
      'merchant',
      'retail_offer_id',
      'observed_at',
      'foreign_retail_price_cents',
      'transport_cost_cents',
      'transport_offer_id',
      'excise_rule_version_id',
      'container_duty_rule_version_id',
      'landed_cost_cents',
      'input_reliability',
      'confidence',
    ]);
  });

  it('is byte-stable regardless of source-object key insertion order', () => {
    // Build the same record with reversed key order — the serializer must
    // emit canonical bytes either way.
    const reversed = Object.fromEntries(
      Object.entries(RECORD).reverse(),
    ) as ObservationLogRecord;
    expect(serializeObservationLine(reversed)).toBe(serializeObservationLine(RECORD));
  });

  it('preserves the input_reliability snapshot object (pg jsonb content)', () => {
    const parsed = parseObservationLine(serializeObservationLine(RECORD));
    expect(parsed.input_reliability).toEqual(RECORD.input_reliability);
  });

  it('keeps tri-state rule-version FK ids (null on engine fallback)', () => {
    const parsed = parseObservationLine(serializeObservationLine(RECORD));
    expect(parsed.excise_rule_version_id).toBe(3);
    expect(parsed.container_duty_rule_version_id).toBeNull();
  });

  it('rejects empty and malformed lines with a field-level error', () => {
    expect(() => parseObservationLine('')).toThrow(TypeError);
    expect(() => parseObservationLine('   ')).toThrow(TypeError);
    expect(() => parseObservationLine('{not json')).toThrow(TypeError);
    expect(() => parseObservationLine('"just a string"')).toThrow(TypeError);
    expect(() =>
      parseObservationLine(JSON.stringify({ id: 1 })),
    ).toThrow(/missing the required field/);
  });
});

describe('serializeObservationLog / parseObservationLog', () => {
  it('writes one LF-terminated JSON object per line', () => {
    const body = serializeObservationLog([RECORD, { ...RECORD, id: 43 }]);
    const lines = body.split('\n');
    expect(lines[lines.length - 1]).toBe(''); // trailing newline
    expect(lines.slice(0, -1)).toHaveLength(2);
    expect(parseObservationLog(body)).toEqual([RECORD, { ...RECORD, id: 43 }]);
  });

  it('tolerates blank lines when parsing (append-order robustness)', () => {
    const body = serializeObservationLine(RECORD) + '\n\n' + serializeObservationLine({ ...RECORD, id: 44 }) + '\n';
    expect(parseObservationLog(body).map((r) => r.id)).toEqual([42, 44]);
  });

  it('round-trips the empty log as an empty body', () => {
    expect(serializeObservationLog([])).toBe('');
    expect(parseObservationLog('')).toEqual([]);
  });
});

describe('observationKeysToScan — watermark scan over objects', () => {
  const KEYS = [
    'observations/2026-08-13.jsonl',
    'observations/2026-08-14.jsonl',
    'observations/2026-08-15.jsonl',
    'observations/2026-08-16.jsonl',
  ];

  it('returns all partitions ascending when no watermark exists (first run backfill)', () => {
    expect(observationKeysToScan(KEYS, null)).toEqual([
      'observations/2026-08-13.jsonl',
      'observations/2026-08-14.jsonl',
      'observations/2026-08-15.jsonl',
      'observations/2026-08-16.jsonl',
    ]);
  });

  it('excludes partitions strictly before the watermark day', () => {
    expect(observationKeysToScan(KEYS, new Date('2026-08-15T00:00:00.000Z'))).toEqual([
      'observations/2026-08-15.jsonl',
      'observations/2026-08-16.jsonl',
    ]);
  });

  it('includes the watermark day from its start (inclusive lower bound)', () => {
    // A mid-day watermark still scans its own partition from the start —
    // the per-line >= watermark filter happens in the aggregation
    // consumer, mirroring findProductActivitySince's documented contract.
    expect(observationKeysToScan(KEYS, new Date('2026-08-14T10:00:00.000Z'))).toEqual([
      'observations/2026-08-14.jsonl',
      'observations/2026-08-15.jsonl',
      'observations/2026-08-16.jsonl',
    ]);
  });

  it('skips keys outside the observation-log scheme', () => {
    const mixed = [...KEYS, 'rate-snapshots/latest.json', 'observations/README'];
    expect(observationKeysToScan(mixed, new Date('2026-08-16T00:00:00.000Z'))).toEqual([
      'observations/2026-08-16.jsonl',
    ]);
  });

  it('returns an empty list when every partition predates the watermark', () => {
    expect(observationKeysToScan(KEYS, new Date('2026-09-01T00:00:00.000Z'))).toEqual([]);
  });

  it('orders the scan ascending by partition day regardless of listing order', () => {
    const shuffled = [KEYS[2], KEYS[0], KEYS[3], KEYS[1]];
    expect(observationKeysToScan(shuffled, null)).toEqual([
      KEYS[0],
      KEYS[1],
      KEYS[2],
      KEYS[3],
    ]);
  });

  it('exposes the key scheme constants for the R2 list prefix', () => {
    expect(OBSERVATION_LOG_PREFIX).toBe('observations/');
    expect(observationPartitionDay('observations/2026-08-15.jsonl')).toBe('2026-08-15');
    expect(observationPartitionDay('other/2026-08-15.jsonl')).toBeNull();
  });
});
