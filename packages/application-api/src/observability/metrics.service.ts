/**
 * Prometheus metrics exporter (FIX-M, deployment-observability spec —
 * completes the metric contract in infra/monitoring/README.md).
 *
 * Owns the freshness gauges the PrometheusRule alerts consume and serves
 * them on a dedicated INTERNAL HTTP port (`/metrics`), separate from the
 * public API port:
 *
 *   - The public rate limiter never applies (it guards per-controller on
 *     the API port only).
 *   - No ops-dashboard guard coupling: Prometheus needs bearer/allowlist
 *     credentials otherwise, and the endpoint is meant to be reachable
 *     from the cluster network only — the k8s Service exposes the port
 *     without any Ingress route.
 *
 * Opt-in by environment: the server starts only when `METRICS_PORT` is a
 * positive integer. Unset (tests, ad-hoc module boots) → no listener;
 * `0` → explicit disable. Recommended/manifest value: 9464.
 *
 * Metric contract (names are load-bearing — infra/k8s/base/prometheusrule.yaml):
 *   rajahinta_data_quality_stale_price_share_ratio  gauge  0..1
 *   rajahinta_transport_newest_offer_age_seconds    gauge  seconds
 *   rajahinta_data_quality_offers_total{status}     counter (optional, debugging)
 *
 * @module PrometheusMetricsService
 */

import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import client from 'prom-client';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { DataQualityService } from '@rajahinta/data-acquisition';

const STALE_PRICE_SHARE_METRIC = 'rajahinta_data_quality_stale_price_share_ratio';
const TRANSPORT_NEWEST_OFFER_AGE_METRIC = 'rajahinta_transport_newest_offer_age_seconds';
const DATA_QUALITY_OFFERS_METRIC = 'rajahinta_data_quality_offers_total';

const DATA_QUALITY_STATUSES = [
  'verified',
  'stale',
  'estimated',
  'unavailable',
] as const;

/** Metric-contract port (internal scraping). */
const DEFAULT_METRICS_PORT = 9464;

@Injectable()
export class PrometheusMetricsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PrometheusMetricsService.name);

  /** Dedicated registry — isolated from prom-client's global default so
   * repeated instantiation (tests, multiple app contexts) cannot collide. */
  private readonly registry = new client.Registry();

  private readonly stalePriceShare = new client.Gauge({
    name: STALE_PRICE_SHARE_METRIC,
    help: 'Share of audited retail offers whose actual recency status is STALE (24h price-domain threshold); 0 when none audited. Updated after each ingestion quality check.',
    registers: [this.registry],
  });

  private readonly transportNewestOfferAge = new client.Gauge({
    name: TRANSPORT_NEWEST_OFFER_AGE_METRIC,
    help: 'Age in seconds of the newest active transport offer (now - max(observedAt)); +Inf when no offers exist. Updated after each transport-rate refresh.',
    registers: [this.registry],
  });

  private readonly dataQualityOffers = new client.Counter({
    name: DATA_QUALITY_OFFERS_METRIC,
    help: 'Offers audited by the ingestion quality check, by resulting reliability status.',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });

  private server: Server | null = null;
  private metricsPort: number | null = null;

  constructor() {
    // Contract: both gauges render at 0 from process start (the
    // absent() canary in the PrometheusRule must not fire merely because
    // no ingestion cycle has run yet).
    this.stalePriceShare.set(0);
    this.transportNewestOfferAge.set(0);
    for (const status of DATA_QUALITY_STATUSES) {
      this.dataQualityOffers.labels(status).inc(0);
    }

    // Gauge hook for DataQualityService.runQualityCheck. Static (not a DI
    // token like OFFER_CHANGE_HOOK_TOKEN) because data-acquisition sits
    // below application-api in the layer graph and its package index is
    // not touched by this change; the class itself is exported from the
    // package root. Last writer wins — harmless for the singleton app.
    DataQualityService.setQualityReportHook((report) => this.recordQualityReport(report));
  }

  // -------------------------------------------------------------------------
  // Gauge setters — called where the data flows
  // -------------------------------------------------------------------------

  /**
   * DataQualityService.runQualityCheck hook: set the stale-price-share
   * gauge (staleCount / totalOffers, 0 when nothing was audited) and bump
   * the per-status counters.
   */
  recordQualityReport(report: {
    totalOffers: number;
    staleCount: number;
    unavailableCount: number;
    estimatedCount: number;
    verifiedCount: number;
  }): void {
    const share =
      report.totalOffers > 0 ? report.staleCount / report.totalOffers : 0;
    this.stalePriceShare.set(share);
    this.dataQualityOffers.labels('stale').inc(report.staleCount);
    this.dataQualityOffers.labels('unavailable').inc(report.unavailableCount);
    this.dataQualityOffers.labels('estimated').inc(report.estimatedCount);
    this.dataQualityOffers.labels('verified').inc(report.verifiedCount);
  }

  /**
   * Transport-rate-refresh hook: age of the newest active transport
   * offer. `null` (no offers at all) is the degenerate case of every
   * offer being stale — +Inf keeps both alert thresholds firing.
   */
  setTransportNewestOfferAge(ageSeconds: number | null): void {
    this.transportNewestOfferAge.set(ageSeconds ?? Number.POSITIVE_INFINITY);
  }

  // -------------------------------------------------------------------------
  // Internal HTTP endpoint (opt-in via METRICS_PORT)
  // -------------------------------------------------------------------------

  /** {@inheritDoc} */
  onApplicationBootstrap(): void {
    const raw = process.env.METRICS_PORT?.trim();
    if (!raw) return; // unset → disabled (tests, minimal hosts)
    const port = Number(raw);
    if (!Number.isInteger(port) || port <= 0) {
      this.logger.warn(`Ignoring invalid METRICS_PORT="${raw}" — metrics endpoint disabled`);
      return;
    }
    if (port !== DEFAULT_METRICS_PORT) {
      this.logger.log(`METRICS_PORT=${port} differs from the manifest default ${DEFAULT_METRICS_PORT}`);
    }

    this.metricsPort = port;
    this.server = createServer((req, res) => this.handle(req, res));
    // A busy port must never take the API down — log and run without
    // the endpoint (the absent() canary will page).
    this.server.on('error', (err) => {
      this.logger.error(`Metrics endpoint on port ${this.metricsPort} failed: ${err.message}`);
      this.server = null;
    });
    this.server.listen(port, '0.0.0.0', () => {
      this.logger.log(`Prometheus /metrics listening on internal port ${port}`);
    });
  }

  /** {@inheritDoc} */
  onApplicationShutdown(): void {
    this.server?.close();
    this.server = null;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'GET' || req.url !== '/metrics') {
      res.statusCode = 404;
      res.end();
      return;
    }
    void this.registry
      .metrics()
      .then((body) => {
        res.setHeader('Content-Type', this.registry.contentType);
        res.end(body);
      })
      .catch((err: unknown) => {
        this.logger.error(`Collecting metrics failed: ${String(err)}`);
        res.statusCode = 500;
        res.end();
      });
  }
}
