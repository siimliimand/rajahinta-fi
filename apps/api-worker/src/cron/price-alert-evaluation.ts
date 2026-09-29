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
 * The CATEGORY sweep reads the same window through the summary
 * repository's deterministic category-minimum query; the LANDED_COST
 * branch (task 2.2) reads the same window on the landed-cost close
 * column and, when it notifies, cites the close's composition facts
 * from the stored observation record (spec: landed-cost alert
 * explainability — see {@link buildLandedCostAlertEmail}).
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
 * limit). Task 6.1 (design D7): the run emits one counter point-set per
 * alert kind present in the sweep, each stamped with its kind as the AE
 * label, so sweep activity is attributable per kind — a kind whose
 * alerts all skipped still emits its zeros under its kind, and a sweep
 * with no threshold-kind row at all keeps the legacy kindless aggregate
 * point-set (the run's heartbeat).
 *
 * @module PriceAlertEvaluationCron
 */

import type { ConfidenceLevel } from '@rajahinta/core-domain';
import type { AlertChannel } from '../../../../packages/data-platform/src/repositories/d1/alert-notification.repository';
import { D1AlertNotificationRepository } from '../../../../packages/data-platform/src/repositories/d1/alert-notification.repository';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import {
  OBSERVATION_LOG_PREFIX,
  parseObservationLog,
} from '../../../../packages/data-platform/src/d1/observation-log';
import { D1PriceAlertRepository } from '../../../../packages/data-platform/src/repositories/d1/price-alert.repository';
import type { PriceAlertKind } from '../../../../packages/data-platform/src/repositories/d1/price-alert.repository';
import { D1PriceHistorySummaryRepository } from '../../../../packages/data-platform/src/repositories/d1/price-history-summary.repository';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import {
  recordPriceAlertEvaluationCounters,
  type PriceAlertEvaluationCounters,
} from '../observability/metrics';
import { AGGREGATION_CRON } from './time-series-aggregation';
import { createR2ObservationLogStore } from '../adapters/r2-observation-log.store';
import { dispatchEmailToWorker, type EmailDispatchTarget } from '../services/email-send';
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

// ---------------------------------------------------------------------------
// Alert email (email Worker send contract — freshness-alert precedent)
// ---------------------------------------------------------------------------

/** The structured plain-text price-alert email. */
export interface PriceAlertEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Cents → "€12.34" for the email body. */
function euroLabel(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/**
 * Subject-safe product name (shared by both alert emails): newline-
 * stripped and capped — product names are user-facing data up to 512
 * chars; the email Worker rejects subjects over 255 or carrying line
 * breaks.
 */
function emailProductName(name: string | null, productId: number): string {
  return (name ?? `Product #${productId}`)
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 100);
}

/**
 * Render one triggered alert into the plain-text user email. Hygiene
 * (cap + newline strip) lives in {@link emailProductName}.
 */
export function buildPriceAlertEmail(input: {
  readonly to: string;
  readonly productName: string | null;
  readonly productId: number;
  readonly observedPriceCents: number;
  readonly thresholdCents: number;
  readonly evaluatedAt: Date;
}): PriceAlertEmail {
  const name = emailProductName(input.productName, input.productId);
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
 * Render one triggered CATEGORY alert (task 3.1). Factual content only —
 * the tripping product, its observed price, the watched category, the
 * threshold; the content policy bans advice phrasing, so the body states
 * what was observed and nothing else. Same hygiene contract as the price
 * alert (via {@link emailProductName}).
 */
export function buildCategoryAlertEmail(input: {
  readonly to: string;
  readonly productName: string | null;
  readonly productId: number;
  readonly category: string;
  readonly observedPriceCents: number;
  readonly thresholdCents: number;
  readonly evaluatedAt: Date;
}): PriceAlertEmail {
  const name = emailProductName(input.productName, input.productId);
  const subject = `[rajahinta] Category alert: ${name} at ${euroLabel(input.observedPriceCents)}`;
  const text = [
    'Your rajahinta category price alert was triggered.',
    '',
    `Category:           ${input.category}`,
    `Tripping product:   ${name} (#${input.productId})`,
    `Observed price:     ${euroLabel(input.observedPriceCents)}`,
    `Your threshold:     ${euroLabel(input.thresholdCents)}`,
    `Observed:           ${input.evaluatedAt.toISOString()} (materialized price summary)`,
    '',
    'The observed price is the lowest materialized daily product-wide',
    "price summary across the category's products within the lookback",
    'window, not a live quote. You manage or pause your alerts in your',
    'rajahinta account.',
    '',
  ].join('\n');
  return { to: input.to, subject, text };
}

/**
 * The composition facts behind one landed-cost close (task 2.2, spec:
 * landed-cost alert explainability). Every field is read back verbatim
 * from a stored record — the observation-log line that produced the
 * close plus the reference rows its FKs name — never computed at send
 * time.
 */
export interface LandedCostCompositionFacts {
  /** The provenance observation's stored instant (ISO-8601 UTC). */
  readonly observedAt: string;
  /** The observed offer's stored foreign retail price (cents). */
  readonly retailPriceCents: number;
  /** The stored transport cost contribution (0 when no offer matched). */
  readonly transportCostCents: number;
  /** Route of the selected transport offer; all null when none recorded. */
  readonly transportCarrier: string | null;
  readonly transportOriginCountry: string | null;
  readonly transportDestinationCountry: string | null;
  /** Dataset version labels in effect on the observation; null = engine fallback stored no rule row. */
  readonly exciseDatasetVersion: string | null;
  readonly containerDutyDatasetVersion: string | null;
  /** The confidence stored on the observation record. */
  readonly confidence: ConfidenceLevel;
}

/**
 * Render one triggered LANDED_COST alert (task 2.2). Every composition
 * fact is cited verbatim from {@link LandedCostCompositionFacts} — the
 * builder computes nothing — and the body carries the quantity=1
 * baseline / not-a-live-quote statement. Factual content only; the
 * content policy bans advice phrasing. Same hygiene contract as the
 * price alert (via {@link emailProductName}).
 */
export function buildLandedCostAlertEmail(input: {
  readonly to: string;
  readonly productName: string | null;
  readonly productId: number;
  readonly observedLandedCostCents: number;
  readonly thresholdCents: number;
  readonly facts: LandedCostCompositionFacts;
}): PriceAlertEmail {
  const name = emailProductName(input.productName, input.productId);
  const subject = `[rajahinta] Landed-cost alert: ${name} at ${euroLabel(input.observedLandedCostCents)}`;
  const facts = input.facts;
  const transport =
    facts.transportCarrier === null
      ? `${euroLabel(facts.transportCostCents)} (no offer recorded)`
      : `${euroLabel(facts.transportCostCents)} (${facts.transportCarrier}, ${
          facts.transportOriginCountry ?? 'unknown'
        } → ${facts.transportDestinationCountry ?? 'unknown'})`;
  const text = [
    'Your rajahinta landed-cost alert was triggered.',
    '',
    `Product:                ${name} (#${input.productId})`,
    `Observed landed cost:   ${euroLabel(input.observedLandedCostCents)}`,
    `Your threshold:         ${euroLabel(input.thresholdCents)}`,
    `Retail price:           ${euroLabel(facts.retailPriceCents)}`,
    `Transport:              ${transport}`,
    `Excise dataset:         ${facts.exciseDatasetVersion ?? 'unknown'}`,
    `Container-duty dataset: ${facts.containerDutyDatasetVersion ?? 'unknown'}`,
    `Confidence:             ${facts.confidence}`,
    `Observed:               ${facts.observedAt}`,
    '',
    'The observed landed cost is the quantity=1 baseline from the',
    "product's latest materialized daily summary, not a live quote. You",
    'manage or pause your alerts in your rajahinta account.',
    '',
  ].join('\n');
  return { to: input.to, subject, text };
}

/**
 * The summary-bucket facts a LANDED_COST email needs for provenance:
 * the newest product-wide daily close and the day whose observation-log
 * partition holds the composition facts behind it.
 */
export interface LandedCostCloseBucket {
  readonly periodStart: string;
  readonly landedCostCloseCents: number;
}

/**
 * Resolve the composition facts of one landed-cost close (task 2.2
 * default read — cite-only, nothing recomputed). The product-wide daily
 * close is the LAST observation's landed cost in the fold's series
 * order (observed_at asc, id tie-break — summary-aggregation's own
 * rule), so the provenance line lives in the bucket day's partition;
 * its FKs name the transport-offer row (route) and the tax-rules rows
 * (dataset version labels), all stored reads.
 *
 * Returns null — and the caller skips the alert, because the email
 * SHALL cite the composition — when the facts are not retrievable from
 * stored records: no OBSERVATION_LOG binding, a missing partition or
 * product line, or a consistency mismatch. That mismatch means the
 * bucket was rebuilt between the summary read and this read (a newer
 * observation landed); citing the then-current line would attribute the
 * close to the wrong composition, so the alert waits for the next tick's
 * consistent materialization.
 */
async function resolveLandedCostCompositionFacts(
  env: Env,
  productId: number,
  close: LandedCostCloseBucket,
): Promise<LandedCostCompositionFacts | null> {
  if (!env.OBSERVATION_LOG) {
    return null;
  }
  const reader = createR2ObservationLogStore(env.OBSERVATION_LOG);
  const body = await reader.readObject(
    `${OBSERVATION_LOG_PREFIX}${close.periodStart}.jsonl`,
  );
  if (body === null) {
    return null;
  }
  const observations = parseObservationLog(body).filter(
    (record) => record.product_id === productId,
  );
  if (observations.length === 0) {
    return null;
  }
  const ordered = [...observations].sort((a, b) =>
    a.observed_at !== b.observed_at
      ? a.observed_at < b.observed_at
        ? -1
        : 1
      : a.id - b.id,
  );
  const closeSource = ordered[ordered.length - 1];
  if (closeSource.landed_cost_cents !== close.landedCostCloseCents) {
    return null;
  }

  const route =
    closeSource.transport_offer_id === null
      ? null
      : await env.DB
          .prepare(
            'SELECT carrier, origin_country, destination_country FROM transport_offers WHERE id = ?',
          )
          .bind(closeSource.transport_offer_id)
          .first<{
            carrier: string;
            origin_country: string;
            destination_country: string;
          }>();
  const datasetVersion = async (
    ruleVersionId: number | null,
  ): Promise<string | null> => {
    if (ruleVersionId === null) {
      return null;
    }
    const row = await env.DB
      .prepare('SELECT version_label FROM tax_rules WHERE id = ?')
      .bind(ruleVersionId)
      .first<{ version_label: string }>();
    return row?.version_label ?? null;
  };
  const [exciseDatasetVersion, containerDutyDatasetVersion] = await Promise.all([
    datasetVersion(closeSource.excise_rule_version_id),
    datasetVersion(closeSource.container_duty_rule_version_id),
  ]);

  return {
    observedAt: closeSource.observed_at,
    retailPriceCents: closeSource.foreign_retail_price_cents,
    transportCostCents: closeSource.transport_cost_cents,
    transportCarrier: route?.carrier ?? null,
    transportOriginCountry: route?.origin_country ?? null,
    transportDestinationCountry: route?.destination_country ?? null,
    exciseDatasetVersion,
    containerDutyDatasetVersion,
    confidence: closeSource.confidence,
  };
}

/**
 * POST one price-alert email through the email Worker's internal send
 * contract. Throws on transport or rejection — the CALLER owns outcome
 * marking and counting.
 */
export async function sendPriceAlertEmail(
  target: EmailDispatchTarget,
  email: PriceAlertEmail,
): Promise<void> {
  await dispatchEmailToWorker(target, email);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** One run's outcome — logged by the cron dispatch, asserted by tests. */
export interface PriceAlertEvaluationResult extends PriceAlertEvaluationCounters {
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
  resolveLandedCostFacts?: (
    productId: number,
    close: LandedCostCloseBucket,
  ) => Promise<LandedCostCompositionFacts | null>;
  send?: (email: PriceAlertEmail) => Promise<void>;
  now?: () => Date;
}

/** The run-local, mutable twin of the exported counter shape. */
type MutablePriceAlertCounters = {
  -readonly [K in keyof PriceAlertEvaluationCounters]: PriceAlertEvaluationCounters[K];
};

/**
 * The threshold kinds this sweep evaluates — every alert kind except
 * TAX_CHANGE, which the tax-change evaluator owns and whose rows skip
 * here before any read or counter (the kind guard below).
 */
type PriceAlertSweepKind = Exclude<PriceAlertKind, 'TAX_CHANGE'>;

/**
 * The closed [fromDay, toDay] daily-period window the summary lookback
 * covers: whole-day anchors, the run day inclusive, exactly
 * {@link SUMMARY_LOOKBACK_DAYS} days back — matching the closed-range
 * semantics of `findByProductRange` and the category-minimum query.
 */
function lookbackWindow(now: Date): { fromDay: string; toDay: string } {
  return {
    toDay: now.toISOString().slice(0, 10),
    fromDay: new Date(now.getTime() - SUMMARY_LOOKBACK_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10),
  };
}

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
  const { fromDay, toDay } = lookbackWindow(now);
  const rows = await summaries.findByProductRange(productId, 'daily', fromDay, toDay);
  const latest = rows[rows.length - 1];
  return latest ? latest.priceCloseCents : null;
}

/**
 * Newest product-wide daily LANDED-COST close within the lookback
 * window, or null (task 2.1) — the price reader's protocol applied to
 * the landed-cost close column: same window, same ascending read, same
 * last-row-is-newest selection. The LANDED_COST evaluator branch (task
 * 2.2) reads the same window directly because its email also needs the
 * bucket's period_start (the day whose observation-log partition holds
 * the close's composition facts); this reader stays the exported
 * contract reference and the task-2.1 unit tests' subject.
 */
export async function latestMaterializedLandedCostCents(
  summaries: D1PriceHistorySummaryRepository,
  productId: number,
  now: Date,
): Promise<number | null> {
  const { fromDay, toDay } = lookbackWindow(now);
  const rows = await summaries.findByProductRange(productId, 'daily', fromDay, toDay);
  const latest = rows[rows.length - 1];
  return latest ? latest.landedCostCloseCents : null;
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
 * boundary only sees failures of the scan itself. Counters are kept per
 * kind and emitted as one stamped point-set per kind present in the
 * sweep (task 6.1, design D7); the returned/logged counters are their
 * run-wide sum.
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

  // -- Email configuration gate -------------------------------------------
  // Without the send path no intent could ever complete; evaluating
  // would only strand pending rows. Same posture as the freshness alert.
  if (
    !env.EMAIL_SEND_SECRET ||
    (!env.EMAIL_WORKER && !env.EMAIL_WORKER_URL)
  ) {
    log.warn({
      message:
        'Price-alert email delivery is not configured (EMAIL_WORKER binding ' +
        'or EMAIL_WORKER_URL, EMAIL_SEND_SECRET) — alerts not evaluated ' +
        'this tick',
    });
    return { configured: false, ...zeros };
  }

  const now = deps.now ?? (() => new Date());
  // Captured post-gate: closures (the default sender below) see plain
  // values instead of re-reading optional properties.
  const sendTarget: EmailDispatchTarget = {
    binding: env.EMAIL_WORKER,
    baseUrl: env.EMAIL_WORKER_URL,
    sendSecret: env.EMAIL_SEND_SECRET,
  };

  const alerts = deps.alerts ?? new D1PriceAlertRepository(env.DB);
  const notifications =
    deps.notifications ?? new D1AlertNotificationRepository(env.DB);
  const summaries =
    deps.summaries ?? new D1PriceHistorySummaryRepository(env.DB);
  const products = deps.products ?? new D1ProductSearchRepository(env.DB);
  const findAccountEmail =
    deps.findAccountEmail ??
    ((accountId: number) => findAccountEmailDefault(env.DB, accountId));
  const resolveLandedCostFacts =
    deps.resolveLandedCostFacts ??
    ((productId: number, close: LandedCostCloseBucket) =>
      resolveLandedCostCompositionFacts(env, productId, close));
  const send =
    deps.send ??
    ((email: PriceAlertEmail) => sendPriceAlertEmail(sendTarget, email));

  const active = await alerts.findActive();
  // Per-kind counter buckets (task 6.1, design D7): a bucket exists for
  // each threshold kind PRESENT in the sweep — its row entered the
  // counted loop below — and is emitted under its kind after the loop.
  // A kind whose alerts all skipped therefore still emits its zeros
  // under its kind (never omitted, never invented); kinds absent from
  // the sweep get no fabricated point-set.
  const kindBuckets = new Map<PriceAlertSweepKind, MutablePriceAlertCounters>();
  const bucketFor = (kind: PriceAlertSweepKind): MutablePriceAlertCounters => {
    const existing = kindBuckets.get(kind);
    if (existing !== undefined) return existing;
    const bucket: MutablePriceAlertCounters = {
      evaluated: 0,
      matched: 0,
      notified: 0,
      failed: 0,
      suppressed: 0,
    };
    kindBuckets.set(kind, bucket);
    return bucket;
  };
  const evaluatedAt = now();

  for (const alert of active) {
    // Kind ownership (task 4.1 design D5; spec: kind-guarded ownership):
    // each alert is evaluated ONLY by its kind's branch — the guard
    // table is exhaustive, with CATEGORY, LANDED_COST, and PRICE each
    // owned by exactly one branch below. TAX_CHANGE rows belong to the
    // tax-change evaluator and skip here BEFORE any read or counter.
    // Existing rows carry kind = 'PRICE' (migration 0016 backfill), so
    // prior evaluations are unaffected.
    if (alert.kind === 'TAX_CHANGE') continue;
    // The run-local bucket this row's kind owns — the increments in the
    // branches below are per kind; the run-wide aggregate is their sum.
    const counters = bucketFor(alert.kind);
    // Per-alert isolation: a failing alert counts failed, never aborts
    // the sweep.
    try {
      // Per-kind observation and match; the delivery pipeline below is
      // kind-agnostic. All threshold kinds share the 7-day lookback, the
      // `observed <= threshold` trigger, and the 24-hour cooldown (spec).
      let observedCents: number;
      let trippingProductId: number;
      let renderEmail: (to: string, productName: string | null) => PriceAlertEmail;
      if (alert.kind === 'CATEGORY') {
        const category = alert.category;
        // A CATEGORY row always carries a threshold — the kind-aware
        // create contract requires it (threshold is nullable only for
        // TAX_CHANGE, excluded by the guard above).
        const thresholdCents = alert.thresholdCents as number;
        if (category === null) {
          // Unrepresentable per the create contract — a data anomaly that
          // cannot be evaluated.
          log.warn({
            message: `Alert ${alert.id}: CATEGORY row without a category — skipped`,
          });
          continue;
        }
        const { fromDay, toDay } = lookbackWindow(evaluatedAt);
        const minimum = await summaries.findCategoryMinPriceCents(
          category,
          'daily',
          fromDay,
          toDay,
        );
        if (minimum === null) {
          // Stale summaries never trigger — the PRICE reader's null
          // posture: skipped with no evaluation counter and no email.
          log.info({
            message: `Alert ${alert.id}: no fresh daily product-wide summary within ${SUMMARY_LOOKBACK_DAYS}d for category ${category} — skipped`,
          });
          continue;
        }
        counters.evaluated++;

        if (minimum.priceCloseCents > thresholdCents) continue;
        counters.matched++;
        observedCents = minimum.priceCloseCents;
        trippingProductId = minimum.productId;
        renderEmail = (to, productName) =>
          buildCategoryAlertEmail({
            to,
            productName,
            productId: minimum.productId,
            category,
            observedPriceCents: minimum.priceCloseCents,
            thresholdCents,
            evaluatedAt,
          });
      } else if (alert.kind === 'LANDED_COST') {
        const productId = alert.productId;
        // A LANDED_COST row always carries a product (create contract);
        // null would be a data anomaly that cannot be evaluated.
        if (productId === null) {
          log.warn({
            message: `Alert ${alert.id}: LANDED_COST row without a product — skipped`,
          });
          continue;
        }
        const { fromDay, toDay } = lookbackWindow(evaluatedAt);
        const rows = await summaries.findByProductRange(
          productId,
          'daily',
          fromDay,
          toDay,
        );
        const latest = rows[rows.length - 1];
        if (latest === undefined) {
          // Stale summaries never trigger — the PRICE reader's null
          // posture: skipped with no evaluation counter and no email.
          log.info({
            message: `Alert ${alert.id}: no materialized daily summary for product ${productId} within ${SUMMARY_LOOKBACK_DAYS}d — skipped`,
          });
          continue;
        }
        // Composition before evaluation (spec: landed-cost alert
        // explainability): the email SHALL cite the close's composition
        // facts, so a close whose facts are not retrievable from stored
        // records is not evaluated at all — no counter, no email.
        const facts = await resolveLandedCostFacts(productId, {
          periodStart: latest.periodStart,
          landedCostCloseCents: latest.landedCostCloseCents,
        });
        if (facts === null) {
          log.warn({
            message: `Alert ${alert.id}: landed-cost composition for product ${productId} (${latest.periodStart}) not retrievable from the stored observation record — skipped`,
          });
          continue;
        }
        counters.evaluated++;

        // Threshold semantics: observed <= threshold triggers — the
        // same comparison every threshold kind uses.
        const thresholdCents = alert.thresholdCents as number;
        if (latest.landedCostCloseCents > thresholdCents) continue;
        counters.matched++;
        observedCents = latest.landedCostCloseCents;
        trippingProductId = productId;
        renderEmail = (to, productName) =>
          buildLandedCostAlertEmail({
            to,
            productName,
            productId,
            observedLandedCostCents: latest.landedCostCloseCents,
            thresholdCents,
            facts,
          });
      } else {
        const productId = alert.productId;
        // A PRICE row always carries a product (create contract); null
        // would be a data anomaly that cannot be evaluated.
        if (productId === null) {
          log.warn({
            message: `Alert ${alert.id}: PRICE row without a product — skipped`,
          });
          continue;
        }
        const observed = await latestMaterializedPriceCents(
          summaries,
          productId,
          evaluatedAt,
        );
        if (observed === null) {
          log.info({
            message: `Alert ${alert.id}: no materialized daily summary for product ${productId} within ${SUMMARY_LOOKBACK_DAYS}d — skipped`,
          });
          continue;
        }
        counters.evaluated++;

        // Threshold semantics (design decision): observed <= threshold
        // triggers.
        const thresholdCents = alert.thresholdCents as number;
        if (observed > thresholdCents) continue;
        counters.matched++;
        observedCents = observed;
        trippingProductId = productId;
        renderEmail = (to, productName) =>
          buildPriceAlertEmail({
            to,
            productName,
            productId,
            observedPriceCents: observed,
            thresholdCents,
            evaluatedAt,
          });
      }

      // -- Kind-agnostic delivery pipeline --------------------------------
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

      // The tripping product's row names the email — for PRICE the
      // watched product, for CATEGORY the product holding the minimum.
      const product = await products.findById(trippingProductId);
      const email = renderEmail(to, product?.name ?? null);

      // Intent row MUST exist before any dispatch attempt (spec:
      // delivery intent log).
      const intent = await notifications.createIntent({
        alertId: alert.id,
        observedPriceCents: observedCents,
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

  // Run-wide aggregate = the sum of the per-kind buckets; every counted
  // increment landed in exactly one of them.
  const totals = {
    evaluated: 0,
    matched: 0,
    notified: 0,
    failed: 0,
    suppressed: 0,
  };
  for (const bucket of kindBuckets.values()) {
    totals.evaluated += bucket.evaluated;
    totals.matched += bucket.matched;
    totals.notified += bucket.notified;
    totals.failed += bucket.failed;
    totals.suppressed += bucket.suppressed;
  }

  // Per-kind emission (task 6.1, design D7): one stamped point-set per
  // kind present in the sweep, so a failing kind's failed point carries
  // its kind and the run-wide failure ladder stays attributable via the
  // point's label. A sweep with no threshold-kind row at all (empty
  // active set, or TAX_CHANGE-only) keeps the legacy kindless point-set
  // — the run's heartbeat, so a zero-valued "cron produced its points"
  // stays distinguishable from a cron that stopped producing points.
  if (kindBuckets.size === 0) {
    recordPriceAlertEvaluationCounters(env, totals);
  } else {
    for (const [kind, bucket] of kindBuckets) {
      recordPriceAlertEvaluationCounters(env, { ...bucket, kind });
    }
  }

  log.info({
    message: `Price-alert evaluation: ${totals.evaluated} evaluated, ${totals.matched} matched, ${totals.notified} notified, ${totals.suppressed} cooldown-suppressed, ${totals.failed} failed`,
    activeAlerts: active.length,
    ...totals,
  });

  return {
    configured: true,
    activeAlerts: active.length,
    ...totals,
  };
}
