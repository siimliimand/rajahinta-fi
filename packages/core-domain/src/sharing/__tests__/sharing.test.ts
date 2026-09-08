/**
 * Share-snapshot module tests (task 6.1, change
 * trust-and-reach-roadmap) — public-id generation contract, frozen-copy
 * assembly (closed projection), and the personal-data strip assertion
 * (spec share-permalinks: no account identifiers in the snapshot).
 *
 * @module SharingTest
 */

import { describe, it, expect } from 'vitest';
import {
  assembleShareSnapshot,
  assertNoPersonalData,
  generatePublicId,
  isValidPublicId,
  publicIdFromBytes,
} from '../sharing';
import {
  PUBLIC_ID_LENGTH,
  PUBLIC_ID_RANDOM_BYTES,
  PersonalDataFieldError,
  SHARE_SNAPSHOT_RETENTION_DAYS,
} from '../sharing.types';

/** Deterministic byte source: 0xAB repeated. */
function fixedBytes(byte: number, length = PUBLIC_ID_RANDOM_BYTES): Uint8Array {
  return new Uint8Array(length).fill(byte);
}

describe('public-id generation (22-char random id)', () => {
  it('produces exactly 22 base64url characters from 16 bytes', () => {
    const id = publicIdFromBytes(fixedBytes(0xab));
    expect(id).toHaveLength(PUBLIC_ID_LENGTH);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is deterministic for the same bytes', () => {
    expect(publicIdFromBytes(fixedBytes(0x00))).toBe(publicIdFromBytes(fixedBytes(0x00)));
    expect(publicIdFromBytes(fixedBytes(0x00))).toBe('AAAAAAAAAAAAAAAAAAAAAA');
  });

  it('rejects a byte count that is not 16 — a generator bug, not a row', () => {
    expect(() => publicIdFromBytes(new Uint8Array(15))).toThrow(/16 random bytes/);
    expect(() => publicIdFromBytes(new Uint8Array(17))).toThrow(/16 random bytes/);
  });

  it('covers the full 128 bits — every byte position affects the id', () => {
    const base = publicIdFromBytes(fixedBytes(0x00));
    for (let pos = 0; pos < PUBLIC_ID_RANDOM_BYTES; pos += 1) {
      const bytes = fixedBytes(0x00);
      bytes[pos] = 0x01;
      expect(publicIdFromBytes(bytes), `byte ${pos}`).not.toBe(base);
    }
  });

  it('generatePublicId yields valid, fresh ids', () => {
    const a = generatePublicId();
    const b = generatePublicId();
    expect(isValidPublicId(a)).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('isValidPublicId (public lookup gate)', () => {
  it('accepts exactly-22-char base64url strings', () => {
    expect(isValidPublicId('AbC123_-'.padEnd(22, 'x'))).toBe(true);
  });

  it('rejects wrong lengths and out-of-alphabet characters', () => {
    expect(isValidPublicId('short')).toBe(false);
    expect(isValidPublicId('x'.repeat(23))).toBe(false);
    expect(isValidPublicId(`${'a'.repeat(21)}/a`)).toBe(false);
    expect(isValidPublicId(`${'a'.repeat(21)}+a`)).toBe(false);
  });
});

describe('assembleShareSnapshot (frozen copy, closed projection)', () => {
  const source = {
    productName: 'Karhu III',
    productBrand: 'Hartwall',
    productCategory: 'beer',
    quantity: 2,
    totalCents: 1746,
    breakdown: [{ label: 'Retail price', cents: 700 }],
    confidence: 'MEDIUM',
    destination: 'FI',
    disclaimer: { text: 'Arvio.', language: 'fi', version: '1.0' },
    calculatedAt: '2026-09-08T10:00:00.000Z',
  };

  it('copies the public result fields', () => {
    const snapshot = assembleShareSnapshot(source);
    expect(snapshot.type).toBe('landed-cost-snapshot');
    expect(snapshot.product).toEqual({
      name: 'Karhu III',
      brand: 'Hartwall',
      category: 'beer',
    });
    expect(snapshot.totalCents).toBe(1746);
    expect(snapshot.currency).toBe('EUR');
    expect(snapshot.disclaimer).toEqual(source.disclaimer);
    expect(snapshot.calculatedAt).toBe(source.calculatedAt);
  });

  it('is a COPY — mutating the source afterwards cannot reach the snapshot', () => {
    const breakdown = [{ label: 'Retail price', cents: 700 }] as unknown;
    const snapshot = assembleShareSnapshot({ ...source, breakdown });
    (breakdown as { label: string }).label = 'MUTATED';
    expect(
      (snapshot.breakdown as { label: string }[])[0].label,
    ).toBe('Retail price');
  });

  it('projects a closed shape — exactly the documented keys', () => {
    const snapshot = assembleShareSnapshot(source);
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        'breakdown',
        'calculatedAt',
        'confidence',
        'currency',
        'destination',
        'disclaimer',
        'product',
        'quantity',
        'totalCents',
        'type',
      ].sort(),
    );
  });
});

describe('assertNoPersonalData (strip assertion)', () => {
  it('passes a clean snapshot', () => {
    expect(() =>
      assertNoPersonalData(
        assembleShareSnapshot({
          productName: 'Karhu III',
          productBrand: null,
          productCategory: 'beer',
          quantity: 1,
          totalCents: 873,
          breakdown: [],
          confidence: 'LOW',
          destination: 'FI',
          disclaimer: { text: 'x', language: 'fi', version: '1' },
          calculatedAt: '2026-09-08T10:00:00.000Z',
        }),
      ),
    ).not.toThrow();
  });

  it.each(['userId', 'user_id', 'accountId', 'session_id', 'SessionToken', 'email'])(
    'throws naming the path for a %s field at any depth',
    (key) => {
      expect(() => assertNoPersonalData({ nested: { [key]: 'u1' } })).toThrow(
        PersonalDataFieldError,
      );
      try {
        assertNoPersonalData({ nested: { [key]: 'u1' } });
      } catch (err) {
        expect((err as PersonalDataFieldError).path).toBe(`nested.${key}`);
      }
    },
  );

  it('catches personal data riding inside free-form breakdown lines', () => {
    const snapshot = assembleShareSnapshot({
      productName: 'x',
      productBrand: null,
      productCategory: 'beer',
      quantity: 1,
      totalCents: 100,
      breakdown: [{ label: 'line', meta: { accountId: 7 } }],
      confidence: 'LOW',
      destination: 'FI',
      disclaimer: null,
      calculatedAt: '2026-09-08T10:00:00.000Z',
    });
    expect(() => assertNoPersonalData(snapshot)).toThrow(PersonalDataFieldError);
  });

  it('is cycle-safe', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => assertNoPersonalData(a)).not.toThrow();
  });
});

describe('hygiene constants', () => {
  it('pins the 12-month sweep window', () => {
    expect(SHARE_SNAPSHOT_RETENTION_DAYS).toBe(365);
  });
});
