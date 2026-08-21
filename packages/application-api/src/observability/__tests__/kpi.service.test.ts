/**
 * Tests for KpiService — in-memory KPI metric buffer with flush-to-log.
 *
 * Covers metric recording, buffering, auto-flush on buffer full, log format,
 * manual flush, and dispose. Uses direct instantiation (no @nestjs/testing)
 * matching the project pattern established in sibling tests.
 *
 * @module KpiServiceTest
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { KpiService } from '../kpi.service';
import { KpiCategory, MetricType } from '../kpi.types';
import type { KpiMetric } from '../kpi.types';

// ---------------------------------------------------------------------------
// Test subclass — disables the auto-flush timer so tests drive flush manually
// ---------------------------------------------------------------------------

class TestKpiService extends KpiService {
  constructor() {
    super();
    // The constructor called startAutoFlush(10000). Clear that timer immediately
    // so tests control flush timing.
    this.dispose();
  }

  /** Expose protected flush for test assertions on timer state. */
  get flushTimerIsActive(): boolean {
    // Access the private flushTimer field via the fact that dispose() nulls it.
    // We check indirectly: after dispose() the timer is null; after startAutoFlush
    // it is set. Reflect on the instance.
    return (this as any).flushTimer !== null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Factory to produce a KpiMetric that matches the service schema. */
function makeMetric(overrides?: Partial<KpiMetric>): KpiMetric {
  return {
    timestamp: expect.any(String),
    category: KpiCategory.PRODUCT,
    metric: 'test.metric',
    value: 42,
    metricType: MetricType.COUNTER,
    tags: {},
    ...overrides,
  };
}

/** Parse a log line captured by the spy back into a KpiMetric object. */
function parseLogLine(line: string): KpiMetric | null {
  // Expected format: "[KPI] { ...json... }"
  const prefix = '[KPI] ';
  if (!line.startsWith(prefix)) return null;
  try {
    return JSON.parse(line.slice(prefix.length)) as KpiMetric;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KpiService', () => {
  let service: TestKpiService;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on Logger.prototype.log before each test so we capture all log output
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    service = new TestKpiService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Metric recording
  // ---------------------------------------------------------------------------

  describe('record', () => {
    it('records a single metric to the buffer', () => {
      service.record(KpiCategory.PRODUCT, 'test.metric', 42);

      const metrics = service.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toMatchObject({
        category: KpiCategory.PRODUCT,
        metric: 'test.metric',
        value: 42,
        metricType: MetricType.COUNTER,
      });
      expect(metrics[0].timestamp).toEqual(expect.any(String));
      expect(typeof Date.parse(metrics[0].timestamp)).toBe('number');
    });

    it('records multiple metrics in order', () => {
      service.record(KpiCategory.PRODUCT, 'a', 1);
      service.record(KpiCategory.COMMERCIAL, 'b', 2);
      service.record(KpiCategory.DATA, 'c', 3);

      const metrics = service.getMetrics();
      expect(metrics).toHaveLength(3);
      expect(metrics.map((m) => m.metric)).toEqual(['a', 'b', 'c']);
    });

    it('accepts optional tags and metricType', () => {
      service.record(
        KpiCategory.COMPLIANCE,
        'audit.check',
        1,
        { region: 'fi', env: 'prod' },
        MetricType.GAUGE,
      );

      const [metric] = service.getMetrics();
      expect(metric.tags).toEqual({ region: 'fi', env: 'prod' });
      expect(metric.metricType).toBe(MetricType.GAUGE);
    });

    it('defaults tags to empty object when omitted', () => {
      service.record(KpiCategory.PRODUCT, 'defaults', 1);

      const [metric] = service.getMetrics();
      expect(metric.tags).toEqual({});
    });

    it('defaults metricType to COUNTER when omitted', () => {
      service.record(KpiCategory.PRODUCT, 'defaults', 1);

      const [metric] = service.getMetrics();
      expect(metric.metricType).toBe(MetricType.COUNTER);
    });

    it('records metrics with different categories', () => {
      const categories = Object.values(KpiCategory);
      for (const cat of categories) {
        service.record(cat, `metric.${cat}`, 1);
      }

      const metrics = service.getMetrics();
      expect(metrics).toHaveLength(categories.length);
      const recordedCategories = metrics.map((m) => m.category).sort();
      expect(recordedCategories).toEqual([...categories].sort());
    });
  });

  // ---------------------------------------------------------------------------
  // Buffering — getMetrics snapshot semantics
  // ---------------------------------------------------------------------------

  describe('buffering', () => {
    it('getMetrics returns a live reference to the buffer (not a copy)', () => {
      service.record(KpiCategory.PRODUCT, 'a', 1);
      const ref = service.getMetrics();

      service.record(KpiCategory.PRODUCT, 'b', 2);

      // The returned array is a live reference — mutations to the internal buffer
      // appear in previously captured references.
      expect(ref).toHaveLength(2);
    });

    it('buffer is empty initially', () => {
      expect(service.getMetrics()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Manual flush
  // ---------------------------------------------------------------------------

  describe('flush', () => {
    it('flushes buffered metrics to the log', () => {
      service.record(KpiCategory.PRODUCT, 'flush.test', 99);
      service.flush();

      expect(logSpy).toHaveBeenCalledTimes(1);

      const logArg = logSpy.mock.calls[0][0] as string;
      const parsed = parseLogLine(logArg);
      expect(parsed).not.toBeNull();
      expect(parsed!.metric).toBe('flush.test');
      expect(parsed!.value).toBe(99);
    });

    it('empties the buffer after flush', () => {
      service.record(KpiCategory.PRODUCT, 'a', 1);
      service.record(KpiCategory.COMMERCIAL, 'b', 2);

      service.flush();

      expect(service.getMetrics()).toHaveLength(0);
    });

    it('is a no-op when buffer is empty', () => {
      service.flush();

      expect(logSpy).not.toHaveBeenCalled();
    });

    it('logs each metric as a separate structured JSON line', () => {
      service.record(KpiCategory.PRODUCT, 'm1', 1);
      service.record(KpiCategory.COMMERCIAL, 'm2', 2);
      service.record(KpiCategory.DATA, 'm3', 3);

      service.flush();

      expect(logSpy).toHaveBeenCalledTimes(3);

      const lines = logSpy.mock.calls.map((c) => c[0] as string);
      const parsed = lines.map(parseLogLine);

      expect(parsed).toHaveLength(3);
      expect(parsed.every((p) => p !== null)).toBe(true);
      expect(parsed.map((p) => p!.metric)).toEqual(['m1', 'm2', 'm3']);
    });

    it('multiple flushes can be called sequentially', () => {
      service.record(KpiCategory.PRODUCT, 'a', 1);
      service.flush();
      expect(service.getMetrics()).toHaveLength(0);

      service.record(KpiCategory.PRODUCT, 'b', 2);
      service.flush();
      expect(service.getMetrics()).toHaveLength(0);

      expect(logSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Auto-flush on buffer full
  // ---------------------------------------------------------------------------

  describe('auto-flush on buffer full', () => {
    it('flushes automatically when buffer reaches MAX_BUFFER_SIZE (500)', () => {
      // Record 500 metrics — that's the threshold
      for (let i = 0; i < 500; i++) {
        service.record(KpiCategory.PRODUCT, `auto.${i}`, i);
      }

      // Buffer should have been flushed on the 500th push
      expect(service.getMetrics()).toHaveLength(0);

      // At least 500 log calls (one per metric in the flush batch)
      expect(logSpy.mock.calls.length).toBeGreaterThanOrEqual(500);
    });

    it('does NOT flush before reaching MAX_BUFFER_SIZE', () => {
      for (let i = 0; i < 499; i++) {
        service.record(KpiCategory.PRODUCT, `pre.${i}`, i);
      }

      // Buffer should still contain 499 metrics — no auto-flush yet
      expect(service.getMetrics()).toHaveLength(499);
      // No log output unless someone called flush manually
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('flushes and then continues buffering new metrics', () => {
      // Fill to threshold
      for (let i = 0; i < 500; i++) {
        service.record(KpiCategory.PRODUCT, `batch1.${i}`, i);
      }

      // Buffer cleared
      expect(service.getMetrics()).toHaveLength(0);

      // Record new metrics after flush
      service.record(KpiCategory.COMMERCIAL, 'post.flush', 1);
      expect(service.getMetrics()).toHaveLength(1);
      expect(service.getMetrics()[0].metric).toBe('post.flush');
    });
  });

  // ---------------------------------------------------------------------------
  // Log format
  // ---------------------------------------------------------------------------

  describe('log format', () => {
    it('writes each metric line with [KPI] prefix', () => {
      service.record(KpiCategory.PRODUCT, 'format.test', 7);
      service.flush();

      const logArg = logSpy.mock.calls[0][0] as string;
      expect(logArg).toMatch(/^\[KPI\] /);
    });

    it('writes valid JSON after the [KPI] prefix', () => {
      service.record(KpiCategory.PRODUCT, 'json.test', 7, { region: 'fi' });
      service.flush();

      const logArg = logSpy.mock.calls[0][0] as string;
      const jsonPart = logArg.slice('[KPI] '.length);

      expect(() => JSON.parse(jsonPart)).not.toThrow();
    });

    it('includes all required KpiMetric fields in log output', () => {
      service.record(
        KpiCategory.DATA,
        'schema.test',
        3.14,
        { source: 'alko' },
        MetricType.HISTOGRAM,
      );
      service.flush();

      const logArg = logSpy.mock.calls[0][0] as string;
      const parsed = parseLogLine(logArg);

      expect(parsed).toMatchObject({
        category: KpiCategory.DATA,
        metric: 'schema.test',
        value: 3.14,
        metricType: MetricType.HISTOGRAM,
        tags: { source: 'alko' },
      });
      expect(parsed!.timestamp).toEqual(expect.any(String));
    });

    it('timestamp in log output is a parseable ISO-8601 string', () => {
      service.record(KpiCategory.PRODUCT, 'ts.test', 1);
      service.flush();

      const parsed = parseLogLine(logSpy.mock.calls[0][0] as string);
      const ts = Date.parse(parsed!.timestamp);
      expect(Number.isNaN(ts)).toBe(false);
    });

    it('log output is one line per metric (no multi-line artifacts)', () => {
      service.record(KpiCategory.PRODUCT, 'a', 1);
      service.record(KpiCategory.COMMERCIAL, 'b', 2);
      service.flush();

      for (const call of logSpy.mock.calls) {
        const line = call[0] as string;
        // A single structured JSON line should not contain line breaks
        expect(line).not.toContain('\n');
        expect(line).not.toContain('\r');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  describe('dispose', () => {
    it('flushes remaining metrics on dispose', () => {
      service.record(KpiCategory.PRODUCT, 'dispose.a', 1);
      service.record(KpiCategory.PRODUCT, 'dispose.b', 2);

      service.dispose();

      // Should have flushed both metrics
      expect(logSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(service.getMetrics()).toHaveLength(0);
    });

    it('stops the auto-flush timer', () => {
      // TestKpiService already called dispose in constructor to disable the timer.
      // Verify the timer is now inactive.
      expect(service.flushTimerIsActive).toBe(false);
    });

    it('is idempotent — calling dispose twice does not throw', () => {
      service.record(KpiCategory.PRODUCT, 'idempotent', 1);
      service.dispose();
      expect(() => service.dispose()).not.toThrow();
    });

    it('dispose on empty service does not log', () => {
      // Clear any spy calls from constructor / setup
      logSpy.mockClear();
      service.dispose();
      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});