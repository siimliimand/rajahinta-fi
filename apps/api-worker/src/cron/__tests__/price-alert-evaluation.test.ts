/**
 * Price-alert evaluation cron handler tests (task 2.2, design R2) —
 * the binding semantics of the Hinta-Haukka sweep:
 *
 * - threshold equality triggers (`<=` — observed == threshold notifies);
 * - observed above the threshold does not;
 * - the 24-hour cooldown is a HALF-OPEN window measured from the latest
 *   delivered notification row: strictly younger than 24 h suppresses,
 *   exactly 24 h has elapsed and re-notifies (documented decision);
 * - suppression is visible in the counters;
 * - the intent row is written BEFORE dispatch and the outcome marked
 *   AFTER;
 * - a retried run skips delivered rows — no second email per trigger;
 * - a failed dispatch marks the row failed and counts it;
 * - per-alert error isolation and the skip paths (no summary, no
 *   recipient);
 * - the unconfigured-email no-op with zero evaluations;
 * - the task-2.1 LANDED_COST reader (newest product-wide daily
 *   landed-cost close, null otherwise — price-reader parity);
 * - the task-3.1 CATEGORY sweep (deterministic category minimum,
 *   identical threshold/cooldown semantics);
 * - the task-2.2 LANDED_COST sweep (composition-cited emails: fires at
 *   the threshold, stale and unresolvable-composition skips carry no
 *   counters, cooldown parity, and the exhaustive kind-guard table —
 *   each kind evaluated exactly once by its own branch, TAX_CHANGE
 *   foreign);
 * - counters exported via the observability module; router wiring on
 *   the shared 30-minute pattern.
 *
 * @module PriceAlertEvaluationTest
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PRICE_ALERT_COOLDOWN_MS,
  PRICE_ALERT_EVALUATION_CRON,
  buildCategoryAlertEmail,
  buildLandedCostAlertEmail,
  buildPriceAlertEmail,
  handlePriceAlertEvaluation,
  latestMaterializedLandedCostCents,
  sendPriceAlertEmail,
  type LandedCostCompositionFacts,
  type PriceAlertEmail,
  type PriceAlertEvaluationResult,
} from '../price-alert-evaluation';
import { handlersForCron } from '../router';
import { createLogger, type Logger } from '../../logger';
import type { Env } from '../../env';
import {
  PRICE_ALERT_EVALUATED_COUNTER,
  PRICE_ALERT_MATCHED_COUNTER,
  PRICE_ALERT_NOTIFIED_COUNTER,
  PRICE_ALERT_FAILED_COUNTER,
  PRICE_ALERT_SUPPRESSED_COUNTER,
} from '../../observability/metrics';
import type {
  D1PriceAlertRepository,
  PriceAlertRecord,
} from '../../../../../packages/data-platform/src/repositories/d1/price-alert.repository';
import type { D1AlertNotificationRepository } from '../../../../../packages/data-platform/src/repositories/d1/alert-notification.repository';
import type {
  AlertNotificationIntentInput,
  AlertNotificationRecord,
} from '../../../../../packages/data-platform/src/repositories/d1/alert-notification.repository';
import type { D1PriceHistorySummaryRepository } from '../../../../../packages/data-platform/src/repositories/d1/price-history-summary.repository';
import type { D1ProductSearchRepository } from '../../../../../packages/data-platform/src/repositories/d1/product-search.repository';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Fixed "now" — the cooldown boundary math is deterministic against it. */
const NOW = new Date('2026-08-30T12:00:00.000Z');

const LOG = createLogger('error');

function alert(overrides: Partial<PriceAlertRecord> = {}): PriceAlertRecord {
  return {
    id: 11,
    accountId: 7,
    productId: 123,
    kind: 'PRICE',
    category: null,
    thresholdCents: 1500,
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** CATEGORY-kind fixture — null product, canonical category, threshold. */
function categoryAlert(
  overrides: Partial<PriceAlertRecord> = {},
): PriceAlertRecord {
  return alert({
    id: 21,
    productId: null,
    kind: 'CATEGORY',
    category: 'beer',
    thresholdCents: 1500,
    ...overrides,
  });
}

/** LANDED_COST-kind fixture — product-bearing, threshold (create contract). */
function landedCostAlert(
  overrides: Partial<PriceAlertRecord> = {},
): PriceAlertRecord {
  return alert({
    id: 22,
    kind: 'LANDED_COST',
    thresholdCents: 4500,
    ...overrides,
  });
}

/**
 * Composition facts fixture (task 2.2). The retail price is deliberately
 * NOT derivable from the other figures (4450 − 3500 ≠ 450): if a builder
 * computed any fact instead of citing it, these values could not round-trip.
 */
const LANDED_FACTS: LandedCostCompositionFacts = {
  observedAt: '2026-08-30T09:30:00.000Z',
  retailPriceCents: 3500,
  transportCostCents: 450,
  transportCarrier: 'posti',
  transportOriginCountry: 'EE',
  transportDestinationCountry: 'FI',
  exciseDatasetVersion: 'v1.0-2024',
  containerDutyDatasetVersion: 'v1.2-2024',
  confidence: 'HIGH',
};

function deliveredRow(
  alertId: number,
  createdAt: Date,
): AlertNotificationRecord {
  return {
    id: 90,
    alertId,
    observedPriceCents: 1400,
    channel: 'email',
    deliveryStatus: 'delivered',
    createdAt,
    markedAt: createdAt,
  };
}

/** Fake AE binding — records every writeDataPoint call. */
function fakeMetricsBinding(): {
  binding: AnalyticsEngineDataset;
  points: AnalyticsEngineDataPoint[];
} {
  const points: AnalyticsEngineDataPoint[] = [];
  return {
    points,
    binding: {
      writeDataPoint(event?: AnalyticsEngineDataPoint): void {
        points.push(event ?? {});
      },
    },
  };
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    EMAIL_WORKER_URL: 'https://rajahinta-email-worker.example.workers.dev',
    EMAIL_SEND_SECRET: 'test-shared-secret',
    LOG_LEVEL: 'error',
    ...overrides,
  } as unknown as Env;
}

// ---------------------------------------------------------------------------
// Dependency stubs (the handler's seams; concrete-class casts are the
// time-series-aggregation test precedent)
// ---------------------------------------------------------------------------

interface World {
  findActive: ReturnType<typeof vi.fn>;
  findByProductRange: ReturnType<typeof vi.fn>;
  findCategoryMinPriceCents: ReturnType<typeof vi.fn>;
  resolveLandedCostFacts: ReturnType<typeof vi.fn>;
  findLatestDeliveredByAlertId: ReturnType<typeof vi.fn>;
  createIntent: ReturnType<typeof vi.fn>;
  markDelivered: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  findAccountEmail: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

interface WorldOptions {
  /** Active-alert scan set. */
  alerts?: PriceAlertRecord[];
  /** The newest daily close per call — null simulates "no summary". */
  closeCents?: number | null;
  /** The newest daily landed-cost close on the same bucket row. */
  landedCloseCents?: number | null;
  /**
   * The category-minimum result — null simulates "no fresh product-wide
   * summary for any product of the category" (the stale-skip path).
   */
  categoryMin?: { productId: number; priceCloseCents: number } | null;
  /**
   * The LANDED_COST composition-facts resolution — null simulates a
   * close whose facts are not retrievable from stored records.
   */
  landedFacts?: LandedCostCompositionFacts | null;
  /** Pre-existing delivered notification rows, by alert id. */
  latestDelivered?: Map<number, AlertNotificationRecord>;
  /** The account-email read result (default: an address). */
  email?: string | null;
  /** The dispatch behavior (default: success). */
  sendImpl?: () => Promise<void>;
  /** Intent-write behavior override (isolation tests). */
  createIntentImpl?: (input: AlertNotificationIntentInput) => Promise<unknown>;
}

function makeWorld(options: WorldOptions = {}): {
  world: World;
  run: (
    envOverrides?: Partial<Env>,
    depsOverrides?: Record<string, unknown>,
  ) => Promise<PriceAlertEvaluationResult>;
} {
  const {
    alerts = [alert()],
    closeCents = 1499,
    landedCloseCents = 4499,
    categoryMin = { productId: 123, priceCloseCents: 1499 },
    landedFacts = LANDED_FACTS,
    latestDelivered = new Map(),
    email = 'user@example.com',
    sendImpl,
    createIntentImpl,
  } = options;

  let intentSeq = 500;
  const findActive = vi.fn(async () => alerts);
  const findByProductRange = vi.fn(async () =>
    closeCents === null
      ? []
      : [
          {
            periodStart: '2026-08-30',
            priceCloseCents: closeCents,
            landedCostCloseCents: landedCloseCents,
          },
        ],
  );
  const findCategoryMinPriceCents = vi.fn(async () => categoryMin);
  const resolveLandedCostFacts = vi.fn(async () => landedFacts);
  const findLatestDeliveredByAlertId = vi.fn(async (alertId: number) =>
    latestDelivered.get(alertId) ?? null,
  );
  const createIntent = vi.fn(
    createIntentImpl ??
      (async (input: AlertNotificationIntentInput) => ({
        id: ++intentSeq,
        alertId: input.alertId,
        observedPriceCents: input.observedPriceCents,
        channel: 'email' as const,
        deliveryStatus: 'pending' as const,
        createdAt: NOW,
        markedAt: null,
      })),
  );
  const markDelivered = vi.fn(
    async (id: number) =>
      ({
        id,
        alertId: 11,
        observedPriceCents: closeCents ?? 0,
        channel: 'email',
        deliveryStatus: 'delivered',
        createdAt: NOW,
        markedAt: NOW,
      }) satisfies AlertNotificationRecord,
  );
  const markFailed = vi.fn(async () => null);
  const findById = vi.fn(async () => ({ name: 'Keitele Senorita' }));
  const findAccountEmail = vi.fn(async () => email);
  const send = vi.fn(sendImpl ?? (async () => undefined));

  const deps = {
    alerts: { findActive } as never as D1PriceAlertRepository,
    notifications: {
      findLatestDeliveredByAlertId,
      createIntent,
      markDelivered,
      markFailed,
    } as never as D1AlertNotificationRepository,
    summaries: {
      findByProductRange,
      findCategoryMinPriceCents,
    } as never as D1PriceHistorySummaryRepository,
    products: { findById } as never as D1ProductSearchRepository,
    findAccountEmail,
    resolveLandedCostFacts,
    send,
  };

  const world: World = {
    findActive,
    findByProductRange,
    findCategoryMinPriceCents,
    resolveLandedCostFacts,
    findLatestDeliveredByAlertId,
    createIntent,
    markDelivered,
    markFailed,
    findById,
    findAccountEmail,
    send,
  };

  return {
    world,
    run: (envOverrides = {}, depsOverrides = {}) =>
      handlePriceAlertEvaluation(makeEnv(envOverrides), LOG, {
        ...deps,
        ...depsOverrides,
      } as never),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Threshold semantics — `<=` triggers (binding design decision)
// ---------------------------------------------------------------------------

describe('threshold semantics', () => {
  it('observed price EXACTLY at the threshold triggers', async () => {
    const { world, run } = makeWorld({ closeCents: 1500 });

    const result = await run();

    expect(result.evaluated).toBe(1);
    expect(result.matched).toBe(1);
    expect(result.notified).toBe(1);
    expect(world.send).toHaveBeenCalledTimes(1);
  });

  it('observed price ABOVE the threshold does not trigger', async () => {
    const { world, run } = makeWorld({ closeCents: 1501 });

    const result = await run();

    expect(result.evaluated).toBe(1);
    expect(result.matched).toBe(0);
    expect(result.notified).toBe(0);
    expect(world.send).not.toHaveBeenCalled();
    // No intent row either — a non-match never touches the log.
    expect(world.createIntent).not.toHaveBeenCalled();
  });

  it('observed price BELOW the threshold triggers', async () => {
    const { world, run } = makeWorld({ closeCents: 1420 });

    const result = await run();

    expect(result.matched).toBe(1);
    expect(world.send).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Cooldown — 24-hour half-open window over the latest DELIVERED row
// ---------------------------------------------------------------------------

describe('24h cooldown (latest delivered notification row)', () => {
  it('a delivered row 1 ms inside the window suppresses — counted, not sent', async () => {
    const latestDelivered = new Map([
      [11, deliveredRow(11, new Date(NOW.getTime() - (PRICE_ALERT_COOLDOWN_MS - 1)))],
    ]);
    const { world, run } = makeWorld({ latestDelivered });

    const result = await run();

    expect(result.matched).toBe(1);
    expect(result.suppressed).toBe(1);
    expect(result.notified).toBe(0);
    expect(world.send).not.toHaveBeenCalled();
    expect(world.createIntent).not.toHaveBeenCalled();
  });

  it('a delivered row EXACTLY 24 h old has had its window elapse — re-notifies', async () => {
    // Boundary decision (documented in the handler module): "within the
    // last 24-hour period" is a half-open window — suppression holds
    // strictly younger than 24 h; at exactly 24 h the window has passed
    // and the spec's re-trigger scenario applies.
    const latestDelivered = new Map([
      [11, deliveredRow(11, new Date(NOW.getTime() - PRICE_ALERT_COOLDOWN_MS))],
    ]);
    const { world, run } = makeWorld({ latestDelivered });

    const result = await run();

    expect(result.suppressed).toBe(0);
    expect(result.notified).toBe(1);
    expect(world.send).toHaveBeenCalledTimes(1);
  });

  it('an alert with no delivered row ever is not suppressed', async () => {
    const { world, run } = makeWorld();

    const result = await run();

    expect(result.suppressed).toBe(0);
    expect(world.findLatestDeliveredByAlertId).toHaveBeenCalledWith(11);
    expect(world.send).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Intent log — ordering and crash safety
// ---------------------------------------------------------------------------

describe('intent-log pipeline (crash-safe delivery)', () => {
  it('writes the intent row BEFORE dispatch and marks delivered AFTER', async () => {
    const { world, run } = makeWorld();

    await run();

    expect(world.createIntent).toHaveBeenCalledTimes(1);
    const intentOrder = world.createIntent.mock.invocationCallOrder[0]!;
    const sendOrder = world.send.mock.invocationCallOrder[0]!;
    const markOrder = world.markDelivered.mock.invocationCallOrder[0]!;
    expect(intentOrder).toBeLessThan(sendOrder);
    expect(sendOrder).toBeLessThan(markOrder);
    // The intent freezes the observed materialized price.
    expect(world.createIntent.mock.calls[0]![0]).toMatchObject({
      alertId: 11,
      observedPriceCents: 1499,
      channel: 'email',
    });
  });

  it('retry after a crash skips delivered rows — no second email per trigger', async () => {
    const latestDelivered = new Map<number, AlertNotificationRecord>();
    const { world, run } = makeWorld({ latestDelivered });

    // Run 1: delivers (the "crash" happens after this run completes its
    // mark — the row is persisted delivered).
    const first = await run();
    expect(first.notified).toBe(1);
    expect(world.send).toHaveBeenCalledTimes(1);

    // Run 2 (the retry): the same alert still matches, but the delivered
    // row from run 1 routes it through the cooldown — suppressed, no
    // second send.
    latestDelivered.set(11, deliveredRow(11, NOW));
    const second = await run();

    expect(second.notified).toBe(0);
    expect(second.suppressed).toBe(1);
    expect(world.send).toHaveBeenCalledTimes(1);
  });

  it('a failed dispatch marks the row FAILED and counts it — the pending intent is retried next tick', async () => {
    const { world, run } = makeWorld({
      sendImpl: async () => {
        throw new Error('email worker rejected the price-alert send: HTTP 500');
      },
    });

    const result = await run();

    expect(result.notified).toBe(0);
    expect(result.failed).toBe(1);
    expect(world.send).toHaveBeenCalledTimes(1);
    expect(world.markFailed).toHaveBeenCalledTimes(1);
    // Marked on the SAME intent row that was written before dispatch.
    const intent = (await world.createIntent.mock.results[0]!
      .value) as AlertNotificationRecord;
    expect(world.markFailed).toHaveBeenCalledWith(intent.id);
  });
});

// ---------------------------------------------------------------------------
// Skip paths and isolation
// ---------------------------------------------------------------------------

describe('skip paths and per-alert isolation', () => {
  it('an alert without a recent materialized summary is skipped, not evaluated', async () => {
    const { world, run } = makeWorld({ closeCents: null });

    const result = await run();

    expect(result.evaluated).toBe(0);
    expect(result.matched).toBe(0);
    expect(world.send).not.toHaveBeenCalled();
    expect(world.createIntent).not.toHaveBeenCalled();
  });

  it('an unresolvable account email counts failed and writes NO intent row', async () => {
    const { world, run } = makeWorld({ email: null });

    const result = await run();

    expect(result.failed).toBe(1);
    expect(result.notified).toBe(0);
    expect(world.createIntent).not.toHaveBeenCalled();
    expect(world.send).not.toHaveBeenCalled();
  });

  it('one failing alert does not abort the sweep', async () => {
    const second = alert({ id: 12, accountId: 8, productId: 456, thresholdCents: 2000 });
    const { world, run } = makeWorld({
      alerts: [alert(), second],
      // Alert 11's intent write explodes; alert 12 must still deliver.
      createIntentImpl: async (input) => {
        if (input.alertId === 11) throw new Error('D1 write failed');
        return {
          id: 777,
          alertId: input.alertId,
          observedPriceCents: input.observedPriceCents,
          channel: 'email',
          deliveryStatus: 'pending',
          createdAt: NOW,
          markedAt: null,
        } satisfies AlertNotificationRecord;
      },
    });

    const result = await run();

    expect(result.activeAlerts).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.notified).toBe(1);
    expect(world.send).toHaveBeenCalledTimes(1);
    expect(world.send.mock.calls[0]![0].to).toBe('user@example.com');
  });
});

// ---------------------------------------------------------------------------
// latestMaterializedLandedCostCents — the LANDED_COST reader (task 2.1)
// ---------------------------------------------------------------------------

describe('latestMaterializedLandedCostCents (task 2.1 reader)', () => {
  function summariesStub(
    rows: Array<{ periodStart: string; landedCostCloseCents: number }>,
  ): D1PriceHistorySummaryRepository {
    return {
      findByProductRange: vi.fn(async () => rows),
    } as never as D1PriceHistorySummaryRepository;
  }

  it('returns the NEWEST bucket\'s landedCostCloseCents, reading the 7-day product-wide window', async () => {
    const summaries = summariesStub([
      { periodStart: '2026-08-28', landedCostCloseCents: 5300 },
      { periodStart: '2026-08-29', landedCostCloseCents: 5100 },
      { periodStart: '2026-08-30', landedCostCloseCents: 5250 },
    ]);

    const landed = await latestMaterializedLandedCostCents(summaries, 123, NOW);

    // Price-reader parity: ascending read, LAST row is the newest bucket.
    expect(landed).toBe(5250);
    expect(summaries.findByProductRange).toHaveBeenCalledWith(
      123,
      'daily',
      '2026-08-23', // NOW − 7d
      '2026-08-30', // NOW
    );
  });

  it('returns null when no bucket exists inside the lookback window', async () => {
    const summaries = summariesStub([]);

    const landed = await latestMaterializedLandedCostCents(summaries, 123, NOW);

    expect(landed).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LANDED_COST sweep — composition-cited landed-cost alerts (task 2.2)
// ---------------------------------------------------------------------------

describe('LANDED_COST sweep (task 2.2)', () => {
  it('fires on the landed close AT the threshold; the email cites the composition and the notification is marked', async () => {
    const { world, run } = makeWorld({
      alerts: [landedCostAlert({ thresholdCents: 4499 })],
      landedCloseCents: 4499,
    });

    const result = await run();

    // Equality triggers — the same `observed <= threshold` semantics as
    // every threshold kind.
    expect(result.evaluated).toBe(1);
    expect(result.matched).toBe(1);
    expect(result.notified).toBe(1);
    // The freshness window is the price reader's protocol on the
    // landed-cost close column.
    expect(world.findByProductRange).toHaveBeenCalledWith(
      123,
      'daily',
      '2026-08-23',
      '2026-08-30',
    );
    // Every composition fact is cited in the body, each sourced from the
    // resolved facts — the retail price (€35.00) is deliberately not
    // derivable from the other cited figures.
    const email = world.send.mock.calls[0]![0] as PriceAlertEmail;
    expect(email.subject).toContain('Keitele Senorita');
    expect(email.subject).toContain('€44.99');
    expect(email.text).toContain('€44.99'); // observed landed close + threshold
    expect(email.text).toContain('€35.00'); // retail price (facts.retailPriceCents)
    expect(email.text).toContain('€4.50'); // transport cost
    expect(email.text).toContain('posti'); // carrier
    expect(email.text).toContain('EE → FI'); // route
    expect(email.text).toContain('v1.0-2024'); // excise dataset version
    expect(email.text).toContain('v1.2-2024'); // container-duty dataset version
    expect(email.text).toContain('HIGH'); // confidence
    expect(email.text).toContain(LANDED_FACTS.observedAt); // observed-at
    expect(email.text).toContain('quantity=1 baseline');
    expect(email.text).toContain('not a live quote');
    // The intent row freezes the observed landed close, delivered-marked.
    expect(world.createIntent).toHaveBeenCalledWith(
      expect.objectContaining({ alertId: 22, observedPriceCents: 4499 }),
    );
    expect(world.markDelivered).toHaveBeenCalledTimes(1);
  });

  it('observed landed close above the threshold does not trigger', async () => {
    const { world, run } = makeWorld({
      alerts: [landedCostAlert({ thresholdCents: 4499 })],
      landedCloseCents: 4500,
    });

    const result = await run();

    expect(result.evaluated).toBe(1);
    expect(result.matched).toBe(0);
    expect(world.send).not.toHaveBeenCalled();
    expect(world.createIntent).not.toHaveBeenCalled();
  });

  it('stale summaries never trigger — skip with no evaluation counter, no composition read, no email', async () => {
    const { world, run } = makeWorld({
      alerts: [landedCostAlert()],
      closeCents: null,
    });

    const result = await run();

    expect(world.findByProductRange).toHaveBeenCalledTimes(1);
    expect(world.resolveLandedCostFacts).not.toHaveBeenCalled();
    expect(result).toMatchObject({ evaluated: 0, matched: 0, notified: 0 });
    expect(world.send).not.toHaveBeenCalled();
    expect(world.createIntent).not.toHaveBeenCalled();
  });

  it('a close whose composition is not retrievable is not evaluated — no counter, no email (explainability precondition)', async () => {
    const { world, run } = makeWorld({
      alerts: [landedCostAlert()],
      landedFacts: null,
    });

    const result = await run();

    expect(result).toMatchObject({
      evaluated: 0,
      matched: 0,
      notified: 0,
      failed: 0,
    });
    expect(world.send).not.toHaveBeenCalled();
    expect(world.createIntent).not.toHaveBeenCalled();
  });

  it('the 24h delivered-row cooldown applies identically to LANDED_COST matches', async () => {
    const { world, run } = makeWorld({
      alerts: [landedCostAlert()],
      latestDelivered: new Map([
        [22, deliveredRow(22, new Date(NOW.getTime() - (PRICE_ALERT_COOLDOWN_MS - 1)))],
      ]),
    });

    const result = await run();

    expect(result.matched).toBe(1);
    expect(result.suppressed).toBe(1);
    expect(result.notified).toBe(0);
    expect(world.send).not.toHaveBeenCalled();
    expect(world.createIntent).not.toHaveBeenCalled();
  });

  it('a LANDED_COST row without a product is a data anomaly — skipped cleanly, no counters', async () => {
    const { world, run } = makeWorld({
      alerts: [landedCostAlert({ productId: null })],
    });

    const result = await run();

    expect(result).toMatchObject({ evaluated: 0, matched: 0, failed: 0 });
    expect(world.findByProductRange).not.toHaveBeenCalled();
    expect(world.resolveLandedCostFacts).not.toHaveBeenCalled();
    expect(world.send).not.toHaveBeenCalled();
  });

  it('the LANDED_COST branch owns its kind alone — the category-minimum query never runs for it', async () => {
    const { world, run } = makeWorld({
      alerts: [landedCostAlert()],
    });

    await run();

    expect(world.findCategoryMinPriceCents).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CATEGORY sweep — deterministic category minimum (task 3.1)
// ---------------------------------------------------------------------------

describe('CATEGORY sweep (task 3.1)', () => {
  it('triggers on the category minimum at the threshold and sends the category email', async () => {
    const { world, run } = makeWorld({
      alerts: [categoryAlert({ thresholdCents: 1500 })],
      categoryMin: { productId: 77, priceCloseCents: 1500 },
    });

    const result = await run();

    // Equality triggers — the same `observed <= threshold` semantics as PRICE.
    expect(result.evaluated).toBe(1);
    expect(result.matched).toBe(1);
    expect(result.notified).toBe(1);
    // The sweep query stays parameterized: canonical category, daily
    // granularity, the same 7-day window the PRICE reader uses.
    expect(world.findCategoryMinPriceCents).toHaveBeenCalledWith(
      'beer',
      'daily',
      '2026-08-23',
      '2026-08-30',
    );
    // The email names the tripping product, its price, the category, and
    // the threshold.
    const email = world.send.mock.calls[0]![0] as PriceAlertEmail;
    expect(email.subject).toContain('Keitele Senorita');
    expect(email.subject).toContain('€15.00');
    expect(email.text).toContain('beer');
    expect(email.text).toContain('€15.00');
    expect(email.text).toContain('#77');
    // The intent row freezes the category minimum.
    expect(world.createIntent).toHaveBeenCalledWith(
      expect.objectContaining({ alertId: 21, observedPriceCents: 1500 }),
    );
  });

  it('observed minimum above the threshold does not trigger', async () => {
    const { world, run } = makeWorld({
      alerts: [categoryAlert({ thresholdCents: 1400 })],
      categoryMin: { productId: 77, priceCloseCents: 1499 },
    });

    const result = await run();

    expect(result.evaluated).toBe(1);
    expect(result.matched).toBe(0);
    expect(world.send).not.toHaveBeenCalled();
    expect(world.createIntent).not.toHaveBeenCalled();
  });

  it('no fresh summary in the category skips BEFORE the evaluation counter (stale never triggers)', async () => {
    const { world, run } = makeWorld({
      alerts: [categoryAlert()],
      categoryMin: null,
    });

    const result = await run();

    expect(world.findCategoryMinPriceCents).toHaveBeenCalledTimes(1);
    expect(result.evaluated).toBe(0);
    expect(result.matched).toBe(0);
    expect(world.send).not.toHaveBeenCalled();
    expect(world.createIntent).not.toHaveBeenCalled();
  });

  it('the 24h delivered-row cooldown applies identically to CATEGORY matches', async () => {
    const { world, run } = makeWorld({
      alerts: [categoryAlert()],
      latestDelivered: new Map([
        [21, deliveredRow(21, new Date(NOW.getTime() - (PRICE_ALERT_COOLDOWN_MS - 1)))],
      ]),
    });

    const result = await run();

    expect(result.matched).toBe(1);
    expect(result.suppressed).toBe(1);
    expect(result.notified).toBe(0);
    expect(world.send).not.toHaveBeenCalled();
    expect(world.createIntent).not.toHaveBeenCalled();
  });

  it('TAX_CHANGE rows stay foreign to this sweep — skipped BEFORE any read or counter', async () => {
    const { world, run } = makeWorld({
      alerts: [alert({ id: 31, kind: 'TAX_CHANGE', thresholdCents: null })],
    });

    const result = await run();

    expect(result).toMatchObject({
      evaluated: 0,
      matched: 0,
      notified: 0,
      suppressed: 0,
      failed: 0,
    });
    // Skipped before ANY read — neither the price reader, the landed-cost
    // window, nor the category-minimum query ran.
    expect(world.findByProductRange).not.toHaveBeenCalled();
    expect(world.findCategoryMinPriceCents).not.toHaveBeenCalled();
    expect(world.resolveLandedCostFacts).not.toHaveBeenCalled();
    expect(world.send).not.toHaveBeenCalled();
  });

  it('a mixed sweep evaluates every threshold kind exactly once, each by its own branch', async () => {
    const { world, run } = makeWorld({
      alerts: [
        alert({ id: 11 }), // PRICE
        categoryAlert({ id: 21 }), // CATEGORY
        alert({ id: 31, kind: 'TAX_CHANGE', thresholdCents: null }),
        landedCostAlert({ id: 32 }), // LANDED_COST
      ],
    });

    const result = await run();

    // The guard table is exhaustive: three threshold kinds, each owned by
    // exactly one branch; the foreign kind contributes nothing.
    expect(result.evaluated).toBe(3);
    expect(result.notified).toBe(3);
    // One window read per product-bearing branch (PRICE + LANDED_COST),
    // one category-minimum query, one composition resolution.
    expect(world.findByProductRange).toHaveBeenCalledTimes(2);
    expect(world.findCategoryMinPriceCents).toHaveBeenCalledTimes(1);
    expect(world.resolveLandedCostFacts).toHaveBeenCalledTimes(1);
    expect(world.send).toHaveBeenCalledTimes(3);
    const subjects = world.send.mock.calls.map(
      (call) => (call[0] as PriceAlertEmail).subject,
    );
    expect(subjects.some((s) => s.startsWith('[rajahinta] Price alert:'))).toBe(true);
    expect(subjects.some((s) => s.startsWith('[rajahinta] Category alert:'))).toBe(true);
    expect(subjects.some((s) => s.startsWith('[rajahinta] Landed-cost alert:'))).toBe(true);
  });

  it('a PRICE row without a product is a data anomaly — skipped cleanly, no counters', async () => {
    const { world, run } = makeWorld({
      alerts: [alert({ id: 41, productId: null })],
    });

    const result = await run();

    expect(result).toMatchObject({ evaluated: 0, matched: 0, failed: 0 });
    expect(world.findByProductRange).not.toHaveBeenCalled();
    expect(world.send).not.toHaveBeenCalled();
  });

  it('strips line breaks and truncates long names in the category email subject', async () => {
    const { world, run } = makeWorld({
      alerts: [categoryAlert()],
      categoryMin: { productId: 77, priceCloseCents: 1400 },
    });

    await run(
      {},
      {
        products: {
          findById: async () => ({
            name: `${'x'.repeat(400)}\n\rBCC: victim@example.com`,
          }),
        } as never,
      },
    );

    const email = world.send.mock.calls[0]![0] as PriceAlertEmail;
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject).not.toContain('BCC');
    expect(email.subject.length).toBeLessThanOrEqual(255);
  });

  it('the category email is factual — no advice phrasing (content policy)', async () => {
    const { world, run } = makeWorld({
      alerts: [categoryAlert()],
      categoryMin: { productId: 77, priceCloseCents: 1400 },
    });

    await run();

    const email = world.send.mock.calls[0]![0] as PriceAlertEmail;
    for (const banned of ['good time to buy', 'best deal', 'buy now']) {
      expect(email.text.toLowerCase()).not.toContain(banned);
      expect(email.subject.toLowerCase()).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Configuration gate
// ---------------------------------------------------------------------------

describe('configuration gate', () => {
  it('unconfigured email path → no evaluation, one warning (freshness-alert posture)', async () => {
    const { world } = makeWorld();
    const warn = vi.fn();
    const log: Logger = { ...LOG, warn };

    const result = await handlePriceAlertEvaluation(
      makeEnv({ EMAIL_WORKER_URL: undefined }),
      log,
      {
        alerts: { findActive: world.findActive } as never as D1PriceAlertRepository,
        notifications: {} as never as D1AlertNotificationRepository,
        summaries: {} as never as D1PriceHistorySummaryRepository,
        products: {} as never as D1ProductSearchRepository,
        findAccountEmail: world.findAccountEmail,
        send: world.send,
      },
    );

    expect(result.configured).toBe(false);
    expect(result.evaluated).toBe(0);
    expect(world.findActive).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('not configured'),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Observability — counters exported through the metrics module
// ---------------------------------------------------------------------------

describe('counter export', () => {
  it('writes the five job counters as AE data points with per-run values', async () => {
    const metrics = fakeMetricsBinding();
    const { run } = makeWorld({ closeCents: 1500 });

    await run({}, {}); // one notified alert
    const { run: runSuppressed } = makeWorld({
      closeCents: 1500,
      latestDelivered: new Map([[11, deliveredRow(11, NOW)]]),
    });
    await runSuppressed({ METRICS: metrics.binding });

    expect(metrics.points.map((p) => p.indexes?.[0])).toEqual([
      PRICE_ALERT_EVALUATED_COUNTER,
      PRICE_ALERT_MATCHED_COUNTER,
      PRICE_ALERT_NOTIFIED_COUNTER,
      PRICE_ALERT_FAILED_COUNTER,
      PRICE_ALERT_SUPPRESSED_COUNTER,
    ]);
    // The second run: evaluated 1, matched 1, notified 0, failed 0,
    // suppressed 1 — the suppression is visible in the counters.
    expect(metrics.points.map((p) => p.doubles?.[0])).toEqual([1, 1, 0, 0, 1]);
  });
});

// ---------------------------------------------------------------------------
// Email rendering + the real send contract (fetch seam)
// ---------------------------------------------------------------------------

describe('buildPriceAlertEmail', () => {
  it('renders subject and body within the email Worker contract', () => {
    const email = buildPriceAlertEmail({
      to: 'user@example.com',
      productName: 'Keitele Senorita',
      productId: 123,
      observedPriceCents: 1499,
      thresholdCents: 1500,
      evaluatedAt: NOW,
    });

    expect(email.to).toBe('user@example.com');
    expect(email.subject).toContain('Keitele Senorita');
    expect(email.subject).toContain('€14.99');
    expect(email.subject.length).toBeLessThanOrEqual(255);
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.text).toContain('€14.99');
    expect(email.text).toContain('€15.00');
    expect(email.text).toContain('#123');
    expect(email.text).toContain(NOW.toISOString());
  });

  it('strips line breaks and truncates long product names in the subject', () => {
    const email = buildPriceAlertEmail({
      to: 'user@example.com',
      productName: `${'x'.repeat(400)}\n\rBCC: victim@example.com`,
      productId: 1,
      observedPriceCents: 100,
      thresholdCents: 200,
      evaluatedAt: NOW,
    });

    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject).not.toContain('BCC');
    expect(email.subject.length).toBeLessThanOrEqual(255);
  });

  it('falls back to the product id when no product row resolves', () => {
    const email = buildPriceAlertEmail({
      to: 'user@example.com',
      productName: null,
      productId: 42,
      observedPriceCents: 100,
      thresholdCents: 200,
      evaluatedAt: NOW,
    });

    expect(email.subject).toContain('Product #42');
    expect(email.text).toContain('Product #42 (#42)');
  });
});

describe('buildCategoryAlertEmail', () => {
  it('renders the tripping product, price, category, and threshold within the email Worker contract', () => {
    const email = buildCategoryAlertEmail({
      to: 'user@example.com',
      productName: 'Keitele Senorita',
      productId: 77,
      category: 'beer',
      observedPriceCents: 1499,
      thresholdCents: 1500,
      evaluatedAt: NOW,
    });

    expect(email.to).toBe('user@example.com');
    expect(email.subject).toContain('Keitele Senorita');
    expect(email.subject).toContain('€14.99');
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject.length).toBeLessThanOrEqual(255);
    expect(email.text).toContain('beer');
    expect(email.text).toContain('€14.99'); // observed category minimum
    expect(email.text).toContain('€15.00'); // the user's threshold
    expect(email.text).toContain('#77');
    expect(email.text).toContain(NOW.toISOString());
  });

  it('strips line breaks and caps long names in the body and subject', () => {
    const email = buildCategoryAlertEmail({
      to: 'user@example.com',
      productName: `${'y'.repeat(400)}\nBCC: victim@example.com`,
      productId: 42,
      category: 'wine_still',
      observedPriceCents: 100,
      thresholdCents: 200,
      evaluatedAt: NOW,
    });

    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject).not.toContain('BCC');
    expect(email.subject.length).toBeLessThanOrEqual(255);
    expect(email.text).not.toContain('BCC');
  });

  it('falls back to the product id when no product row resolves', () => {
    const email = buildCategoryAlertEmail({
      to: 'user@example.com',
      productName: null,
      productId: 42,
      category: 'wine_still',
      observedPriceCents: 100,
      thresholdCents: 200,
      evaluatedAt: NOW,
    });

    expect(email.subject).toContain('Product #42');
    expect(email.text).toContain('Product #42 (#42)');
  });
});

describe('buildLandedCostAlertEmail (task 2.2 composition citation)', () => {
  it('cites every composition fact verbatim from the input record', () => {
    const email = buildLandedCostAlertEmail({
      to: 'user@example.com',
      productName: 'Keitele Senorita',
      productId: 123,
      observedLandedCostCents: 4450,
      thresholdCents: 4500,
      facts: LANDED_FACTS,
    });

    expect(email.to).toBe('user@example.com');
    expect(email.subject).toBe(
      '[rajahinta] Landed-cost alert: Keitele Senorita at €44.50',
    );
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject.length).toBeLessThanOrEqual(255);
    // Every cited fact pinned to its INPUT value. The retail price (3500)
    // is deliberately not derivable from the other cited figures
    // (4450 − 3500 ≠ 450), so a computed rather than cited rendering
    // could not produce it.
    expect(email.text).toContain('€44.50'); // observedLandedCostCents (input)
    expect(email.text).toContain('€45.00'); // thresholdCents (input)
    expect(email.text).toContain('€35.00'); // facts.retailPriceCents 3500
    expect(email.text).toContain('€4.50'); // facts.transportCostCents 450
    expect(email.text).toContain('(posti, EE → FI)'); // route triple
    expect(email.text).toContain('Excise dataset:         v1.0-2024');
    expect(email.text).toContain('Container-duty dataset: v1.2-2024');
    expect(email.text).toContain('Confidence:             HIGH');
    expect(email.text).toContain(`Observed:               ${LANDED_FACTS.observedAt}`);
    expect(email.text).toContain('#123');
    // The quantity=1 baseline / not-a-live-quote statement.
    expect(email.text).toContain('quantity=1 baseline');
    expect(email.text).toContain('not a live quote');
  });

  it('renders the fallback states factually — no offer recorded, engine-fallback versions unknown', () => {
    const email = buildLandedCostAlertEmail({
      to: 'user@example.com',
      productName: null,
      productId: 42,
      observedLandedCostCents: 1200,
      thresholdCents: 1500,
      facts: {
        observedAt: '2026-08-29T18:00:00.000Z',
        retailPriceCents: 900,
        transportCostCents: 0,
        transportCarrier: null,
        transportOriginCountry: null,
        transportDestinationCountry: null,
        exciseDatasetVersion: null,
        containerDutyDatasetVersion: null,
        confidence: 'LOW',
      },
    });

    expect(email.subject).toContain('Product #42');
    expect(email.text).toContain('Product #42 (#42)');
    expect(email.text).toContain('€0.00 (no offer recorded)');
    expect(email.text).toContain('Excise dataset:         unknown');
    expect(email.text).toContain('Container-duty dataset: unknown');
    expect(email.text).toContain('Confidence:             LOW');
    expect(email.text).toContain('Observed:               2026-08-29T18:00:00.000Z');
  });

  it('strips line breaks and caps long names in the subject', () => {
    const email = buildLandedCostAlertEmail({
      to: 'user@example.com',
      productName: `${'z'.repeat(400)}\nBCC: victim@example.com`,
      productId: 42,
      observedLandedCostCents: 100,
      thresholdCents: 200,
      facts: LANDED_FACTS,
    });

    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject).not.toContain('BCC');
    expect(email.subject.length).toBeLessThanOrEqual(255);
    expect(email.text).not.toContain('BCC');
  });

  it('is factual — no advice phrasing in subject or body (content policy)', () => {
    for (const facts of [
      LANDED_FACTS,
      {
        ...LANDED_FACTS,
        transportCarrier: null,
        transportOriginCountry: null,
        transportDestinationCountry: null,
        exciseDatasetVersion: null,
        containerDutyDatasetVersion: null,
        confidence: 'LOW' as const,
      },
    ]) {
      const email = buildLandedCostAlertEmail({
        to: 'user@example.com',
        productName: 'Keitele Senorita',
        productId: 123,
        observedLandedCostCents: 4450,
        thresholdCents: 4500,
        facts,
      });
      for (const banned of ['good time to buy', 'best deal', 'buy now']) {
        expect(email.text.toLowerCase()).not.toContain(banned);
        expect(email.subject.toLowerCase()).not.toContain(banned);
      }
    }
  });
});

describe('sendPriceAlertEmail (email Worker send contract)', () => {
  type FetchMock = ReturnType<typeof vi.fn>;

  function stubFetch(...responses: Response[]): FetchMock {
    const fetchMock = vi.fn(async (): Promise<Response> =>
      responses.length > 0 ? responses.shift()! : new Response(null, { status: 202 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const EMAIL: PriceAlertEmail = {
    to: 'user@example.com',
    subject: '[rajahinta] Price alert',
    text: 'body',
  };

  it('POSTs to the internal send path with the shared-secret header', async () => {
    const fetchMock = stubFetch();

    await sendPriceAlertEmail(
      {
        baseUrl: 'https://rajahinta-email-worker.example.workers.dev/',
        sendSecret: 'test-shared-secret',
      },
      EMAIL,
    );

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(
      'https://rajahinta-email-worker.example.workers.dev/internal/email/send',
    );
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('x-email-send-secret')).toBe('test-shared-secret');
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toMatchObject({
      to: EMAIL.to,
      subject: EMAIL.subject,
      text: EMAIL.text,
    });
  });

  it('throws on a non-ok rejection so the caller marks the intent failed', async () => {
    stubFetch(new Response('nope', { status: 413 }));

    await expect(
      sendPriceAlertEmail({ baseUrl: 'https://email.example', sendSecret: 's' }, EMAIL),
    ).rejects.toThrow('HTTP 413');
  });
});

// ---------------------------------------------------------------------------
// Router wiring
// ---------------------------------------------------------------------------

describe('router wiring', () => {
  it('rides the shared 30-minute post-ingestion pattern', () => {
    const names = handlersForCron(PRICE_ALERT_EVALUATION_CRON).map((h) => h.name);
    expect(names).toContain('price-alert-evaluation');
    expect(names).toContain('time-series-aggregation');
    expect(names).toContain('freshness-alert');
  });
});
