/**
 * Freshness alerting cron handler tests (task 6.3, design D7/D8) — the
 * PrometheusRule replacement contract:
 *
 * - healthy invariants → no email, no fetch;
 * - a violation → one structured plain-text email per invariant through
 *   a FAKE global fetch, naming the invariant, measured value, and
 *   threshold, carrying the shared-secret header;
 * - threshold port fidelity: the ported constants stay pinned to the
 *   literal replaced PrometheusRule expressions (0.10/0.25 stale-share,
 *   432000/604800 s transport age); the source rules themselves were
 *   deleted from the repo with the K8s stack (decommission, task 6.7
 *   of migrate-to-cloudflare);
 * - email Worker failure → logged, never thrown, claim released so the
 *   next tick re-alerts;
 * - suppression window honored over the REAL IdempotencyDO job-claim
 *   namespace (in-memory DO storage), expired window → re-alert;
 * - router dispatch wiring for the 30-minute pattern.
 *
 * @module FreshnessAlertTest
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  DEFAULT_SUPPRESSION_SECONDS,
  FRESHNESS_ALERT_CRON,
  STALE_PRICE_SHARE_THRESHOLDS,
  TRANSPORT_AGE_THRESHOLDS,
  buildAlertEmail,
  evaluateStalePriceShare,
  evaluateTransportAge,
  handleFreshnessAlert,
} from '../freshness-alert';
import { TRANSPORT_AGE_INFINITE } from '../../observability/metrics';
import { handlersForCron } from '../router';
import { createLogger, type Logger } from '../../logger';
import { IdempotencyDO } from '../../do/idempotency.do';
import {
  createMemoryDoState,
  createMemoryDoStorage,
} from '../../do/__tests__/memory-do-storage';
import type { Env } from '../../env';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Fixed "now" so age math and DO TTLs are deterministic. */
const NOW = new Date('2026-08-30T12:00:00.000Z');

const LOG = createLogger('error');

/** Fully-configured alerting env with a fresh in-memory IdempotencyDO. */
function alertEnv(overrides: Partial<Env> = {}): Env {
  const storage = createMemoryDoStorage();
  const instance = new IdempotencyDO(createMemoryDoState(storage), {});
  const namespace = {
    idFromName: (name: string) => ({ name }),
    get: () => ({ fetch: (request: Request) => instance.fetch(request) }),
  } as unknown as DurableObjectNamespace;
  return {
    EMAIL_WORKER_URL: 'https://rajahinta-email-worker.example.workers.dev',
    EMAIL_SEND_SECRET: 'test-shared-secret',
    FRESHNESS_ALERT_EMAIL_TO: 'ops@example.com',
    IDEMPOTENCY: namespace,
    ...overrides,
  } as unknown as Env;
}

/** Healthy measurements — 1 % stale share, offer observed 1 h ago. */
const HEALTHY = {
  measureStaleShare: async () => ({ stale: 1, total: 100, share: 0.01 }),
  findNewestObservedAt: async () => new Date(NOW.getTime() - 3_600_000),
};

/** 32 % stale share — breaches the 0.25 critical threshold. */
const STALE_CRITICAL = {
  measureStaleShare: async () => ({ stale: 32, total: 100, share: 0.32 }),
};

/** Newest transport offer observed 8 days ago — breaches 604 800 s. */
const AGE_CRITICAL = {
  findNewestObservedAt: async () =>
    new Date(NOW.getTime() - 8 * 86_400_000),
};

type FetchMock = ReturnType<typeof vi.fn>;

/**
 * Stub global fetch. Queued responses are handed out in order; any call
 * beyond the queue gets a 202 (the healthy email Worker outcome).
 */
function stubFetch(...responses: Response[]): FetchMock {
  const fetchMock = vi.fn(async (): Promise<Response> =>
    responses.length > 0 ? responses.shift()! : new Response(null, { status: 202 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function errorSpy(): { log: Logger; error: ReturnType<typeof vi.fn> } {
  const error = vi.fn();
  return { log: { ...LOG, error }, error };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Threshold port fidelity — the replaced PrometheusRule expressions
// ---------------------------------------------------------------------------

describe('threshold port fidelity (replaced PrometheusRule expressions)', () => {
  // The replaced rule file (infra/k8s/base/prometheusrule.yaml) was
  // deleted with the K8s stack at decommission (task 6.7); the literals
  // below are the exact expressions it carried, pinned here so any
  // drift on this side is a deliberate one-act change.
  it('pins the ported constants to the replaced rule expressions', () => {
    // RajahintaStalePriceShareWarning / Critical
    //   expr: rajahinta_data_quality_stale_price_share_ratio > 0.10 / > 0.25
    expect(STALE_PRICE_SHARE_THRESHOLDS.warning.threshold).toBe(0.1);
    expect(STALE_PRICE_SHARE_THRESHOLDS.critical.threshold).toBe(0.25);
    // RajahintaTransportOfferAgeWarning / Critical
    //   expr: rajahinta_transport_newest_offer_age_seconds > 432000 / > 604800
    expect(TRANSPORT_AGE_THRESHOLDS.warning.thresholdSeconds).toBe(432_000);
    expect(TRANSPORT_AGE_THRESHOLDS.critical.thresholdSeconds).toBe(604_800);
  });

  it('keeps strict-> semantics: a value exactly AT a threshold does not fire that severity', () => {
    // Exactly at a boundary the expr `> threshold` is false for THAT
    // rule — but the lower severity still holds (0.25 > 0.10), exactly
    // as the replaced Prometheus rules would behave.
    expect(evaluateStalePriceShare(0.1)).toBeNull();
    expect(evaluateStalePriceShare(0.25)?.severity).toBe('warning');
    expect(evaluateTransportAge(432_000)).toBeNull();
    expect(evaluateTransportAge(604_800)?.severity).toBe('warning');
  });

  it('fires warning below critical and critical above it', () => {
    expect(evaluateStalePriceShare(0.100001)?.severity).toBe('warning');
    expect(evaluateStalePriceShare(0.250001)?.severity).toBe('critical');
    expect(evaluateTransportAge(432_001)?.severity).toBe('warning');
    expect(evaluateTransportAge(604_801)?.severity).toBe('critical');
  });

  it('treats the +Inf sentinel (no transport offers) as breaching every threshold', () => {
    const violation = evaluateTransportAge(TRANSPORT_AGE_INFINITE);
    expect(violation?.severity).toBe('critical');
    expect(violation?.measuredLabel).toBe('+Inf (no transport offers exist)');
  });

  it('stays silent on healthy values', () => {
    expect(evaluateStalePriceShare(0)).toBeNull();
    expect(evaluateStalePriceShare(0.099999)).toBeNull();
    expect(evaluateTransportAge(0)).toBeNull();
    expect(evaluateTransportAge(431_999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Handler — measurement, delivery, failure, suppression
// ---------------------------------------------------------------------------

describe('handleFreshnessAlert', () => {
  it('healthy invariants → no fetch call at all', async () => {
    const fetchMock = stubFetch();
    const result = await handleFreshnessAlert(alertEnv(), LOG, {
      ...HEALTHY,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.configured).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.alertsSent).toEqual([]);
  });

  it('unconfigured alerting → no evaluation, no fetch, one warning', async () => {
    const fetchMock = stubFetch();
    const warn = vi.fn();
    const log: Logger = { ...LOG, warn };
    const result = await handleFreshnessAlert(
      { EMAIL_SEND_SECRET: 'x' } as unknown as Env,
      log,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.configured).toBe(false);
    expect(result.staleShare).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('not configured'),
      }),
    );
  });

  it('violation → one email per invariant with the spec-contract payload', async () => {
    const fetchMock = stubFetch();
    const result = await handleFreshnessAlert(alertEnv(), LOG, {
      ...STALE_CRITICAL,
      ...AGE_CRITICAL,
    });

    // One POST per violated invariant (stale share critical + transport
    // age critical), each to the configured email Worker send contract.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.alertsSent).toHaveLength(2);
    expect(result.violations).toHaveLength(2);

    for (const call of fetchMock.mock.calls) {
      const [url, init] = call as [string, RequestInit];
      expect(url).toBe(
        'https://rajahinta-email-worker.example.workers.dev/internal/email/send',
      );
      expect(init.method).toBe('POST');
    }
  });

  it('stale-share email names the invariant, measured value, and threshold', async () => {
    const fetchMock = stubFetch();
    await handleFreshnessAlert(alertEnv(), LOG, {
      ...STALE_CRITICAL,
      findNewestObservedAt: HEALTHY.findNewestObservedAt,
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      to: string;
      subject: string;
      text: string;
    };

    expect(body.to).toBe('ops@example.com');
    expect(body.subject).toContain('rajahinta_data_quality_stale_price_share_ratio');
    expect(body.subject).toContain('CRITICAL');
    expect(body.text).toContain('rajahinta_data_quality_stale_price_share_ratio');
    expect(body.text).toContain('0.3200 (32.0 %)');
    expect(body.text).toContain('> 0.25 (25.0 %)');
    expect(body.text).toContain('RajahintaStalePriceShareCritical');
  });

  it('transport-age email names the invariant, measured seconds, and threshold', async () => {
    const fetchMock = stubFetch();
    await handleFreshnessAlert(alertEnv(), LOG, {
      measureStaleShare: HEALTHY.measureStaleShare,
      ...AGE_CRITICAL,
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      to: string;
      subject: string;
      text: string;
    };

    expect(body.subject).toContain('rajahinta_transport_newest_offer_age_seconds');
    expect(body.text).toContain('rajahinta_transport_newest_offer_age_seconds');
    // 8 days = 691 200 s under the frozen clock.
    expect(body.text).toContain('691200 s (8.0 days)');
    expect(body.text).toContain('> 604800 s (7.0 days)');
    expect(body.text).toContain('RajahintaTransportOfferAgeCritical');
  });

  it('carries the shared-secret header and JSON content type', async () => {
    const fetchMock = stubFetch();
    await handleFreshnessAlert(alertEnv(), LOG, {
      ...STALE_CRITICAL,
      findNewestObservedAt: HEALTHY.findNewestObservedAt,
    });

    const headers = new Headers(fetchMock.mock.calls[0]![1]!.headers);
    expect(headers.get('x-email-send-secret')).toBe('test-shared-secret');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('email Worker 500 → logged, not thrown; claim released so the next tick re-alerts', async () => {
    const fetchMock = stubFetch(new Response('nope', { status: 500 }));
    const { log, error } = errorSpy();
    const env = alertEnv();
    const deps = { ...STALE_CRITICAL, findNewestObservedAt: HEALTHY.findNewestObservedAt };

    const first = await handleFreshnessAlert(env, log, deps);
    expect(first.alertsSent).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('HTTP 500'),
      }),
    );

    // The retry IS the next cron run — the released claim lets it email.
    const second = await handleFreshnessAlert(env, log, deps);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second.alertsSent).toHaveLength(1);
  });

  it('fetch rejection (network) → logged, not thrown', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('DNS resolution failed');
    });
    vi.stubGlobal('fetch', fetchMock);
    const { log, error } = errorSpy();

    const result = await handleFreshnessAlert(alertEnv(), log, {
      ...STALE_CRITICAL,
      findNewestObservedAt: HEALTHY.findNewestObservedAt,
    });

    expect(result.alertsSent).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('DNS resolution failed'),
      }),
    );
  });

  it('suppression window: a sustained violation emails once, then stays silent', async () => {
    const fetchMock = stubFetch();
    const env = alertEnv();
    const deps = { ...STALE_CRITICAL, findNewestObservedAt: HEALTHY.findNewestObservedAt };

    const first = await handleFreshnessAlert(env, LOG, deps);
    const second = await handleFreshnessAlert(env, LOG, deps);

    expect(first.alertsSent).toHaveLength(1);
    expect(second.alertsSent).toEqual([]);
    expect(second.alertsSuppressed).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('suppression is per invariant+severity — an escalation within the window still pages', async () => {
    const fetchMock = stubFetch();
    const env = alertEnv();
    // Tick 1: 20 % stale share — WARNING fires.
    const warning = await handleFreshnessAlert(env, LOG, {
      measureStaleShare: async () => ({ stale: 20, total: 100, share: 0.2 }),
      findNewestObservedAt: HEALTHY.findNewestObservedAt,
    });
    expect(warning.alertsSent).toHaveLength(1);

    // Tick 2: degradation to 32 % — CRITICAL was never emailed, so the
    // warning suppression must not silence it (same env = same DO).
    const escalated = await handleFreshnessAlert(env, LOG, {
      ...STALE_CRITICAL,
      findNewestObservedAt: HEALTHY.findNewestObservedAt,
    });

    expect(escalated.alertsSent).toHaveLength(1);
    expect(escalated.alertsSent[0]).toContain(':critical');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('expired suppression window → re-alert', async () => {
    const fetchMock = stubFetch();
    const deps = { ...STALE_CRITICAL, findNewestObservedAt: HEALTHY.findNewestObservedAt };
    const env = alertEnv();

    await handleFreshnessAlert(env, LOG, deps);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // One second past the window the completed marker expires lazily and
    // the sustained violation alerts again.
    vi.setSystemTime(new Date(NOW.getTime() + (DEFAULT_SUPPRESSION_SECONDS + 1) * 1_000));
    const third = await handleFreshnessAlert(env, LOG, deps);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(third.alertsSent).toHaveLength(1);
  });

  it('invalid suppression override falls back to the default with a warning', async () => {
    stubFetch();
    const warn = vi.fn();
    const log: Logger = { ...LOG, warn };
    const deps = {
      ...STALE_CRITICAL,
      findNewestObservedAt: HEALTHY.findNewestObservedAt,
    };

    const result = await handleFreshnessAlert(
      alertEnv({ FRESHNESS_ALERT_SUPPRESSION_SECONDS: 'not-a-number' }),
      log,
      deps,
    );

    expect(result.alertsSent).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('FRESHNESS_ALERT_SUPPRESSION_SECONDS'),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Email rendering (spec: cloudflare-email-service — alert email content)
// ---------------------------------------------------------------------------

describe('buildAlertEmail', () => {
  it('renders the plain-text contract fields for a stale-share violation', () => {
    const violation = evaluateStalePriceShare(0.32)!;
    const email = buildAlertEmail(violation, NOW, 'ops@example.com');

    expect(email.to).toBe('ops@example.com');
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject.length).toBeLessThanOrEqual(255);
    expect(email.text).toContain(violation.invariant);
    expect(email.text).toContain(violation.measuredLabel);
    expect(email.text).toContain(violation.thresholdLabel);
    expect(email.text).toContain(NOW.toISOString());
  });

  it('renders a transport-age violation with its replaced rule named', () => {
    const violation = evaluateTransportAge(691_200)!;
    const email = buildAlertEmail(violation, NOW, 'ops@example.com');

    expect(email.text).toContain('RajahintaTransportOfferAgeCritical');
    expect(email.text).toContain('691200 s (8.0 days)');
  });
});

// ---------------------------------------------------------------------------
// Router wiring
// ---------------------------------------------------------------------------

describe('router wiring', () => {
  it('the freshness alert rides the 30-minute aggregation pattern', () => {
    const names = handlersForCron(FRESHNESS_ALERT_CRON).map((h) => h.name);
    expect(names).toContain('freshness-alert');
    expect(names).toContain('time-series-aggregation');
  });
});
