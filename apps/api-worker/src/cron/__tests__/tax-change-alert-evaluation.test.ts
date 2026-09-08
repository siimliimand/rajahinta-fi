/**
 * Tax-change alert evaluation tests (task 4.1, design D5):
 *
 * - selection: the default alert read filters `status = 'active'` AND
 *   `kind = 'TAX_CHANGE'`; a product selects only when an attributed
 *   step crossed a rule-version boundary with a NON-ZERO landed-cost
 *   delta; confirmed-version scoping ties a run to the confirmation
 *   that enqueued it; merchant-price-only movement never selects;
 * - the 24-hour cooldown is the SHARED half-open window (same constant
 *   as the PRICE sweep): a delivered row strictly younger than 24 h
 *   suppresses, exactly 24 h re-notifies, suppression is visible in the
 *   counters;
 * - crash-safe redelivery: the intent row is written BEFORE dispatch
 *   and marked AFTER; a retried run skips delivered rows (no second
 *   email per trigger); a FAILED send leaves the alert un-cooled and
 *   the next run re-attempts;
 * - the PRICE path is unchanged: threshold-less (TAX_CHANGE) rows are
 *   skipped by the PRICE sweep without any read, while PRICE rows in
 *   the same scan set deliver exactly as before;
 * - the enqueue hook is fail-open: a failing evaluation never throws;
 * - no cron registration — evaluation rides the confirmation hook, not
 *   a cadence.
 *
 * @module TaxChangeAlertEvaluationTest
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TAX_CHANGE_ALERT_LOOKBACK_DAYS,
  buildTaxChangeAlertEmail,
  enqueueTaxChangeAlertEvaluation,
  handleTaxChangeAlertEvaluation,
  resolveLandedCostSteps,
  selectLandedCostDelta,
  type LandedCostStep,
} from '../tax-change-alert-evaluation';
import { PRICE_ALERT_COOLDOWN_MS, handlePriceAlertEvaluation } from '../price-alert-evaluation';
import { cronRoutingTable } from '../router';
import { createLogger, type Logger } from '../../logger';
import type { Env } from '../../env';
import type {
  AlertNotificationIntentInput,
  AlertNotificationRecord,
  D1AlertNotificationRepository,
} from '../../../../../packages/data-platform/src/repositories/d1/alert-notification.repository';
import type { D1ProductSearchRepository } from '../../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import type {
  D1PriceAlertRepository,
  PriceAlertRecord,
} from '../../../../../packages/data-platform/src/repositories/d1/price-alert.repository';
import type { D1PriceHistorySummaryRepository } from '../../../../../packages/data-platform/src/repositories/d1/price-history-summary.repository';
import type {
  RuleVersionBoundary,
} from '../../../../../packages/core-domain/src/history/services/tax-change-attribution.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Fixed "now" — the cooldown boundary math is deterministic against it. */
const NOW = new Date('2026-09-08T12:00:00.000Z');

const LOG = createLogger('error');

function alert(overrides: Partial<PriceAlertRecord> = {}): PriceAlertRecord {
  return {
    id: 21,
    accountId: 7,
    productId: 123,
    kind: 'TAX_CHANGE',
    thresholdCents: null,
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function boundary(label: string): RuleVersionBoundary {
  return { fromVersionLabel: 'v2025', toVersionLabel: label };
}

/** A tax-boundary step with a landed-cost delta (the trigger case). */
function step(overrides: Partial<LandedCostStep> = {}): LandedCostStep {
  const from = overrides.fromLandedCostCents ?? 2000;
  const to = overrides.toLandedCostCents ?? 2136;
  return {
    merchant: 'systembolaget',
    classification: 'TAX_RULE_CHANGE',
    fromLandedCostCents: from,
    toLandedCostCents: to,
    deltaCents: to - from,
    fromObservedAt: new Date(NOW.getTime() - 3_600_000),
    toObservedAt: new Date(NOW.getTime() - 1_800_000),
    exciseRuleBoundary: boundary('v2026'),
    containerDutyRuleBoundary: null,
    ...overrides,
  };
}

function deliveredRow(alertId: number, createdAt: Date): AlertNotificationRecord {
  return {
    id: 90,
    alertId,
    observedPriceCents: 2136,
    channel: 'email',
    deliveryStatus: 'delivered',
    createdAt,
    markedAt: createdAt,
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
// price-alert-evaluation test precedent)
// ---------------------------------------------------------------------------

interface World {
  findActive: ReturnType<typeof vi.fn>;
  findLatestDeliveredByAlertId: ReturnType<typeof vi.fn>;
  createIntent: ReturnType<typeof vi.fn>;
  markDelivered: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  findAccountEmail: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  readSteps: ReturnType<typeof vi.fn>;
}

interface WorldOptions {
  /** Active TAX_CHANGE scan set. */
  alerts?: PriceAlertRecord[];
  /** Attributed steps per readSteps call. */
  steps?: LandedCostStep[];
  /** Pre-existing delivered notification rows, by alert id. */
  latestDelivered?: Map<number, AlertNotificationRecord>;
  /** The account-email read result (default: an address). */
  email?: string | null;
  /** The dispatch behavior (default: success). */
  sendImpl?: () => Promise<void>;
  /** Confirmed version labels for the run. */
  confirmedVersions?: string[];
}

function makeWorld(options: WorldOptions = {}): {
  world: World;
  run: (envOverrides?: Partial<Env>, confirmedVersions?: string[]) => Promise<
    Awaited<ReturnType<typeof handleTaxChangeAlertEvaluation>>
  >;
} {
  const {
    alerts = [alert()],
    steps = [step()],
    latestDelivered = new Map(),
    email = 'user@example.com',
    sendImpl,
    confirmedVersions = [],
  } = options;

  let intentSeq = 500;
  const findActive = vi.fn(async () => alerts);
  const readSteps = vi.fn(async () => steps);
  const findLatestDeliveredByAlertId = vi.fn(async (alertId: number) =>
    latestDelivered.get(alertId) ?? null,
  );
  const createIntent = vi.fn(
    async (input: AlertNotificationIntentInput) =>
      ({
        id: ++intentSeq,
        alertId: input.alertId,
        observedPriceCents: input.observedPriceCents,
        channel: 'email' as const,
        deliveryStatus: 'pending' as const,
        createdAt: NOW,
        markedAt: null,
      }) satisfies AlertNotificationRecord,
  );
  const markDelivered = vi.fn(
    async (id: number) =>
      ({
        id,
        alertId: 21,
        observedPriceCents: 2136,
        channel: 'email',
        deliveryStatus: 'delivered',
        createdAt: NOW,
        markedAt: NOW,
      }) satisfies AlertNotificationRecord,
  );
  const markFailed = vi.fn(async () => null);
  const findById = vi.fn(async () => ({
    name: 'Keitele Senorita',
    category: 'beer',
  }));
  const findAccountEmail = vi.fn(async () => email);
  const send = vi.fn(sendImpl ?? (async () => undefined));

  const world: World = {
    findActive,
    readSteps,
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
    run: (envOverrides = {}, versions = confirmedVersions) =>
      handleTaxChangeAlertEvaluation(makeEnv(envOverrides), LOG, {
        alerts: { findActive } as never as D1PriceAlertRepository,
        notifications: {
          findLatestDeliveredByAlertId: world.findLatestDeliveredByAlertId,
          createIntent: world.createIntent,
          markDelivered: world.markDelivered,
          markFailed: world.markFailed,
        } as never as D1AlertNotificationRepository,
        products: { findById: world.findById } as never as D1ProductSearchRepository,
        findAccountEmail: world.findAccountEmail,
        send: world.send,
        readSteps: world.readSteps,
        confirmedVersions: versions,
      }),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Selection — active TAX_CHANGE alerts only
// ---------------------------------------------------------------------------

describe('selection: active TAX_CHANGE scan set', () => {
  it('reads the scan set through the repository kind filter — findActive("TAX_CHANGE")', async () => {
    const { world, run } = makeWorld();

    await run();

    // The repository owns the SQL (task 1.4); the evaluator's selection
    // obligation is the kind argument and processing only what it returns.
    expect(world.findActive).toHaveBeenCalledWith('TAX_CHANGE');
    expect(world.findActive.mock.results[0]).toBeDefined();
  });

  it('a tax-boundary step with a non-zero delta selects and notifies', async () => {
    const { world, run } = makeWorld();

    const result = await run();

    expect(result.activeAlerts).toBe(1);
    expect(result.evaluated).toBe(1);
    expect(result.matched).toBe(1);
    expect(result.notified).toBe(1);
    expect(world.send).toHaveBeenCalledTimes(1);
    // The intent freezes the NEW materialized landed cost.
    expect(world.createIntent.mock.calls[0]![0]).toMatchObject({
      alertId: 21,
      observedPriceCents: 2136,
      channel: 'email',
    });
  });

  it('a rule boundary with a ZERO delta does not select — the rate change never reached the shelf', async () => {
    const { world, run } = makeWorld({ steps: [step({ fromLandedCostCents: 2136, toLandedCostCents: 2136 })] });

    const result = await run();

    expect(result.evaluated).toBe(1);
    expect(result.matched).toBe(0);
    expect(world.send).not.toHaveBeenCalled();
    expect(world.createIntent).not.toHaveBeenCalled();
  });

  it('a merchant-price move without a rule boundary does not select', async () => {
    const { world, run } = makeWorld({
      steps: [
        step({
          classification: 'MERCHANT_PRICE_CHANGE',
          exciseRuleBoundary: null,
          containerDutyRuleBoundary: null,
        }),
      ],
    });

    const result = await run();

    expect(result.evaluated).toBe(1);
    expect(result.matched).toBe(0);
    expect(world.send).not.toHaveBeenCalled();
  });

  it('confirmed-version scoping: only steps INTO a confirmed version select', async () => {
    const { world, run } = makeWorld({
      steps: [step({ exciseRuleBoundary: boundary('v2026-09') })],
    });

    // The confirmation published 'v2026' — the step into 'v2026-09' is
    // not part of this delta and must not notify.
    const scoped = await run({}, ['v2026']);
    expect(scoped.matched).toBe(0);
    expect(world.send).not.toHaveBeenCalled();

    // Matching the published label selects.
    const matching = await makeWorld({
      steps: [step({ exciseRuleBoundary: boundary('v2026-09') })],
    }).run({}, ['v2026-09']);
    expect(matching.matched).toBe(1);
    expect(matching.notified).toBe(1);
  });

  it('a product with no attributed steps is skipped, not evaluated', async () => {
    const { world, run } = makeWorld({ steps: [] });

    const result = await run();

    expect(result.evaluated).toBe(0);
    expect(result.matched).toBe(0);
    expect(world.send).not.toHaveBeenCalled();
  });

  it('selectLandedCostDelta picks the LATEST qualifying step across merchants', () => {
    const earlier = step({
      merchant: 'premium',
      toObservedAt: new Date(NOW.getTime() - 7_200_000),
    });
    const later = step({
      merchant: 'systembolaget',
      toObservedAt: new Date(NOW.getTime() - 1_800_000),
    });
    const noise = step({
      merchant: 'other',
      exciseRuleBoundary: null,
      containerDutyRuleBoundary: null,
      toObservedAt: new Date(NOW.getTime() - 900_000),
    });

    expect(selectLandedCostDelta([earlier, later, noise], [])).toBe(later);
    expect(selectLandedCostDelta([], [])).toBeNull();
  });

  it('resolveLandedCostSteps fails open without the observation bucket — no steps, no throw', async () => {
    const findById = vi.fn();
    const warn = vi.fn();
    const log: Logger = { ...LOG, warn };

    const steps = await resolveLandedCostSteps(
      makeEnv({ OBSERVATION_LOG: undefined }),
      { findById } as never as D1ProductSearchRepository,
      123,
      NOW,
      log,
    );

    expect(steps).toEqual([]);
    expect(findById).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('OBSERVATION_LOG'),
      }),
    );
  });

  it(`the attribution window is bounded to ${TAX_CHANGE_ALERT_LOOKBACK_DAYS} days by the module constant`, () => {
    expect(TAX_CHANGE_ALERT_LOOKBACK_DAYS).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Cooldown — the SHARED 24-hour half-open window
// ---------------------------------------------------------------------------

describe('24h cooldown (shared with the PRICE sweep)', () => {
  it('uses the SAME cooldown constant as the PRICE sweep', () => {
    // One notification limit for BOTH kinds (spec: notification rate
    // limit) — the window value must be the shared export, not a twin.
    expect(PRICE_ALERT_COOLDOWN_MS).toBe(24 * 3_600 * 1_000);
  });

  it('a delivered row 1 ms inside the window suppresses — counted, not sent', async () => {
    const { world, run } = makeWorld({
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

  it('a delivered row EXACTLY 24 h old has had its window elapse — re-notifies', async () => {
    const { world, run } = makeWorld({
      latestDelivered: new Map([
        [21, deliveredRow(21, new Date(NOW.getTime() - PRICE_ALERT_COOLDOWN_MS))],
      ]),
    });

    const result = await run();

    expect(result.suppressed).toBe(0);
    expect(result.notified).toBe(1);
    expect(world.send).toHaveBeenCalledTimes(1);
  });

  it('a TAX_CHANGE delivery does not cool a PRICE alert of the same product is out of scope here — cooldown is per ALERT id', async () => {
    // The cooldown read is per alert id (findLatestDeliveredByAlertId):
    // an alert of the OTHER kind with the same product never appears in
    // this run's reads.
    const { world, run } = makeWorld();
    await run();
    expect(world.findLatestDeliveredByAlertId).toHaveBeenCalledWith(21);
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
  });

  it('a retried run skips delivered rows — no duplicate email per trigger', async () => {
    const latestDelivered = new Map<number, AlertNotificationRecord>();
    const { world, run } = makeWorld({ latestDelivered });

    // Run 1 delivers (the "crash" happens after the mark is persisted).
    const first = await run();
    expect(first.notified).toBe(1);
    expect(world.send).toHaveBeenCalledTimes(1);

    // Run 2 (the retry): the same delta still selects, but the delivered
    // row from run 1 routes it through the shared cooldown — suppressed,
    // no second send.
    latestDelivered.set(21, deliveredRow(21, NOW));
    const second = await run();

    expect(second.notified).toBe(0);
    expect(second.suppressed).toBe(1);
    expect(world.send).toHaveBeenCalledTimes(1);
  });

  it('a failed dispatch marks the row FAILED and the next run re-attempts — the retry path', async () => {
    let attempt = 0;
    const sendImpl = async (): Promise<void> => {
      attempt++;
      if (attempt === 1) throw new Error('email worker rejected the send: HTTP 500');
    };
    const latestDelivered = new Map<number, AlertNotificationRecord>();
    const { world, run } = makeWorld({ latestDelivered, sendImpl });

    const failedRun = await run();
    expect(failedRun.notified).toBe(0);
    expect(failedRun.failed).toBe(1);
    expect(world.markFailed).toHaveBeenCalledTimes(1);
    const intent = (await world.createIntent.mock.results[0]!
      .value) as AlertNotificationRecord;
    expect(world.markFailed).toHaveBeenCalledWith(intent.id);

    // A FAILED row never cooled the alert (only DELIVERED rows do), so
    // the next run re-attempts the delivery.
    const retry = await run();
    expect(retry.notified).toBe(1);
    expect(world.send).toHaveBeenCalledTimes(2);
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
    const failing = alert({ id: 22, accountId: 8, productId: 456 });
    const { world, run } = makeWorld({ alerts: [failing, alert()] });
    // Alert 22's attribution explodes; alert 21 must still deliver.
    world.readSteps.mockImplementation(async (productId: number) => {
      if (productId === 456) throw new Error('R2 read failed');
      return [step()];
    });

    const result = await run();

    expect(result.activeAlerts).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.notified).toBe(1);
    expect(world.send).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// PRICE path unchanged — kind ownership in the PRICE sweep
// ---------------------------------------------------------------------------

describe('PRICE path unchanged (kind ownership guard)', () => {
  it('the PRICE sweep skips a threshold-less TAX_CHANGE row without any read', async () => {
    const findByProductRange = vi.fn(async () => [
      { periodStart: '2026-09-08', priceCloseCents: 1499 },
    ]);
    const createIntent = vi.fn();
    const send = vi.fn(async () => undefined);

    const taxShapedRow = alert({ id: 99 });

    const result = await handlePriceAlertEvaluation(makeEnv(), LOG, {
      alerts: {
        findActive: async () => [taxShapedRow],
      } as never as D1PriceAlertRepository,
      notifications: {
        findLatestDeliveredByAlertId: async () => null,
        createIntent,
        markDelivered: async () => null,
        markFailed: async () => null,
      } as never as D1AlertNotificationRepository,
      summaries: {
        findByProductRange,
      } as never as D1PriceHistorySummaryRepository,
      products: {
        findById: async () => ({ name: 'Keitele Senorita' }),
      } as never as D1ProductSearchRepository,
      findAccountEmail: async () => 'user@example.com',
      send,
    });

    // The TAX_CHANGE-shaped row was skipped before any summary read or
    // counter; the sweep found nothing to evaluate.
    expect(result.activeAlerts).toBe(1);
    expect(result.evaluated).toBe(0);
    expect(findByProductRange).not.toHaveBeenCalled();
    expect(createIntent).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('a PRICE row in the same scan set as a TAX_CHANGE row still evaluates normally', async () => {
    const findByProductRange = vi.fn(async () => [
      { periodStart: '2026-09-08', priceCloseCents: 1499 },
    ]);
    const createIntent = vi.fn(
      async (input: AlertNotificationIntentInput) =>
        ({
          id: 600,
          alertId: input.alertId,
          observedPriceCents: input.observedPriceCents,
          channel: 'email' as const,
          deliveryStatus: 'pending' as const,
          createdAt: NOW,
          markedAt: null,
        }) satisfies AlertNotificationRecord,
    );
    const send = vi.fn(async () => undefined);

    const priceAlert = {
      id: 11,
      accountId: 7,
      productId: 123,
      kind: 'PRICE' as const,
      thresholdCents: 1500,
      status: 'active',
      createdAt: NOW,
      updatedAt: NOW,
    } satisfies PriceAlertRecord;
    const taxRow = alert({ id: 99, productId: 456 });

    const result = await handlePriceAlertEvaluation(makeEnv(), LOG, {
      alerts: {
        findActive: async () => [priceAlert, taxRow],
      } as never as D1PriceAlertRepository,
      notifications: {
        findLatestDeliveredByAlertId: async () => null,
        createIntent,
        markDelivered: async () => ({
          id: 600,
          alertId: 11,
          observedPriceCents: 1499,
          channel: 'email',
          deliveryStatus: 'delivered',
          createdAt: NOW,
          markedAt: NOW,
        }),
        markFailed: async () => null,
      } as never as D1AlertNotificationRepository,
      summaries: {
        findByProductRange,
      } as never as D1PriceHistorySummaryRepository,
      products: {
        findById: async () => ({ name: 'Keitele Senorita' }),
      } as never as D1ProductSearchRepository,
      findAccountEmail: async () => 'user@example.com',
      send,
    });

    // The PRICE alert evaluated and delivered exactly as before; the
    // TAX_CHANGE row was owned by the tax evaluator, not this sweep.
    expect(result.activeAlerts).toBe(2);
    expect(result.evaluated).toBe(1);
    expect(result.matched).toBe(1);
    expect(result.notified).toBe(1);
    expect(findByProductRange).toHaveBeenCalledTimes(1);
    expect(findByProductRange).toHaveBeenCalledWith(
      123,
      'daily',
      expect.any(String),
      expect.any(String),
    );
    expect(createIntent).toHaveBeenCalledWith(
      expect.objectContaining({ alertId: 11, observedPriceCents: 1499 }),
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Enqueue hook — fail-open (design D3 rule)
// ---------------------------------------------------------------------------

describe('enqueueTaxChangeAlertEvaluation (fail-open confirmation hook)', () => {
  it('an unconfigured email path resolves a no-op result — never a rejection', async () => {
    const warn = vi.fn();
    const log: Logger = { ...LOG, warn };

    const outcome = await enqueueTaxChangeAlertEvaluation(
      makeEnv({ EMAIL_WORKER_URL: undefined }),
      log,
      ['v2026'],
    );

    // The unconfigured-email gate short-circuits to a logged no-op —
    // still a resolved result, never a rejection.
    expect(outcome).toEqual({
      configured: false,
      activeAlerts: 0,
      evaluated: 0,
      matched: 0,
      notified: 0,
      failed: 0,
      suppressed: 0,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('not configured'),
      }),
    );
  });

  it('catches a scan-level crash and resolves null with an error log', async () => {
    const error = vi.fn();
    const log: Logger = { ...LOG, error };

    // Force a crash INSIDE the handler past the config gate: the alerts
    // read explodes. enqueue must swallow it (fail-open).
    const crashingEnv = makeEnv();
    Object.defineProperty(crashingEnv, 'DB', {
      get() {
        throw new Error('D1 unavailable');
      },
    });

    const outcome = await enqueueTaxChangeAlertEvaluation(crashingEnv, log, []);

    expect(outcome).toBeNull();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('fail-open'),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Email rendering
// ---------------------------------------------------------------------------

describe('buildTaxChangeAlertEmail', () => {
  it('renders old → new landed cost, delta, and bounding version labels', () => {
    const email = buildTaxChangeAlertEmail({
      to: 'user@example.com',
      productName: 'Keitele Senorita',
      productId: 123,
      fromLandedCostCents: 2000,
      toLandedCostCents: 2136,
      fromVersionLabel: 'v2025',
      toVersionLabel: 'v2026',
      evaluatedAt: NOW,
    });

    expect(email.to).toBe('user@example.com');
    expect(email.subject).toContain('Keitele Senorita');
    expect(email.subject).toContain('€21.36');
    expect(email.subject.length).toBeLessThanOrEqual(255);
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.text).toContain('€20.00 → €21.36');
    expect(email.text).toContain('+€1.36');
    expect(email.text).toContain('v2025 → v2026');
    expect(email.text).toContain('#123');
    expect(email.text).toContain(NOW.toISOString());
  });

  it('a negative delta renders with the minus sign and stays within contract', () => {
    const email = buildTaxChangeAlertEmail({
      to: 'user@example.com',
      productName: `${'x'.repeat(400)}\r\nBCC: victim@example.com`,
      productId: 1,
      fromLandedCostCents: 2500,
      toLandedCostCents: 2360,
      fromVersionLabel: 'v2025',
      toVersionLabel: 'v2026',
      evaluatedAt: NOW,
    });

    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject).not.toContain('BCC');
    expect(email.subject.length).toBeLessThanOrEqual(255);
    expect(email.text).toContain('−€1.40');
  });

  it('falls back to the product id when no product row resolves', () => {
    const email = buildTaxChangeAlertEmail({
      to: 'user@example.com',
      productName: null,
      productId: 42,
      fromLandedCostCents: 2000,
      toLandedCostCents: 2100,
      fromVersionLabel: null,
      toVersionLabel: null,
      evaluatedAt: NOW,
    });

    expect(email.subject).toContain('Product #42');
    expect(email.text).toContain('unknown → unknown');
  });
});

// ---------------------------------------------------------------------------
// Router wiring — NO cron pattern (publication-triggered, not cadence)
// ---------------------------------------------------------------------------

describe('router wiring', () => {
  it('registers on no cron pattern — evaluation rides the confirmation hook', () => {
    const registered: string[] = [];
    for (const handlers of cronRoutingTable().values()) {
      for (const handler of handlers) {
        registered.push(handler.name);
      }
    }
    expect(registered).not.toContain('tax-change-alert-evaluation');
  });
});
