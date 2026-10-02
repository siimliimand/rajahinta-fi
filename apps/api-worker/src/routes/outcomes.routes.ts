/**
 * Verified-outcome routes (task 3.2, change trust-and-reach-roadmap) —
 * outcome reporting, the public accuracy statistic, and the history
 * payload extension.
 *
 *   POST /api/v1/calculations/:id/outcome   sessionAuth (GUARDED_ROUTES;
 *                                           the prefix's CALCULATOR rate
 *                                           limit registers at index.ts)
 *   GET  /api/v1/accuracy                   public, read-only aggregate
 *
 * Submission order is core-domain's `validateOutcomeSubmission` (the
 * module owns the contract; the route maps reasons to statuses):
 *
 *   unknown record            → 404 RECORD_NOT_FOUND
 *   record owned by another   → 403 NOT_RECORD_OWNER
 *   duplicate (record, account) → 409 OUTCOME_ALREADY_EXISTS (the stored
 *                               outcome stays untouched — the unique
 *                               index is the backstop, the typed
 *                               DuplicateOutcomeError the race guard)
 *   non-positive cents        → 400 REPORTED_TOTAL_NOT_POSITIVE
 *   past the 60-day window    → 400 WINDOW_EXPIRED
 *
 * The accuracy statistic is computed read-time and labeled with the
 * module's exported user-reported labels — the API never invents
 * wording (spec calculation-outcomes).
 *
 * `?groupBy=category|carrier` splits the same statistic read-time
 * (change expand-alerts-accuracy-breakdowns, design D5): cells under
 * the 10-outcome floor carry NO share — the suppression happens here
 * so no client can render a small-sample percentage — and a per-cell
 * state keeps count-only machine-distinguishable from the honest empty
 * state. Wording stays locked to the module labels; the breakdown is
 * display-only (nothing feeds the calculator, ranking, or basket).
 *
 * The unfiltered response carries an additive `coverage` block (change
 * honest-trust-surfaces, task 3.1): the true catalog state — product
 * count, offer observation count, latest aggregation watermark — read
 * from D1 at request time. The statistic fields keep their exact shape;
 * the block is display-only and feeds no calculation input (spec
 * calculation-outcomes).
 *
 * @module OutcomesRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import {
  isWithinMargin,
  validateOutcomeSubmission,
} from '../../../../packages/core-domain/src/outcomes/outcomes';
import {
  InvalidOutcomeInputError,
  USER_REPORTED_OUTCOMES_LABEL_EN,
  USER_REPORTED_OUTCOMES_LABEL_FI,
} from '../../../../packages/core-domain/src/outcomes/outcomes.types';
import type { OutcomeAccuracyBreakdownCell } from '../../../../packages/core-domain/src/outcomes/outcomes.types';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { parseIntParam, parseDto, validationError } from './support';
import { USER_CONTEXT_KEY } from '../auth/authenticated-account';
import type { AuthenticatedAccount } from '../auth/authenticated-account';
import { findOwnedCalculationRecord } from '../adapters/calculation-record-reads';
import { D1CalculationOutcomeRepository } from '../../../../packages/data-platform/src/repositories/d1/calculation-outcome.repository';
import { DuplicateOutcomeError } from '../../../../packages/data-platform/src/abstracts';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import { D1AccountStore } from '../adapters/account-store';

function requireUser(c: Context<AppEnv>): AuthenticatedAccount {
  return c.get(USER_CONTEXT_KEY) as AuthenticatedAccount;
}

const TOTAL_MESSAGE = 'reportedTotalCents must be a positive integer amount in euro cents';

const outcomeSchema = z.object({
  reportedTotalCents: z
    .number({ required_error: TOTAL_MESSAGE, invalid_type_error: TOTAL_MESSAGE })
    .int(TOTAL_MESSAGE),
});

/** Domain rejection → HTTP status. Order matches the module's checks. */
function mapOutcomeError(err: unknown): never {
  if (err instanceof InvalidOutcomeInputError) {
    switch (err.reason) {
      case 'RECORD_NOT_FOUND':
        throw new ApiHttpError(404, {
          statusCode: 404,
          message: err.message,
          error: err.reason,
        });
      case 'NOT_RECORD_OWNER':
        throw new ApiHttpError(403, {
          statusCode: 403,
          message: err.message,
          error: err.reason,
        });
      case 'OUTCOME_ALREADY_EXISTS':
        throw new ApiHttpError(409, {
          statusCode: 409,
          message: err.message,
          error: err.reason,
        });
      default:
        throw new ApiHttpError(400, {
          statusCode: 400,
          message: err.message,
          error: err.reason,
        });
    }
  }
  throw err as Error;
}

async function createOutcome(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const recordId = parseIntParam(c, 'id');
  const body = await parseDto(c, outcomeSchema);

  const record = await findOwnedCalculationRecord(c.env.DB, recordId);

  // Duplicate probe: at most one outcome per (record, account). The
  // repository's record-scoped read keeps the check one indexed query.
  const repo = new D1CalculationOutcomeRepository(c.env.DB);
  const existing = await repo.findByCalculationRecordId(recordId);
  const ownOutcome = existing.find((o) => o.reporterAccountId === user.accountId);

  let validated: ReturnType<typeof validateOutcomeSubmission>;
  try {
    validated = validateOutcomeSubmission({
      calculationRecordId: String(recordId),
      accountId: user.userId,
      reportedTotalCents: body.reportedTotalCents,
      recordCalculationTimestamp: record?.calculatedAt ?? new Date(0),
      now: new Date(),
      recordOwnerAccountId: record === null ? null : record.ownerUserId,
      existingOutcomeId: ownOutcome ? String(ownOutcome.id) : null,
    });
  } catch (err) {
    mapOutcomeError(err);
  }

  try {
    const created = await repo.create({
      calculationRecordId: recordId,
      reporterAccountId: user.accountId,
      // The frozen estimate: total + itemized lines — enough to keep the
      // margin comparison explainable after the record itself is pruned.
      estimateDigest: {
        totalCents: record?.totalCents ?? null,
        breakdown: record?.breakdown ?? null,
      },
      estimatedTotalCents: record?.totalCents ?? 0,
      reportedTotalCents: validated.reportedTotalCents,
    });
    return c.json(
      {
        id: created.id,
        calculationRecordId: created.calculationRecordId,
        estimatedTotalCents: created.estimatedTotalCents,
        reportedTotalCents: created.reportedTotalCents,
        withinMargin: isWithinMargin(
          created.reportedTotalCents,
          created.estimatedTotalCents,
        ),
        reportedAt: created.reportedAt.toISOString(),
      },
      201,
    );
  } catch (err) {
    // The unique index is the race backstop for the pre-check above.
    if (err instanceof DuplicateOutcomeError) {
      throw new ApiHttpError(409, {
        statusCode: 409,
        message: err.message,
        error: 'OUTCOME_ALREADY_EXISTS',
      });
    }
    throw err;
  }
}

/**
 * Below-floor threshold for breakdown cells (design D5): a cell with
 * fewer than 10 outcomes renders the count only. The floor is applied
 * at the endpoint so the share never enters the response — no client
 * can render a below-floor percentage. The global statistic is not
 * floored.
 */
const BREAKDOWN_MIN_CELL_N = 10;

/** The two split dimensions the endpoint accepts — anything else 400s. */
const GROUP_BY_SCHEMA = z.enum(['category', 'carrier']);

/**
 * Response cell under the display floor. `state` is the machine
 * distinction between the two low states: `count_only` (1–9 outcomes,
 * share suppressed) is NOT the honest empty state (`empty`, 0 outcomes),
 * and only `share` (n ≥ 10) carries a numeric `withinMarginShare`.
 */
interface AccuracyBreakdownCellResponse {
  readonly key: string;
  readonly count: number;
  readonly withinMarginShare: number | null;
  readonly state: 'share' | 'count_only' | 'empty';
}

/** Apply the display floor to one repository cell. */
function toFloorResponseCell(
  cell: OutcomeAccuracyBreakdownCell,
): AccuracyBreakdownCellResponse {
  if (cell.count === 0) {
    return { key: cell.key, count: 0, withinMarginShare: null, state: 'empty' };
  }
  if (cell.count < BREAKDOWN_MIN_CELL_N) {
    return {
      key: cell.key,
      count: cell.count,
      withinMarginShare: null,
      state: 'count_only',
    };
  }
  return {
    key: cell.key,
    count: cell.count,
    withinMarginShare: cell.withinMarginShare,
    state: 'share',
  };
}

/**
 * Catalog coverage aggregate (change honest-trust-surfaces, task 3.1) —
 * ONE statement, three scalar subqueries: the true stored counts and
 * the true latest watermark. `MAX(watermark)` over the per-job rows is
 * the ingestion watermark (ISO TEXT compares chronologically); over an
 * empty table it is NULL → null, the honest no-ingest-yet state, never
 * a fabricated instant. Read-time only — no caching, no materialization.
 */
const COVERAGE_SQL = `
  SELECT
    (SELECT COUNT(*) FROM product_master) AS product_count,
    (SELECT COUNT(*) FROM retail_offers) AS offer_observations,
    (SELECT MAX(watermark) FROM aggregation_watermarks) AS last_ingest_at`;

interface D1CoverageRow {
  readonly product_count: number;
  readonly offer_observations: number;
  readonly last_ingest_at: string | null;
}

/** The additive `coverage` block shape on the unfiltered accuracy response. */
export interface AccuracyCoverageResponse {
  readonly productCount: number;
  readonly offerObservations: number;
  readonly lastIngestAt: string | null;
}

/** Read the coverage block — one D1 round-trip, true stored values only. */
async function readCoverage(
  d1: D1DatabaseLike,
): Promise<AccuracyCoverageResponse> {
  const row = await d1.prepare(COVERAGE_SQL).first<D1CoverageRow>();
  if (!row) {
    // Scalar subqueries always yield exactly one row, even over empty tables.
    throw new Error('coverage aggregate returned no row');
  }
  return {
    productCount: row.product_count,
    offerObservations: row.offer_observations,
    lastIngestAt: row.last_ingest_at,
  };
}

async function getAccuracy(c: Context<AppEnv>): Promise<Response> {
  const repo = new D1CalculationOutcomeRepository(c.env.DB);
  const groupBy = c.req.query('groupBy');

  if (groupBy === undefined) {
    // Unfiltered global statistic — the statistic fields stay
    // byte-identical (compliance task 4.3); `coverage` is the one
    // additive field (honest-trust-surfaces task 3.1), read in
    // parallel with the statistic.
    const [statistic, coverage] = await Promise.all([
      repo.findAccuracyStatistic({}, new Date()),
      readCoverage(c.env.DB),
    ]);
    return c.json({
      count: statistic.count,
      withinMarginShare: statistic.withinMarginShare,
      asOf: statistic.asOf.toISOString(),
      // The exact module labels — every rendering says "user-reported"
      // (spec calculation-outcomes; the UI must not invent wording).
      label: {
        fi: USER_REPORTED_OUTCOMES_LABEL_FI,
        en: USER_REPORTED_OUTCOMES_LABEL_EN,
      },
      coverage,
    });
  }

  const parsed = GROUP_BY_SCHEMA.safeParse(groupBy);
  if (!parsed.success) {
    throw validationError(parsed.error);
  }

  // Read-time only: no caching, no materialization — and display-only,
  // so the result must never feed calculator/ranking/basket inputs.
  const breakdown = await repo.findAccuracyBreakdown(
    {},
    new Date(),
    parsed.data,
  );
  return c.json({
    dimension: breakdown.dimension,
    cells: breakdown.cells.map(toFloorResponseCell),
    asOf: breakdown.asOf.toISOString(),
    // Same module labels — the breakdown adds no wording of its own.
    label: {
      fi: USER_REPORTED_OUTCOMES_LABEL_FI,
      en: USER_REPORTED_OUTCOMES_LABEL_EN,
    },
  });
}

/** Register the accuracy handler; POST registers via registerOutcomeRoutes. */
export function registerAccuracyRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.get('/api/v1/accuracy', getAccuracy);
  return app;
}

/** Register the outcome handler (sessionAuth rides the GUARDED_ROUTES entry). */
export function registerOutcomeRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.post('/api/v1/calculations/:id/outcome', createOutcome);
  return app;
}

// ---------------------------------------------------------------------------
// History extension (task 3.2) — outcome flags for the in-account prompt
// ---------------------------------------------------------------------------

/** Shape of the extended history item. */
export interface HistoryOutcomeFlag {
  readonly recordId: number;
  /** True when the account already reported an outcome for the record. */
  readonly outcomeReported: boolean;
}

/**
 * Records of one account flagged with outcome presence — the extended
 * history payload (`GET /api/v1/account/history?outcomes=1`). Records
 * still MISSING an outcome carry `outcomeReported: false`, which drives
 * the in-account report prompt (frontend task 3.3). Default history
 * shape (number[]) is untouched — additive query parameter only.
 */
export async function historyWithOutcomeFlags(
  d1: D1DatabaseLike,
  userId: string,
  accountId: number,
): Promise<HistoryOutcomeFlag[]> {
  const recordIds = await new D1AccountStore(d1).findHistoryIds(userId);
  const reported = new Set(
    (await new D1CalculationOutcomeRepository(d1).findByReporterAccountId(accountId)).map(
      (o) => o.calculationRecordId,
    ),
  );
  return recordIds.map((recordId) => ({
    recordId,
    outcomeReported: reported.has(recordId),
  }));
}
