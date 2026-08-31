/**
 * Price-ingestion Queue producer (task 4.1, design D6).
 *
 * The BullMQ `JobsSchedulerService.schedulePriceIngestion` @Cron(EVERY_HOUR)
 * port: the hourly cron trigger reads the D1 merchant registry and
 * enqueues ONE Queue message per permitted merchant with the dedupe key
 * preserved in the message body.
 *
 * Semantics carried over 1:1:
 * - Registry-driven: every registry row with a non-empty feedUrl is a
 *   candidate; an empty feed URL marks a merchant whose adapter is not
 *   live yet (skip, log).
 * - GRANTED-only via SourceGovernanceService — no governance records, a
 *   governance outage, or any status other than GRANTED skips the
 *   merchant (default-off, fail-closed).
 * - Dedupe key `price-ingestion-<merchantId>-<hour>` (UTC
 *   `YYYY-MM-DD-HH` — the exact BullMQ jobId shape). BullMQ deduped at
 *   enqueue by jobId; Cloudflare Queues has no server-side dedupe, so
 *   the key carries into the message and the CONSUMER enforces it
 *   (idempotent skip — see ingestion.queue.ts).
 * - One merchant's enqueue failure must not starve the remaining
 *   merchants' schedules (per-merchant try/catch, error count returned).
 *
 * @module IngestionProducer
 */

import type { PermissionCheckResult } from '@rajahinta/core-domain';
import type { Logger } from '../logger';
import { createLogger } from '../logger';
import type { IngestionMessageBody } from './ingestion-message';
import {
  composeGovernanceService,
  composeMerchantRegistry,
} from './pipeline';
import type { Env } from '../env';

/** The cron pattern the producer registers under (wrangler triggers.crons). */
export const INGESTION_PRODUCER_CRON = '0 * * * *';

/** Outcome of one hourly scheduling pass — logged by the cron dispatch. */
export interface ProducerResult {
  /** Registry rows considered. */
  readonly merchants: number;
  /** Messages enqueued (one per permitted merchant). */
  readonly enqueued: number;
  /** Skips by reason (governance gate, empty feed URL, enqueue error). */
  readonly skippedNoFeedUrl: number;
  readonly skippedNotPermitted: number;
  readonly enqueueErrors: number;
}

/**
 * Dedupe key for one merchant's hourly ingestion — byte-compatible with
 * the BullMQ jobId (`hourlyBucket()` = `YYYY-MM-DD-HH`, UTC, 'T' → '-').
 */
export function ingestionDedupeKey(merchantId: string, at: Date): string {
  const hourBucket = at.toISOString().slice(0, 13).replace('T', '-');
  return `price-ingestion-${merchantId}-${hourBucket}`;
}

/** Throw-on-use accessor — mirrors the DO client convention for bindings. */
export function ingestionQueue(env: Env): Queue<IngestionMessageBody> {
  if (!env.INGESTION_QUEUE) {
    throw new Error('INGESTION_QUEUE Queue binding is not configured');
  }
  return env.INGESTION_QUEUE;
}

/**
 * Governance permission check for the producer — mirrors the BullMQ
 * scheduler's isMerchantPermitted: no records or a governance error
 * default to PENDING (off), never to granted.
 */
export async function isMerchantPermitted(
  checkPermission: (merchantId: string) => Promise<PermissionCheckResult>,
  merchantId: string,
  log: Logger,
): Promise<boolean> {
  let result: PermissionCheckResult;
  try {
    result = await checkPermission(merchantId);
  } catch (err) {
    log.warn({
      message:
        `Not scheduling merchant "${merchantId}": governance check failed — ` +
        `defaulting to PENDING (${err instanceof Error ? err.message : String(err)})`,
    });
    return false;
  }

  if (result.sources.length === 0) {
    log.warn({
      message:
        `Not scheduling merchant "${merchantId}": no governance records — defaulting to PENDING`,
    });
    return false;
  }

  if (result.permissionStatus !== 'GRANTED') {
    log.warn({
      message:
        `Not scheduling merchant "${merchantId}": permission status is ${result.permissionStatus}`,
    });
    return false;
  }

  return true;
}

/**
 * One hourly scheduling pass: registry in, one Queue message per
 * permitted merchant out.
 *
 * `deps` is a test seam (queue send + governance check); production
 * composes the D1 registry, the governance service, and `env.INGESTION_QUEUE`.
 * The queue seam is the structural send surface — not the workers-types
 * Queue — so tests need no binding-shaped stubs.
 */
export async function schedulePriceIngestions(
  env: Env,
  deps: {
    now?: Date;
    log?: Logger;
    queue?: { send(body: IngestionMessageBody): Promise<unknown> };
    checkPermission?: (merchantId: string) => Promise<PermissionCheckResult>;
  } = {},
): Promise<ProducerResult> {
  const now = deps.now ?? new Date();
  const log = deps.log ?? createLogger(env.LOG_LEVEL);
  const queue = deps.queue ?? ingestionQueue(env);
  const governance = composeGovernanceService();
  const checkPermission =
    deps.checkPermission ?? ((id: string) => governance.checkPermission(id));

  const registry = composeMerchantRegistry(env);
  const merchants = await registry.list();

  // Mutable accumulator for the readonly ProducerResult shape.
  const counts = {
    merchants: merchants.length,
    enqueued: 0,
    skippedNoFeedUrl: 0,
    skippedNotPermitted: 0,
    enqueueErrors: 0,
  };

  for (const merchant of merchants) {
    if (!merchant.feedUrl) {
      // Registry convention: an empty feed URL marks a merchant whose
      // adapter is not live yet (e.g. Alko pre-7.5 wiring).
      log.info({
        message:
          `Skipping merchant "${merchant.merchantId}": registry feed URL is empty`,
      });
      counts.skippedNoFeedUrl++;
      continue;
    }

    if (!(await isMerchantPermitted(checkPermission, merchant.merchantId, log))) {
      counts.skippedNotPermitted++;
      continue;
    }

    const body: IngestionMessageBody = {
      dedupeKey: ingestionDedupeKey(merchant.merchantId, now),
      merchantId: merchant.merchantId,
      sourceUrl: merchant.feedUrl,
    };

    try {
      await queue.send(body);
      counts.enqueued++;
    } catch (err) {
      // One merchant's enqueue failure must not starve the remaining
      // merchants' schedules (BullMQ scheduler parity).
      counts.enqueueErrors++;
      log.error({
        message:
          `Failed to enqueue price-ingestion message for merchant "${merchant.merchantId}": ` +
          (err instanceof Error ? err.message : String(err)),
      });
    }
  }

  log.info({
    message:
      `Hourly price ingestion: enqueued ${counts.enqueued}/${merchants.length} ` +
      `registry merchant message(s) — one message per permitted merchant`,
    enqueued: counts.enqueued,
    merchants: merchants.length,
  });

  return counts;
}
