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
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { parseIntParam, parseDto } from './support';
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

async function getAccuracy(c: Context<AppEnv>): Promise<Response> {
  const statistic = await new D1CalculationOutcomeRepository(
    c.env.DB,
  ).findAccuracyStatistic({}, new Date());

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
