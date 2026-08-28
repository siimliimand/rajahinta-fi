/**
 * Integration test — durability and scaling coverage (task 4.4, change
 * technical-assessment-remediation, spec mvp-testing "Durability and
 * scaling coverage" + application-api "Redis-backed rate limiting" /
 * "Durable audit trail" / "Durable click analytics").
 *
 * Proves, against REAL infrastructure (one Redis, one PostgreSQL), that
 * the durability fixes compose:
 *
 *   1. Rate limits are shared across two application instances — a
 *      burst from one client split over two replicas throttles at ONE
 *      configured limit, not twice it (sliding-window ZSET in Redis).
 *   2. Audit events written through the real AuditService → durable
 *      DrizzleAuditEventRepository survive a simulated process restart
 *      (old pool torn down, new repository instance, same database).
 *   3. Click counters recorded through the real HTTP redirect endpoint
 *      live in the shared Redis store (they survive a pod rollout) and
 *      are archived to PostgreSQL snapshots that survive Redis data
 *      loss.
 *
 * ## Infrastructure gates
 *
 * - `TEST_DATABASE_URL` — PostgreSQL with migrations 0000-0016 applied
 *   (timescale/timescaledb:2.16.1-pg16 image; see ARCHITECTURE.md §13
 *   and the gdpr-integration.test.ts header for the docker recipe).
 * - `TEST_REDIS_URL` (fallback `REDIS_URL`) — any Redis 7 instance.
 *
 * Without these the suites skip with an explanatory message, so CI
 * without infrastructure stays green (same convention as
 * gdpr-integration.test.ts / product-search.db.test.ts).
 *
 * ## Interpretation note — "counters survive restart" (click analytics)
 *
 * The production contract is "counters survive a ROLLOUT" (pods are
 * replaced, the Redis store is not) plus periodic PostgreSQL snapshots
 * as the durable restore path. The scratch Redis container runs with
 * NO persistence by default, so a literal Redis process restart would
 * wipe it; the Redis-loss test therefore pins the PostgreSQL snapshot
 * restore path (snapshot upsert → counters re-readable from snapshots)
 * while the rollout test pins the shared-store survival directly.
 *
 * Everything runs through real production classes — the RedisModule
 * factory, RedisRateLimiter (sliding-window Lua), RateLimitGuard,
 * OutboundRedirectController, RedisClickAnalyticsService,
 * ClickAnalyticsSnapshotService, AuditService — no vi.fn() mocks.
 *
 * @module DurabilityRestartIntegrationTest
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type Redis from 'ioredis';
import { eq } from 'drizzle-orm';

import { AuditService } from '@rajahinta/core-domain';
import {
  DRIZZLE,
  DataPlatformModule,
  DrizzleProvider,
  auditEvents,
  clickCounterSnapshots,
  productMaster,
  retailOffers,
  type DrizzleDatabase,
} from '@rajahinta/data-platform';
// Deep source imports — the application-api package index has
// partially-undefined re-export cycles under this suite's transpile
// plugin (same class of issue as the core-domain index; see the
// historical-price-flow test header), so classes consumed at
// module-evaluation time come from their defining files directly.
import { OutboundRedirectController } from '../../packages/application-api/src/analytics/outbound-redirect.controller';
import { RateLimitingModule } from '../../packages/application-api/src/rate-limiting/rate-limiting.module';
import { RateLimitingService } from '../../packages/application-api/src/rate-limiting/rate-limiting.service';
import { RedisModule, REDIS_CLIENT } from '../../packages/application-api/src/redis/redis.module';
import { AuditModule } from '../../packages/application-api/src/audit/audit.module';
import { RedisClickAnalyticsService } from '../../packages/application-api/src/audit/redis-click-analytics.service';
import { ClickAnalyticsSnapshotService } from '../../packages/application-api/src/audit/click-analytics-snapshot.service';

// ---------------------------------------------------------------------------
// Infrastructure gates
// ---------------------------------------------------------------------------

const PG_URL = process.env.TEST_DATABASE_URL ?? null;
const REDIS_URL = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? null;

if (!PG_URL || !REDIS_URL) {
  console.log(
    '\n  ⏭️  Durability tests SKIPPED — TEST_DATABASE_URL' +
      (!PG_URL ? ' is not set' : '') +
      (!PG_URL && !REDIS_URL ? ' and' : '') +
      (!REDIS_URL ? ' TEST_REDIS_URL/REDIS_URL is not set' : '') +
      '.\n  See the module doc for the docker recipe.\n',
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Delete every key matching a SCAN pattern (test-scoped cleanup only). */
async function delPattern(client: Redis, pattern: string): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
    cursor = next;
    if (keys.length > 0) await client.del(...keys);
  } while (cursor !== '0');
}

/** End the pg.Pool behind a Drizzle instance (vitest hangs otherwise). */
async function endPool(db: DrizzleDatabase): Promise<void> {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
}

/** One full API replica: own pg pool + own Redis client + real graph. */
async function bootReplica(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [RedisModule, DataPlatformModule, RateLimitingModule, AuditModule],
    controllers: [OutboundRedirectController],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

/** Close an app AND end its pg pool (DrizzleModule has no destroy hook). */
async function shutdownReplica(app: INestApplication): Promise<void> {
  const db = app.get(DRIZZLE) as DrizzleDatabase;
  await app.close();
  await endPool(db);
}

/** Poll until predicate holds — recordClick is fire-and-forget. */
async function waitFor<T>(
  probe: () => Promise<T>,
  ok: (value: T) => boolean,
  tries = 60,
  gapMs = 50,
): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const value = await probe();
    if (ok(value)) return value;
    await sleep(gapMs);
  }
  throw new Error('waitFor: condition not met within the poll budget');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MARKER = '(durability-restart-test)';
const MERCHANT = 'durability-click-merchant';
const OFFER_URL = 'https://merchant.example.com/durability-restart-test';
/** OutboundRedirectController runs under @RateLimit('DEFAULT') — 60/min. */
const DEFAULT_LIMIT = 60;
/**
 * Clicks the controller records before the analytics assertions run:
 * the 60 redirected requests of the shared-limit burst plus the two
 * redirected requests of the trusted-proxy scenario (every successful
 * redirect records a click, whatever the client identity).
 */
const EXPECTED_CLICKS = DEFAULT_LIMIT + 2;

// ---------------------------------------------------------------------------
// Suite 1 — two API instances sharing one Redis + one PostgreSQL
// ---------------------------------------------------------------------------

describe.skipIf(!PG_URL || !REDIS_URL)(
  'two API instances sharing one Redis — rate limits, click analytics',
  () => {
    let appA: INestApplication;
    let appB: INestApplication;
    /** Replacement replica booted mid-suite (the "rollout"). */
    let appC: INestApplication;
    let seedDb: DrizzleDatabase;
    let offerId: number;

    const previousEnv: Record<string, string | undefined> = {};

    beforeAll(async () => {
      previousEnv.DATABASE_URL = process.env.DATABASE_URL;
      previousEnv.REDIS_URL = process.env.REDIS_URL;
      previousEnv.RATE_LIMIT_TRUST_PROXY = process.env.RATE_LIMIT_TRUST_PROXY;
      // The module factories read these at provider-instantiation time.
      process.env.DATABASE_URL = PG_URL;
      process.env.REDIS_URL = REDIS_URL;
      delete process.env.RATE_LIMIT_TRUST_PROXY; // origin must not trust XFF

      // Fixture/cleanup pool, independent of any replica.
      seedDb = DrizzleProvider.useFactory();

      appA = await bootReplica();
      appB = await bootReplica();

      // Pre-clean leftovers from an earlier run of this suite.
      await delPattern(appA.get<Redis>(REDIS_CLIENT), 'ratelimit:*');
      await delPattern(appA.get<Redis>(REDIS_CLIENT), `rajahinta:clicks:*:${MERCHANT}`);
      await seedDb.delete(clickCounterSnapshots).where(eq(clickCounterSnapshots.merchantId, MERCHANT));
      await seedDb.delete(retailOffers).where(eq(retailOffers.merchant, MERCHANT));
      await seedDb.delete(productMaster).where(eq(productMaster.name, `Durability Restart Fixture ${MARKER}`));

      // Seed one retail offer the redirect endpoint can serve (302).
      const [product] = await seedDb
        .insert(productMaster)
        .values({
          name: `Durability Restart Fixture ${MARKER}`,
          manufacturer: 'Fixture Brewery',
          brand: 'Fixture',
          category: 'beer',
          alcoholByVolume: '0.0500',
          unitVolume: '0.5000',
          containerType: 'can',
          regulatoryClassification: 'beer',
          depositSystemStatus: true,
          ean: null,
        })
        .returning({ id: productMaster.id });
      const [offer] = await seedDb
        .insert(retailOffers)
        .values({
          merchant: MERCHANT,
          country: 'DE',
          productId: product.id,
          priceCents: 199,
          currency: 'EUR',
          availability: 'in_stock',
          sourceUrl: OFFER_URL,
          reliabilityStatus: 'VERIFIED',
        })
        .returning({ id: retailOffers.id });
      offerId = offer.id;
    });

    afterAll(async () => {
      try {
        if (seedDb !== undefined) {
          // Leave no state behind: fixtures out of PostgreSQL, keys out
          // of Redis.
          await seedDb.delete(clickCounterSnapshots).where(eq(clickCounterSnapshots.merchantId, MERCHANT));
          await seedDb.delete(retailOffers).where(eq(retailOffers.merchant, MERCHANT));
          await seedDb.delete(productMaster).where(eq(productMaster.name, `Durability Restart Fixture ${MARKER}`));
        }
        for (const app of [appA, appB, appC]) {
          if (app === undefined) continue;
          const client = app.get<Redis>(REDIS_CLIENT);
          if (client.status !== 'end') {
            await delPattern(client, 'ratelimit:*');
            await delPattern(client, `rajahinta:clicks:*:${MERCHANT}`);
          }
          await shutdownReplica(app);
        }
      } finally {
        if (seedDb !== undefined) await endPool(seedDb);
        for (const [key, value] of Object.entries(previousEnv)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });

    // -----------------------------------------------------------------
    // Shared limit across instances
    // -----------------------------------------------------------------

    it('throttles a burst split across two instances at one shared limit, not twice it', async () => {
      // 60 requests (the full DEFAULT budget) alternating between the
      // two replicas: every one must be admitted and redirect (302).
      let admitted = 0;
      for (let i = 0; i < DEFAULT_LIMIT; i++) {
        const app = i % 2 === 0 ? appA : appB;
        const res = await request(app.getHttpServer())
          .get(`/api/v1/outbound/${offerId}`)
          .redirects(0);
        expect(
          res.status,
          `request ${i} via instance ${i % 2 === 0 ? 'A' : 'B'}`,
        ).toBe(302);
        admitted++;
      }
      expect(admitted).toBe(DEFAULT_LIMIT);

      // The 61st and 62nd — one via each replica — are throttled: the
      // combined traffic counted against a SINGLE shared budget. Two
      // per-process limiters would have admitted up to 120.
      const resA = await request(appA.getHttpServer())
        .get(`/api/v1/outbound/${offerId}`)
        .redirects(0);
      expect(resA.status).toBe(429);
      expect(resA.body.retryAfterSeconds).toBeGreaterThan(0);

      const resB = await request(appB.getHttpServer())
        .get(`/api/v1/outbound/${offerId}`)
        .redirects(0);
      expect(resB.status).toBe(429);
    });

    it('ignores a spoofed X-Forwarded-For at an origin not configured to trust a proxy', async () => {
      // RATE_LIMIT_TRUST_PROXY is unset in beforeAll. A spoofed header
      // must NOT mint a fresh budget for the same socket client.
      const res = await request(appA.getHttpServer())
        .get(`/api/v1/outbound/${offerId}`)
        .set('X-Forwarded-For', '203.0.113.7')
        .redirects(0);
      expect(res.status).toBe(429); // still keyed by the socket address
    });

    it('gives a forwarded client its own budget, shared across both instances, when the proxy is trusted', async () => {
      process.env.RATE_LIMIT_TRUST_PROXY = 'true';
      try {
        // Two requests through DIFFERENT replicas with the same
        // forwarded identity — both land in the same Redis window.
        for (const app of [appA, appB]) {
          const res = await request(app.getHttpServer())
            .get(`/api/v1/outbound/${offerId}`)
            .set('X-Forwarded-For', '203.0.113.7')
            .redirects(0);
          expect(res.status).toBe(302);
        }

        // Read-side proof of the shared budget: BOTH instances see the
        // same two entries consumed from the 60-request window.
        const remainingA = await appA
          .get(RateLimitingService)
          .getRemaining('203.0.113.7', 'DEFAULT');
        const remainingB = await appB
          .get(RateLimitingService)
          .getRemaining('203.0.113.7', 'DEFAULT');
        expect(remainingA).toBe(DEFAULT_LIMIT - 2);
        expect(remainingB).toBe(DEFAULT_LIMIT - 2);
      } finally {
        delete process.env.RATE_LIMIT_TRUST_PROXY;
      }
    });

    // -----------------------------------------------------------------
    // Click counters — shared store, rollout survival, snapshot restore
    // -----------------------------------------------------------------

    it('records clicks through the real redirect endpoint into counters shared by both instances', async () => {
      // The 60 redirected requests above fire-and-forget recordClicks.
      const counts = await waitFor(
        () => appB.get(RedisClickAnalyticsService).getClickCounts(),
        (c) => (c[MERCHANT]?.[OFFER_URL] ?? 0) === EXPECTED_CLICKS,
      );
      expect(counts[MERCHANT]).toEqual({ [OFFER_URL]: EXPECTED_CLICKS });
    });

    it('counters survive a rollout: a replacement instance reads them from the shared store, not from process memory', async () => {
      // Replace instance A (shutdown + fresh boot) — a pod rollout.
      await shutdownReplica(appA);
      appA = undefined as unknown as INestApplication;
      appC = await bootReplica();

      // The brand-new instance continues from the persisted state.
      const stats = await appC.get(RedisClickAnalyticsService).getClickStats();
      expect(stats[MERCHANT]).toMatchObject({
        totalClicks: EXPECTED_CLICKS,
        uniqueUrls: 1,
        perUrl: { [OFFER_URL]: EXPECTED_CLICKS },
      });

      // A click recorded by the replacement is INCREMENTED onto the
      // surviving counter — counters continue, they do not restart.
      await appC.get(RedisClickAnalyticsService).recordClick(MERCHANT, OFFER_URL);
      const counts = await waitFor(
        () => appC.get(RedisClickAnalyticsService).getClickCounts(),
        (c) => (c[MERCHANT]?.[OFFER_URL] ?? 0) === EXPECTED_CLICKS + 1,
      );
      expect(counts[MERCHANT][OFFER_URL]).toBe(EXPECTED_CLICKS + 1);
    });

    it('snapshots the counters to PostgreSQL idempotently', async () => {
      const snapshotter = appC.get(ClickAnalyticsSnapshotService);
      const at = new Date();

      const written = await snapshotter.snapshotNow(at);
      expect(written).toBe(1); // one (merchant, url) pair

      // Re-running the same capture instant converges (upsert, no dup).
      const rewritten = await snapshotter.snapshotNow(at);
      expect(rewritten).toBe(1);

      const rows = await seedDb
        .select()
        .from(clickCounterSnapshots)
        .where(eq(clickCounterSnapshots.merchantId, MERCHANT));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        url: OFFER_URL,
        clickCount: EXPECTED_CLICKS + 1,
      });
    });

    it('Redis data loss does not erase analytics history — counts are re-readable from the PostgreSQL snapshots', async () => {
      const client = appC.get<Redis>(REDIS_CLIENT);
      // Simulate a no-persistence Redis restart: the live store empties.
      await client.del(`rajahinta:clicks:counts:${MERCHANT}`);
      await client.del(`rajahinta:clicks:urls:${MERCHANT}`);

      const live = await appC.get(RedisClickAnalyticsService).getClickCounts();
      expect(live[MERCHANT]).toBeUndefined(); // live counters gone

      // The durable restore path: the archived snapshot still holds the
      // exact cumulative counts captured before the loss.
      const rows = await seedDb
        .select()
        .from(clickCounterSnapshots)
        .where(eq(clickCounterSnapshots.merchantId, MERCHANT));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ url: OFFER_URL, clickCount: EXPECTED_CLICKS + 1 });
    });
  },
);

// ---------------------------------------------------------------------------
// Suite 2 — audit events survive a process restart
// ---------------------------------------------------------------------------

describe.skipIf(!PG_URL)('audit events survive a process restart', () => {
  const AUTHOR = 'durability-restart-test-author';
  const ENTITY_TYPE = 'tax_rule';
  const ENTITY_ID = 'durability-restart-entity-1';

  let appBefore: INestApplication;
  let appAfter: INestApplication;
  let auditBefore: AuditService;
  let auditAfter: AuditService;
  let ids: string[] = [];

  beforeAll(async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = PG_URL;
    try {
      // Pre-clean leftovers from an earlier run of this suite.
      const cleaner = DrizzleProvider.useFactory();
      await cleaner.delete(auditEvents).where(eq(auditEvents.author, AUTHOR));
      await endPool(cleaner);

      // Instance one writes the events...
      appBefore = await bootAuditApp();
      auditBefore = appBefore.get(AuditService);
      await auditBefore.logChange({
        entityType: ENTITY_TYPE,
        entityId: ENTITY_ID,
        action: 'updated',
        author: AUTHOR,
        reason: 'integration fixture — first change before restart',
        previousValue: { rate: '0.3620' },
        newValue: { rate: '0.4000' },
      });
      // Distinct timestamps (spaced writes) keep the most-recent-first
      // ordering assertion deterministic even at same-millisecond speed.
      await sleep(8);
      await auditBefore.logChange({
        entityType: ENTITY_TYPE,
        entityId: ENTITY_ID,
        action: 'confirmed',
        author: AUTHOR,
        reason: 'integration fixture — confirmation before restart',
      });
      await sleep(8);
      await auditBefore.logChange({
        entityType: ENTITY_TYPE,
        entityId: 'durability-restart-entity-2',
        action: 'created',
        author: AUTHOR,
        reason: 'integration fixture — unrelated entity before restart',
      });
      ids = (await auditBefore.queryChanges({ author: AUTHOR })).map((e) => e.id);
      expect(ids).toHaveLength(3);

      // ...then the process "restarts": the old instance is torn down
      // (pool ended) and a brand-new repository graph boots against the
      // same database.
      await shutdownReplica(appBefore);
      appBefore = undefined as unknown as INestApplication;
      appAfter = await bootAuditApp();
      auditAfter = appAfter.get(AuditService);
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  afterAll(async () => {
    try {
      if (appAfter !== undefined) {
        await shutdownReplica(appAfter);
      }
    } finally {
      // Remove the fixture rows once the replica pool is gone — use a
      // short-lived pool of our own.
      const previousDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = PG_URL;
      try {
        const cleaner = DrizzleProvider.useFactory();
        await cleaner.delete(auditEvents).where(eq(auditEvents.author, AUTHOR));
        await endPool(cleaner);
      } finally {
        if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  /** Minimal real graph for the audit path (no Redis needed). */
  async function bootAuditApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [DataPlatformModule, AuditModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
  }

  it('every event written before the restart is queryable after it', async () => {
    const events = await auditAfter.queryChanges({ author: AUTHOR });
    expect(events).toHaveLength(3);
    expect(new Set(events.map((e) => e.id))).toEqual(new Set(ids));
  });

  it('query results stay most-recent-first and payload values round-trip', async () => {
    const events = await auditAfter.queryChanges({ author: AUTHOR });
    const times = events.map((e) => e.timestamp);
    expect([...times].sort().reverse()).toEqual(times);

    const update = events.find((e) => e.action === 'updated');
    expect(update).toBeDefined();
    expect(update?.previousValue).toEqual({ rate: '0.3620' });
    expect(update?.newValue).toEqual({ rate: '0.4000' });
    expect(update?.reason).toBe('integration fixture — first change before restart');
  });

  it('per-entity history is intact after the restart', async () => {
    const history = await auditAfter.getChangeHistory(ENTITY_TYPE, ENTITY_ID);
    expect(history).toHaveLength(2);
    expect(history.every((e) => e.entityType === ENTITY_TYPE && e.entityId === ENTITY_ID)).toBe(true);
  });
});
