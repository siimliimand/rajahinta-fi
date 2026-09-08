/**
 * Shop-blacklist report + warnings route tests (task 2.2, change
 * trust-and-reach-roadmap) over the FULL app composition on the fake-D1
 * harness.
 *
 * Pins (spec merchant-blacklist):
 * - guard order: POST /api/v1/reports answers anonymous callers with the
 *   401 session envelope (the AUTH limiter composes ahead, sessionAuth
 *   denies);
 * - evidence validation rejects incomplete evidence with NOTHING stored
 *   (typed core-domain reason in the envelope);
 * - accepted reports land OPEN, bound to the session account, with an
 *   audit event appended;
 * - `merchantWarnings` is STRICTLY ADDITIVE on product detail and
 *   search/compare responses: with the merchantWarnings key removed, the
 *   response is identical whether zero, one, or many warnings are
 *   present — offers, order, and totals untouched.
 *
 * @module MerchantReportsRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  issueSessionToken,
  openMigratedD1,
  permissiveEnv,
  request,
  seedAccount,
  seedOffer,
  seedProduct,
} from './harness';
import { WorkerAuditService } from '../../adapters/audit';
import { D1BlacklistRepository } from '../../../../../packages/data-platform/src/repositories/d1/blacklist.repository';
import { D1ShopReportRepository } from '../../../../../packages/data-platform/src/repositories/d1/shop-report.repository';

const AGE = { 'x-age-confirmed': 'confirmed' };

/** Seed one account (the reporter) and return a session cookie value. */
async function reporterSetup(): Promise<{
  db: ReturnType<typeof openMigratedD1>['db'];
  d1: ReturnType<typeof openMigratedD1>['d1'];
  cookie: string;
}> {
  const { db, d1 } = openMigratedD1();
  seedAccount(db, { id: 7, userId: 'user-7', email: 'user-7@example.invalid', tier: 'FREE' });
  const token = await issueSessionToken(d1, 7);
  return { db, d1, cookie: `rajahinta_session=${token}` };
}

const validBody = {
  merchantDomain: 'WWW.Example.com',
  merchantName: 'Example Oy',
  orderReference: 'ORD-123',
  correspondenceSummary: 'Ordered 2026-08-01, never delivered, no refund.',
};

describe('POST /api/v1/reports — guard chain', () => {
  it('rejects an anonymous caller with the 401 session envelope', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    await expectEnvelope(res, 401, { error: 'SessionRequired' });
  });
});

describe('POST /api/v1/reports — evidence + persistence', () => {
  it('stores an OPEN report bound to the session account (identity normalized)', async () => {
    const { d1, cookie } = await reporterSetup();
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: number;
      merchantDomain: string;
      merchantNameNormalized: string;
      status: string;
    };
    // Identity stored NORMALIZED (domain case/www folded, name casefolded).
    expect(body.merchantDomain).toBe('example.com');
    expect(body.merchantNameNormalized).toBe('example oy');
    expect(body.status).toBe('OPEN');

    const stored = await new D1ShopReportRepository(d1).findById(body.id);
    expect(stored).not.toBeNull();
    expect(stored!.reporterAccountId).toBe(7);
    expect(stored!.orderReference).toBe('ORD-123');
  });

  it('appends an audit event (identity + shape, never the evidence text)', async () => {
    const { d1, cookie } = await reporterSetup();
    const app = buildApp();

    await request(app, permissiveEnv(d1), '/api/v1/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(validBody),
    });

    const entries = await new WorkerAuditService(d1).queryChanges({ limit: 10 });
    const event = entries.find((e) => e.entityType === 'shop_report');
    expect(event).toBeDefined();
    expect(event!.action).toBe('created');
    expect(event!.author).toBe('user-7');
    expect(JSON.stringify(event!.newValue)).toContain('example.com');
    expect(JSON.stringify(event!.newValue)).not.toContain('ORD-123');
    expect(JSON.stringify(event!.newValue)).not.toContain('never delivered');
  });

  it.each([
    ['missing order reference', { ...validBody, orderReference: undefined }, 'ValidationError'],
    ['missing correspondence summary', { ...validBody, correspondenceSummary: '' }, 'ValidationError'],
    ['whitespace-only evidence', { ...validBody, orderReference: '   ' }, 'MISSING_ORDER_REFERENCE'],
    ['unusable domain', { ...validBody, merchantDomain: 'not a domain' }, 'INVALID_MERCHANT_DOMAIN'],
    ['blank name', { ...validBody, merchantName: '   ' }, 'INVALID_MERCHANT_NAME'],
  ])('rejects %s with 400 and stores nothing', async (_label, body, expectedError) => {
    const { d1, cookie } = await reporterSetup();
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
    await expectEnvelope(res, 400, { error: expectedError });

    const open = await new D1ShopReportRepository(d1).findByReporterAccountId(7);
    expect(open).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// merchantWarnings — additive join (spec: byte-identical 0/1/many)
// ---------------------------------------------------------------------------

interface DetailBody {
  product: { id: number };
  offers: unknown[];
  merchantWarnings?: unknown;
  merchantReliability?: unknown;
}

/** Remove the warnings key — the byte-identity comparison base. */
function stripWarnings(body: DetailBody): Omit<DetailBody, 'merchantWarnings'> {
  const { merchantWarnings: _omitted, ...rest } = body;
  return rest;
}

/**
 * Strip the informational reliability embed's `computedAt` freshness
 * stamp — it is read-time metadata (differing milliseconds between two
 * fetches), not a calculated value; the comparison targets offers,
 * order, and totals.
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

async function setupProductWithOffers(): Promise<ReturnType<typeof openMigratedD1>> {
  const { db, d1 } = openMigratedD1();
  seedProduct(db, { id: 1, name: 'Karhu III' });
  seedOffer(db, { id: 11, productId: 1, merchant: 'www.Example.com' });
  seedOffer(db, { id: 12, productId: 1, merchant: 'Alko' });
  seedOffer(db, { id: 13, productId: 1, merchant: 'Example Oy Ab' });
  return { db, d1 };
}

async function getDetail(env: ReturnType<typeof permissiveEnv>): Promise<DetailBody> {
  const app = buildApp();
  const res = await request(app, env, '/api/v1/products/1', { headers: AGE });
  expect(res.status).toBe(200);
  return (await res.json()) as DetailBody;
}

describe('merchantWarnings join — product detail', () => {
  it('zero published entries: the block is present and empty', async () => {
    const { d1 } = await setupProductWithOffers();
    const body = await getDetail(permissiveEnv(d1));
    expect(body.merchantWarnings).toEqual([]);
  });

  it('one entry: the warning joins without touching offers or totals', async () => {
    const { d1 } = await setupProductWithOffers();
    const before = stripWarnings(await getDetail(permissiveEnv(d1)));

    await new D1BlacklistRepository(d1).publish({
      merchantIdentity: { domain: 'example.com', name: 'example oy' },
      standardMet: 'CONFIRMED_NON_DELIVERY_REPORTS',
      publishedBy: 'ops',
    });

    const after = await getDetail(permissiveEnv(d1));
    // Identical base response — byte-for-byte JSON equality after the
    // additive key is removed (and the reliability embed's read-time
    // freshness stamp is normalized away).
    expect(JSON.stringify(normalizeVolatile(stripWarnings(after)))).toBe(
      JSON.stringify(normalizeVolatile(before)),
    );
    expect(after.merchantWarnings).toHaveLength(1);
    expect(after.merchantWarnings).toMatchObject([
      {
        merchantDomain: 'example.com',
        merchantName: 'example oy',
        standardMet: 'CONFIRMED_NON_DELIVERY_REPORTS',
        methodologyUrl: '/ranking',
      },
    ]);
  });

  it('many entries: domain OR normalized-name matches all join', async () => {
    const { d1 } = await setupProductWithOffers();
    const repo = new D1BlacklistRepository(d1);
    await repo.publish({
      merchantIdentity: { domain: 'example.com', name: 'unrelated name' },
      standardMet: 'CONFIRMED_NON_DELIVERY_REPORTS',
      publishedBy: 'ops',
    });
    await repo.publish({
      merchantIdentity: { domain: 'some-other-domain.invalid', name: 'example oy ab' },
      standardMet: 'CONFIRMED_INVALID_BUSINESS_REGISTRATION',
      publishedBy: 'ops',
    });

    const body = await getDetail(permissiveEnv(d1));
    expect(body.merchantWarnings).toHaveLength(2);
    const domains = (body.merchantWarnings as { merchantDomain: string }[]).map(
      (w) => w.merchantDomain,
    );
    expect(domains).toContain('example.com');
    expect(domains).toContain('some-other-domain.invalid');
  });

  it('REOPENED entries never warn (appeal removes display immediately)', async () => {
    const { d1 } = await setupProductWithOffers();
    const repo = new D1BlacklistRepository(d1);
    const entry = await repo.publish({
      merchantIdentity: { domain: 'example.com', name: 'example oy' },
      standardMet: 'CONFIRMED_NON_DELIVERY_REPORTS',
      publishedBy: 'ops',
    });
    await repo.appeal(entry.id, { appealedAt: new Date(), appealReason: 'dispute' });

    const body = await getDetail(permissiveEnv(d1));
    expect(body.merchantWarnings).toEqual([]);
  });
});

describe('merchantWarnings join — search + compare (?ids=)', () => {
  it('search responses carry warnings for the page products offer merchants', async () => {
    const { d1 } = await setupProductWithOffers();
    await new D1BlacklistRepository(d1).publish({
      merchantIdentity: { domain: 'example.com', name: 'no-name-match' },
      standardMet: 'CONFIRMED_NON_DELIVERY_REPORTS',
      publishedBy: 'ops',
    });

    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/products?ids=1', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: number; eurPerGram: unknown }>;
      total: number;
      merchantWarnings: unknown[];
    };
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.merchantWarnings).toHaveLength(1);
    expect(body.merchantWarnings[0]).toMatchObject({ merchantDomain: 'example.com' });
  });

  it('the search base response is byte-identical with zero and one warnings', async () => {
    const { d1 } = await setupProductWithOffers();
    const app = buildApp();

    const fetchSearch = async (): Promise<{ base: string; warnings: unknown }> => {
      const res = await request(app, permissiveEnv(d1), '/api/v1/products?ids=1', {
        headers: AGE,
      });
      const body = (await res.json()) as {
        merchantWarnings?: unknown;
        [key: string]: unknown;
      };
      const { merchantWarnings, ...rest } = body;
      return { base: JSON.stringify(rest), warnings: merchantWarnings };
    };

    const zero = await fetchSearch();
    expect(zero.warnings).toEqual([]);

    await new D1BlacklistRepository(d1).publish({
      merchantIdentity: { domain: 'example.com', name: 'no-name-match' },
      standardMet: 'CONFIRMED_NON_DELIVERY_REPORTS',
      publishedBy: 'ops',
    });

    const one = await fetchSearch();
    expect(one.warnings).toHaveLength(1);
    expect(one.base).toBe(zero.base);
  });
});
