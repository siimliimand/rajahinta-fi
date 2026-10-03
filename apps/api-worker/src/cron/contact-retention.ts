/**
 * Contact-message retention cron handler (task 3.2, change
 * first-impression-pass; design D8, spec contact-intake "Retention is
 * bounded") — deletes `contact_messages` rows older than 90 days.
 *
 * Registered on the same daily pattern as the calculation-record sweep
 * ({@link RETENTION_CRON}; wrangler crons are UTC-only — see the
 * wrangler.jsonc note): the routing table runs both handlers on the
 * tick with per-handler error isolation, so a failure here cannot
 * starve the other sweeps. The delete itself is the repository's
 * bounded batch loop, idempotent by cutoff — a missed or repeated run
 * converges (the spec's "a contact message older than 90 days SHALL be
 * deleted by the retention job").
 *
 * The window is pinned at 90 days in code, not config: it is a spec
 * requirement, not a tunable — a deployment cannot silently keep
 * personal data longer by editing a var.
 *
 * @module ContactRetentionCron
 */

import { D1ContactMessageRepository } from '../../../../packages/data-platform/src/repositories/d1/contact-message.repository';
import type { Env } from '../env';
import type { Logger } from '../logger';
import { RETENTION_CRON } from './retention-sweep';

/** The cron pattern this handler registers under (shares the daily sweep). */
export const CONTACT_RETENTION_CRON = RETENTION_CRON;

/** The spec-pinned retention window for contact messages. */
export const CONTACT_RETENTION_DAYS = 90;

/** Rows deleted per DELETE statement (retention-service parity). */
const DEFAULT_BATCH_SIZE = 500;

/** Milliseconds per day. */
const MS_PER_DAY = 86_400_000;

export interface ContactRetentionRunResult {
  /** Rows deleted in this sweep. */
  readonly deleted: number;
  /** The applied created-at cutoff (ISO string). */
  readonly cutoffIso: string;
  /** Rows per DELETE statement (bounded batches). */
  readonly batchSize: number;
}

/**
 * One daily contact-message retention sweep. `deps` is a test seam
 * (window/batch/repository overrides).
 */
export async function handleContactRetention(
  env: Env,
  log: Logger,
  deps: {
    now?: Date;
    retentionDays?: number;
    batchSize?: number;
    repository?: D1ContactMessageRepository;
  } = {},
): Promise<ContactRetentionRunResult> {
  const now = deps.now ?? new Date();
  const retentionDays = deps.retentionDays ?? CONTACT_RETENTION_DAYS;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const cutoff = new Date(now.getTime() - retentionDays * MS_PER_DAY);

  const deleted = await (deps.repository ??
    new D1ContactMessageRepository(env.DB)).deleteCreatedBefore(
    cutoff,
    batchSize,
  );

  log.info({
    message: `Contact-message retention sweep finished: deleted ${deleted} rows past the ${retentionDays}-day window (cutoff ${cutoff.toISOString()}, batch ${batchSize})`,
    deleted,
  });

  return { deleted, cutoffIso: cutoff.toISOString(), batchSize };
}
