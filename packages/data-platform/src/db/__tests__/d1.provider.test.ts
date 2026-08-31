/**
 * Tests for the D1 connection provider and registration helper (task 2.4).
 *
 * The drizzle instance is exercised purely through SQL building
 * (`.toSQL()`), so no real D1/SQLite is needed — the fake client only
 * proves that nothing touches the binding until a query executes.
 *
 * @module DrizzleD1ProviderTest
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  DRIZZLE_D1,
  createDrizzleD1,
  type D1DatabaseLike,
} from '../d1.provider';
import { getDrizzleD1 } from '../d1.module';
import { productMaster } from '../../d1/index';

/** Inert D1 binding: statements resolve never; queries must never run. */
function createFakeD1(): D1DatabaseLike & { prepared: string[] } {
  const prepared: string[] = [];
  const statement = (sql: string) => ({
    bind: () => statement(sql),
    first: () => new Promise<never>(() => {}),
    run: () => new Promise<never>(() => {}),
    all: () => new Promise<never>(() => {}),
    raw: () => new Promise<never>(() => {}),
  });
  return {
    prepared,
    prepare: (query: string) => {
      prepared.push(query);
      return statement(query);
    },
    batch: () => new Promise<never>(() => {}),
  };
}

describe('d1.provider', () => {
  it('exports a unique injection token', () => {
    expect(typeof DRIZZLE_D1).toBe('symbol');
  });

  it('builds schema-typed SQL against the translated D1 tables', () => {
    const db = createDrizzleD1(createFakeD1());
    const query = db.select().from(productMaster).toSQL();
    expect(query.sql).toContain('product_master');
  });

  it('does not touch the binding while building queries', () => {
    const fake = createFakeD1();
    const db = createDrizzleD1(fake);
    void db.select().from(productMaster).toSQL();
    expect(fake.prepared).toHaveLength(0);
  });
});

describe('getDrizzleD1', () => {
  it('memoizes one instance per binding object', () => {
    const fake = createFakeD1();
    expect(getDrizzleD1(fake)).toBe(getDrizzleD1(fake));
  });

  it('returns distinct instances for distinct bindings', () => {
    const a = getDrizzleD1(createFakeD1());
    const b = getDrizzleD1(createFakeD1());
    expect(a).not.toBe(b);
  });
});

/**
 * Cross-runtime key-material sanity: the provider file's hash-free surface
 * is trivial, but pin the Node/web-crypto boundary the Worker relies on —
 * SHA-256 must agree between node:crypto (tests) and WebCrypto (Workers).
 */
describe('web-crypto/node-crypto sha-256 parity', () => {
  it('produces identical digests', async () => {
    const input = 'product-master|1|FI';
    const expected = createHash('sha256').update(input).digest('hex');
    const actual = await crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(input))
      .then((bytes) => Buffer.from(bytes).toString('hex'));
    expect(actual).toBe(expected);
  });
});
