/**
 * Compliance test: blacklist-warning additive neutrality (task 9.1,
 * change trust-and-reach-roadmap; spec merchant-blacklist — "Warnings
 * SHALL NOT exclude offers, alter sort order, or modify any calculated
 * value, and output SHALL be byte-identical whether zero, one, or many
 * warnings are present").
 *
 * Deliberately independent of the task-2.2 route-unit suite
 * (apps/api-worker/src/routes/__tests__/merchant-reports.routes.test.ts
 * — the compliance layer's second-opinion role,
 * trip-affiliate-neutrality.test.ts precedent). What this file adds:
 *
 * 1. **Byte-identity across database states, fresh composition each** —
 *    the route-unit suite publishes entries BETWEEN two requests on one
 *    database; here each warning state (0 / 1 / many PUBLISHED
 *    blacklist_entries) is a fully separate composition (own migrated
 *    D1 + full createApp()), with identical product/offer seeds. All
 *    three public warning surfaces are fired in every state — product
 *    detail (GET /api/v1/products/:id), search (GET /api/v1/products?q=)
 *    and compare (GET /api/v1/products?ids=) — and for each surface the
 *    response minus the `merchantWarnings` key must be byte-identical
 *    across all three states. The states are proven real by the warning
 *    blocks themselves (lengths 0 / 1 / 2).
 * 2. **Warning content pins** — one entry joins by domain OR normalized
 *    name; many entries join all matching merchants; every warning
 *    carries the methodology link; a REOPENED entry never warns.
 *
 * Byte-proxy decision: `JSON.stringify` of the response body minus the
 * additive `merchantWarnings` key, with the reliability embed's
 * `computedAt` freshness stamp normalized away — the same two decisions
 * the task-2.2 route suite makes for this exact requirement (computedAt
 * is read-time metadata, differing milliseconds between fetches, not a
 * calculated value). Every seed uses a fixed observedAt, so no other
 * volatility exists between compositions.
 *
 * Harness note: the full app composition (createApp) IS the code under
 * test; imports go by relative path exactly the way
 * trip-affiliate-neutrality.test.ts imports the harness, which
 * tests/compliance/vitest.config.ts resolves.
 *
 * @module WarningsAdditiveNeutralityComplianceTest
 */

import { describe, it, expect } from 'vitest';

import {
  buildApp,
  openMigratedD1,
  permissiveEnv,
  request,
  seedOffer,
  seedProduct,
} from '../../apps/api-worker/src/routes/__tests__/harness';
import { D1BlacklistRepository } from '../../packages/data-platform/src/repositories/d1/blacklist.repository';
import type { D1DatabaseLike } from '../../packages/data-platform/src/d1/executor';

// ---------------------------------------------------------------------------
// Fixtures — identical in every composition; every value deterministic
// ---------------------------------------------------------------------------

const AGE = { 'x-age-confirmed': 'confirmed' };

/** Fixed seed instant — a fresh Date() here would break cross-run bytes. */
const OBSERVED_AT = '2026-01-15T10:00:00.000Z';

/**
 * One product offered by three merchants: 'www.Example.com' (matches an
 * entry by DOMAIN once normalized), 'Alko' (never warned), and
 * 'Example Oy Ab' (matches an entry by NORMALIZED NAME).
 */
function seedWarnableCatalog(db: ReturnType<typeof openMigratedD1>['db']): void {
  seedProduct(db, { id: 1, name: 'Karhu III' });
  seedOffer(db, { id: 11, productId: 1, merchant: 'www.Example.com', observedAt: OBSERVED_AT });
  seedOffer(db, { id: 12, productId: 1, merchant: 'Alko', observedAt: OBSERVED_AT });
  seedOffer(db, { id: 13, productId: 1, merchant: 'Example Oy Ab', observedAt: OBSERVED_AT });
}

interface EntrySpec {
  domain: string;
  name: string;
  standardMet: string;
}

async function publishEntry(d1: D1DatabaseLike, spec: EntrySpec): Promise<void> {
  await new D1BlacklistRepository(d1).publish({
    merchantIdentity: { domain: spec.domain, name: spec.name },
    standardMet: spec.standardMet,
    publishedBy: 'ops-compliance',
  });
}

/** The one-warning state: domain match only. */
const ONE_ENTRY: EntrySpec = {
  domain: 'example.com',
  name: 'no-name-match',
  standardMet: 'CONFIRMED_NON_DELIVERY_REPORTS',
};

/** The many state adds a name-only match for the second warned merchant. */
const MANY_ENTRY: EntrySpec = {
  domain: 'some-other-domain.invalid',
  name: 'example oy ab',
  standardMet: 'CONFIRMED_INVALID_BUSINESS_REGISTRATION',
};

// ---------------------------------------------------------------------------
// Composition + the three warning surfaces
// ---------------------------------------------------------------------------

interface SurfaceBody {
  merchantWarnings?: unknown;
  [key: string]: unknown;
}

/**
 * Build one fully separate composition for a warning state and fire the
 * IDENTICAL detail / search / compare requests against it. Returns each
 * surface's raw body plus its byte proxy (body minus the additive
 * merchantWarnings key, computedAt normalized away).
 */
async function runComposition(
  entries: readonly EntrySpec[],
): Promise<{ detail: SurfaceBody; search: SurfaceBody; compare: SurfaceBody }> {
  const { db, d1 } = openMigratedD1();
  seedWarnableCatalog(db);
  for (const spec of entries) {
    await publishEntry(d1, spec);
  }

  const app = buildApp();
  const env = permissiveEnv(d1);

  const fire = async (path: string): Promise<SurfaceBody> => {
    const res = await request(app, env, path, { headers: AGE });
    expect(res.status).toBe(200);
    return (await res.json()) as SurfaceBody;
  };

  return {
    detail: await fire('/api/v1/products/1'),
    search: await fire('/api/v1/products?q=Karhu'),
    compare: await fire('/api/v1/products?ids=1'),
  };
}

/** Strip the additive key — the byte-identity comparison base. */
function stripWarnings(body: SurfaceBody): SurfaceBody {
  const { merchantWarnings: _omitted, ...rest } = body;
  return rest;
}

/**
 * Remove the reliability embed's read-time `computedAt` stamp — see the
 * byte-proxy decision in the module docs.
 */
function normalizeVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeVolatile);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (key !== 'computedAt') out[key] = normalizeVolatile(v);
    }
    return out;
  }
  return value;
}

function bytes(body: SurfaceBody): string {
  return JSON.stringify(normalizeVolatile(stripWarnings(body)));
}

function warningsOf(body: SurfaceBody): MerchantWarningJson[] {
  expect(Array.isArray(body.merchantWarnings)).toBe(true);
  return body.merchantWarnings as MerchantWarningJson[];
}

interface MerchantWarningJson {
  merchantDomain: string;
  merchantName: string;
  standardMet: string;
  publishedAt: string;
  methodologyUrl: string;
}

// ===========================================================================
// 1. Byte-identity with zero, one, many PUBLISHED entries — all surfaces
//    (spec scenario: "Warning attached without side effects")
// ===========================================================================

describe('merchantWarnings byte-identity across warning states (fresh composition per state)', () => {
  const ZERO: readonly EntrySpec[] = [];

  it('detail, search, and compare responses are byte-identical with zero, one, and many warnings', async () => {
    const zero = await runComposition(ZERO);
    const one = await runComposition([ONE_ENTRY]);
    const many = await runComposition([ONE_ENTRY, MANY_ENTRY]);

    for (const surface of ['detail', 'search', 'compare'] as const) {
      // The response minus the additive key is byte-identical across all
      // three warning states — offers, order, and totals untouched.
      expect(bytes(one[surface]), `${surface}: one vs zero`).toBe(bytes(zero[surface]));
      expect(bytes(many[surface]), `${surface}: many vs zero`).toBe(bytes(zero[surface]));

      // Non-vacuity: the warning blocks themselves differ — the three
      // states are genuinely different database states, and the join is
      // what moved (never the base response).
      expect(warningsOf(zero[surface])).toEqual([]);
      expect(warningsOf(one[surface])).toHaveLength(1);
      expect(warningsOf(many[surface])).toHaveLength(2);
      expect(JSON.stringify(one[surface])).not.toBe(JSON.stringify(zero[surface]));
      expect(JSON.stringify(many[surface])).not.toBe(JSON.stringify(one[surface]));
    }
  });

  it('zero warnings: the block is present and EMPTY on every surface — never omitted', async () => {
    const zero = await runComposition(ZERO);
    for (const surface of ['detail', 'search', 'compare'] as const) {
      expect(zero[surface]).toHaveProperty('merchantWarnings');
      expect(warningsOf(zero[surface])).toEqual([]);
    }
  });

  it('the join matches by domain OR normalized name, carries the methodology link, and never leaks the entry state', async () => {
    const many = await runComposition([ONE_ENTRY, MANY_ENTRY]);

    const compare = warningsOf(many.compare);
    const domains = compare.map((w) => w.merchantDomain).sort();
    expect(domains).toEqual(['example.com', 'some-other-domain.invalid']);
    for (const warning of [...compare, ...warningsOf(many.detail)]) {
      expect(Object.keys(warning).sort()).toEqual([
        'merchantDomain',
        'merchantName',
        'methodologyUrl',
        'publishedAt',
        'standardMet',
      ]);
      expect(warning.methodologyUrl).toBe('/ranking');
      expect(typeof warning.publishedAt).toBe('string');
      expect(Number.isNaN(Date.parse(warning.publishedAt))).toBe(false);
    }
    // Standard-met provenance travels per entry.
    expect(compare.map((w) => w.standardMet).sort()).toEqual([
      'CONFIRMED_INVALID_BUSINESS_REGISTRATION',
      'CONFIRMED_NON_DELIVERY_REPORTS',
    ]);
  });

  it('a REOPENED entry warns on no surface (appeal removes the display immediately)', async () => {
    const { db, d1 } = openMigratedD1();
    seedWarnableCatalog(db);
    const repo = new D1BlacklistRepository(d1);
    const entry = await repo.publish({
      merchantIdentity: { domain: ONE_ENTRY.domain, name: ONE_ENTRY.name },
      standardMet: ONE_ENTRY.standardMet,
      publishedBy: 'ops-compliance',
    });
    await repo.appeal(entry.id, {
      appealedAt: new Date(),
      appealReason: 'compliance appeal',
    });

    const app = buildApp();
    const env = permissiveEnv(d1);
    for (const path of ['/api/v1/products/1', '/api/v1/products?q=Karhu', '/api/v1/products?ids=1']) {
      const res = await request(app, env, path, { headers: AGE });
      expect(res.status).toBe(200);
      const body = (await res.json()) as SurfaceBody;
      expect(warningsOf(body)).toEqual([]);
    }
  });
});
