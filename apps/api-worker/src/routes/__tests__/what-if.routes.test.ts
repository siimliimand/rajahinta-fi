/**
 * What-if excise route tests (task 8.2, change product-roadmap-phases-1-4)
 * over the FULL app composition (createApp() + registerWhatIfRoutes —
 * the exact composition index.ts wires, flag gate + rate limit on the
 * route itself) on the fake-D1 harness.
 *
 * Pinning here: flag-off 403 (EXCISE_WHAT_IF), the zod bounds contract
 * (rate bounds, product list caps, canonical category, ABV fraction,
 * price/volume caps, duplicate ids), the HAND-computed scenario vector
 * through the engine-resolved baseline (36.20 €/cl-ethanol beer rule),
 * the structural HYPOTHETICAL disclaimer on every result, the
 * engine's zero-rate fallback baseline, and the share-token codec —
 * round-trip fidelity, encode∘decode identity, UTF-8 ids, and
 * tamper/corruption/bound rejection.
 *
 * EPHEMERAL architecture is pinned too: no idempotency store is wired
 * into the route, so identical payloads recompute fresh every time
 * (no scenario storage server-side — design R11).
 *
 * @module WhatIfRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
  seedTaxRule,
} from './harness';
import {
  registerWhatIfRoutes,
  encodeWhatIfShareToken,
  decodeWhatIfShareToken,
  WhatIfShareTokenError,
} from '../what-if.routes';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/**
 * index.ts registers the what-if handler behind its route-level gate+
 * limiter (same slot as the other route ports); the test composition
 * mirrors that exactly.
 */
function whatIfApp(): ReturnType<typeof buildApp> {
  const app = buildApp();
  registerWhatIfRoutes(app);
  return app;
}

function whatIfEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, { ...overrides, FF_EXCISE_WHAT_IF: 'true' });
}

/** The seeded baseline: 36.20 € per centilitre of ethanol, beer, verified. */
function seedBeerRule(db: Parameters<typeof seedTaxRule>[0]): number {
  return seedTaxRule(db, {
    id: 101,
    taxType: 'excise',
    productCategory: 'beer',
    rate: 36.2,
    versionLabel: 'v3.0-2026',
  });
}

const SCENARIO = {
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

function jsonInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function postWhatIf(
  app: ReturnType<typeof buildApp>,
  env: Env,
  body: unknown = SCENARIO,
): Promise<Response> {
  return request(app, env, '/api/v1/what-if/excise', jsonInit(body));
}

interface WhatIfLineJson {
  id: string;
  category: string;
  importTotalBaselineCents: number;
  importTotalHypotheticalCents: number;
  gapBaselineCents: number;
  gapHypotheticalCents: number;
  gapDeltaCents: number;
  baseline: {
    formulaRef: string;
    rateApplied: number;
    taxCents: number;
    taxDatasetVersion: string;
    ruleId: number | null;
    reliability: string;
  };
  hypothetical: {
    formulaRef: string;
    rate: number;
    rateApplied: number;
    taxCents: number;
  };
}

interface WhatIfJson {
  hypotheticalRate: number;
  baselineTaxDatasetVersion: string;
  disclaimer: { text: string; language: string; version: string };
  lines: WhatIfLineJson[];
  totals: {
    baselineExciseCents: number;
    hypotheticalExciseCents: number;
    gapBaselineCents: number;
    gapHypotheticalCents: number;
  };
  shareToken: string;
}

// ---------------------------------------------------------------------------
// Gate: flag-off 403 (EXCISE_WHAT_IF)
// ---------------------------------------------------------------------------

describe('POST /api/v1/what-if/excise — gate', () => {
  it('rejects with 403 while EXCISE_WHAT_IF is off (route 403 envelope shape)', async () => {
    const { d1 } = openMigratedD1();
    const app = whatIfApp();
    const res = await postWhatIf(app, lockedEnv(d1));
    await expectEnvelope(res, 403, {
      message: 'Feature "EXCISE_WHAT_IF" is not enabled',
    });
  });

  it('is anonymous — the happy path needs no session or account', async () => {
    const { db, d1 } = openMigratedD1();
    seedBeerRule(db);
    const app = whatIfApp();
    // No Authorization header, no session cookie — only the flag + limiter.
    const res = await postWhatIf(app, whatIfEnv(d1));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Validation — rate bounds, product list caps, categories, shapes
// ---------------------------------------------------------------------------

describe('POST /api/v1/what-if/excise — validation', () => {
  it.each([-1, -0.001, 1000.01, 10_000])('rejects hypotheticalRate=%s with 400', async (rate) => {
    const { d1 } = openMigratedD1();
    const app = whatIfApp();
    await expectEnvelope(
      await postWhatIf(app, whatIfEnv(d1), { ...SCENARIO, hypotheticalRate: rate }),
      400,
      { error: 'ValidationError' },
    );
  });

  it('rejects an empty product list and a list over the 20-product cap with 400', async () => {
    const { d1 } = openMigratedD1();
    const app = whatIfApp();
    const env = whatIfEnv(d1);

    await expectEnvelope(await postWhatIf(app, env, { ...SCENARIO, products: [] }), 400, {
      error: 'ValidationError',
    });

    const tooMany = Array.from({ length: 21 }, (_, i) => ({
      ...SCENARIO.products[0],
      id: `product-${i}`,
    }));
    await expectEnvelope(await postWhatIf(app, env, { ...SCENARIO, products: tooMany }), 400, {
      error: 'ValidationError',
    });
  });

  it('rejects an unknown category, out-of-fraction ABV, negative/non-integer prices, and duplicate ids with 400', async () => {
    const { d1 } = openMigratedD1();
    const app = whatIfApp();
    const env = whatIfEnv(d1);

    await expectEnvelope(
      await postWhatIf(app, env, {
        ...SCENARIO,
        products: [{ ...SCENARIO.products[0], category: 'mead' }],
      }),
      400,
      { error: 'ValidationError' },
    );
    await expectEnvelope(
      await postWhatIf(app, env, {
        ...SCENARIO,
        products: [{ ...SCENARIO.products[0], abv: 1.5 }],
      }),
      400,
      { error: 'ValidationError' },
    );
    await expectEnvelope(
      await postWhatIf(app, env, {
        ...SCENARIO,
        products: [{ ...SCENARIO.products[0], abv: -0.01 }],
      }),
      400,
      { error: 'ValidationError' },
    );
    await expectEnvelope(
      await postWhatIf(app, env, {
        ...SCENARIO,
        products: [{ ...SCENARIO.products[0], alkoPriceCents: -5 }],
      }),
      400,
      { error: 'ValidationError' },
    );
    await expectEnvelope(
      await postWhatIf(app, env, {
        ...SCENARIO,
        products: [{ ...SCENARIO.products[0], importPriceCents: 10.5 }],
      }),
      400,
      { error: 'ValidationError' },
    );
    await expectEnvelope(
      await postWhatIf(app, env, {
        ...SCENARIO,
        products: [
          SCENARIO.products[0],
          { ...SCENARIO.products[0], id: 'beer-05' },
        ],
      }),
      400,
      { error: 'ValidationError' },
    );
  });

  it('accepts the exact caps as valid input (rate 1000, 20 products, volume/price caps)', async () => {
    const { db, d1 } = openMigratedD1();
    seedBeerRule(db);
    const app = whatIfApp();

    const res = await postWhatIf(app, whatIfEnv(d1), {
      hypotheticalRate: 1000,
      products: [
        {
          id: 'max-case',
          category: 'beer',
          abv: 1,
          volumeLitres: 10_000,
          alkoPriceCents: 10_000_000,
          importPriceCents: 10_000_000,
        },
      ],
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Computed result — engine-resolved baseline + structural disclaimer
// ---------------------------------------------------------------------------

describe('POST /api/v1/what-if/excise — computed result', () => {
  it('substitutes the hypothetical rate through the engine-resolved baseline, citing the dataset version and the HYPOTHETICAL disclaimer', async () => {
    const { db, d1 } = openMigratedD1();
    const ruleId = seedBeerRule(db);
    const app = whatIfApp();

    const res = await postWhatIf(app, whatIfEnv(d1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as WhatIfJson;

    // Baseline version cited (spec) + the scenario rate echoed.
    expect(body.hypotheticalRate).toBe(18.1);
    expect(body.baselineTaxDatasetVersion).toBe('v3.0-2026');

    // Hand-computed vector (PER_CENTILITRE_ETHANOL, rate 36.20 €/cl):
    //   baseline 36.20 × 0.047 × 1 l = 1.7014 €  → 170 c
    //   hypothetical 18.10 × 0.047 × 1 l = 0.8507 € → 85 c
    expect(body.lines).toHaveLength(1);
    const line = body.lines[0];
    expect(line.id).toBe('beer-05');
    expect(line.category).toBe('beer');
    expect(line.importTotalBaselineCents).toBe(89 + 170);
    expect(line.importTotalHypotheticalCents).toBe(89 + 85);
    expect(line.gapBaselineCents).toBe(89 + 170 - 1298);
    expect(line.gapHypotheticalCents).toBe(89 + 85 - 1298);
    expect(line.gapDeltaCents).toBe(85 - 170);
    expect(line.baseline).toEqual({
      formulaRef: 'PER_CENTILITRE_ETHANOL',
      rateApplied: 36.2 * 0.047,
      taxCents: 170,
      taxDatasetVersion: 'v3.0-2026',
      ruleId,
      reliability: 'VERIFIED',
    });
    expect(line.hypothetical).toEqual({
      formulaRef: 'PER_CENTILITRE_ETHANOL',
      rate: 18.1,
      rateApplied: 18.1 * 0.047,
      taxCents: 85,
    });

    expect(body.totals).toEqual({
      baselineExciseCents: 170,
      hypotheticalExciseCents: 85,
      gapBaselineCents: 89 + 170 - 1298,
      gapHypotheticalCents: 89 + 85 - 1298,
    });

    // Structural HYPOTHETICAL disclaimer travels ON the result (spec):
    // stronger-than-calculator wording, naming what the output is NOT.
    expect(body.disclaimer.language).toBe('en');
    expect(body.disclaimer.version).toBe('1.0');
    expect(body.disclaimer.text).toMatch(/^Hypothetical calculation:/u);
    expect(body.disclaimer.text).toContain('not a forecast');
    expect(body.disclaimer.text).toContain('not an estimate of future prices');
    expect(body.disclaimer.text).toContain('not an official statement');
  });

  it('falls back to the engine zero-rate baseline when no rule covers the category', async () => {
    const { d1 } = openMigratedD1(); // no tax rules seeded at all
    const app = whatIfApp();

    const res = await postWhatIf(app, whatIfEnv(d1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as WhatIfJson;

    // computeFallback parity: ruleId null, version FALLBACK, ESTIMATED,
    // zero baseline — the hypothetical rate still substitutes cleanly.
    expect(body.baselineTaxDatasetVersion).toBe('FALLBACK');
    const line = body.lines[0];
    expect(line.baseline).toEqual({
      formulaRef: 'PER_CENTILITRE_ETHANOL',
      rateApplied: 0,
      taxCents: 0,
      taxDatasetVersion: 'FALLBACK',
      ruleId: null,
      reliability: 'ESTIMATED',
    });
    expect(line.hypothetical.taxCents).toBe(85);
  });
});

// ---------------------------------------------------------------------------
// Share token — round-trip fidelity, identity, tamper rejection
// ---------------------------------------------------------------------------

describe('what-if share token codec', () => {
  it('round-trips the response token back to the exact scenario inputs', async () => {
    const { db, d1 } = openMigratedD1();
    seedBeerRule(db);
    const app = whatIfApp();

    const res = await postWhatIf(app, whatIfEnv(d1));
    const body = (await res.json()) as WhatIfJson;

    const decoded = decodeWhatIfShareToken(body.shareToken);
    expect(decoded).toEqual({
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
    });
  });

  it('is deterministic — encode(decode(token)) is the identity', () => {
    const token = encodeWhatIfShareToken(SCENARIO);
    expect(decodeWhatIfShareToken(token)).toEqual(SCENARIO);
    expect(encodeWhatIfShareToken(decodeWhatIfShareToken(token))).toBe(token);
  });

  it('round-trips non-ASCII product ids (UTF-8 safe)', () => {
    const token = encodeWhatIfShareToken({
      hypotheticalRate: 5,
      products: [{ ...SCENARIO.products[0], id: 'olut-ä 3,5 %' }],
    });
    expect(decodeWhatIfShareToken(token).products[0].id).toBe('olut-ä 3,5 %');
  });

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
  ])('rejects tampering/corruption: %s', (_label, tamper) => {
    const token = encodeWhatIfShareToken(SCENARIO);
    expect(() => decodeWhatIfShareToken(tamper(token))).toThrow(WhatIfShareTokenError);
  });

  it('rejects a validly-checksummed payload that violates the request bounds', () => {
    // encode takes the scenario at face value; decode re-validates
    // against the SAME zod bounds the POST endpoint enforces.
    const token = encodeWhatIfShareToken({
      hypotheticalRate: -5,
      products: SCENARIO.products,
    });
    expect(() => decodeWhatIfShareToken(token)).toThrow(WhatIfShareTokenError);
  });

  it('rejects oversized tokens before parsing', () => {
    expect(() => decodeWhatIfShareToken(`wi1.${'e'.repeat(10_000)}.0`)).toThrow(
      WhatIfShareTokenError,
    );
  });
});

// ---------------------------------------------------------------------------
// Ephemeral architecture — no scenario storage, recompute every time
// ---------------------------------------------------------------------------

describe('POST /api/v1/what-if/excise — ephemeral by design', () => {
  it('recomputes identical payloads fresh every time (no idempotency store, no cache)', async () => {
    const { db, d1 } = openMigratedD1();
    seedBeerRule(db);
    const app = whatIfApp();
    const env = whatIfEnv(d1);

    for (let i = 0; i < 3; i++) {
      const res = await postWhatIf(app, env);
      expect(res.status).toBe(200);
      // No cache semantics on the response — the trip/calculator routes
      // stamp X-Cache; the what-if route deliberately does not.
      expect(res.headers.get('X-Cache')).toBeNull();
      const body = (await res.json()) as WhatIfJson;
      expect(body.lines[0].baseline.taxCents).toBe(170);
      expect(body.shareToken).toBe(encodeWhatIfShareToken(SCENARIO));
    }
  });
});

// ---------------------------------------------------------------------------
// Rate-limit profile — CALCULATOR (10/min)
// ---------------------------------------------------------------------------

describe('POST /api/v1/what-if/excise — rate-limit profile', () => {
  it('admits ten requests per minute per IP (CALCULATOR) and rejects the eleventh with 429', async () => {
    const { db, d1 } = openMigratedD1();
    seedBeerRule(db);
    const app = whatIfApp();
    const env = whatIfEnv(d1); // one shared env = one shared DO limiter bucket

    for (let i = 0; i < 10; i++) {
      const res = await postWhatIf(app, env);
      expect(res.status).toBe(200);
    }

    const eleventh = await postWhatIf(app, env);
    await expectEnvelope(eleventh, 429, { error: 'TooManyRequests' });
    expect(eleventh.headers.get('Retry-After')).not.toBeNull();
  });
});
