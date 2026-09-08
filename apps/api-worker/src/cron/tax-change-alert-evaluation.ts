/**
 * Tax-change alert evaluation (task 4.1, design D5) — the TAX_CHANGE kind
 * of the watchlist alert system.
 *
 * ## Trigger — rate-version confirmation, not a cadence
 *
 * The spec evaluates TAX_CHANGE alerts on rate-version publication, so
 * unlike every other handler in this directory this module registers on
 * NO cron pattern. {@link enqueueTaxChangeAlertEvaluation} is the entry
 * point the rate-version confirmation path invokes fire-and-forget (the
 * call-site wraps it in `waitUntil` / drops the promise); it never
 * throws, mirroring design D3's fail-open rule — an evaluation failure
 * must never block or fail the operator's confirmation. The tax-dataset
 * review cron only DETECTS rate changes (requiresConfirmation), and the
 * confirmation action itself is still a fail-closed 503 stub
 * (ops.routes taxReviewsUnavailable — the rate-review store has no D1
 * counterpart yet), so no live call-site exists today; the hook lands
 * with the confirmation-store work on the same path as design D3's
 * draft hook. Evaluation is idempotent end to end (delivered-row
 * cooldown), so an at-least-once invocation never double-notifies.
 *
 * ## Selection — attribution of the version delta
 *
 * For each alert's tracked product, the recent observation window is
 * attributed with the PURE {@link TaxChangeAttributionService} (the same
 * read-time join the price-history route runs: observation series ×
 * excise/container-duty effective windows). A product "moved" when a
 * step crossed a rule-version boundary AND its landed cost actually
 * changed — a boundary with a zero-cent delta selects nobody (the rate
 * change did not reach the shelf). When the confirmation names the
 * confirmed version labels, only steps INTO one of those versions
 * select; unscoped runs take any recent boundary with a non-zero delta.
 *
 * Data source: materialized data only — the R2 observation log plus D1
 * tax-rule windows, never a recomputation from live feeds (spec:
 * scheduled evaluation reads materialized data). The R2 scan is the
 * documented port of the price-history route's range read
 * (routes/historical.routes.ts findObservationsByProductRange), kept
 * local on purpose: importing the route module would couple cron
 * dispatch to the Hono layer (the EMAIL_SEND_SECRET_HEADER duplication
 * precedent).
 *
 * ## Delivery — shared intent-log + 24-hour cooldown
 *
 * Identical pipeline to the PRICE sweep (task 2.2): cooldown check →
 * PENDING intent row → email dispatch → outcome mark, with the SAME
 * notification repository, the SAME half-open 24-hour cooldown window
 * (PRICE_ALERT_COOLDOWN_MS — one limit for BOTH kinds per spec), and
 * the SAME crash-safe rule: a retried run re-reads the latest delivered
 * row and skips what a previous run already delivered. Per-alert error
 * isolation and the observability counters match the PRICE sweep so
 * suppression is visible in the job's counters.
 *
 * @module TaxChangeAlertEvaluationCron
 */

import type { PriceObservation } from '../../../../packages/core-domain/src/history/price-observation.types';
import {
  TaxChangeAttributionService,
  type AttributedStep,
  type RuleVersionBoundary,
  type TaxRuleEffectiveWindow,
} from '../../../../packages/core-domain/src/history/services/tax-change-attribution.service';
import { TAX_TYPES } from '../../../../packages/core-domain/src/tax/tax-categories';
import { normaliseCategory } from '../../../../packages/core-domain/src/tax/services/alcohol-excise.math';
import { D1AlertNotificationRepository } from '../../../../packages/data-platform/src/repositories/d1/alert-notification.repository';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import {
  observationKeysToScan,
  OBSERVATION_LOG_PREFIX,
  parseObservationLine,
} from '../../../../packages/data-platform/src/d1/observation-log';
import { D1PriceAlertRepository } from '../../../../packages/data-platform/src/repositories/d1/price-alert.repository';
import type { PriceAlertRecord } from '../../../../packages/data-platform/src/repositories/d1/price-alert.repository';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import { D1TaxRateRepository } from '../../../../packages/data-platform/src/repositories/d1/tax-rate.repository';
import { createR2ObservationLogStore } from '../adapters/r2-observation-log.store';
import type { Env } from '../env';
import type { Logger } from '../logger';
import {
  recordPriceAlertEvaluationCounters,
  type PriceAlertEvaluationCounters,
} from '../observability/metrics';
import {
  PRICE_ALERT_COOLDOWN_MS,
  sendPriceAlertEmail,
} from './price-alert-evaluation';

// ---------------------------------------------------------------------------
// Window + selection types
// ---------------------------------------------------------------------------

/**
 * How far back the attribution window reaches (days), evaluated from the
 * run instant. A confirmed version moves products at its effectiveFrom;
 * observations older than a week describe a boundary a prior evaluation
 * already had its chance to notify on — the same staleness horizon the
 * PRICE sweep's summary lookback uses.
 */
export const TAX_CHANGE_ALERT_LOOKBACK_DAYS = 7;

/**
 * One active TAX_CHANGE alert — the scan-set row comes straight from the
 * repository's kind-filtered read (task 1.4's `findActive(kind)`
 * overload), which is documented as serving the per-kind evaluation
 * crons. TAX_CHANGE rows carry no threshold.
 */
export type TaxChangeAlertRecord = PriceAlertRecord;

/**
 * One attributed, tax-boundary step of one product — the evaluator's
 * selection input. `deltaCents` is the per-product landed-cost delta the
 * alert fires on (to − from; non-zero is the selection requirement).
 */
export interface LandedCostStep {
  readonly merchant: string;
  readonly classification: AttributedStep['classification'];
  readonly fromLandedCostCents: number;
  readonly toLandedCostCents: number;
  readonly deltaCents: number;
  readonly fromObservedAt: Date;
  readonly toObservedAt: Date;
  /** Excise boundary evidence — null when no excise boundary was crossed. */
  readonly exciseRuleBoundary: RuleVersionBoundary | null;
  /** Container-duty boundary evidence — null when none was crossed. */
  readonly containerDutyRuleBoundary: RuleVersionBoundary | null;
}

/** The version label a step moved INTO (excise preferred, duty fallback). */
function stepToVersionLabel(step: LandedCostStep): string | null {
  return (
    step.exciseRuleBoundary?.toVersionLabel ??
    step.containerDutyRuleBoundary?.toVersionLabel ??
    null
  );
}

/**
 * Pick the step an evaluation notifies on: the LATEST attributed step
 * that crossed a rule-version boundary with a NON-ZERO landed-cost
 * delta (spec: selection = products whose landed cost changed per the
 * attribution of the version delta). When `confirmedVersions` is
 * non-empty, only steps into one of those confirmed version labels
 * qualify — the scoping that ties a run to the confirmation that
 * enqueued it. Ties on toObservedAt keep the first-seen step, making
 * the choice deterministic over the ascending-step input order.
 * Pure — unit-tested directly.
 */
export function selectLandedCostDelta(
  steps: readonly LandedCostStep[],
  confirmedVersions: readonly string[],
): LandedCostStep | null {
  let selected: LandedCostStep | null = null;
  for (const step of steps) {
    if (step.exciseRuleBoundary === null && step.containerDutyRuleBoundary === null) {
      continue; // No rule boundary — a merchant/transport move, not a tax change.
    }
    if (step.deltaCents === 0) {
      continue; // The version changed but the landed cost did not move.
    }
    if (confirmedVersions.length > 0) {
      const toLabel = stepToVersionLabel(step);
      if (toLabel === null || !confirmedVersions.includes(toLabel)) {
        continue; // Not a step into a version this confirmation published.
      }
    }
    if (selected === null || step.toObservedAt.getTime() > selected.toObservedAt.getTime()) {
      selected = step;
    }
  }
  return selected;
}

// ---------------------------------------------------------------------------
// Alert email (same email Worker send contract as the PRICE sweep)
// ---------------------------------------------------------------------------

/** The structured plain-text tax-change alert email. */
export interface TaxChangeAlertEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Cents → "€12.34" for the email body (PRICE module's local helper twin). */
function euroLabel(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/**
 * Render one triggered tax-change alert into the plain-text user email.
 * Same subject capping and newline stripping as the PRICE email (the
 * email Worker rejects subjects over 255 or carrying line breaks).
 */
export function buildTaxChangeAlertEmail(input: {
  readonly to: string;
  readonly productName: string | null;
  readonly productId: number;
  readonly fromLandedCostCents: number;
  readonly toLandedCostCents: number;
  readonly fromVersionLabel: string | null;
  readonly toVersionLabel: string | null;
  readonly evaluatedAt: Date;
}): TaxChangeAlertEmail {
  const name = (input.productName ?? `Product #${input.productId}`)
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 100);
  const subject = `[rajahinta] Tax change: ${name} landed cost now ${euroLabel(input.toLandedCostCents)}`;
  const delta = input.toLandedCostCents - input.fromLandedCostCents;
  const deltaLabel = `${delta > 0 ? '+' : '−'}${euroLabel(Math.abs(delta))}`;
  const text = [
    'Your rajahinta tax-change alert was triggered.',
    '',
    `Product:               ${name} (#${input.productId})`,
    `Landed cost:           ${euroLabel(input.fromLandedCostCents)} → ${euroLabel(input.toLandedCostCents)} (${deltaLabel})`,
    `Rule version:          ${input.fromVersionLabel ?? 'unknown'} → ${input.toVersionLabel ?? 'unknown'}`,
    `Attributed:            ${input.evaluatedAt.toISOString()} (read-time, materialized observations)`,
    '',
    'The landed cost is the materialized quantity=1 baseline for the',
    'product, attributed to a tax-rule version boundary — not a live',
    'quote. You manage or pause your alerts in your rajahinta account.',
    '',
  ].join('\n');
  return { to: input.to, subject, text };
}

// ---------------------------------------------------------------------------
// Default data reads (kind-filtered alerts + R2 observations × D1 windows)
// ---------------------------------------------------------------------------

/** Map a repository rule record onto the attribution window shape. */
function toEffectiveWindow(rule: {
  readonly id: number;
  readonly versionLabel: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}): TaxRuleEffectiveWindow {
  return {
    ruleId: rule.id,
    versionLabel: rule.versionLabel,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
  };
}

/** Resolve a stored rule-version FK id to a snapshot via the fetched windows. */
function resolveSnapshot(
  ruleId: number | null,
  windows: readonly TaxRuleEffectiveWindow[],
): PriceObservation['exciseRuleVersion'] {
  if (ruleId === null) return null;
  const window = windows.find((w) => w.ruleId === ruleId);
  return window !== undefined ? { ruleId, versionLabel: window.versionLabel } : null;
}

/**
 * Attribute one product's recent observation window into tax-boundary
 * steps with landed-cost deltas. Fail-open on missing bindings/data: a
 * product without a resolvable category or an unconfigured observation
 * bucket yields no steps (nothing to notify on), never a throw.
 */
export async function resolveLandedCostSteps(
  env: Env,
  products: D1ProductSearchRepository,
  productId: number,
  evaluatedAt: Date,
  log: Logger,
): Promise<LandedCostStep[]> {
  if (!env.OBSERVATION_LOG) {
    log.warn({
      message:
        `Tax-change alert evaluation: product ${productId} cannot be attributed — ` +
        'OBSERVATION_LOG R2 bucket binding is not configured',
    });
    return [];
  }
  const product = await products.findById(productId);
  if (product === null) {
    log.warn({
      message: `Tax-change alert evaluation: product ${productId} no longer resolves — skipped`,
    });
    return [];
  }

  // Window + rule fetch — the price-history route's attribution plumbing.
  const fromDate = new Date(
    evaluatedAt.getTime() - TAX_CHANGE_ALERT_LOOKBACK_DAYS * 86_400_000,
  );
  const exciseCategory = normaliseCategory(product.category);
  const taxRepo = new D1TaxRateRepository(env.DB);
  const [exciseRules, containerDutyRules] = await Promise.all([
    taxRepo.findHistoryRates(TAX_TYPES.excise, exciseCategory, fromDate, evaluatedAt),
    taxRepo.findHistoryRates(
      TAX_TYPES.containerDuty,
      'all_beverages',
      fromDate,
      evaluatedAt,
    ),
  ]);
  const exciseWindows = exciseRules.map(toEffectiveWindow);
  const containerDutyWindows = containerDutyRules.map(toEffectiveWindow);

  // R2 observation scan — the route's range read, ported (single product,
  // every merchant). Partitions ascend by day; the final sort enforces
  // the series order the attribution contract demands.
  const reader = createR2ObservationLogStore(env.OBSERVATION_LOG);
  const allKeys = await reader.listKeys(OBSERVATION_LOG_PREFIX);
  const toDay = evaluatedAt.toISOString().slice(0, 10);
  const keys = observationKeysToScan(allKeys, fromDate).filter((key) => {
    const day = key.slice(OBSERVATION_LOG_PREFIX.length, OBSERVATION_LOG_PREFIX.length + 10);
    return day <= toDay;
  });

  const observations: PriceObservation[] = [];
  for (const key of keys) {
    const body = await reader.readObject(key);
    if (body === null) continue;
    for (const line of body.split('\n')) {
      if (line.trim().length === 0) continue;
      let record: ReturnType<typeof parseObservationLine>;
      try {
        record = parseObservationLine(line);
      } catch {
        continue; // A torn tail line never fails a read (JSONL framing).
      }
      if (record.product_id !== productId) continue;
      const observedAt = new Date(record.observed_at);
      if (observedAt < fromDate || observedAt >= evaluatedAt) continue;
      observations.push({
        productId: record.product_id,
        merchant: record.merchant,
        retailOfferId: record.retail_offer_id,
        observedAt,
        foreignRetailPriceCents: record.foreign_retail_price_cents,
        transportOfferId: record.transport_offer_id,
        transportCostCents: record.transport_cost_cents,
        exciseRuleVersion: resolveSnapshot(record.excise_rule_version_id, exciseWindows),
        containerDutyRuleVersion: resolveSnapshot(
          record.container_duty_rule_version_id,
          containerDutyWindows,
        ),
        landedCostCents: record.landed_cost_cents,
        inputReliability: record.input_reliability,
        confidence: record.confidence,
      });
    }
  }
  observations.sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());

  // Attribute per (productId, merchant) series — never interleaved.
  const seriesByMerchant = new Map<string, PriceObservation[]>();
  for (const observation of observations) {
    const list = seriesByMerchant.get(observation.merchant) ?? [];
    list.push(observation);
    seriesByMerchant.set(observation.merchant, list);
  }

  const attributionService = new TaxChangeAttributionService();
  const steps: LandedCostStep[] = [];
  for (const [merchant, series] of seriesByMerchant) {
    if (series.length < 2) continue; // A single observation yields no steps.
    const attributed = attributionService.attribute({
      observations: series,
      exciseRuleWindows: exciseWindows,
      containerDutyRuleWindows: containerDutyWindows,
    });
    // Step i spans series[i] → series[i+1]; the landed-cost delta is read
    // from the paired observations, not recomputed from rule rates.
    for (let i = 0; i < attributed.length; i++) {
      const step = attributed[i]!;
      if (step.exciseRuleBoundary === null && step.containerDutyRuleBoundary === null) {
        continue; // Only tax-boundary steps are selection candidates.
      }
      const fromLandedCostCents = series[i]!.landedCostCents;
      const toLandedCostCents = series[i + 1]!.landedCostCents;
      steps.push({
        merchant,
        classification: step.classification,
        fromLandedCostCents,
        toLandedCostCents,
        deltaCents: toLandedCostCents - fromLandedCostCents,
        fromObservedAt: step.fromObservedAt,
        toObservedAt: step.toObservedAt,
        exciseRuleBoundary: step.exciseRuleBoundary,
        containerDutyRuleBoundary: step.containerDutyRuleBoundary,
      });
    }
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** One run's outcome — logged by the enqueue wrapper, asserted by tests. */
export interface TaxChangeAlertEvaluationResult extends PriceAlertEvaluationCounters {
  /** False when the email Worker URL/secret are unset — nothing evaluated. */
  readonly configured: boolean;
  /** Size of the active-TAX_CHANGE-alert scan set. */
  readonly activeAlerts: number;
}

/** Seam overrides (test doubles; defaults are the real D1/R2/fetch paths). */
export interface TaxChangeAlertEvaluationDeps {
  /** Kind-filtered alert scan — defaults to `findActive('TAX_CHANGE')`. */
  alerts?: D1PriceAlertRepository;
  notifications?: D1AlertNotificationRepository;
  products?: D1ProductSearchRepository;
  findAccountEmail?: (accountId: number) => Promise<string | null>;
  send?: (email: TaxChangeAlertEmail) => Promise<void>;
  /** Attribution seam — defaults to {@link resolveLandedCostSteps}. */
  readSteps?: (
    productId: number,
    evaluatedAt: Date,
  ) => Promise<readonly LandedCostStep[]>;
  /**
   * Version labels the triggering confirmation published — non-empty
   * scopes selection to steps INTO one of them (empty = any recent
   * tax-boundary delta selects).
   */
  confirmedVersions?: readonly string[];
  now?: () => Date;
}

/** The run-local, mutable twin of the exported counter shape. */
type MutableTaxChangeCounters = {
  -readonly [K in keyof PriceAlertEvaluationCounters]: PriceAlertEvaluationCounters[K];
};

/** Direct account-email read (the PRICE sweep's default, duplicated seam). */
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

const ALERT_CHANNEL_EMAIL = 'email' as const;

/**
 * One tax-change alert evaluation run: scan active TAX_CHANGE alerts,
 * select products whose attributed landed cost moved across a rule
 * boundary, enforce the shared 24-hour delivered-row cooldown, and
 * dispatch through the intent-log pipeline. Never throws on per-alert
 * failure (isolation) — the enqueue wrapper is the only boundary that
 * must not throw at all.
 */
export async function handleTaxChangeAlertEvaluation(
  env: Env,
  log: Logger,
  deps: TaxChangeAlertEvaluationDeps = {},
): Promise<TaxChangeAlertEvaluationResult> {
  const zeros = {
    activeAlerts: 0,
    evaluated: 0,
    matched: 0,
    notified: 0,
    failed: 0,
    suppressed: 0,
  } as const;

  // -- Email configuration gate -------------------------------------------
  // Without the send path no intent could ever complete; evaluating
  // would only strand pending rows. Same posture as the PRICE sweep.
  if (!env.EMAIL_WORKER_URL || !env.EMAIL_SEND_SECRET) {
    log.warn({
      message:
        'Tax-change alert email delivery is not configured (EMAIL_WORKER_URL, ' +
        'EMAIL_SEND_SECRET) — alerts not evaluated this run',
    });
    return { configured: false, ...zeros };
  }

  const now = deps.now ?? (() => new Date());
  const emailWorkerUrl = env.EMAIL_WORKER_URL;
  const emailSendSecret = env.EMAIL_SEND_SECRET;

  const notifications =
    deps.notifications ?? new D1AlertNotificationRepository(env.DB);
  const products = deps.products ?? new D1ProductSearchRepository(env.DB);
  const alertsRepo = deps.alerts ?? new D1PriceAlertRepository(env.DB);
  const findAccountEmail =
    deps.findAccountEmail ??
    ((accountId: number) => findAccountEmailDefault(env.DB, accountId));
  const send =
    deps.send ??
    ((email: TaxChangeAlertEmail) =>
      sendPriceAlertEmail(emailWorkerUrl, emailSendSecret, email));
  const readSteps =
    deps.readSteps ??
    ((productId: number, evaluatedAt: Date) =>
      resolveLandedCostSteps(env, products, productId, evaluatedAt, log));
  const confirmedVersions = deps.confirmedVersions ?? [];

  // The kind-filtered scan — only active TAX_CHANGE rows (the
  // repository owns the SQL; paused and PRICE rows never enter this run).
  const alerts = await alertsRepo.findActive('TAX_CHANGE');
  const counters: MutableTaxChangeCounters = {
    evaluated: 0,
    matched: 0,
    notified: 0,
    failed: 0,
    suppressed: 0,
  };
  const evaluatedAt = now();

  for (const alert of alerts) {
    // Per-alert isolation: a failing alert counts failed, never aborts
    // the sweep.
    try {
      const steps = await readSteps(alert.productId, evaluatedAt);
      if (steps.length === 0) {
        log.info({
          message: `Tax-change alert ${alert.id}: no attributed rule-boundary steps for product ${alert.productId} within ${TAX_CHANGE_ALERT_LOOKBACK_DAYS}d — skipped`,
        });
        continue;
      }
      counters.evaluated++;

      const step = selectLandedCostDelta(steps, confirmedVersions);
      if (step === null) continue;
      counters.matched++;

      // Cooldown from the latest DELIVERED row — the SHARED window: the
      // same read makes a re-run after a crash skip what a previous run
      // already delivered, for both kinds.
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
          message: `Tax-change alert ${alert.id}: account ${alert.accountId} has no email row — not notified`,
        });
        counters.failed++;
        continue;
      }

      // Intent row MUST exist before any dispatch attempt (spec:
      // delivery intent log). The intent freezes the NEW materialized
      // landed cost — the value the notification reports.
      const product = await products.findById(alert.productId);
      const email = buildTaxChangeAlertEmail({
        to,
        productName: product?.name ?? null,
        productId: alert.productId,
        fromLandedCostCents: step.fromLandedCostCents,
        toLandedCostCents: step.toLandedCostCents,
        fromVersionLabel:
          step.exciseRuleBoundary?.fromVersionLabel ??
          step.containerDutyRuleBoundary?.fromVersionLabel ??
          null,
        toVersionLabel: stepToVersionLabel(step),
        evaluatedAt,
      });
      const intent = await notifications.createIntent({
        alertId: alert.id,
        observedPriceCents: step.toLandedCostCents,
        channel: ALERT_CHANNEL_EMAIL,
      });

      try {
        await send(email);
      } catch (err) {
        log.error({
          message: `Tax-change alert ${alert.id}: email dispatch failed: ${
            err instanceof Error ? err.message : 'unknown error'
          } — the pending intent is retried on the next run`,
          alertId: alert.id,
        });
        // Best-effort marking; a marking failure leaves the row pending,
        // and the next run's re-attempt is the retry path either way.
        await notifications
          .markFailed(intent.id)
          .catch((markErr: unknown) => {
            log.error({
              message: `Tax-change alert ${alert.id}: mark-failed failed: ${
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
          message: `Tax-change alert ${alert.id}: notification ${intent.id} was already marked by another writer`,
        });
      }
      counters.notified++;
    } catch (err) {
      counters.failed++;
      log.error({
        message: `Tax-change alert ${alert.id}: evaluation failed: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
        alertId: alert.id,
      });
    }
  }

  recordPriceAlertEvaluationCounters(env, counters);

  log.info({
    message: `Tax-change alert evaluation: ${counters.evaluated} evaluated, ${counters.matched} matched, ${counters.notified} notified, ${counters.suppressed} cooldown-suppressed, ${counters.failed} failed`,
    activeAlerts: alerts.length,
    confirmedVersions: [...confirmedVersions],
    ...counters,
  });

  return {
    configured: true,
    activeAlerts: alerts.length,
    ...counters,
  };
}

// ---------------------------------------------------------------------------
// Enqueue entry — the confirmation hook (fail-open, design D3 rule)
// ---------------------------------------------------------------------------

/**
 * The rate-version confirmation hook: evaluate TAX_CHANGE alerts for the
 * just-confirmed version delta WITHOUT ever blocking or failing the
 * confirmation. Never throws — every failure is caught and logged, and
 * the wrapper resolves to null so the call-site cannot observe anything
 * but success (design D3's fail-open rule applied to the alert hook,
 * exactly as the risks section demands for the confirmation path's
 * write hooks). Invocation is fire-and-forget:
 *
 *   ctx.executionCtx.waitUntil(
 *     enqueueTaxChangeAlertEvaluation(env, log, [versionLabel]),
 *   );
 *
 * `confirmedVersions` scopes selection to steps INTO the published
 * versions; an empty list evaluates any recent tax-boundary delta.
 */
export async function enqueueTaxChangeAlertEvaluation(
  env: Env,
  log: Logger,
  confirmedVersions: readonly string[] = [],
): Promise<TaxChangeAlertEvaluationResult | null> {
  try {
    return await handleTaxChangeAlertEvaluation(env, log, { confirmedVersions });
  } catch (err) {
    log.error({
      message: `Tax-change alert evaluation failed (fail-open, the confirmation is unaffected): ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
      confirmedVersions: [...confirmedVersions],
    });
    return null;
  }
}
