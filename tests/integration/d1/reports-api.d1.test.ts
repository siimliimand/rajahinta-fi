/**
 * API integration tests for GET /api/v1/reports/:recordId on D1 (task 2.7,
 * change migrate-to-cloudflare). D1 port of
 * tests/integration/reports-api.test.ts; the pg original stays untouched
 * until cutover.
 *
 * Same proof as the original — all three formats over HTTP incl.
 * content-type / disposition headers and the structural disclaimer (CSV
 * escaping round-trips through a quote-aware parser), entitlement 403s,
 * flag-off 403, 400/404, and the real DECLARATION limiter exhausting at 20
 * req/min — with one upgrade: the calculation-record query port reads from
 * a REAL D1 database (migrations applied, row seeded through the real
 * D1CalculationRecordRepository write path), so the 404 case exercises a
 * genuinely-missing row instead of an in-memory double returning null.
 *
 * The D1 record-query adapter below is test-local (the production adapter
 * is phase-3 wiring); its mapping mirrors the documented production rules:
 * the record joins product_master / transport_offers / tax_rules (port
 * contract: "adapters join the calculation record with the product master
 * and transport offer as needed"), figures are summed per category from
 * the persisted ItemizedCost[] breakdown exactly like
 * calculation-result.mapper.ts, and the disclaimer JSON round-trips through
 * parseDisclaimer's contract. Classification is not persisted (mapper
 * doctrine: derive nothing); the adapter derives it from the transport
 * join — carrier present = DistanceSelling — which the eventual production
 * adapter must own.
 *
 * @module ReportsApiD1IntegrationTest
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type {
  CalculationRecordData,
  ICalculationRecordQueryPort,
} from '@rajahinta/core-domain';
import { Injectable } from '@nestjs/common';
import { EntitlementModule } from '@rajahinta/core-domain';
import {
  FeatureFlagsModule,
  RateLimitingModule,
  AgeGateModule,
  ReportsModule,
  RATE_LIMITER,
  InMemoryRateLimiter,
} from '@rajahinta/application-api';

import { openMigratedD1 } from './harness';
import { D1CalculationRecordRepository } from '../../../packages/data-platform/src/repositories/d1/calculation-record.repository';
import type { D1DatabaseLike } from '../../../packages/data-platform/src/d1/executor';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RECORD_ID = 4242;
const PRODUCT_ID = 4001;
const TRANSPORT_OFFER_ID = 700;
const EXCISE_RULE_ID = 300;

/** Disclaimer carrying every RFC-4180 escape trigger. */
const ESCAPABLE_DISCLAIMER =
  'Estimate only, "unofficial" —\r\nsee vero.fi for the authoritative figure.';

/** The record the D1 row must reconstruct — identical to the pg fixture. */
const RECORD: CalculationRecordData = {
  id: RECORD_ID,
  productName: 'Premium Lager 5%',
  productBrand: 'Golden Brewery',
  productCategory: 'beer',
  alcoholByVolume: 0.05,
  volumeLitres: 0.5,
  containerType: 'can',
  depositSystemStatus: true,
  quantity: 6,
  transportCarrier: 'beverage-de',
  transportOrigin: 'DE',
  transportDestination: 'FI',
  alcoholExciseCents: 100,
  containerDutyCents: 0,
  totalCents: 2000,
  confidence: 'HIGH',
  classification: 'DistanceSelling',
  disclaimerText: ESCAPABLE_DISCLAIMER,
  disclaimerLanguage: 'en',
  disclaimerVersion: '1.0.0',
  calculationTimestamp: '2026-08-20T12:00:00.000Z',
  exciseRuleVersionLabel: '2026-01',
  containerDutyRuleVersionLabel: null,
};

// ---------------------------------------------------------------------------
// D1 handle + test-local record-query adapter (see module doc)
// ---------------------------------------------------------------------------

let sharedD1: D1DatabaseLike | null = null;

function getD1(): D1DatabaseLike {
  if (sharedD1 === null) {
    throw new Error('D1 harness not booted — beforeAll has not run');
  }
  return sharedD1;
}

/** Figure categories the calculator persists into breakdown (mapper contract). */
function sumBreakdownCategory(breakdown: unknown, category: string): number {
  if (!Array.isArray(breakdown)) return 0;
  return breakdown
    .map((entry) => entry as { category?: unknown; cents?: unknown })
    .filter((entry) => entry.category === category && typeof entry.cents === 'number')
    .reduce((sum, entry) => sum + (entry.cents as number), 0);
}

@Injectable()
class D1CalculationRecordQueryPort implements ICalculationRecordQueryPort {
  async findById(id: number): Promise<CalculationRecordData | null> {
    const row = await getD1()
      .prepare(
        `SELECT c.id, c.quantity, c.total_cents, c.confidence, c.breakdown,
                c.disclaimer, c.calculated_at,
                p.name AS product_name, p.brand AS product_brand,
                p.category AS product_category, p.alcohol_by_volume,
                p.unit_volume, p.container_type, p.deposit_system_status,
                t.carrier AS transport_carrier, t.origin_country,
                t.destination_country,
                tx.version_label AS excise_version_label,
                td.version_label AS container_version_label
           FROM calculation_records c
           JOIN product_master p ON p.id = c.product_master_id
           LEFT JOIN transport_offers t ON t.id = c.transport_offer_id
           LEFT JOIN tax_rules tx ON tx.id = c.excise_rule_version_id
           LEFT JOIN tax_rules td ON td.id = c.container_duty_rule_version_id
          WHERE c.id = ?`,
      )
      .bind(id)
      .first<Record<string, unknown>>();
    if (!row) return null;

    const carrier = row.transport_carrier as string | null;
    return {
      id: row.id as number,
      productName: row.product_name as string,
      productBrand: (row.product_brand as string | null) ?? null,
      productCategory: row.product_category as string,
      alcoholByVolume: (row.alcohol_by_volume as number | null) ?? 0,
      volumeLitres: (row.unit_volume as number | null) ?? 0,
      containerType: row.container_type as string,
      depositSystemStatus:
        row.deposit_system_status === null
          ? null
          : Number(row.deposit_system_status) === 1,
      quantity: row.quantity as number,
      transportCarrier: carrier,
      transportOrigin: (row.origin_country as string | null) ?? null,
      transportDestination: (row.destination_country as string | null) ?? null,
      alcoholExciseCents: sumBreakdownCategory(
        JSON.parse(row.breakdown as string),
        'alcoholExciseEstimate',
      ),
      containerDutyCents: sumBreakdownCategory(
        JSON.parse(row.breakdown as string),
        'containerDutyEstimate',
      ),
      totalCents: row.total_cents as number,
      confidence: row.confidence as CalculationRecordData['confidence'],
      // Not persisted (mapper doctrine) — derived from the transport join;
      // the production adapter owns this mapping (module doc).
      classification:
        carrier !== null ? 'DistanceSelling' : 'DistanceBuying',
      disclaimerText: JSON.parse(row.disclaimer as string).text as string,
      disclaimerLanguage: JSON.parse(row.disclaimer as string)
        .language as CalculationRecordData['disclaimerLanguage'],
      disclaimerVersion: JSON.parse(row.disclaimer as string).version as string,
      calculationTimestamp: row.calculated_at as string,
      exciseRuleVersionLabel:
        (row.excise_version_label as string | null) ?? null,
      containerDutyRuleVersionLabel:
        (row.container_version_label as string | null) ?? null,
    };
  }
}

// ---------------------------------------------------------------------------
// Seed — through the real D1 write path
// ---------------------------------------------------------------------------

async function seedRecordRow(): Promise<void> {
  const d1 = getD1();
  await d1
    .prepare(
      `INSERT INTO product_master (id, name, manufacturer, brand, category,
          alcohol_by_volume, unit_volume, container_type, regulatory_classification,
          deposit_system_status, ean)
       VALUES (?, 'Premium Lager 5%', 'Golden Brewery', 'Golden Brewery', 'beer',
               0.05, 0.5, 'can', 'beer', 1, NULL)`,
    )
    .bind(PRODUCT_ID)
    .run();

  await d1
    .prepare(
      `INSERT INTO transport_offers (id, carrier, origin_country, destination_country,
          weight_min_kg, weight_max_kg, package_tier, price_cents, currency,
          seller_involvement_indicator, refreshed_at, reliability_status)
       VALUES (?, 'beverage-de', 'DE', 'FI', 0, 1, 'parcel', 150, 'EUR', 1,
               '2026-01-01T00:00:00Z', 'VERIFIED')`,
    )
    .bind(TRANSPORT_OFFER_ID)
    .run();

  await d1
    .prepare(
      `INSERT INTO tax_rules (id, tax_type, product_category, rate, effective_from,
          effective_to, exemption_conditions, calculation_formula_reference,
          official_source, verification_date, version_label)
       VALUES (?, 'excise', 'beer', 40.00, '2026-01-02T00:00:00Z', NULL, NULL,
               'PER_DEGREE_PLATO', 'Finnish Tax Administration (vero.fi) — d1 fixture',
               '2024-03-01T00:00:00Z', '2026-01')`,
    )
    .bind(EXCISE_RULE_ID)
    .run();

  // The write path the calculator uses: breakdown = ItemizedCost[],
  // disclaimer = JSON.stringify(Disclaimer).
  await new D1CalculationRecordRepository(d1).create({
    id: RECORD_ID,
    productMasterId: PRODUCT_ID,
    retailOfferIds: [1],
    transportOfferId: TRANSPORT_OFFER_ID,
    exciseRuleVersionId: EXCISE_RULE_ID,
    containerDutyRuleVersionId: null,
    totalCents: 2000,
    breakdown: [
      { label: 'Retail price', category: 'foreignRetailPrice', cents: 1900, reliability: 'VERIFIED' },
      { label: 'Alcohol excise', category: 'alcoholExciseEstimate', cents: 100, reliability: 'VERIFIED' },
      { label: 'Container duty', category: 'containerDutyEstimate', cents: 0, reliability: 'EXEMPTED' },
    ],
    confidence: 'HIGH',
    quantity: 6,
    destination: 'FI',
    disclaimer: JSON.stringify({
      text: ESCAPABLE_DISCLAIMER,
      language: 'en',
      version: '1.0.0',
    }),
    sessionId: null,
    calculatedAt: new Date('2026-08-20T12:00:00.000Z'),
  });
}

// ---------------------------------------------------------------------------
// App harness (identical to the pg suite, with the D1 query port bound)
// ---------------------------------------------------------------------------

/** Permissive rate limiter — never throttles (e2e convention; async per IRateLimiter). */
const NEVER_RATE_LIMIT = {
  check: async () => true,
  remaining: async () => 999,
  resetAt: async () => Date.now() + 60_000,
};

/**
 * Auth stand-in: production derives request.user from the session auth
 * guard. The optional x-test-tier header mirrors the tier field the real
 * guard attaches from the account record.
 */
function applyAuthStandIn(app: INestApplication): void {
  app.use((req: unknown, _res: unknown, next: () => void) => {
    const headers = (req as { headers?: Record<string, string> }).headers;
    const id = headers?.['x-test-user'];
    const tier = headers?.['x-test-tier'];
    if (typeof id === 'string' && id.length > 0) {
      (req as { user?: { id: string; userId?: string; tier?: string } }).user =
        typeof tier === 'string' && tier.length > 0
          ? { id, userId: id, tier }
          : { id };
    }
    next();
  });
}

interface AppOptions {
  /** FF_ADVANCED_FEATURES state at FeatureFlagService construction time. */
  flagOn: boolean;
  /** Keep a real (in-memory) limiter backend (rate-limit describe only). */
  realRateLimiter?: boolean;
}

async function createApp(options: AppOptions): Promise<INestApplication> {
  if (options.flagOn) process.env.FF_ADVANCED_FEATURES = 'true';
  else delete process.env.FF_ADVANCED_FEATURES;

  const builder = Test.createTestingModule({
    imports: [
      FeatureFlagsModule,
      RateLimitingModule,
      AgeGateModule,
      EntitlementModule,
      ReportsModule.forRoot({
        recordQueryPort: D1CalculationRecordQueryPort,
      }),
    ],
  });

  if (!options.realRateLimiter) {
    builder.overrideProvider(RATE_LIMITER).useValue(NEVER_RATE_LIMIT);
  } else {
    // Pin the real in-memory implementation explicitly (async IRateLimiter,
    // per-process windows) — the un-overridden backend would want Redis.
    builder.overrideProvider(RATE_LIMITER).useValue(new InMemoryRateLimiter());
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  applyAuthStandIn(app);
  await app.init();
  return app;
}

/** Standard happy-path request headers (premium user + age confirmation). */
const PREMIUM_HEADERS = {
  'x-test-user': 'reports-premium-user',
  'x-age-confirmed': 'test-token',
};

/**
 * Quote-aware RFC-4180 parser — proves the CSV escaping round-trips.
 * (Same helper shape as the unit suite; tests do not import each other.)
 */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  while (i < csv.length) {
    const ch = csv[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r' && csv[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 2;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Suite — flag on, permissive limiter
// ---------------------------------------------------------------------------

// D1 harness + seeded record live at FILE scope: every describe below boots
// its own Nest app but shares the one seeded database (the rate-limit suite
// serves real records too).
let db: Awaited<ReturnType<typeof openMigratedD1>>['db'];

beforeAll(async () => {
  const opened = openMigratedD1();
  db = opened.db;
  sharedD1 = opened.d1;
  await seedRecordRow();
});

afterAll(() => {
  sharedD1 = null;
  db.close();
});

describe('GET /api/v1/reports/:recordId on D1 — flag on', () => {
  let app: INestApplication;
  const originalEnv = process.env;

  beforeAll(async () => {
    app = await createApp({ flagOn: true });
  });

  afterAll(async () => {
    await app?.close();
    process.env = originalEnv;
  });

  const get = (path: string, headers: Record<string, string> = PREMIUM_HEADERS) =>
    request(app.getHttpServer()).get(path).set(headers);

  // -------------------------------------------------------------------
  // JSON (default)
  // -------------------------------------------------------------------

  it('serves the lossless JSON mirror by default', async () => {
    const res = await get(`/api/v1/reports/${RECORD_ID}`).expect(200);

    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.format).toBe('json');
    expect(res.body.recordId).toBe(RECORD_ID);
    expect(res.body.record).toEqual(RECORD);
    // Disclaimer present as a record field.
    expect(res.body.record.disclaimerText).toBe(ESCAPABLE_DISCLAIMER);
  });

  it('explicit format=json behaves identically', async () => {
    const res = await get(`/api/v1/reports/${RECORD_ID}?format=json`).expect(200);
    expect(res.body.record).toEqual(RECORD);
  });

  // -------------------------------------------------------------------
  // CSV
  // -------------------------------------------------------------------

  it('serves text/csv as an attachment with the escaped disclaimer trailing row', async () => {
    const res = await get(`/api/v1/reports/${RECORD_ID}?format=csv`).expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="rajahinta-calculation-${RECORD_ID}.csv"`,
    );

    const rows = parseCsv(res.text);
    // Header + 3 figure rows + structural disclaimer row — the embedded
    // CRLF inside the quoted disclaimer must not split the row.
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain('record_id');
    expect(rows[4]?.[2]).toBe('disclaimer');
    // Escaping round-trips through the quote-aware parser.
    expect(rows[4]?.[8]).toBe(ESCAPABLE_DISCLAIMER);
    // Raw form: quoted with doubled embedded quotes.
    expect(res.text).toContain(`"${ESCAPABLE_DISCLAIMER.replace(/"/g, '""')}"`);
    expect(res.text.endsWith('\r\n')).toBe(true);
  });

  // -------------------------------------------------------------------
  // HTML
  // -------------------------------------------------------------------

  it('serves a self-contained text/html page with a rendered disclaimer block', async () => {
    const res = await get(`/api/v1/reports/${RECORD_ID}?format=html`).expect(200);

    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.text.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(res.text).toContain('class="disclaimer"');
    // HTML-escaped quotes inside the disclaimer text.
    expect(res.text).toContain('Estimate only, &quot;unofficial&quot; —');
    expect(res.text).toContain(`Version ${RECORD.disclaimerVersion}`);
  });

  // -------------------------------------------------------------------
  // Entitlement — 403 for FREE tier and anonymous, 200 for PREMIUM
  // -------------------------------------------------------------------

  describe('entitlement enforcement (calculation:export)', () => {
    const FREE_USER = 'report_free_user';

    it('returns 403 InsufficientEntitlement for a FREE-tier user', async () => {
      const res = await get(`/api/v1/reports/${RECORD_ID}`, {
        ...PREMIUM_HEADERS,
        'x-test-user': FREE_USER,
        'x-test-tier': 'FREE',
      }).expect(403);

      expect(res.body).toMatchObject({
        statusCode: 403,
        error: 'InsufficientEntitlement',
        requiredTier: 'calculation:export',
        currentTier: 'FREE',
      });
    });

    it('returns 403 for anonymous requests (no auth context)', async () => {
      const res = await get(`/api/v1/reports/${RECORD_ID}`, {
        'x-age-confirmed': 'test-token',
      }).expect(403);

      expect(res.body).toMatchObject({
        statusCode: 403,
        currentTier: 'FREE',
      });
    });

    it('an explicit PREMIUM user passes (default for authenticated users)', async () => {
      await get(`/api/v1/reports/${RECORD_ID}?format=csv`).expect(200);
    });
  });

  // -------------------------------------------------------------------
  // Age gate — 403 without a confirmation token
  // -------------------------------------------------------------------

  it('returns 403 when the age-confirmation header is missing', async () => {
    await get(`/api/v1/reports/${RECORD_ID}`, {
      'x-test-user': 'reports-premium-user',
    }).expect(403);
  });

  // -------------------------------------------------------------------
  // Format + record errors
  // -------------------------------------------------------------------

  it('returns 400 for an unsupported format', async () => {
    const res = await get(`/api/v1/reports/${RECORD_ID}?format=pdf`).expect(400);
    expect(res.body.message).toContain('pdf');
  });

  it('returns 404 for a record id missing from D1', async () => {
    const res = await get('/api/v1/reports/999999').expect(404);
    expect(res.body.message).toContain('Calculation record 999999 not found');
  });

  it('returns 404 for a missing record in csv format too', async () => {
    await get('/api/v1/reports/999999?format=csv').expect(404);
  });
});

// ---------------------------------------------------------------------------
// Flag-off gate — the endpoint must stay dark while the rollout flag is off
// ---------------------------------------------------------------------------

describe('GET /api/v1/reports/:recordId on D1 — flag off', () => {
  let flagOffApp: INestApplication;
  const originalEnv = process.env;

  beforeAll(async () => {
    delete process.env.FF_ADVANCED_FEATURES; // default: off
    flagOffApp = await createApp({ flagOn: false });
  });

  afterAll(async () => {
    await flagOffApp?.close();
    process.env = originalEnv;
  });

  it('returns 403 even with a premium user and an age token, in every format', async () => {
    for (const format of ['json', 'csv', 'html']) {
      await request(flagOffApp.getHttpServer())
        .get(`/api/v1/reports/${RECORD_ID}?format=${format}`)
        .set(PREMIUM_HEADERS)
        .expect(403);
    }
  });
});

// ---------------------------------------------------------------------------
// Rate limiting — real DECLARATION profile (20 req/min) through the stack
// ---------------------------------------------------------------------------

describe('GET /api/v1/reports/:recordId on D1 — DECLARATION rate limit (real limiter)', () => {
  let rateLimitApp: INestApplication;
  const originalEnv = process.env;

  beforeAll(async () => {
    // X-Forwarded-For derives the client key only behind a configured
    // proxy (RATE_LIMIT_TRUST_PROXY); supertest sockets all share one IP,
    // so enable the flag for this describe to exercise per-key isolation.
    process.env = { ...originalEnv, RATE_LIMIT_TRUST_PROXY: 'true' };
    rateLimitApp = await createApp({ flagOn: true, realRateLimiter: true });
  });

  afterAll(async () => {
    await rateLimitApp?.close();
    process.env = originalEnv;
  });

  /** Fixed client key so exhaustion is deterministic. */
  const RATE_HEADERS = {
    ...PREMIUM_HEADERS,
    'x-forwarded-for': '203.0.113.77',
  };

  it('serves the first 20 requests then rejects the 21st with 429 + Retry-After', async () => {
    for (let i = 1; i <= 20; i++) {
      const res = await request(rateLimitApp.getHttpServer())
        .get(`/api/v1/reports/${RECORD_ID}?format=json`)
        .set(RATE_HEADERS)
        .expect(200);
      expect(res.body.format).toBe('json');
    }

    const blocked = await request(rateLimitApp.getHttpServer())
      .get(`/api/v1/reports/${RECORD_ID}?format=json`)
      .set(RATE_HEADERS)
      .expect(429);

    expect(blocked.body).toMatchObject({
      statusCode: 429,
      error: 'TooManyRequests',
    });
    expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.body.retryAfterSeconds).toBeLessThanOrEqual(60);

    const retryAfter = blocked.headers['retry-after'];
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it('a different client key is not affected by the exhausted window', async () => {
    await request(rateLimitApp.getHttpServer())
      .get(`/api/v1/reports/${RECORD_ID}?format=json`)
      .set({ ...PREMIUM_HEADERS, 'x-forwarded-for': '203.0.113.88' })
      .expect(200);
  });
});
