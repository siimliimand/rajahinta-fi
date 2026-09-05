/**
 * What-if share-token codec tests (task 8.3, change
 * product-roadmap-phases-1-4).
 *
 * The frontend codec must stay byte-compatible with the worker's codec
 * (apps/api-worker/src/routes/what-if.routes.ts, task 8.2): the
 * compatibility vectors below are literal tokens PRODUCED BY THE
 * WORKER'S OWN TEST RUN — encode must reproduce them exactly, and
 * decode must accept them. Tamper/corruption/bound vectors mirror the
 * worker's test suite, so the two decoders reject the same inputs.
 *
 * @module WhatIfShareTokenTest
 */

import { describe, it, expect } from 'vitest';
import {
  encodeWhatIfShareToken,
  decodeWhatIfShareToken,
  WhatIfShareTokenError,
} from './share-token';
import type { WhatIfScenarioRequest } from './what-if.types';

const SCENARIO: WhatIfScenarioRequest = {
  hypotheticalRate: 18.1,
  products: [
    {
      id: 'beer-05',
      category: 'beer',
      abv: 0.047,
      volumeLitres: 1,
      alkoPriceCents: 1298,
      importPriceCents: 89,
    },
  ],
};

/** Produced by encodeWhatIfShareToken in apps/api-worker (task 8.2 test run). */
const WORKER_VECTOR = 'wi1.eyJ2IjoxLCJyYXRlIjoxOC4xLCJwIjpbeyJpZCI6ImJlZXItMDUiLCJjYXRlZ29yeSI6ImJlZXIiLCJhYnYiOjAuMDQ3LCJ2b2x1bWVMaXRyZXMiOjEsImFsa29QcmljZUNlbnRzIjoxMjk4LCJpbXBvcnRQcmljZUNlbnRzIjo4OX1dfQ.pa45j8';

/** Worker-produced vector carrying a non-ASCII id (UTF-8 safety, cross-app). */
const WORKER_VECTOR_UTF8 = 'wi1.eyJ2IjoxLCJyYXRlIjo1LCJwIjpbeyJpZCI6Im9sdXQtw6QgMyw1ICUiLCJjYXRlZ29yeSI6ImJlZXIiLCJhYnYiOjAuMDQ3LCJ2b2x1bWVMaXRyZXMiOjEsImFsa29QcmljZUNlbnRzIjoxMjk4LCJpbXBvcnRQcmljZUNlbnRzIjo4OX1dfQ.ojxbsp';

// ---------------------------------------------------------------------------
// Cross-app compatibility + round-trip
// ---------------------------------------------------------------------------

describe('what-if share token — worker compatibility', () => {
  it('decodes a token produced by the worker codec back to its scenario', () => {
    expect(decodeWhatIfShareToken(WORKER_VECTOR)).toEqual(SCENARIO);
  });

  it('encodes a scenario byte-identically to the worker codec', () => {
    expect(encodeWhatIfShareToken(SCENARIO)).toBe(WORKER_VECTOR);
  });

  it('round-trips non-ASCII product ids against the worker vector', () => {
    const scenario: WhatIfScenarioRequest = {
      hypotheticalRate: 5,
      products: [{ ...SCENARIO.products[0], id: 'olut-ä 3,5 %' }],
    };
    expect(decodeWhatIfShareToken(WORKER_VECTOR_UTF8)).toEqual(scenario);
    expect(encodeWhatIfShareToken(scenario)).toBe(WORKER_VECTOR_UTF8);
  });
});

describe('what-if share token — round-trip fidelity', () => {
  it('is deterministic — encode(decode(token)) is the identity', () => {
    const token = encodeWhatIfShareToken(SCENARIO);
    expect(decodeWhatIfShareToken(token)).toEqual(SCENARIO);
    expect(encodeWhatIfShareToken(decodeWhatIfShareToken(token))).toBe(token);
  });

  it('decode trims ids like the worker zod schema', () => {
    // encode takes the scenario at face value; the worker's zod
    // .trim()s on validation, so decode must hand back the trimmed id.
    const token = encodeWhatIfShareToken({
      hypotheticalRate: 1,
      products: [{ ...SCENARIO.products[0], id: '  beer-05  ' }],
    });
    expect(decodeWhatIfShareToken(token).products[0]!.id).toBe('beer-05');
  });

  it('ignores unknown envelope keys like the worker zod schema (object stripping)', () => {
    // Independent reconstruction: an envelope with an extra product key
    // and a valid checksum must decode to the known fields only.
    const payload = JSON.stringify({
      v: 1,
      rate: 1,
      p: [{ ...SCENARIO.products[0], smuggled: 'x' }],
      extra: true,
    });
    let hash = 0x0811c9dc5;
    for (let i = 0; i < payload.length; i++) {
      hash ^= payload.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    const b64 = Buffer.from(payload, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/u, '');
    const token = `wi1.${b64}.${(hash >>> 0).toString(36)}`;
    expect(decodeWhatIfShareToken(token)).toEqual({
      hypotheticalRate: 1,
      products: [SCENARIO.products[0]],
    });
  });
});

// ---------------------------------------------------------------------------
// Tamper / corruption / bounds rejection — worker parity
// ---------------------------------------------------------------------------

describe('what-if share token — rejection', () => {
  it.each([
    ['altered payload byte', (t: string) => {
      const [prefix, payload, checksum] = t.split('.');
      const flipped = (payload[0] === 'e' ? 'f' : 'e') + payload.slice(1);
      return `${prefix}.${flipped}.${checksum}`;
    }],
    ['altered checksum', (t: string) => {
      const [prefix, payload] = t.split('.');
      return `${prefix}.${payload}.broken`;
    }],
    ['wrong prefix', (t: string) => t.replace('wi1.', 'wi2.')],
    ['truncated token', (t: string) => t.slice(0, t.length - 8)],
    ['not a token at all', () => 'hello world'],
    ['empty string', () => ''],
  ])('rejects tampering/corruption: %s', (_label, tamper) => {
    const token = encodeWhatIfShareToken(SCENARIO);
    expect(() => decodeWhatIfShareToken(tamper(token))).toThrow(WhatIfShareTokenError);
  });

  it.each([
    ['negative rate', { hypotheticalRate: -5, products: SCENARIO.products }],
    ['rate over the cap', { hypotheticalRate: 1000.01, products: SCENARIO.products }],
    ['abv over 1', { hypotheticalRate: 1, products: [{ ...SCENARIO.products[0], abv: 1.5 }] }],
    [
      'non-integer price',
      { hypotheticalRate: 1, products: [{ ...SCENARIO.products[0], importPriceCents: 10.5 }] },
    ],
    [
      'unknown category',
      { hypotheticalRate: 1, products: [{ ...SCENARIO.products[0], category: 'mead' as never }] },
    ],
    [
      'duplicate ids',
      {
        hypotheticalRate: 1,
        products: [SCENARIO.products[0], { ...SCENARIO.products[0] }],
      },
    ],
    ['empty product list', { hypotheticalRate: 1, products: [] }],
  ])('rejects a validly-checksummed payload that violates the bounds: %s', (_label, scenario) => {
    const token = encodeWhatIfShareToken(scenario as WhatIfScenarioRequest);
    expect(() => decodeWhatIfShareToken(token)).toThrow(WhatIfShareTokenError);
  });

  it('rejects oversized tokens before parsing', () => {
    expect(() => decodeWhatIfShareToken(`wi1.${'e'.repeat(10_000)}.0`)).toThrow(
      WhatIfShareTokenError,
    );
  });
});
