/**
 * ETL transform + validation fixtures (task 6.6, change
 * migrate-to-cloudflare).
 *
 * Every pg → D1 transform (design D2 rules), every CHECK value set, the
 * error paths (loud, aggregated), FK-safe ordering, batching,
 * determinism, sessions rotation ordering, and the R2 observation-log
 * routing — exercised against synthetic pg rows, no database required.
 *
 * @module EtlPgToD1Tests
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  CONTAINER_TYPES,
  EtlValidationError,
  KNOWN_TABLES,
  OBSERVATIONS_TABLE,
  TABLE_REGISTRY,
  buildImportJsonl,
  buildInsertStatements,
  buildObservationRecord,
  buildVerifySql,
  groupObservationPartitions,
  kindForOid,
  orderSessionsByRotation,
  runEtl,
  transformRows,
  transformValue,
  type PgClientLike,
} from '../etl-pg-to-d1';
import {
  parseObservationLine,
  serializeObservationLine,
} from '../../packages/data-platform/src/d1/observation-log';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** pg field OID constants (pg-types builtins). */
const OID = { BOOL: 16, INT4: 23, VARCHAR: 1043, DATE: 1082, TIMESTAMP: 1114, TIMESTAMPTZ: 1184, NUMERIC: 1700, JSONB: 3802 } as const;

/** Build a columnKinds map from [name, OID] pairs. */
function kinds(entries: ReadonlyArray<[string, number]>): Map<string, ReturnType<typeof kindForOid>> {
  return new Map(entries.map(([name, oid]) => [name, kindForOid(oid)]));
}

const PRODUCT_KINDS = kinds([
  ['id', OID.INT4],
  ['name', OID.VARCHAR],
  ['manufacturer', OID.VARCHAR],
  ['brand', OID.VARCHAR],
  ['category', OID.VARCHAR],
  ['alcohol_by_volume', OID.NUMERIC],
  ['unit_volume', OID.NUMERIC],
  ['container_type', OID.VARCHAR],
  ['regulatory_classification', OID.VARCHAR],
  ['deposit_system_status', OID.BOOL],
  ['ean', OID.VARCHAR],
  ['created_at', OID.TIMESTAMP],
  ['updated_at', OID.TIMESTAMP],
]);

/** A full product_master pg row (all 13 D1 columns present). */
function productRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 1,
    name: 'Karhu IV',
    manufacturer: 'Hartwall',
    brand: 'Karhu',
    category: 'beer',
    alcohol_by_volume: '0.047',
    unit_volume: '0.3300',
    container_type: 'can',
    regulatory_classification: 'alcoholic_beverage',
    deposit_system_status: true,
    ean: '6415600500217',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-02T03:04:05.123Z'),
    ...overrides,
  };
}

const TRANSPORT_KINDS = kinds([
  ['id', OID.INT4],
  ['carrier', OID.VARCHAR],
  ['origin_country', OID.VARCHAR],
  ['destination_country', OID.VARCHAR],
  ['weight_min_kg', OID.NUMERIC],
  ['weight_max_kg', OID.NUMERIC],
  ['package_tier', OID.VARCHAR],
  ['price_cents', OID.INT4],
  ['currency', OID.VARCHAR],
  ['seller_involvement_indicator', OID.BOOL],
  ['observed_at', OID.TIMESTAMP],
  ['refreshed_at', OID.TIMESTAMP],
  ['reliability_status', OID.VARCHAR],
]);

function transportRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 1,
    carrier: 'posti_freight',
    origin_country: 'EE',
    destination_country: 'FI',
    weight_min_kg: '0.0000',
    weight_max_kg: '50.0000',
    package_tier: 'parcel',
    price_cents: 2500,
    currency: 'EUR',
    seller_involvement_indicator: false,
    observed_at: new Date('2026-03-01T10:00:00.000Z'),
    refreshed_at: new Date('2026-03-01T10:00:00.000Z'),
    reliability_status: 'VERIFIED',
    ...overrides,
  };
}

/** pg observation row — exact field set of the former price_observations. */
function observationRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 7,
    product_id: 1,
    merchant: 'alko',
    retail_offer_id: 3,
    observed_at: new Date('2026-03-01T12:30:00.000Z'),
    foreign_retail_price_cents: 200,
    transport_cost_cents: 150,
    transport_offer_id: 9,
    excise_rule_version_id: 12,
    container_duty_rule_version_id: 13,
    landed_cost_cents: 441,
    input_reliability: { price: 'ESTIMATED', transport: 'VERIFIED', classification: 'VERIFIED' },
    confidence: 'MEDIUM',
    ...overrides,
  };
}

function specOf(name: string) {
  const spec = TABLE_REGISTRY.find((t) => t.name === name);
  if (!spec) throw new Error(`fixture bug: ${name} not in registry`);
  return spec;
}

// ---------------------------------------------------------------------------
// Value transforms (design D2 rules)
// ---------------------------------------------------------------------------

describe('transformValue — every pg → D1 rule', () => {
  it('maps integers pass-through and rejects non-integers', () => {
    expect(transformValue('int', 42, 'x')).toEqual({ sql: '42', json: 42 });
    expect(transformValue('int', '42', 'x').sql).toBe('42'); // pg int8 arrives as string
    expect(() => transformValue('int', 4.5, 'x')).toThrow(EtlValidationError);
    expect(() => transformValue('int', 'abc', 'x')).toThrow(EtlValidationError);
  });

  it('maps floats and rejects non-finite values', () => {
    expect(transformValue('float', 2.5, 'x')).toEqual({ sql: '2.5', json: 2.5 });
    expect(() => transformValue('float', Number.NaN, 'x')).toThrow(EtlValidationError);
  });

  it('maps pg numeric text to a REAL literal without float round-trip', () => {
    // The validated decimal text is emitted verbatim — '0.047' never
    // becomes 0.047000000000000001.
    const mapped = transformValue('numeric-text', '0.047', 'x');
    expect(mapped).toEqual({ sql: '0.047', json: 0.047 });
    expect(transformValue('numeric-text', '28.750000', 'x').sql).toBe('28.750000');
    expect(() => transformValue('numeric-text', '12,5', 'x')).toThrow(EtlValidationError);
    expect(() => transformValue('numeric-text', 'NaN', 'x')).toThrow(EtlValidationError);
  });

  it('maps text with SQL escaping', () => {
    expect(transformValue('text', "O'Brien", 'x').sql).toBe(`'O''Brien'`);
    expect(() => transformValue('text', 42, 'x')).toThrow(EtlValidationError);
  });

  it('maps booleans to 0/1 and preserves the tri-state NULL', () => {
    expect(transformValue('boolean', true, 'x')).toEqual({ sql: '1', json: 1 });
    expect(transformValue('boolean', false, 'x')).toEqual({ sql: '0', json: 0 });
    // Tri-state (deposit_system_status): unknown must stay NULL, not 0.
    expect(transformValue('boolean', null, 'x')).toEqual({ sql: 'NULL', json: null });
    expect(() => transformValue('boolean', 'true', 'x')).toThrow(EtlValidationError);
  });

  it('maps timestamps (Date and string) to ISO-8601 UTC text', () => {
    expect(transformValue('timestamp', new Date('2026-01-02T03:04:05.123Z'), 'x').sql).toBe(
      `'2026-01-02T03:04:05.123Z'`,
    );
    expect(transformValue('timestamp', '2026-01-02T03:04:05Z', 'x').json).toBe('2026-01-02T03:04:05.000Z');
    expect(() => transformValue('timestamp', 'not-a-date', 'x')).toThrow(EtlValidationError);
    expect(() => transformValue('timestamp', Number.NaN, 'x')).toThrow(EtlValidationError);
  });

  it('maps pg date to YYYY-MM-DD text', () => {
    expect(transformValue('date', '2026-08-28', 'x')).toEqual({ sql: `'2026-08-28'`, json: '2026-08-28' });
    expect(transformValue('date', new Date('2026-08-28T00:00:00.000Z'), 'x').json).toBe('2026-08-28');
    expect(() => transformValue('date', '28.08.2026', 'x')).toThrow(EtlValidationError);
  });

  it('maps jsonb objects (and raw strings) to canonical JSON text', () => {
    const mapped = transformValue('jsonb', { b: 1, a: [true, null] }, 'x');
    expect(mapped.json).toBe('{"b":1,"a":[true,null]}');
    expect(mapped.sql).toBe(`'{"b":1,"a":[true,null]}'`);
    expect(transformValue('jsonb', '{"x":1}', 'x').json).toBe('{"x":1}');
    expect(transformValue('jsonb', null, 'x')).toEqual({ sql: 'NULL', json: null });
    expect(() => transformValue('jsonb', '{broken', 'x')).toThrow(EtlValidationError);
  });

  it('maps every pg OID kind via kindForOid', () => {
    expect(kindForOid(23)).toBe('int');
    expect(kindForOid(20)).toBe('int');
    expect(kindForOid(1700)).toBe('numeric-text');
    expect(kindForOid(1114)).toBe('timestamp');
    expect(kindForOid(1184)).toBe('timestamp'); // timestamptz
    expect(kindForOid(1082)).toBe('date');
    expect(kindForOid(16)).toBe('boolean');
    expect(kindForOid(3802)).toBe('jsonb');
    expect(kindForOid(1043)).toBe('text');
  });
});

// ---------------------------------------------------------------------------
// Row transforms — CHECK sets, loud aggregation, drift
// ---------------------------------------------------------------------------

describe('transformRows — CHECK validation is loud, never silent', () => {
  it('transforms a full product row with every design-D2 rule applied', () => {
    const result = transformRows(
      specOf('product_master'),
      PRODUCT_KINDS,
      [productRow()],
      (row) => String(row['id']),
      Object.keys(productRow()),
    );
    // Emission column order = D1 schema definition order (physical names).
    expect(result.columns).toEqual([
      'id',
      'name',
      'manufacturer',
      'brand',
      'category',
      'alcohol_by_volume',
      'unit_volume',
      'container_type',
      'regulatory_classification',
      'deposit_system_status',
      'ean',
      'created_at',
      'updated_at',
    ]);
    const tuple = result.tuples[0];
    expect(tuple).toContain('1'); // id
    expect(tuple).toContain('0.047'); // pg numeric → REAL literal (validated text, unquoted)
    expect(tuple).toContain('0.3300'); // exact decimal text preserved
    expect(tuple).toContain('1'); // deposit_system_status true → 1
    expect(tuple).toContain("'2026-01-02T03:04:05.123Z'"); // timestamptz → ISO text
    expect(result.jsonRows[0]['deposit_system_status']).toBe(1);
  });

  it('fails listing every offending container_type row (0002 set)', () => {
    const rows = [
      productRow({ id: 42, container_type: 'bag-in-box' }),
      productRow({ id: 7, container_type: 'CAN' }), // case-sensitive CHECK — loud, not normalized away
    ];
    try {
      transformRows(specOf('product_master'), PRODUCT_KINDS, rows, (row) => String(row['id']), Object.keys(productRow()));
      expect.unreachable('expected EtlValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(EtlValidationError);
      const message = (error as Error).message;
      expect(message).toContain('2 offending row value(s)');
      expect(message).toContain('container_type');
      expect(message).toContain('bag-in-box');
      expect(message).toContain('CAN');
      expect(message).toContain('glass, plastic, metal, carton, other, can, bottle');
    }
  });

  it('accepts the full widened 0002 container-type set', () => {
    for (const value of CONTAINER_TYPES) {
      const rows = [productRow({ id: 1, container_type: value })];
      expect(() =>
        transformRows(specOf('product_master'), PRODUCT_KINDS, rows, (row) => String(row['id']), Object.keys(productRow())),
      ).not.toThrow();
    }
  });

  it('does NOT CHECK package_tier — migration 0003 dropped it (container-type vocabulary is legal)', () => {
    const rows = [transportRow({ id: 5, package_tier: 'can' })];
    expect(() => transformRows(specOf('transport_offers'), TRANSPORT_KINDS, rows, (row) => String(row['id']), Object.keys(transportRow()))).not.toThrow();
  });

  it('fails on reliability_status outside the D1 CHECK set', () => {
    // The pg world historically stored 'EXACT' (fixtures predate the
    // renaming) — that value has no D1 counterpart and must fail loudly.
    const rows = [transportRow({ id: 9, reliability_status: 'EXACT' })];
    expect(() =>
      transformRows(specOf('transport_offers'), TRANSPORT_KINDS, rows, (row) => String(row['id']), Object.keys(transportRow())),
    ).toThrow(/VERIFIED, ESTIMATED, STALE, UNAVAILABLE/);
  });

  it('aggregates transform failures and CHECK failures into one report', () => {
    const rows = [
      transportRow({ id: 1, price_cents: 1.5 }), // non-integer cents
      transportRow({ id: 2, reliability_status: 'EXACT' }),
    ];
    try {
      transformRows(specOf('transport_offers'), TRANSPORT_KINDS, rows, (row) => String(row['id']), Object.keys(transportRow()));
      expect.unreachable('expected EtlValidationError');
    } catch (error) {
      expect((error as Error).message).toContain('2 offending row value(s)');
      expect((error as Error).message).toContain('price_cents');
      expect((error as Error).message).toContain('reliability_status');
    }
  });

  it('fails loudly on schema drift (pg column absent from D1 schema)', () => {
    const rows = [{ ...productRow(), legacy_column: 'x' }];
    // The drift check compares against the pg FIELD metadata (which here
    // carries the legacy column), not the expected fixture keys.
    const pgFields = [...Object.keys(productRow()), 'legacy_column'];
    expect(() => transformRows(specOf('product_master'), PRODUCT_KINDS, rows, (r) => String(r['id']), pgFields)).toThrow(
      /schema drift.*legacy_column/,
    );
  });

  it('fails loudly when the kind map is missing a D1 column', () => {
    const partial = new Map([...PRODUCT_KINDS].filter(([name]) => name !== 'ean'));
    expect(() => transformRows(specOf('product_master'), partial, [productRow()], (r) => String(r['id']), Object.keys(productRow()))).toThrow(
      /no pg type kind for "product_master"\."ean"/,
    );
  });
});

// ---------------------------------------------------------------------------
// Emission — FK order, batching, idempotency, determinism
// ---------------------------------------------------------------------------

describe('emission', () => {
  it('registers the 18 D1 tables in FK-safe order (parents before children)', () => {
    expect(TABLE_REGISTRY).toHaveLength(18);
    const positions = new Map(TABLE_REGISTRY.map((t, i) => [t.name, i]));
    expect(positions.get('product_master')!).toBeLessThan(positions.get('retail_offers')!);
    expect(positions.get('fx_rate_datasets')!).toBeLessThan(positions.get('fx_rates')!);
    expect(positions.get('accounts')!).toBeLessThan(positions.get('sessions')!);
    expect(positions.get('sessions')!).toBeLessThan(positions.get('saved_baskets')!);
    expect(positions.get('product_master')!).toBeLessThan(positions.get('calculation_records')!);
    expect(positions.get('transport_offers')!).toBeLessThan(positions.get('calculation_records')!);
    expect(positions.get('tax_rules')!).toBeLessThan(positions.get('calculation_records')!);
    expect(KNOWN_TABLES).toContain(OBSERVATIONS_TABLE);
    expect(KNOWN_TABLES).toHaveLength(19); // 18 D1 + the R2-routed table
  });

  it('pins exactly the D1 migration DDL column set for every table', () => {
    // The registry column lists are hand-pinned (scripts/ cannot import
    // drizzle-orm); this check compares them against the actual migration
    // DDL, so schema drift fails here loudly instead of at cutover time.
    const migrationsDir = resolve(
      join(dirname(new URL(import.meta.url).pathname), '..', '..', 'packages', 'data-platform', 'src', 'd1', 'migrations'),
    );
    expect(existsSync(migrationsDir)).toBe(true);

    const ddl = readFileSync(join(migrationsDir, '0000_supreme_bucky.sql'), 'utf8');
    for (const spec of TABLE_REGISTRY) {
      const createRe = new RegExp(`CREATE TABLE \\\`${spec.name}\\\` \\([\\s\\S]*?\\n\\);`);
      const match = createRe.exec(ddl);
      if (!match) throw new Error(`fixture bug: no CREATE TABLE for ${spec.name} in 0000 migration`);
      const ddlColumns = match[0]
        .split('\n')
        .map((line) => /^\s*`([a-z_]+)`/.exec(line)?.[1]) // column defs start with a backtick-quoted name; CONSTRAINT/INDEX lines do not
        .filter((name): name is string => name !== undefined);
      expect([...spec.columns].sort(), `column set of ${spec.name}`).toEqual([...ddlColumns].sort());
    }
  });

  it('emits explicit ids and INSERT OR IGNORE (idempotent re-import)', () => {
    const statements = buildInsertStatements(
      'product_master',
      ['id', 'name'],
      [['7', "'Karhu IV'"]],
      100,
    );
    expect(statements[0]).toContain('INSERT OR IGNORE INTO "product_master"');
    expect(statements[0]).toContain('(7, \'Karhu IV\')');
  });

  it('batches rows at the configured size', () => {
    const tuples = Array.from({ length: 250 }, (_, i) => [String(i), `'n${i}'`]);
    const statements = buildInsertStatements('t', ['id', 'name'], tuples, 100);
    expect(statements).toHaveLength(3);
    // Open parens = one per row tuple + one for the column list.
    expect(statements[0].match(/\(/g)!.length).toBe(101);
    expect(statements[2].match(/\(/g)!.length).toBe(51);
  });

  it('emits nothing for zero rows (empty table → no INSERT)', () => {
    expect(buildInsertStatements('t', ['id'], [], 100)).toEqual([]);
    expect(buildImportJsonl(['id'], [])).toBe('');
  });

  it('emits JSONL with a header line for wrangler d1 import', () => {
    const jsonl = buildImportJsonl(['id', 'name'], [
      { id: 1, name: 'Karhu IV' },
      { id: 2, name: "O'Brien" },
    ]);
    const lines = jsonl.trimEnd().split('\n');
    expect(lines[0]).toBe('["id","name"]');
    expect(lines[1]).toBe('{"id":1,"name":"Karhu IV"}');
    expect(lines[2]).toBe(`{"id":2,"name":"O'Brien"}`);
  });

  it('is byte-deterministic for identical input', () => {
    const run = () =>
      buildInsertStatements(
        'product_master',
        ['id', 'name'],
        transformRows(specOf('product_master'), PRODUCT_KINDS, [productRow()], (r) => String(r['id']), Object.keys(productRow())).tuples,
        100,
      ).join('\n\n');
    expect(run()).toBe(run());
  });

  it('orders sessions so rotation parents insert before children', () => {
    const row = (id: number, parent: number | null): Record<string, unknown> => ({
      id,
      rotated_from_id: parent,
    });
    // id 3 rotates FROM id 5 (a forward reference — ORDER BY id would
    // violate the FK; topo ordering must repair it).
    const ordered = orderSessionsByRotation([row(3, 5), row(1, null), row(2, 3), row(5, null)]);
    expect(ordered.map((r) => r['id'])).toEqual([1, 5, 3, 2]);
  });

  it('fails on an unorderable rotation cycle', () => {
    const row = (id: number, parent: number | null): Record<string, unknown> => ({ id, rotated_from_id: parent });
    expect(() => orderSessionsByRotation([row(1, 2), row(2, 1)])).toThrow(EtlValidationError);
  });
});

// ---------------------------------------------------------------------------
// Observations → R2 layout
// ---------------------------------------------------------------------------

describe('observation routing to the R2 log', () => {
  it('builds the exact ObservationLogRecord field set from a pg row', () => {
    const record = buildObservationRecord(observationRow(), '7@2026-03-01');
    expect(serializeObservationLine(record)).toBe(
      '{"id":7,"product_id":1,"merchant":"alko","retail_offer_id":3,"observed_at":"2026-03-01T12:30:00.000Z",' +
        '"foreign_retail_price_cents":200,"transport_cost_cents":150,"transport_offer_id":9,' +
        '"excise_rule_version_id":12,"container_duty_rule_version_id":13,"landed_cost_cents":441,' +
        '"input_reliability":{"price":"ESTIMATED","transport":"VERIFIED","classification":"VERIFIED"},"confidence":"MEDIUM"}',
    );
  });

  it('groups observations into date-partitioned R2 objects with stable lines', () => {
    // Records arrive in (observed_at, id) order — the pg read order runEtl uses.
    const records = [
      buildObservationRecord(observationRow({ id: 3, observed_at: new Date('2026-03-01T00:00:00.000Z') }), '3'),
      buildObservationRecord(observationRow({ id: 1, observed_at: new Date('2026-03-01T23:59:59.000Z') }), '1'),
      buildObservationRecord(observationRow({ id: 2, observed_at: new Date('2026-03-02T00:00:01.000Z') }), '2'),
    ];
    const partitions = groupObservationPartitions(records);
    expect([...partitions.keys()].sort()).toEqual(['observations/2026-03-01.jsonl', 'observations/2026-03-02.jsonl']);

    const day1 = partitions.get('observations/2026-03-01.jsonl')!;
    expect(day1).toHaveLength(2);
    // Lines round-trip through the layout parser.
    for (const line of day1) {
      expect(() => parseObservationLine(line)).not.toThrow();
    }
    expect(parseObservationLine(day1[0]).id).toBe(3);
    expect(parseObservationLine(day1[1]).id).toBe(1);
  });

  it('fails loudly on an observation confidence outside the CHECK set', () => {
    expect(() => buildObservationRecord(observationRow({ confidence: 'OK' }), '9')).toThrow(
      /HIGH, MEDIUM, LOW/,
    );
  });
});

// ---------------------------------------------------------------------------
// runEtl — end-to-end over a fake pg client
// ---------------------------------------------------------------------------

/** Fake pg client serving canned results per table. */
function fakeClient(results: Record<string, { rows: Record<string, unknown>[]; fields: ReadonlyArray<{ name: string; dataTypeID: number }> }>): PgClientLike {
  return {
    query: async (text: string) => {
      const match = /FROM "([a-z_]+)"/.exec(text);
      if (!match) throw new Error(`fakeClient: unparseable query ${text}`);
      const result = results[match[1]];
      if (!result) throw new Error(`fakeClient: no fixture for ${match[1]}`);
      return result;
    },
  };
}

function fieldList(names: ReadonlyArray<[string, number]>): ReadonlyArray<{ name: string; dataTypeID: number }> {
  return names.map(([name, dataTypeID]) => ({ name, dataTypeID }));
}

describe('runEtl over a fake pg client', () => {
  const registryRow = {
    id: 1,
    merchant_id: 'alko',
    name: 'Alko',
    country: 'FI',
    feed_url: 'https://example.com/feed',
    feed_format: 'json',
    polling_interval_ms: 3600000,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
  };
  const accountRow = {
    id: 3,
    user_id: 'user-1',
    email: 'user@example.com',
    tier: 'PREMIUM',
    created_at: new Date('2026-02-02T02:02:02.000Z'),
    last_active_at: new Date('2026-08-30T12:00:00.000Z'),
  };

  const client = fakeClient({
    merchant_registry: {
      rows: [registryRow],
      fields: fieldList([
        ['id', OID.INT4],
        ['merchant_id', OID.VARCHAR],
        ['name', OID.VARCHAR],
        ['country', OID.VARCHAR],
        ['feed_url', OID.VARCHAR],
        ['feed_format', OID.VARCHAR],
        ['polling_interval_ms', OID.INT4],
        ['created_at', OID.TIMESTAMP],
        ['updated_at', OID.TIMESTAMP],
      ]),
    },
    accounts: {
      rows: [accountRow],
      fields: fieldList([
        ['id', OID.INT4],
        ['user_id', OID.VARCHAR],
        ['email', OID.VARCHAR],
        ['tier', OID.VARCHAR],
        ['created_at', OID.TIMESTAMP],
        ['last_active_at', OID.TIMESTAMP],
      ]),
    },
    price_observations: {
      rows: [observationRow({ id: 1 }), observationRow({ id: 2, observed_at: new Date('2026-03-02T08:00:00.000Z') })],
      fields: fieldList([
        ['id', OID.INT4],
        ['product_id', OID.INT4],
        ['merchant', OID.VARCHAR],
        ['retail_offer_id', OID.INT4],
        ['observed_at', OID.TIMESTAMPTZ],
        ['foreign_retail_price_cents', OID.INT4],
        ['transport_cost_cents', OID.INT4],
        ['transport_offer_id', OID.INT4],
        ['excise_rule_version_id', OID.INT4],
        ['container_duty_rule_version_id', OID.INT4],
        ['landed_cost_cents', OID.INT4],
        ['input_reliability', OID.JSONB],
        ['confidence', OID.VARCHAR],
      ]),
    },
  });

  it('runs a subset (--table semantics), routes observations to R2 keys, and counts in vs out', async () => {
    const { manifest, files, verifySql } = await runEtl(client, {
      format: 'sql',
      batchSize: 100,
      tables: ['merchant_registry', 'accounts', OBSERVATIONS_TABLE],
      source: 'localhost:5432/rajahinta',
    });

    expect(Object.keys(manifest.tables).sort()).toEqual(['accounts', 'merchant_registry']);
    expect(manifest.tables['merchant_registry']).toMatchObject({ rowsIn: 1, rowsEmitted: 1 });
    expect(manifest.tables['accounts']).toMatchObject({ rowsIn: 1, rowsEmitted: 1 });

    // Observations landed under R2 keys — never as a D1 table file.
    expect(files.has('observations/2026-03-01.jsonl')).toBe(true);
    expect(files.has('observations/2026-03-02.jsonl')).toBe(true);
    expect([...files.keys()].filter((f) => f.includes('price_observations'))).toEqual([]);
    expect(manifest.observations).toEqual({
      rowsIn: 2,
      partitions: expect.objectContaining({ 'observations/2026-03-01.jsonl': expect.objectContaining({ lines: 1 }) }),
    });

    // Verify SQL covers D1 tables only — price_observations does not exist in D1.
    expect(verifySql).toContain('"merchant_registry_total"');
    expect(verifySql).toContain('"accounts_total"');
    expect(verifySql).not.toContain('price_observations');
  });

  it('emits byte-identical artifacts across runs', async () => {
    const options = {
      format: 'sql' as const,
      batchSize: 100,
      tables: ['merchant_registry', 'accounts', OBSERVATIONS_TABLE] as const,
      source: 'localhost:5432/rajahinta',
    };
    const first = await runEtl(client, options);
    const second = await runEtl(client, options);
    expect([...first.files.entries()]).toEqual([...second.files.entries()]);
    expect(first.manifest).toEqual(second.manifest);
  });

  it('supports the jsonl import format', async () => {
    const { files, manifest } = await runEtl(client, {
      format: 'jsonl',
      batchSize: 100,
      tables: ['accounts'],
      source: 'localhost:5432/rajahinta',
    });
    const body = files.get('08-accounts.d1.jsonl')!;
    expect(body.split('\n')[0]).toBe(
      JSON.stringify(['id', 'user_id', 'email', 'tier', 'created_at', 'last_active_at']),
    );
    expect(manifest.format).toBe('jsonl');
  });
});

describe('buildVerifySql', () => {
  it('produces one COUNT field per D1 table and never references the R2-routed table', () => {
    const sql = buildVerifySql(TABLE_REGISTRY.map((t) => t.name));
    expect(sql).toContain('SELECT');
    expect((sql.match(/COUNT\(\*\)/g) ?? []).length).toBe(18);
    expect(sql).not.toContain(OBSERVATIONS_TABLE);
  });
});
