/**
 * Freshness alerting cron handler (task 6.3, design D7/D8) — replaces
 * the PrometheusRule paging of infra/k8s/base/prometheusrule.yaml with
 * an in-Worker checker that evaluates the freshness invariants on the
 * aggregation cadence and delivers operator alert emails through the
 * email Worker's internal send contract (task 5.3, design D7).
 *
 * ## Where the measured values come from (reuse, not re-derivation)
 *
 * - Stale price share: the SAME audited R2 scan set the time-series
 *   aggregation reads (watermark-driven partitions) through the SAME
 *   `stalePriceShareOf` computation the gauge emitter uses — the alert
 *   and the Analytics Engine dashboard value cannot diverge.
 * - Transport age: `D1TransportOfferWritePort.findNewestObservedAt()` —
 *   the exact read the transport-rate-refresh handler (task 4.3) feeds
 *   its gauge from — aged by the SAME `transportAgeSeconds` computation
 *   the gauge writer uses (null → +Inf sentinel, metrics.ts).
 *
 * ## Threshold/`for` port (see the threshold constants below)
 *
 * Thresholds are ported verbatim from the replaced PrometheusRule
 * expressions. The `for` durations are absorbed by the evaluation
 * cadence: the checker fires on the 30-min aggregation tick, and the
 * deployment-observability spec defines firing as "exceeds its threshold
 * at the Cron evaluation" — every replaced `for` window (15–30 min) is
 * shorter than one cadence. The exposure-path canary
 * (RajahintaFreshnessMetricsAbsent) has no port: the checker computes
 * values directly from the data, so there is no scrape/export path that
 * could go silently blind.
 *
 * ## Verified ageing write-back (task 5.2, design D8)
 *
 * Before the alerting evaluation, the tick degrades aged VERIFIED retail
 * offers to STALE: the freshness window that defines `actualStatus` in
 * the data-quality classifier — `ReliabilityService.stalenessThresholdFor
 * ('price')`, the same window source, never a second constant — decides
 * which stored VERIFIED rows are past their evidence. The write is
 * status-only (price, observed_at, and the verified_at/verified_by
 * attribution pair are never touched), guarded on
 * `reliability_status = 'VERIFIED'` so a re-run over already-STALE rows
 * writes nothing. Ageing runs even where alerting emails are
 * unconfigured — it is data hygiene, not paging — and a failed pass is
 * logged without failing the tick (the next tick retries).
 *
 * ## Suppression (dedupe) — IdempotencyDO job-claim namespace
 *
 * A sustained violation would otherwise email on every tick. Each
 * invariant+severity holds an IdempotencyDO claim marker
 * (`claimJob` → email → `completeJob` with the suppression window as
 * TTL): while the completed marker is live the repeat is suppressed;
 * once it expires the next tick re-alerts. A failed send releases the
 * claim — the next cron run re-alerting IS the retry path. If the
 * handler dies between claim and send, the `processing` marker
 * self-heals via the job-claim stale reclaim (15 min). Atomicity comes
 * from the DO's input gates, the same mechanism the ingestion dedupe
 * keys use (task 4.1).
 *
 * Email Worker failures are logged, never thrown — a broken email path
 * must not fail the cron tick (the next tick re-alerts).
 *
 * @module FreshnessAlertCron
 */

import { startOfIsoWeek } from '../../../../packages/data-platform/src/d1/summary-aggregation';
import {
  OBSERVATION_LOG_PREFIX,
  observationKeysToScan,
} from '../../../../packages/data-platform/src/d1/observation-log';
import { D1AggregationWatermarkRepository } from '../../../../packages/data-platform/src/repositories/d1/aggregation-watermark.repository';
import {
  AGGREGATION_CRON,
  WATERMARK_KEY,
  readPartitions,
  stalePriceShareOf,
} from './time-series-aggregation';
import { observationLogStore } from '../adapters/r2-observation-log.store';
import { D1TransportOfferWritePort } from '../adapters/d1-domain-ports';
import {
  STALE_PRICE_SHARE_GAUGE,
  TRANSPORT_AGE_INFINITE,
  TRANSPORT_NEWEST_OFFER_AGE_GAUGE,
  transportAgeSeconds,
} from '../observability/metrics';
import { claimJob, completeJob, releaseJob } from '../do/client';
import type { JobClaimOutcome } from '../do/idempotency.do';
import { dispatchEmailToWorker, type EmailDispatchTarget } from '../services/email-send';
import { ReliabilityService } from '../adapters/core-domain-bridge';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import type { Env } from '../env';
import type { Logger } from '../logger';

/**
 * The cron pattern this handler registers under — the 30-minute
 * aggregation tick (`AGGREGATION_CRON`, already in wrangler
 * triggers.crons). Mapping to the replaced Prometheus evaluation: the
 * in-cluster rules were evaluated on the scrape interval with `for`
 * windows of 15–30 min; the checker runs where the stale-share value
 * itself is recomputed, so every replaced `for` window is covered by a
 * single cadence and alert latency is bounded by one tick (≤30 min).
 */
export const FRESHNESS_ALERT_CRON = AGGREGATION_CRON;

// ---------------------------------------------------------------------------
// Threshold port — infra/k8s/base/prometheusrule.yaml, group
// `rajahinta.freshness` (each entry names the rule it replaces)
// ---------------------------------------------------------------------------

/**
 * Stale-price-share thresholds, ported verbatim from the replaced rules'
 * expressions (`rajahinta_data_quality_stale_price_share_ratio > …`):
 *
 * - `warning` replaces **RajahintaStalePriceShareWarning**
 *   (`expr: … > 0.10`, `for: 15m`) — ingestion falling behind across
 *   merchants.
 * - `critical` replaces **RajahintaStalePriceShareCritical**
 *   (`expr: … > 0.25`, `for: 15m`) — broad merchant/feed outage.
 */
export const STALE_PRICE_SHARE_THRESHOLDS = {
  warning: { threshold: 0.1, forSeconds: 15 * 60 },
  critical: { threshold: 0.25, forSeconds: 15 * 60 },
} as const;

/**
 * Transport newest-offer-age thresholds (seconds).
 *
 * DEVIATION from the replaced rules (owner decision 2026-09-28): the
 * original literals (432000/604800 s — 5/7 days) monitored LIVE carrier
 * feeds. The monitored carriers are now manually curated in-repo
 * datasets (fransberg, posti, omniva, pakettipojat, norrlog) with a
 * few-times-per-year admin review cadence (curated-rate-refresh.ts),
 * against which a 7-day alert would fire permanently. The thresholds
 * now track the review cadence instead — the alert means "the periodic
 * manual re-verification is overdue", not "the feed broke":
 *
 * - `warning` at 45 days (3_888_000 s) — halfway to a missed quarterly
 *   review; time to schedule the re-check.
 * - `critical` at 90 days (7_776_000 s) — the quarterly review is
 *   overdue; transport data is unverified for a full season.
 *
 * The user-facing reliability staleness threshold is a SEPARATE contract
 * and stays at 7 days (core-domain DEFAULT_STALENESS_THRESHOLDS):
 * transport rows honestly degrade to STALE between reviews.
 *
 * `forSeconds` documents the replaced window; it is not evaluated (see
 * the module doc — the cadence subsumes it per the spec contract).
 */
export const TRANSPORT_AGE_THRESHOLDS = {
  warning: { thresholdSeconds: 3_888_000, forSeconds: 30 * 60 },
  critical: { thresholdSeconds: 7_776_000, forSeconds: 15 * 60 },
} as const;

/**
 * Default repeat-suppression window: 4 h — Alertmanager
 * `repeat_interval` parity. A sustained violation re-alerts at most
 * once per window instead of on every 30-min tick.
 */
export const DEFAULT_SUPPRESSION_SECONDS = 4 * 3_600;

/** Env var overriding the suppression window (seconds). */
export const SUPPRESSION_SECONDS_ENV_VAR = 'FRESHNESS_ALERT_SUPPRESSION_SECONDS';

/** Bound-check floor for a configured suppression window (1 s). */
const MIN_SUPPRESSION_SECONDS = 1;

// ---------------------------------------------------------------------------
// Violations
// ---------------------------------------------------------------------------

export type AlertSeverity = 'warning' | 'critical';

/** One breached invariant, ready to render into an alert email. */
export interface FreshnessViolation {
  /** Metric-contract invariant name (greppable continuity with Prometheus). */
  readonly invariant: string;
  readonly severity: AlertSeverity;
  /** Measured value — a 0..1 share or an age in seconds (+Inf sentinel). */
  readonly measured: number;
  /** Human-readable measured value for the email body. */
  readonly measuredLabel: string;
  /** The breached threshold (numeric twin of the ported expr RHS). */
  readonly threshold: number;
  /** Human-readable threshold for the email body. */
  readonly thresholdLabel: string;
  /** The replaced PrometheusRule alert name. */
  readonly replacedRule: string;
}

/**
 * Evaluate the stale-price-share invariant against the ported thresholds
 * — strict `>` exactly like the replaced exprs. A share breaching both
 * levels reports the higher severity (one email per invariant per tick).
 */
export function evaluateStalePriceShare(
  share: number,
): FreshnessViolation | null {
  const { warning, critical } = STALE_PRICE_SHARE_THRESHOLDS;
  if (share > critical.threshold) {
    return {
      invariant: STALE_PRICE_SHARE_GAUGE,
      severity: 'critical',
      measured: share,
      measuredLabel: `${share.toFixed(4)} (${percentLabel(share)})`,
      threshold: critical.threshold,
      thresholdLabel: `> ${critical.threshold.toFixed(2)} (${percentLabel(critical.threshold)})`,
      replacedRule: 'RajahintaStalePriceShareCritical',
    };
  }
  if (share > warning.threshold) {
    return {
      invariant: STALE_PRICE_SHARE_GAUGE,
      severity: 'warning',
      measured: share,
      measuredLabel: `${share.toFixed(4)} (${percentLabel(share)})`,
      threshold: warning.threshold,
      thresholdLabel: `> ${warning.threshold.toFixed(2)} (${percentLabel(warning.threshold)})`,
      replacedRule: 'RajahintaStalePriceShareWarning',
    };
  }
  return null;
}

/**
 * Evaluate the transport-age invariant against the ported thresholds —
 * strict `>` exactly like the replaced exprs. The +Inf sentinel (no
 * offers at all) exceeds every threshold by construction, matching the
 * gauge contract.
 */
export function evaluateTransportAge(
  ageSeconds: number,
): FreshnessViolation | null {
  const { warning, critical } = TRANSPORT_AGE_THRESHOLDS;
  if (ageSeconds > critical.thresholdSeconds) {
    return {
      invariant: TRANSPORT_NEWEST_OFFER_AGE_GAUGE,
      severity: 'critical',
      measured: ageSeconds,
      measuredLabel: ageLabel(ageSeconds),
      threshold: critical.thresholdSeconds,
      thresholdLabel: `> ${critical.thresholdSeconds} s (${daysLabel(critical.thresholdSeconds)})`,
      replacedRule: 'RajahintaTransportOfferAgeCritical',
    };
  }
  if (ageSeconds > warning.thresholdSeconds) {
    return {
      invariant: TRANSPORT_NEWEST_OFFER_AGE_GAUGE,
      severity: 'warning',
      measured: ageSeconds,
      measuredLabel: ageLabel(ageSeconds),
      threshold: warning.thresholdSeconds,
      thresholdLabel: `> ${warning.thresholdSeconds} s (${daysLabel(warning.thresholdSeconds)})`,
      replacedRule: 'RajahintaTransportOfferAgeWarning',
    };
  }
  return null;
}

function percentLabel(share: number): string {
  return `${(share * 100).toFixed(1)} %`;
}

function daysLabel(seconds: number): string {
  return `${(seconds / 86_400).toFixed(1)} days`;
}

function ageLabel(seconds: number): string {
  return seconds >= TRANSPORT_AGE_INFINITE
    ? '+Inf (no transport offers exist)'
    : `${seconds} s (${daysLabel(seconds)})`;
}

// ---------------------------------------------------------------------------
// Alert email (email Worker send contract — task 5.3)
// ---------------------------------------------------------------------------

/** The structured plain-text alert email. */
export interface AlertEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/**
 * Render one violation into the spec-contract plain-text body: it names
 * the invariant, the measured value, and the threshold
 * (cloudflare-email-service spec, "Alert email content").
 */
export function buildAlertEmail(
  violation: FreshnessViolation,
  evaluatedAt: Date,
  to: string,
): AlertEmail {
  const invariantDescription =
    violation.invariant === STALE_PRICE_SHARE_GAUGE
      ? 'stale price share — audited price offers whose reliability is STALE'
      : 'transport offer age — age of the NEWEST transport offer';
  const action =
    violation.invariant === STALE_PRICE_SHARE_GAUGE
      ? 'Check the price-ingestion queue and merchant feed health.'
      : 'Check the transport-rate-refresh cron and the carrier source.';

  const subject = `[${violation.severity.toUpperCase()}] rajahinta freshness: ${violation.invariant} breached`;
  const text = [
    `rajahinta freshness alert — ${violation.severity.toUpperCase()}`,
    '',
    `Invariant:  ${violation.invariant}`,
    `            (${invariantDescription})`,
    `Measured:   ${violation.measuredLabel}`,
    `Threshold:  ${violation.thresholdLabel}`,
    `Replaces:   PrometheusRule ${violation.replacedRule}`,
    `            (infra/k8s/base/prometheusrule.yaml, group rajahinta.freshness)`,
    `Evaluated:  ${evaluatedAt.toISOString()} by the api-worker freshness-alert cron`,
    '',
    `Action: ${action}`,
    '',
  ].join('\n');
  return { to, subject, text };
}

/**
 * POST one alert email to the email Worker's internal send contract.
 * Throws on transport or rejection — the CALLER owns the
 * log-only-never-throw policy (a broken email path must not fail the
 * cron tick).
 */
export async function sendAlertEmail(
  target: EmailDispatchTarget,
  email: AlertEmail,
): Promise<void> {
  await dispatchEmailToWorker(target, email);
}

// ---------------------------------------------------------------------------
// Verified ageing write-back (task 5.2, change transport-confidence-unlock,
// design D8)
// ---------------------------------------------------------------------------

/**
 * Degrade every aged VERIFIED retail offer to STALE — the write-back
 * pass the freshness tick runs before its alert evaluation.
 *
 * The window is the SAME one that defines `actualStatus` in the
 * data-quality classifier: `ReliabilityService.stalenessThresholdFor
 * ('price')`, whose `assessDataRecency` reports STALE exactly when
 * `now − observed_at` EXCEEDS the threshold (a row observed exactly at
 * the boundary is still fresh). The strict `observed_at < cutoff`
 * comparison over ISO-8601 text mirrors that boundary one-to-one — no
 * second freshness constant lives here.
 *
 * The update is status-only and idempotent by construction:
 *
 * - guarded on `reliability_status = 'VERIFIED'`, so already-STALE rows
 *   (and ESTIMATED / UNAVAILABLE rows, which age through re-ingestion,
 *   not through this pass) never match — a re-run writes zero rows;
 * - never touches price, observed_at, or the verified_at/verified_by
 *   attribution pair: the pair keeps recording WHO verified the offer
 *   and WHEN — the STALE status says the verification has since aged
 *   out, and re-verification overwrites the pair in place.
 *
 * @returns The number of rows transitioned VERIFIED → STALE.
 */
export async function writeBackAgedVerifiedOffers(
  d1: D1DatabaseLike,
  now: Date,
): Promise<number> {
  const threshold = new ReliabilityService().stalenessThresholdFor('price');
  const cutoff = new Date(now.getTime() - threshold.milliseconds);
  const result = await d1
    .prepare(
      `UPDATE retail_offers
          SET reliability_status = 'STALE'
        WHERE reliability_status = 'VERIFIED'
          AND observed_at < ?`,
    )
    .bind(cutoff.toISOString())
    .run();
  return Number(result.meta.changes ?? 0);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** One run's outcome — logged by the cron dispatch, asserted by tests. */
export interface FreshnessAlertResult {
  /** False when the EMAIL_WORKER binding/URL, secret, or recipient are unset. */
  readonly configured: boolean;
  /**
   * Offers transitioned VERIFIED → STALE by the ageing write-back
   * (task 5.2, design D8) — runs every tick, alerting config or not.
   * Null when the pass failed (logged; the next tick retries).
   */
  readonly verifiedToStale: number | null;
  /** Measured stale-price-share (null when unconfigured). */
  readonly staleShare: {
    readonly stale: number;
    readonly total: number;
    readonly share: number;
  } | null;
  /** Measured transport age in seconds (+Inf sentinel; null when unconfigured). */
  readonly transportAgeSeconds: number | null;
  readonly violations: readonly FreshnessViolation[];
  /** Suppression keys actually emailed this tick. */
  readonly alertsSent: readonly string[];
  /** Suppression keys withheld by a live suppression window. */
  readonly alertsSuppressed: readonly string[];
}

/** Measurement + delivery seams (test overrides; defaults are the real ones). */
export interface FreshnessAlertDeps {
  /** Defaults to the watermark-driven audited R2 scan → stalePriceShareOf. */
  measureStaleShare?: () => Promise<{ stale: number; total: number; share: number }>;
  /** Defaults to D1TransportOfferWritePort.findNewestObservedAt (the refresh read). */
  findNewestObservedAt?: () => Promise<Date | null>;
  /**
   * Defaults to the D1 VERIFIED → STALE write-back against env.DB
   * (task 5.2, design D8).
   */
  writeBackAgedVerified?: (now: Date) => Promise<number>;
  now?: () => Date;
  send?: (email: AlertEmail) => Promise<void>;
  claim?: (key: string) => Promise<JobClaimOutcome>;
  complete?: (key: string, ttlSeconds: number) => Promise<void>;
  release?: (key: string) => Promise<void>;
}

/**
 * One freshness-alert tick: age aged VERIFIED offers back to STALE
 * (status-only, idempotent), measure both invariants, evaluate the
 * ported thresholds, and email each violated invariant through the
 * email Worker — suppressed per invariant+severity within the
 * configured window. Healthy → no email, no fetch. Never throws on
 * email or write-back failure.
 */
export async function handleFreshnessAlert(
  env: Env,
  log: Logger,
  deps: FreshnessAlertDeps = {},
): Promise<FreshnessAlertResult> {
  const now = deps.now ?? (() => new Date());

  // -- Verified ageing (task 5.2, design D8) -------------------------------
  // Runs BEFORE the alerting-configuration gate: degrading aged VERIFIED
  // rows is data hygiene, not paging — it must not depend on the email
  // path being configured. The default pass is skipped only where no D1
  // binding exists at all (bare test envs). A failed pass is logged,
  // never thrown — the next tick retries and alerting proceeds.
  const writeBackAgedVerified =
    deps.writeBackAgedVerified ??
    (env.DB
      ? (at: Date) => writeBackAgedVerifiedOffers(env.DB, at)
      : async () => 0);
  let verifiedToStale: number | null;
  try {
    verifiedToStale = await writeBackAgedVerified(now());
  } catch (err) {
    log.error({
      message: `Verified-ageing write-back failed: ${
        err instanceof Error ? err.message : 'unknown error'
      } — offers stay VERIFIED until the next tick retries`,
    });
    verifiedToStale = null;
  }

  // -- Alerting configuration gate ----------------------------------------
  // Unconfigured = alerting off for the environment: skip the evaluation
  // reads entirely (no R2 scan, no D1 read) and say so once per tick.
  if (
    !env.EMAIL_SEND_SECRET ||
    (!env.EMAIL_WORKER && !env.EMAIL_WORKER_URL) ||
    !env.FRESHNESS_ALERT_EMAIL_TO
  ) {
    log.warn({
      message:
        'Freshness alerting is not configured (EMAIL_WORKER binding or ' +
        'EMAIL_WORKER_URL, EMAIL_SEND_SECRET, FRESHNESS_ALERT_EMAIL_TO) — ' +
        'invariants not evaluated this tick',
    });
    return {
      configured: false,
      verifiedToStale,
      staleShare: null,
      transportAgeSeconds: null,
      violations: [],
      alertsSent: [],
      alertsSuppressed: [],
    };
  }

  // Captured post-gate: closures (the default sender below) see plain
  // values instead of re-reading optional properties.
  const sendTarget: EmailDispatchTarget = {
    binding: env.EMAIL_WORKER,
    baseUrl: env.EMAIL_WORKER_URL,
    sendSecret: env.EMAIL_SEND_SECRET,
  };
  const alertRecipient = env.FRESHNESS_ALERT_EMAIL_TO;

  // -- Measure (the same computations the 4.3 handlers/gauges use) --------
  const measureStaleShare =
    deps.measureStaleShare ?? (async () => {
      const store = observationLogStore(env);
      const watermark = await new D1AggregationWatermarkRepository(
        env.DB,
      ).find(WATERMARK_KEY);
      const keys = await store.listKeys(OBSERVATION_LOG_PREFIX);
      const readFrom = watermark === null ? null : startOfIsoWeek(watermark);
      const records = await readPartitions(
        store,
        observationKeysToScan(keys, readFrom),
      );
      return stalePriceShareOf(records);
    });
  const findNewestObservedAt =
    deps.findNewestObservedAt ??
    (() => new D1TransportOfferWritePort(env.DB).findNewestObservedAt());

  const staleShare = await measureStaleShare();
  const transportAge = transportAgeSeconds(await findNewestObservedAt());

  const violations = [evaluateStalePriceShare(staleShare.share), evaluateTransportAge(transportAge)].filter(
    (violation): violation is FreshnessViolation => violation !== null,
  );

  log.info({
    message:
      violations.length === 0
        ? 'Freshness invariants healthy'
        : `Freshness invariants violated: ${violations.length}`,
    staleShare: staleShare.share,
    transportAgeSeconds: transportAge,
    violations: violations.length,
  });

  // -- Deliver (suppressed per invariant+severity within the window) ------
  const suppressionSeconds = resolveSuppressionSeconds(env, log);
  const claim = deps.claim ?? ((key: string) => claimJob(env, key));
  const complete =
    deps.complete ??
    ((key: string, ttlSeconds: number) =>
      completeJob(env, key, { ttlSeconds }));
  const release = deps.release ?? ((key: string) => releaseJob(env, key));
  const send =
    deps.send ?? ((email: AlertEmail) => sendAlertEmail(sendTarget, email));

  const alertsSent: string[] = [];
  const alertsSuppressed: string[] = [];

  for (const violation of violations) {
    const key = suppressionKey(violation);
    const outcome = await claim(key);
    if (outcome.status !== 'claimed') {
      log.info({
        message: `Freshness alert suppressed (${outcome.status}) — within the ${suppressionSeconds}s window`,
        invariant: violation.invariant,
        severity: violation.severity,
      });
      alertsSuppressed.push(key);
      continue;
    }

    try {
      await send(buildAlertEmail(violation, now(), alertRecipient));
    } catch (err) {
      // Email Worker failure: log only, never crash the handler — and
      // release the claim so the NEXT cron run re-alerts (that IS the
      // retry). If the release itself fails, the `processing` marker
      // still self-heals via the job-claim stale reclaim.
      log.error({
        message: `Freshness alert email failed for ${key}: ${
          err instanceof Error ? err.message : 'unknown error'
        } — will re-alert on the next tick`,
        invariant: violation.invariant,
        severity: violation.severity,
      });
      await release(key).catch((releaseErr: unknown) => {
        log.error({
          message: `Freshness alert claim release failed for ${key}: ${
            releaseErr instanceof Error ? releaseErr.message : 'unknown error'
          } — the stale claim will self-reclaim`,
        });
      });
      continue;
    }

    // Delivered — hold the suppression window. A failure here leaves the
    // `processing` marker, which self-reclaims (bounded duplicate risk)
    // rather than suppressing a live alert indefinitely.
    try {
      await complete(key, suppressionSeconds);
    } catch (err) {
      log.error({
        message: `Freshness alert suppression marker failed for ${key}: ${
          err instanceof Error ? err.message : 'unknown error'
        } — the next tick may re-alert`,
      });
    }
    alertsSent.push(key);
  }

  return {
    configured: true,
    verifiedToStale,
    staleShare,
    transportAgeSeconds: transportAge,
    violations,
    alertsSent,
    alertsSuppressed,
  };
}

/** IdempotencyDO job-claim key — one marker per invariant+severity. */
function suppressionKey(violation: FreshnessViolation): string {
  return `freshness-alert:${violation.invariant}:${violation.severity}`;
}

/**
 * Resolve the suppression window: FRESHNESS_ALERT_SUPPRESSION_SECONDS
 * override, falling back to the default with a warning on junk input.
 */
function resolveSuppressionSeconds(env: Env, log: Logger): number {
  const raw = env.FRESHNESS_ALERT_SUPPRESSION_SECONDS;
  if (raw === undefined || raw === '') {
    return DEFAULT_SUPPRESSION_SECONDS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_SUPPRESSION_SECONDS) {
    log.warn({
      message: `Invalid ${SUPPRESSION_SECONDS_ENV_VAR}="${raw}" — using the ${DEFAULT_SUPPRESSION_SECONDS}s default`,
    });
    return DEFAULT_SUPPRESSION_SECONDS;
  }
  return parsed;
}
