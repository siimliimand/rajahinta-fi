/**
 * API integration tests for GET /api/v1/reports/:recordId (task 6.2,
 * change phase2-advanced-features).
 *
 * Boots the real NestJS HTTP app (golden-dataset convention — real modules
 * and guards, an in-memory calculation-record query port double, no
 * vi.fn()):
 *
 *   - all three formats over HTTP incl. content-type / disposition headers
 *     and the structural disclaimer (CSV escaping round-trips through a
 *     quote-aware parser — the fixture disclaimer contains a comma, double
 *     quotes, and a CRLF)
 *   - entitlement 403 for FREE tier (forced via the account context the
 *     auth stand-in attaches from x-test-tier), anonymous 403, age-gate 403
 *   - flag-off 403 on a second app booted with FF_ADVANCED_FEATURES unset
 *   - 400 for an unsupported format, 404 for an unknown record
 *   - rate limiting: exhausting the real in-memory DECLARATION limiter
 *     (20 req/min) through the full stack yields 429 + Retry-After
 *
 * The harness wires an auth stand-in middleware that derives request.user
 * from a test header — the same contract production auth middleware will
 * provide for EntitlementGuard.
 *
 * @module ReportsApiIntegrationTest
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type {
  CalculationRecordData,
  ICalculationRecordQueryPort,
} from '@rajahinta/core-domain';
import { EntitlementModule } from '@rajahinta/core-domain';
import {
  FeatureFlagsModule,
  RateLimitingModule,
  AgeGateModule,
  ReportsModule,
  RATE_LIMITER,
  InMemoryRateLimiter,
} from '@rajahinta/application-api';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RECORD_ID = 4242;

/** Disclaimer carrying every RFC-4180 escape trigger. */
const ESCAPABLE_DISCLAIMER =
  'Estimate only, "unofficial" —\r\nsee vero.fi for the authoritative figure.';

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

/** In-memory record-query port double (plain class for ReportsModule.forRoot). */
class InMemoryCalculationRecordQueryPort implements ICalculationRecordQueryPort {
  async findById(id: number): Promise<CalculationRecordData | null> {
    return id === RECORD_ID ? RECORD : null;
  }
}

/** Permissive rate limiter — never throttles (e2e convention; async per IRateLimiter). */
const NEVER_RATE_LIMIT = {
  check: async () => true,
  remaining: async () => 999,
  resetAt: async () => Date.now() + 60_000,
};

/**
 * Auth stand-in: production derives request.user from the session auth
 * guard. The optional x-test-tier header mirrors the tier field the real
 * guard attaches from the account record (EntitlementService accepts
 * AccountContext | string | null).
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
        recordQueryPort: InMemoryCalculationRecordQueryPort,
      }),
    ],
  });

  if (!options.realRateLimiter) {
    builder.overrideProvider(RATE_LIMITER).useValue(NEVER_RATE_LIMIT);
  } else {
    // The un-overridden backend selects Redis when the shared client is
    // registered, which this suite never wants — pin the real in-memory
    // implementation explicitly (async IRateLimiter, per-process windows).
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

describe('GET /api/v1/reports/:recordId — flag on', () => {
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
      // Tier resolves from the account context the auth stand-in attaches
      // from x-test-tier — mirroring a FREE account row (the per-user
      // ENTITLEMENT_TIER_<USERID> env override no longer exists).
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

  it('returns 404 for an unknown record id', async () => {
    const res = await get('/api/v1/reports/999999').expect(404);
    expect(res.body.message).toContain('Calculation record 999999 not found');
  });

  it('returns 404 for an unknown record in csv format too', async () => {
    await get('/api/v1/reports/999999?format=csv').expect(404);
  });
});

// ---------------------------------------------------------------------------
// Flag-off gate — the endpoint must stay dark while the rollout flag is off
// ---------------------------------------------------------------------------

describe('GET /api/v1/reports/:recordId — flag off', () => {
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

describe('GET /api/v1/reports/:recordId — DECLARATION rate limit (real limiter)', () => {
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
