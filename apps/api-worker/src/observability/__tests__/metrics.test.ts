/**
 * Analytics Engine metrics tests (task 6.1/6.2, design D8).
 *
 * - request-metrics middleware emission against a FAKE AE binding
 *   (index/blob/double sinks recording every writeDataPoint): route
 *   PATTERN bucketing (no raw-path cardinality), status classes, method,
 *   duration;
 * - the no-op fallback path when the METRICS binding is absent, and
 *   tolerance of a throwing binding;
 * - the freshness gauge writers (stale share, transport age + the +Inf
 *   sentinel) and the status-class mapping;
 * - config presence assertions over wrangler.jsonc (per-env datasets,
 *   traces export keys).
 *
 * @module AnalyticsEngineMetricsTest
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../../env';
import {
  PRICE_ALERT_FAILED_COUNTER,
  PRICE_ALERT_MATCHED_COUNTER,
  PRICE_ALERT_NOTIFIED_COUNTER,
  PRICE_ALERT_EVALUATED_COUNTER,
  PRICE_ALERT_SUPPRESSED_COUNTER,
  STALE_PRICE_SHARE_GAUGE,
  TRANSPORT_AGE_INFINITE,
  TRANSPORT_NEWEST_OFFER_AGE_GAUGE,
  metricsEmitter,
  recordPriceAlertEvaluationCounters,
  recordStalePriceShare,
  recordTransportAge,
  requestMetrics,
  statusClassOf,
} from '../metrics';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Fake AE binding — index/blob/double sinks recording every call
// ---------------------------------------------------------------------------

/** One recorded writeDataPoint call. */
type RecordedPoint = AnalyticsEngineDataPoint;

interface FakeAnalyticsEngine {
  /** The binding-shaped object to place in env.METRICS. */
  binding: AnalyticsEngineDataset;
  /** Every recorded data point, in call order. */
  points: RecordedPoint[];
}

function fakeAnalyticsEngine(
  write?: (point: RecordedPoint) => void,
): FakeAnalyticsEngine {
  const points: RecordedPoint[] = [];
  return {
    points,
    binding: {
      writeDataPoint(event?: RecordedPoint): void {
        const point = event ?? {};
        points.push(point);
        write?.(point);
      },
    },
  };
}

function envWith(ae: FakeAnalyticsEngine | null): Env {
  return (ae === null ? {} : { METRICS: ae.binding }) as unknown as Env;
}

/** A minimal app mirroring createApp's outermost composition. */
function buildApp(): {
  app: Hono<AppEnv>;
  routeThrows: () => void;
} {
  const app = new Hono<AppEnv>();
  app.use(requestMetrics());
  app.onError((err, c) => c.json({ message: String(err) }, 500));
  app.get('/api/v1/products/:id/price-history', (c) => c.json({ ok: true }));
  app.post('/api/v1/calculator', (c) => c.json({ ok: true }));
  let throwInHandler = false;
  app.get('/api/v1/test/boom', (c) => {
    if (throwInHandler) throw new Error('boom');
    return c.json({ ok: true });
  });
  return { app, routeThrows: () => (throwInHandler = true) };
}

async function request(
  env: Env | undefined,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { app } = buildApp();
  return (await app.request(path, init, env)) as Response;
}

// ---------------------------------------------------------------------------
// Middleware emission
// ---------------------------------------------------------------------------

describe('requestMetrics middleware (fake AE binding)', () => {
  const ae = fakeAnalyticsEngine();
  const env = envWith(ae);

  it('buckets by ROUTE PATTERN, not raw path — no cardinality explosion', async () => {
    await request(env, '/api/v1/products/123/price-history');
    await request(env, '/api/v1/products/999/price-history');
    expect(ae.points).toHaveLength(2);
    for (const point of ae.points) {
      expect(point.indexes).toEqual(['/api/v1/products/:id/price-history']);
    }
  });

  it('emits method, status class, exact status, and duration', async () => {
    ae.points.length = 0;
    const res = await request(env, '/api/v1/calculator', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(ae.points).toHaveLength(1);
    const [point] = ae.points;
    expect(point.blobs?.[0]).toBe('POST');
    expect(point.blobs?.[1]).toBe('2xx');
    expect(point.blobs?.[2]).toBe('200');
    expect(typeof point.doubles?.[0]).toBe('number');
    expect(point.doubles?.[0]).toBeGreaterThanOrEqual(0);
  });

  it('classifies 4xx for unmatched routes — and falls back to a constant bucket', async () => {
    ae.points.length = 0;
    // Two DIFFERENT raw paths, both unmatched: the bucket must not
    // carry either raw path (404 scanners must not explode the index).
    await request(env, '/api/v1/products/abc/def/ghi');
    await request(env, '/api/v1/totally/unknown/path');
    expect(ae.points).toHaveLength(2);
    for (const point of ae.points) {
      expect(point.blobs?.[1]).toBe('4xx');
      expect(point.blobs?.[2]).toBe('404');
      expect(point.indexes).toEqual(['unmatched']);
    }
  });

  it('classifies 5xx when a handler throws (status read after onError)', async () => {
    ae.points.length = 0;
    const { app, routeThrows } = buildApp();
    routeThrows();
    const res = (await app.request('/api/v1/test/boom', {}, env)) as Response;
    expect(res.status).toBe(500);
    expect(ae.points).toHaveLength(1);
    expect(ae.points[0].blobs?.[1]).toBe('5xx');
    expect(ae.points[0].blobs?.[2]).toBe('500');
  });

  it('swallows a throwing binding — the response is unaffected', async () => {
    const throwing = fakeAnalyticsEngine(() => {
      throw new Error('AE unavailable');
    });
    const res = await request(envWith(throwing), '/api/v1/calculator', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(throwing.points).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// No-op fallback (binding absent — dev/local, or undefined env in tests)
// ---------------------------------------------------------------------------

describe('no-op fallback without the METRICS binding', () => {
  it('emitter reports enabled=false', () => {
    expect(metricsEmitter(undefined).enabled).toBe(false);
    expect(metricsEmitter({} as Pick<Env, 'METRICS'>).enabled).toBe(false);
    expect(metricsEmitter(envWith(null)).enabled).toBe(false);
  });

  it('requests complete and nothing throws without a binding or env', async () => {
    const res = await request(envWith(null), '/api/v1/calculator', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const noEnv = await request(undefined, '/api/v1/products/1/price-history');
    expect(noEnv.status).toBe(200);
  });

  it('gauge writers no-op safely', () => {
    expect(() =>
      recordStalePriceShare(envWith(null), 1, 4),
    ).not.toThrow();
    expect(() =>
      recordTransportAge(envWith(null), new Date()),
    ).not.toThrow();
    expect(() =>
      recordTransportAge(envWith(null), null),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Status classes
// ---------------------------------------------------------------------------

describe('statusClassOf (InstrumentationService statusGroup parity)', () => {
  it('maps the hundreds bucket to the Nxx class', () => {
    expect(statusClassOf(200)).toBe('2xx');
    expect(statusClassOf(201)).toBe('2xx');
    expect(statusClassOf(302)).toBe('3xx');
    expect(statusClassOf(404)).toBe('4xx');
    expect(statusClassOf(422)).toBe('4xx');
    expect(statusClassOf(500)).toBe('5xx');
    expect(statusClassOf(503)).toBe('5xx');
  });
});

// ---------------------------------------------------------------------------
// Freshness gauge writes
// ---------------------------------------------------------------------------

describe('freshness gauge writers (fake AE binding)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recordStalePriceShare writes the Prometheus-contract name and the share', () => {
    const ae = fakeAnalyticsEngine();
    recordStalePriceShare(envWith(ae), 3, 4);
    expect(ae.points).toHaveLength(1);
    const [point] = ae.points;
    expect(point.indexes).toEqual([STALE_PRICE_SHARE_GAUGE]);
    expect(point.blobs?.[0]).toBe(STALE_PRICE_SHARE_GAUGE);
    expect(point.blobs?.[1]).toBe(String(3 / 4));
    expect(point.doubles?.[0]).toBeCloseTo(0.75);
  });

  it('recordStalePriceShare renders 0 when nothing was audited (canary contract)', () => {
    const ae = fakeAnalyticsEngine();
    recordStalePriceShare(envWith(ae), 0, 0);
    expect(ae.points[0].doubles?.[0]).toBe(0);
    expect(ae.points[0].blobs?.[1]).toBe('0');
  });

  it('recordTransportAge writes whole seconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T12:00:00Z'));
    const ae = fakeAnalyticsEngine();
    recordTransportAge(envWith(ae), new Date('2026-08-30T10:00:00Z'));
    expect(ae.points[0].indexes).toEqual([TRANSPORT_NEWEST_OFFER_AGE_GAUGE]);
    expect(ae.points[0].doubles?.[0]).toBe(7200);
    expect(ae.points[0].blobs?.[1]).toBe('7200');
  });

  it('recordTransportAge encodes no-offers as +Inf (sentinel + faithful blob)', () => {
    const ae = fakeAnalyticsEngine();
    recordTransportAge(envWith(ae), null);
    expect(ae.points[0].doubles?.[0]).toBe(TRANSPORT_AGE_INFINITE);
    expect(Number.isFinite(ae.points[0].doubles?.[0])).toBe(true); // AE-safe
    expect(ae.points[0].blobs?.[1]).toBe('+Inf');
  });

  it('recordGauge carries labels as JSON in blob3', () => {
    const ae = fakeAnalyticsEngine();
    metricsEmitter(envWith(ae)).recordGauge({
      name: TRANSPORT_NEWEST_OFFER_AGE_GAUGE,
      value: 60,
      labels: { carrier: '*' },
    });
    expect(ae.points[0].blobs?.[2]).toBe('{"carrier":"*"}');
  });
});

// ---------------------------------------------------------------------------
// Price-alert job counter writes (task 2.2)
// ---------------------------------------------------------------------------

describe('recordPriceAlertEvaluationCounters (fake AE binding)', () => {
  it('writes one point per counter with the stable name/value pairing', () => {
    const ae = fakeAnalyticsEngine();
    recordPriceAlertEvaluationCounters(envWith(ae), {
      evaluated: 4,
      matched: 2,
      notified: 1,
      failed: 1,
      suppressed: 1,
    });

    expect(ae.points).toHaveLength(5);
    expect(ae.points.map((p) => p.indexes?.[0])).toEqual([
      PRICE_ALERT_EVALUATED_COUNTER,
      PRICE_ALERT_MATCHED_COUNTER,
      PRICE_ALERT_NOTIFIED_COUNTER,
      PRICE_ALERT_FAILED_COUNTER,
      PRICE_ALERT_SUPPRESSED_COUNTER,
    ]);
    expect(ae.points.map((p) => p.doubles?.[0])).toEqual([4, 2, 1, 1, 1]);
    // Self-describing blobs (AE convention) carry the name too.
    expect(ae.points[0].blobs?.[0]).toBe(PRICE_ALERT_EVALUATED_COUNTER);
    expect(ae.points[0].blobs?.[1]).toBe('4');
  });

  it('no-ops safely without the METRICS binding', () => {
    expect(() =>
      recordPriceAlertEvaluationCounters(envWith(null), {
        evaluated: 1,
        matched: 1,
        notified: 0,
        failed: 0,
        suppressed: 0,
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// wrangler.jsonc config presence assertions (task 6.1 + 6.2 wiring)
// ---------------------------------------------------------------------------

/**
 * Strip JSONC comments WITHOUT touching `//` inside string literals
 * (wrangler.jsonc carries "../../"-style relative paths) — a small
 * string-aware state machine.
 */
function stripJsoncComments(jsonc: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < jsonc.length; i++) {
    const char = jsonc[i];
    if (inString) {
      out += char;
      if (char === '\\') {
        out += jsonc[i + 1] ?? '';
        i++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && jsonc[i + 1] === '/') {
      while (i < jsonc.length && jsonc[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (char === '/' && jsonc[i + 1] === '*') {
      i += 2;
      while (i < jsonc.length && !(jsonc[i] === '*' && jsonc[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += char;
  }
  return out;
}

function wranglerConfig(): Record<string, unknown> {
  const path = fileURLToPath(new URL('../../../wrangler.jsonc', import.meta.url));
  return JSON.parse(stripJsoncComments(readFileSync(path, 'utf8')));
}

interface AeDatasetEntry {
  binding: string;
  dataset: string;
}

describe('wrangler.jsonc config presence', () => {
  const config = wranglerConfig();
  const envs = ['dev', 'staging', 'production'] as const;

  it('declares the METRICS Analytics Engine dataset per environment', () => {
    const datasets: string[] = [];
    for (const scope of [config, ...envs.map((e) => (config.env as Record<string, unknown>)[e])]) {
      const entries = (scope as Record<string, unknown>)[
        'analytics_engine_datasets'
      ] as AeDatasetEntry[];
      expect(entries, `analytics_engine_datasets missing in ${String(scope)}`).toBeTruthy();
      expect(entries).toHaveLength(1);
      expect(entries[0].binding).toBe('METRICS');
      datasets.push(entries[0].dataset);
    }
    // Four scopes (top-level mirrors dev + staging + production): one
    // distinct dataset per env (design D9).
    expect(datasets[0]).toBe('rajahinta-api-metrics-dev');
    expect(datasets[1]).toBe('rajahinta-api-metrics-dev');
    expect(datasets[2]).toBe('rajahinta-api-metrics-staging');
    expect(datasets[3]).toBe('rajahinta-api-metrics-production');
    expect(new Set(datasets).size).toBe(datasets.length - 1); // top-level == dev
  });

  it('configures the Grafana OTLP trace export (task 6.2 keys)', () => {
    const observability = config['observability'] as Record<string, unknown>;
    expect(observability['enabled']).toBe(true);
    const traces = observability['traces'] as Record<string, unknown>;
    expect(traces['enabled']).toBe(true);
    // Head sampling: 0 < rate <= 1 (cost control for per-span billing).
    const rate = traces['head_sampling_rate'] as number;
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThanOrEqual(1);
    // Grafana is the sole trace destination — no dashboard double storage.
    expect(traces['persist']).toBe(false);
    const destinations = traces['destinations'] as string[];
    expect(Array.isArray(destinations)).toBe(true);
    expect(destinations).toContain('rajahinta-grafana-traces');
  });
});
