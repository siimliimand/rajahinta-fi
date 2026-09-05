/**
 * Price-alert evaluation cron handler (task 2.2, change
 * product-roadmap-phases-1-4, design R2) — the Hinta-Haukka sweep.
 *
 * ## Cadence — shared post-ingestion tick
 *
 * Registered on the EXISTING 30-minute aggregation pattern
 * ({@link AGGREGATION_CRON}, already in wrangler triggers.crons; task
 * 10.1 owns wrangler). The same tick materializes the price summaries
 * this handler reads, so evaluation runs on the post-ingestion cadence
 * with alert latency bounded by one tick. There is deliberately no
 * ordering guarantee between same-tick handlers (per-handler waitUntil
 * isolation, router.ts): an alert whose bucket lands on tick N is
 * evaluated on tick N or N+1 — bounded staleness, no correctness issue.
 *
 * ## Data source — materialized summaries only
 *
 * The observed price is the close of the NEWEST product-wide daily
 * summary bucket within the lookback window (`findByProductRange`
 * ascending, last row) — never the raw R2 observation log (design R2).
 * A product with no bucket inside the window is skipped, not evaluated:
 * a "price drop" must reflect a recent materialized observation, and a
 * genuine movement always produces fresh buckets (hourly ingestion).
 *
 * ## Delivery pipeline (crash-safe, per matched alert)
 *
 * cooldown check → intent row (PENDING) → email dispatch → outcome
 * mark. The intent row exists before any dispatch attempt; marking is
 * pending-only (task 2.1's one-shot anchor), so the outcome of an
 * attempt is recorded exactly once. Idempotency on retry routes through
 * the SAME cooldown read: a row already marked DELIVERED within the
 * window suppresses the re-run — a crashed sweep never double-sends an
 * alert it already delivered. The one bounded window is a crash AFTER
 * the send but BEFORE markDelivered: the row stays pending and the next
 * tick re-attempts (the freshness-alert suppression marker carries the
 * identical documented risk; closing it would need a pending-lookup the
 * repositories intentionally do not expose). A FAILED send also stays
 * un-cooled — the next tick's re-attempt IS the retry path.
 *
 * Cooldown boundary: "within the last 24-hour period" is a half-open
 * window — suppress iff the latest delivered row is strictly younger
 * than 24h; a row exactly 24h old has had its window elapse and may
 * re-notify (spec: re-trigger AFTER the cooldown window has passed).
 *
 * Emails dispatch through the email Worker's internal send contract
 * behind the shared-secret header, exactly like the freshness alert.
 *
 * Per-alert error isolation: one failing alert counts as failed and the
 * sweep continues. Counters (evaluated/matched/notified/failed plus
 * cooldown-suppressed) export through the observability module so
 * suppression is visible in the job's counters (spec: notification rate
 * limit).
 *
 * @module PriceAlertEvaluationCron
 */

import type { AlertChannel } from '../../../../packages/data-platform/src/repositories/d1/alert-notification.repository';
import { D1AlertNotificationRepository } from '../../../../packages/data-platform/src/repositories/d1/alert-notification.repository';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import { D1PriceAlertRepository } from '../../../../packages/data-platform/src/repositories/d1/price-alert.repository';
import { D1PriceHistorySummaryRepository } from '../../../../packages/data-platform/src/repositories/d1/price-history-summary.repository';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import { FeatureFlag, FeatureFlagService } from '../middleware/feature-flags';
import {
  recordPriceAlertEvaluationCounters,
  type PriceAlertEvaluationCounters,
} from '../observability/metrics';
import { AGGREGATION_CRON } from './time-series-aggregation';
import type { Env } from '../env';
import type { Logger } from '../logger';

/**
 * The cron pattern this handler registers under — the 30-minute
 * aggregation tick (see the module doc for the shared-tick semantics).
 */
export const PRICE_ALERT_EVALUATION_CRON = AGGREGATION_CRON;

/**
 * Notification rate limit (spec: price-alerts): at most one notification
 * per alert per 24-hour period, enforced from the latest DELIVERED
 * notification row's timestamp (design R2 — recorded on the row).
 */
export const PRICE_ALERT_COOLDOWN_MS = 24 * 3_600 * 1_000;

/**
 * How recent the newest daily summary bucket must be for an alert to be
 * evaluated (days). Beyond this the product has had no observed price
 * movement for a week — the same horizon the transport staleness
 * invariant uses — and emailing on that old a close would present stale
 * data as a current price.
 */
const SUMMARY_LOOKBACK_DAYS = 7;

const ALERT_CHANNEL: AlertChannel = 'email';

/** The price-alerts feature gate (spec slug `enable_price_alerts`). */
const PRICE_ALERTS_FLAG = FeatureFlag.PRICE_ALERTS;

// ---------------------------------------------------------------------------
// Alert email (email Worker send contract — freshness-alert precedent)
// ---------------------------------------------------------------------------

/** The structured plain-text price-alert email. */
export interface PriceAlertEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Send-contract path on the email Worker (apps/email-worker, task 5.3). */
const EMAIL_SEND_PATH = '/internal/email/send';

/**
 * Shared-secret header — byte-parity with SEND_SECRET_HEADER in
 * apps/email-worker/src/app.ts. Duplicated on purpose (freshness-alert
 * precedent): importing the email Worker's Hono app into the API Worker
 * bundle would drag the whole application in for one string.
 */
const EMAIL_SEND_SECRET_HEADER = 'x-email-send-secret';

/** Cents → "€12.34" for the email body. */
function euroLabel(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/**
 * Render one triggered alert into the plain-text user email. The
 * subject is capped and newline-stripped (product names are user-facing
 * data up to 512 chars; the email Worker rejects subjects over 255 or
 * carrying line breaks).
 */
export function buildPriceAlertEmail(input: {
  readonly to: string;
  readonly productName: string | null;
  readonly productId: number;
  readonly observedPriceCents: number;
  readonly thresholdCents: number;
  readonly evaluatedAt: Date;
}): PriceAlertEmail {
  const name = (input.productName ?? `Product #${input.productId}`)
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 100);
  const subject = `[rajahinta] Price alert: ${name} at ${euroLabel(input.observedPriceCents)}`;
  const text = [
    'Your rajahinta price alert was triggered.',
    '',
    `Product:            ${name} (#${input.productId})`,
    `Observed price:     ${euroLabel(input.observedPriceCents)}`,
    `Your threshold:     ${euroLabel(input.thresholdCents)}`,
    `Observed:           ${input.evaluatedAt.toISOString()} (materialized price summary)`,
    '',
    'The observed price is the latest materialized price summary for the',
    'product, not a live quote. You manage or pause your alerts in your',
    'rajahinta account.',
    '',
  ].join('\n');
  return { to: input.to, subject, text };
}

/**
 * POST one price-alert email through the email Worker's internal send
 * contract. Throws on transport or rejection — the CALLER owns outcome
 * marking and counting.
 */
export async function sendPriceAlertEmail(
  baseUrl: string,
  sendSecret: string,
  email: PriceAlertEmail,
): Promise<void> {
  const url = `${baseUrl.replace(/\/+$/, '')}${EMAIL_SEND_PATH}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [EMAIL_SEND_SECRET_HEADER]: sendSecret,
    },
    body: JSON.stringify({
      to: email.to,
      subject: email.subject,
      text: email.text,
    }),
  });
  if (!response.ok) {
    throw new Error(`email worker rejected the price-alert send: HTTP ${response.status}`);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** One run's outcome — logged by the cron dispatch, asserted by tests. */
export interface PriceAlertEvaluationResult extends PriceAlertEvaluationCounters {
  /** False when the price-alerts flag is off — nothing was scanned. */
  readonly flagEnabled: boolean;
  /** False when the email Worker URL/secret are unset — nothing evaluated. */
  readonly configured: boolean;
  /** Size of the active-alert scan set. */
  readonly activeAlerts: number;
}

/** Seam overrides (test doubles; defaults are the real D1/fetch paths). */
export interface PriceAlertEvaluationDeps {
  alerts?: D1PriceAlertRepository;
  notifications?: D1AlertNotificationRepository;
  summaries?: D1PriceHistorySummaryRepository;
  products?: D1ProductSearchRepository;
  findAccountEmail?: (accountId: number) => Promise<string | null>;
  send?: (email: PriceAlertEmail) => Promise<void>;
  now?: () => Date;
  /**
   * Flag override for tests — defaults to the FeatureFlagService
   * resolution of the price-alerts gate (no-op when off).
   */
  flagEnabled?: boolean;
}

/** The run-local, mutable twin of the exported counter shape. */
type MutablePriceAlertCounters = {
  -readonly [K in keyof PriceAlertEvaluationCounters]: PriceAlertEvaluationCounters[K];
};

/**
 * Newest product-wide daily close within the lookback window, or null.
 * `findByProductRange` orders by period_start ASC, so the LAST row is
 * the newest bucket; its close is the most recent materialized price.
 */
async function latestMaterializedPriceCents(
  summaries: D1PriceHistorySummaryRepository,
  productId: number,
  now: Date,
): Promise<number | null> {
  const toDay = now.toISOString().slice(0, 10);
  const fromDay = new Date(now.getTime() - SUMMARY_LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const rows = await summaries.findByProductRange(productId, 'daily', fromDay, toDay);
  const latest = rows[rows.length - 1];
  return latest ? latest.priceCloseCents : null;
}

/** Direct account-email read (the session-resolver precedent — no D1 account repository exists worker-side). */
async function findAccountEmailDefault(
  d1: D1DatabaseLike,
  accountId: number,
): Promise<string | null> {
  const row = await d1
    .prepare('SELECT email FROM accounts WHERE id = ? LIMIT 1')
    .bind(accountId)
    .first<{ email: string }>();
  return row?.email ?? null;
}

/**
 * One price-alert evaluation tick: scan active alerts, compare each
 * against its product's latest materialized price, enforce the 24-hour
 * delivered-row cooldown, and dispatch through the intent-log pipeline.
 * Never throws on per-alert failure (isolation) — the router's handler
 * boundary only sees failures of the scan itself.
 */
export async function handlePriceAlertEvaluation(
  env: Env,
  log: Logger,
  deps: PriceAlertEvaluationDeps = {},
): Promise<PriceAlertEvaluationResult> {
  const zeros = {
    activeAlerts: 0,
    evaluated: 0,
    matched: 0,
    notified: 0,
    failed: 0,
    suppressed: 0,
  } as const;

  // -- Flag gate (instant rollback) ---------------------------------------
  const flagEnabled =
    deps.flagEnabled ?? new FeatureFlagService(env).isEnabled(PRICE_ALERTS_FLAG);
  if (!flagEnabled) {
    log.info({
      message: 'Price-alerts flag is off — evaluation skipped this tick',
    });
    return { flagEnabled: false, configured: true, ...zeros };
  }

  // -- Email configuration gate -------------------------------------------
  // Without the send path no intent could ever complete; evaluating
  // would only strand pending rows. Same posture as the freshness alert.
  if (!env.EMAIL_WORKER_URL || !env.EMAIL_SEND_SECRET) {
    log.warn({
      message:
        'Price-alert email delivery is not configured (EMAIL_WORKER_URL, ' +
        'EMAIL_SEND_SECRET) — alerts not evaluated this tick',
    });
    return { flagEnabled: true, configured: false, ...zeros };
  }

  const now = deps.now ?? (() => new Date());
  // Captured post-gate: closures (the default sender below) see plain
  // string consts instead of re-reading optional properties.
  const emailWorkerUrl = env.EMAIL_WORKER_URL;
  const emailSendSecret = env.EMAIL_SEND_SECRET;

  const alerts = deps.alerts ?? new D1PriceAlertRepository(env.DB);
  const notifications =
    deps.notifications ?? new D1AlertNotificationRepository(env.DB);
  const summaries =
    deps.summaries ?? new D1PriceHistorySummaryRepository(env.DB);
  const products = deps.products ?? new D1ProductSearchRepository(env.DB);
  const findAccountEmail =
    deps.findAccountEmail ??
    ((accountId: number) => findAccountEmailDefault(env.DB, accountId));
  const send =
    deps.send ??
    ((email: PriceAlertEmail) =>
      sendPriceAlertEmail(emailWorkerUrl, emailSendSecret, email));

  const active = await alerts.findActive();
  const counters: MutablePriceAlertCounters = {
    evaluated: 0,
    matched: 0,
    notified: 0,
    failed: 0,
    suppressed: 0,
  };
  const evaluatedAt = now();

  for (const alert of active) {
    // Per-alert isolation: a failing alert counts failed, never aborts
    // the sweep.
    try {
      const observed = await latestMaterializedPriceCents(
        summaries,
        alert.productId,
        evaluatedAt,
      );
      if (observed === null) {
        log.info({
          message: `Alert ${alert.id}: no materialized daily summary for product ${alert.productId} within ${SUMMARY_LOOKBACK_DAYS}d — skipped`,
        });
        continue;
      }
      counters.evaluated++;

      // Threshold semantics (design decision): observed <= threshold
      // triggers.
      if (observed > alert.thresholdCents) continue;
      counters.matched++;

      // Cooldown from the latest DELIVERED row — the same read makes a
      // re-run after a crash skip what a previous run already delivered.
      const latestDelivered = await notifications.findLatestDeliveredByAlertId(alert.id);
      if (
        latestDelivered !== null &&
        evaluatedAt.getTime() - latestDelivered.createdAt.getTime() <
          PRICE_ALERT_COOLDOWN_MS
      ) {
        counters.suppressed++;
        continue;
      }

      // Recipient resolves BEFORE the intent write — an unresolvable
      // address must not strand a pending row.
      const to = await findAccountEmail(alert.accountId);
      if (to === null) {
        log.warn({
          message: `Alert ${alert.id}: account ${alert.accountId} has no email row — not notified`,
        });
        counters.failed++;
        continue;
      }

      // Intent row MUST exist before any dispatch attempt (spec:
      // delivery intent log).
      const product = await products.findById(alert.productId);
      const email = buildPriceAlertEmail({
        to,
        productName: product?.name ?? null,
        productId: alert.productId,
        observedPriceCents: observed,
        thresholdCents: alert.thresholdCents,
        evaluatedAt,
      });
      const intent = await notifications.createIntent({
        alertId: alert.id,
        observedPriceCents: observed,
        channel: ALERT_CHANNEL,
      });

      try {
        await send(email);
      } catch (err) {
        log.error({
          message: `Alert ${alert.id}: email dispatch failed: ${
            err instanceof Error ? err.message : 'unknown error'
          } — the pending intent is retried on the next tick`,
          alertId: alert.id,
        });
        // Best-effort marking; a marking failure leaves the row pending,
        // and the next tick's re-attempt is the retry path either way.
        await notifications
          .markFailed(intent.id)
          .catch((markErr: unknown) => {
            log.error({
              message: `Alert ${alert.id}: mark-failed failed: ${
                markErr instanceof Error ? markErr.message : 'unknown error'
              }`,
            });
          });
        counters.failed++;
        continue;
      }

      // null would mean the row already left pending (a concurrent
      // marker) — the send itself still succeeded, so it counts notified.
      const marked = await notifications.markDelivered(intent.id);
      if (marked === null) {
        log.warn({
          message: `Alert ${alert.id}: notification ${intent.id} was already marked by another writer`,
        });
      }
      counters.notified++;
    } catch (err) {
      counters.failed++;
      log.error({
        message: `Alert ${alert.id}: evaluation failed: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
        alertId: alert.id,
      });
    }
  }

  recordPriceAlertEvaluationCounters(env, counters);

  log.info({
    message: `Price-alert evaluation: ${counters.evaluated} evaluated, ${counters.matched} matched, ${counters.notified} notified, ${counters.suppressed} cooldown-suppressed, ${counters.failed} failed`,
    activeAlerts: active.length,
    ...counters,
  });

  return {
    flagEnabled: true,
    configured: true,
    activeAlerts: active.length,
    ...counters,
  };
}
