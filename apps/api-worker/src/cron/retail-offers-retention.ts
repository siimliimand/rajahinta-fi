/**
 * Retail-offer retention cron handler (task 3.1, change
 * d1-read-cost-reduction; design D4) — bounds the hot `retail_offers`
 * table (282k rows, append-only, no retention) to the current rows plus
 * a 30-day trailing window. Cron wiring on RETENTION_CRON (`30 3 * * *`,
 * alongside the calculation-record sweep and contact retention) is task
 * 3.2; this module owns only the handler.
 *
 * ## Superseded definition — the migration-0035 deterministic-latest rule
 *
 * A row is deletable iff (a) it is superseded — NOT the latest row of its
 * (merchant, product_id) pair under (observed_at DESC, id DESC), the
 * ROW_NUMBER() rn = 1 rule the reliability aggregate's LIVE_AGGREGATE_SQL
 * materializes from — and (b) its observed_at is past the window cutoff.
 * The selection states the rule as an anti-join instead of the ranked
 * CTE: a row is rn ≥ 2 exactly when some same-pair row ranks strictly
 * above it, and the rn = 1 row has no such successor — so each pair's
 * deterministic-latest row survives even when it is itself older than the
 * window. The anti-join (unlike a window CTE, which must consume every
 * partition before LIMIT can apply) lets each bounded batch stop at its
 * LIMIT — the per-batch rows-read the change's cost model rests on.
 *
 * ## Dry-run first (design D4, the nonalcoholic-catalog-audit precedent)
 *
 * The handler defaults to report-only mode: the same bounded selection
 * runs, candidates and window bounds are reported, nothing is deleted.
 * Live mode is an explicit `deps.mode` flip at the registration site —
 * a reviewed one-line change owned by the operator decision in the
 * change's owner gates — never an env var (no FF or launch-gate gating).
 *
 * ## Pre-flight provenance assertion (design D4)
 *
 * Live mode refuses to run unless the LANDED_COST alert's composition
 * citations provably COPY observation fields rather than dereference
 * (deleted) retail_offers rows. Verified against the evaluator
 * (price-alert-evaluation.ts, resolveLandedCostCompositionFacts): every
 * LandedCostCompositionFacts field is copied from the R2 observation-log
 * record's own field set — observed_at, foreign_retail_price_cents,
 * transport_cost_cents, confidence — and the route/dataset labels resolve
 * through FKs into transport_offers and tax_rules only. The log record's
 * `retail_offer_id` is carried but never dereferenced, and no statement
 * on the citation path touches retail_offers.
 * {@link FACTS_COPIED_FROM_LOG} pins that mapping at compile time — a
 * composition fact without a declared log source fails to compile, and
 * mapping one to `retail_offer_id` is the retail_offers-reference case
 * the pin forbids. {@link assertLandedCostProvenanceCopiesObservationFields}
 * re-verifies at runtime that the log layout carries every copied source
 * field and that the permitted FK targets stay clear of retail_offers. A
 * failed audit throws the typed refusal in live mode; dry-run still
 * reports.
 *
 * ## Bounded batches (contact-retention precedent)
 *
 * D1 has no DELETE … LIMIT: each batch selects the next id-ascending
 * chunk of deletable rows past the cursor and deletes by id list, then
 * advances; batches per invocation are capped and the remainder waits
 * for the next night (idempotent by cutoff). The safety chain holds by
 * construction: the R2 observation log mirrors every append, and the
 * historical surfaces read materialized price_history_summaries — a
 * deleted offer loses no consumer-reachable history (design D4).
 *
 * @module RetailOffersRetentionCron
 */

import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import type { ObservationLogRecord } from '../../../../packages/data-platform/src/d1/observation-log';
import {
  parseObservationLine,
  serializeObservationLine,
} from '../../../../packages/data-platform/src/d1/observation-log';
import type { LandedCostCompositionFacts } from './price-alert-evaluation';
import { RETENTION_CRON } from './retention-sweep';
import type { Env } from '../env';
import type { Logger } from '../logger';

/** The cron pattern this handler registers under (task 3.2 wiring). */
export const RETAIL_OFFERS_RETENTION_CRON = RETENTION_CRON;

/**
 * The spec-pinned retention window (design D4): a code constant, not a
 * var — a deployment cannot silently keep offer history longer.
 */
export const RETENTION_WINDOW_DAYS = 30;

/** Rows selected (and deleted) per batch (retention-service parity). */
export const RETENTION_BATCH_SIZE = 500;

/**
 * Ids per DELETE statement — D1 caps bound SQL variables at 100, so the
 * 500-row batch deletes in 90-id chunks (the 2026-10-26 first live tick
 * failed with `too many SQL variables`; the node:sqlite test harness does
 * not enforce the cap, which is why the tests missed it).
 */
export const RETENTION_DELETE_CHUNK = 90;

/**
 * Batch cap per invocation — 40 × 500 = 20k rows per night bounds the
 * sweep's D1 cost while draining even the initial 282k-row backlog in
 * about two weeks; the remainder waits for the next nightly run.
 */
export const RETENTION_MAX_BATCHES = 40;

/** Milliseconds per day. */
const MS_PER_DAY = 86_400_000;

/** Report-only (the default) or destructive. */
export type RetailOffersRetentionMode = 'dry-run' | 'live';

/**
 * Typed refusal (design D4): live mode with a failed provenance
 * pre-flight. Dry-run is never refused — it reports and deletes nothing.
 */
export class LandedCostProvenanceRefusalError extends Error {
  constructor(detail: string) {
    super(`retail-offers retention refused live mode: ${detail}`);
    this.name = 'LandedCostProvenanceRefusalError';
  }
}

/** Outcome of the pre-flight provenance audit. */
export interface LandedCostProvenanceContractResult {
  /** True when citations are copies, never retail_offers dereferences. */
  readonly holds: boolean;
  /** What was (not) verified — logged and surfaced on refusal. */
  readonly detail: string;
}

/**
 * Compile-time pin (design D4): every LANDED_COST composition fact maps
 * to the observation-log field it is COPIED from. Adding a fact without
 * a log source fails this `satisfies`; sourcing a fact from
 * `retail_offer_id` would route a citation through a deleted retail_offers
 * row and is rejected at runtime by the audit below.
 */
const FACTS_COPIED_FROM_LOG = {
  observedAt: 'observed_at',
  retailPriceCents: 'foreign_retail_price_cents',
  transportCostCents: 'transport_cost_cents',
  transportCarrier: 'transport_offer_id',
  transportOriginCountry: 'transport_offer_id',
  transportDestinationCountry: 'transport_offer_id',
  exciseDatasetVersion: 'excise_rule_version_id',
  containerDutyDatasetVersion: 'container_duty_rule_version_id',
  confidence: 'confidence',
} as const satisfies Readonly<
  Record<keyof LandedCostCompositionFacts, keyof ObservationLogRecord>
>;

/**
 * The tables the citation path may dereference by FK — the reviewed
 * resolveLandedCostCompositionFacts lookups (route fields, dataset
 * version labels). retail_offers must never appear here.
 */
const FACTS_FK_TARGETS = ['transport_offers', 'tax_rules'] as const;

/**
 * The synthetic log record the audit round-trips through the serializer
 * to prove the log layout physically carries every copied source field
 * (a layout change dropping one must fail the audit, not a citation).
 */
const PROVENANCE_PROBE_RECORD: ObservationLogRecord = {
  id: 0,
  product_id: 0,
  merchant: '',
  retail_offer_id: 0,
  observed_at: '1970-01-01T00:00:00.000Z',
  foreign_retail_price_cents: 0,
  transport_cost_cents: 0,
  transport_offer_id: null,
  excise_rule_version_id: null,
  container_duty_rule_version_id: null,
  landed_cost_cents: 0,
  input_reliability: {
    retailPrice: 'ESTIMATED',
    transport: 'UNAVAILABLE',
    exciseRule: 'ESTIMATED',
    containerDutyRule: 'ESTIMATED',
  },
  confidence: 'LOW',
};

/**
 * Pre-flight (design D4): the LANDED_COST citation path must copy
 * observation-log fields, never FK-reference retail_offers. See the
 * module docblock for what was verified against the evaluator.
 */
export function assertLandedCostProvenanceCopiesObservationFields(): LandedCostProvenanceContractResult {
  const carried = new Set(
    Object.keys(
      parseObservationLine(serializeObservationLine(PROVENANCE_PROBE_RECORD)),
    ),
  );
  for (const source of Object.values(FACTS_COPIED_FROM_LOG)) {
    if (!carried.has(source)) {
      return {
        holds: false,
        detail: `observation log no longer carries '${source}' — citations could not be copied from stored records`,
      };
    }
  }
  if ((FACTS_FK_TARGETS as readonly string[]).includes('retail_offers')) {
    return {
      holds: false,
      detail: 'the citation path dereferences retail_offers rows',
    };
  }
  return {
    holds: true,
    detail: `LANDED_COST citations copy observation-log fields (${Object.values(FACTS_COPIED_FROM_LOG).join(', ')}); FK dereferences limited to ${FACTS_FK_TARGETS.join(', ')}`,
  };
}

/**
 * One batch's deletable ids — superseded (the anti-join form of rn ≥ 2,
 * see the module docblock) AND past the window, id-ascending past the
 * cursor, bounded by LIMIT.
 */
const SELECT_SUPERSEDED_IDS_SQL = `
  SELECT candidate.id
    FROM retail_offers AS candidate
   WHERE candidate.observed_at < ?
     AND candidate.id > ?
     AND EXISTS (
           SELECT 1
             FROM retail_offers AS newer
            WHERE newer.merchant = candidate.merchant
              AND newer.product_id = candidate.product_id
              AND (newer.observed_at > candidate.observed_at
                OR (newer.observed_at = candidate.observed_at
                    AND newer.id > candidate.id))
         )
   ORDER BY candidate.id ASC
   LIMIT ?`;

/** One run's outcome — logged, asserted by tests, reported by dry-run. */
export interface RetailOffersRetentionResult {
  readonly mode: RetailOffersRetentionMode;
  /** The applied window cutoff (ISO-8601 UTC). */
  readonly cutoffIso: string;
  /** Superseded rows past the window found within the invocation bounds. */
  readonly candidates: number;
  /** Rows actually deleted (always 0 in dry-run). */
  readonly deleted: number;
  readonly batchesRun: number;
  readonly batchSize: number;
  readonly maxBatches: number;
  /** True when selection ended empty before the batch cap stopped it. */
  readonly exhausted: boolean;
  readonly provenance: LandedCostProvenanceContractResult;
}

/** Injection seams (test overrides; defaults are the real ones). */
export interface RetailOffersRetentionDeps {
  /**
   * Defaults to the Worker's D1 binding (`env.DB`). Tests inject the
   * node:sqlite harness with the committed migrations applied.
   */
  db?: D1DatabaseLike;
  /** Defaults to `new Date()`. */
  now?: Date;
  /** Defaults to 'dry-run' — the owner-gated flip to 'live' is explicit. */
  mode?: RetailOffersRetentionMode;
  /** Defaults to {@link RETENTION_WINDOW_DAYS}. */
  retentionDays?: number;
  /** Defaults to {@link RETENTION_BATCH_SIZE}. */
  batchSize?: number;
  /** Defaults to {@link RETENTION_MAX_BATCHES}. */
  maxBatches?: number;
  /** Defaults to {@link RETENTION_DELETE_CHUNK}. */
  deleteChunk?: number;
  /** Defaults to the real audit; tests force failures through this. */
  provenance?: LandedCostProvenanceContractResult;
}

/**
 * One nightly retention pass over `retail_offers`. Dry-run (the default)
 * runs the bounded selection and deletes nothing; live mode refuses to
 * start unless the provenance pre-flight holds, then deletes in
 * cursor-chunked bounded batches capped at {@link RetailOffersRetentionDeps.maxBatches}.
 * Throws on refusal — the router's per-handler isolation logs it.
 */
export async function handleRetailOffersRetention(
  env: Env,
  log: Logger,
  deps: RetailOffersRetentionDeps = {},
): Promise<RetailOffersRetentionResult> {
  const db = deps.db ?? env.DB;
  const mode = deps.mode ?? 'dry-run';
  const now = deps.now ?? new Date();
  const retentionDays = deps.retentionDays ?? RETENTION_WINDOW_DAYS;
  const batchSize = deps.batchSize ?? RETENTION_BATCH_SIZE;
  const maxBatches = deps.maxBatches ?? RETENTION_MAX_BATCHES;
  const deleteChunk = deps.deleteChunk ?? RETENTION_DELETE_CHUNK;
  const cutoffIso = new Date(
    now.getTime() - retentionDays * MS_PER_DAY,
  ).toISOString();

  const provenance =
    deps.provenance ?? assertLandedCostProvenanceCopiesObservationFields();
  if (mode === 'live' && !provenance.holds) {
    throw new LandedCostProvenanceRefusalError(provenance.detail);
  }

  const selectIds = db.prepare(SELECT_SUPERSEDED_IDS_SQL);
  let cursor = 0;
  let candidates = 0;
  let deleted = 0;
  let batchesRun = 0;
  let exhausted = false;

  while (batchesRun < maxBatches) {
    const ids = (
      await selectIds.bind(cutoffIso, cursor, batchSize).all<{ id: number }>()
    ).results.map((row) => row.id);
    if (ids.length === 0) {
      exhausted = true;
      break;
    }
    candidates += ids.length;
    cursor = ids[ids.length - 1];
    if (mode === 'live') {
      // D1 caps bound variables at 100 — delete the batch in ≤90-id chunks.
      for (let i = 0; i < ids.length; i += deleteChunk) {
        const chunk = ids.slice(i, i + deleteChunk);
        const placeholders = chunk.map(() => '?').join(', ');
        const result = await db
          .prepare(`DELETE FROM retail_offers WHERE id IN (${placeholders})`)
          .bind(...chunk)
          .run();
        deleted += Number(result.meta.changes ?? 0);
      }
    }
    batchesRun++;
    // A short selection means nothing deletable is left past the cursor.
    if (ids.length < batchSize) {
      exhausted = true;
      break;
    }
  }

  const fields = {
    message:
      mode === 'dry-run'
        ? `Retail-offers retention DRY-RUN: ${candidates} superseded rows past the ${retentionDays}-day window (cutoff ${cutoffIso}, ${batchesRun}/${maxBatches} batches of ${batchSize}, exhausted=${exhausted}) — deleted nothing`
        : `Retail-offers retention: deleted ${deleted} superseded rows past the ${retentionDays}-day window (cutoff ${cutoffIso}, ${batchesRun}/${maxBatches} batches of ${batchSize}, exhausted=${exhausted})`,
    mode,
    candidates,
    deleted,
    batchesRun,
    exhausted,
  };
  // Dry-run reports at warn so report-only runs stay visible in Workers
  // Logs until the owner flips live mode at the registration site.
  if (mode === 'dry-run') {
    log.warn(fields);
  } else {
    log.info(fields);
  }

  return {
    mode,
    cutoffIso,
    candidates,
    deleted,
    batchesRun,
    batchSize,
    maxBatches,
    exhausted,
    provenance,
  };
}
