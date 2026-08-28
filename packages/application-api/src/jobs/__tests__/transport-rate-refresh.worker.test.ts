/**
 * TransportRateRefreshWorker tests.
 *
 * Verifies the freshness alerting path (task 7.4 / background-jobs
 * spec, FIX-M): after each refresh the worker sets the
 * rajahinta_transport_newest_offer_age_seconds gauge on the Prometheus
 * exporter and raises the alert when the newest offer exceeds the 7-day
 * transport staleness threshold — including when no offers exist at all.
 *
 * @module TransportRateRefreshWorkerTest
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { TransportRateRefreshWorker } from '../workers/transport-rate-refresh.worker';
import type { TransportRateRefreshJobData } from '../workers/transport-rate-refresh.worker';
import type { TransportRateService, TransportRateRefreshResult } from '@rajahinta/data-acquisition';
import type { PrometheusMetricsService } from '../../observability/metrics.service';
import type { Job } from 'bullmq';

const DAY_MS = 24 * 60 * 60 * 1000;

function createJob(carrierId = '*'): Job<TransportRateRefreshJobData> {
  return {
    data: { carrierId },
    attemptsMade: 0,
  } as unknown as Job<TransportRateRefreshJobData>;
}

function createService(
  result: TransportRateRefreshResult,
): TransportRateService {
  return {
    refreshCarrierRates: vi.fn().mockResolvedValue(result),
    schedulePeriodicRefresh: vi.fn(),
  } as unknown as TransportRateService;
}

/** Captures gauge writes without a prom-client instance. */
function createMetrics(): PrometheusMetricsService & {
  setTransportNewestOfferAge: ReturnType<typeof vi.fn>;
} {
  return {
    setTransportNewestOfferAge: vi.fn(),
  } as unknown as PrometheusMetricsService & {
    setTransportNewestOfferAge: ReturnType<typeof vi.fn>;
  };
}

describe('TransportRateRefreshWorker', () => {
  let worker: TransportRateRefreshWorker;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    worker = new TransportRateRefreshWorker(createService({ ratesUpdated: 3, newestOfferObservedAt: new Date() }));
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls refreshCarrierRates with the job carrierId and logs the update count', async () => {
    const service = createService({ ratesUpdated: 3, newestOfferObservedAt: new Date() });
    worker = new TransportRateRefreshWorker(service);

    await worker.process(createJob('posti'));

    expect(service.refreshCarrierRates).toHaveBeenCalledWith('posti');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Refreshed 3 transport rates'));
  });

  it('sets the newest-offer-age gauge on a fresh refresh', async () => {
    const metrics = createMetrics();
    worker = new TransportRateRefreshWorker(
      createService({ ratesUpdated: 2, newestOfferObservedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) }),
      metrics,
    );

    await worker.process(createJob());

    expect(metrics.setTransportNewestOfferAge).toHaveBeenCalledTimes(1);
    const ageSeconds = metrics.setTransportNewestOfferAge.mock.calls[0][0] as number;
    expect(ageSeconds).toBeGreaterThanOrEqual(7200);
    expect(ageSeconds).toBeLessThan(7300);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('raises the freshness alert when the newest offer exceeds 7 days', async () => {
    worker = new TransportRateRefreshWorker(
      createService({ ratesUpdated: 0, newestOfferObservedAt: new Date(Date.now() - 8 * DAY_MS) }),
    );

    await worker.process(createJob());

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = String(errorSpy.mock.calls[0][0]);
    expect(message).toContain('rajahinta_transport_newest_offer_age_seconds=');
    expect(message).toContain('TRANSPORT_FRESHNESS_ALERT');
    expect(message).toContain('7-day threshold');
  });

  it('does not alert exactly at fresh ages within the threshold', async () => {
    worker = new TransportRateRefreshWorker(
      createService({ ratesUpdated: 1, newestOfferObservedAt: new Date(Date.now() - 6 * DAY_MS) }),
    );

    await worker.process(createJob());

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('alerts when no transport offers exist at all', async () => {
    const metrics = createMetrics();
    worker = new TransportRateRefreshWorker(
      createService({ ratesUpdated: 0, newestOfferObservedAt: null }),
      metrics,
    );

    await worker.process(createJob());

    // No offers → gauge +Inf (every offer stale by definition).
    expect(metrics.setTransportNewestOfferAge).toHaveBeenCalledWith(null);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = String(errorSpy.mock.calls[0][0]);
    expect(message).toContain('rajahinta_transport_newest_offer_age_seconds=+Inf');
    expect(message).toContain('no transport offers exist');
  });
});
