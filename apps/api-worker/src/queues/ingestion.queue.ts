/**
 * Price-ingestion Queue consumer (task 4.1, design D6) — the BullMQ
 * `PriceIngestionWorker` port with idempotent skip.
 *
 * ## Idempotent skip (the dedupe-key carry-over)
 *
 * BullMQ deduped at ENQUEUE by jobId; Cloudflare Queues has no
 * server-side dedupe, so `price-ingestion-<merchantId>-<hour>` moves to
 * a consumer-side marker in the IdempotencyDO's job-claim namespace
 * (strongly consistent + atomic — the D5 reason a DO beats KV here):
 *
 * 1. claim the dedupe key — `claimed` runs the job;
 *    `already-completed` / `in-flight` ack the delivery with no work
 *    (duplicate schedule ⇒ exactly one ingestion, the spec scenario);
 *    a stale `processing` claim (dead attempt) is reclaimed.
 * 2. run the pipeline; on success mark the key completed (TTL 25 h —
 *   hourly keys, BullMQ removeOnComplete age was one day).
 * 3. on failure RELEASE the claim and retry the message — a failed run
 *    must never leave a marker that suppresses its own retry
 *    (at-least-once completion, BullMQ attempts: 5 parity via
 *    `max_retries` in wrangler.jsonc).
 *
 * ## Pipeline invocation
 *
 * {@link runIngestion} is the narrow invocation interface task 4.2's
 * Workflow re-hosts: re-read the registry row at run time (registry
 * edits take effect on the next job without a deploy; the message's
 * sourceUrl is enqueue-time log context only), derive the MerchantConfig,
 * and run the composed pipeline (see pipeline.ts) — the governance gate
 * applies again inside the pipeline before any fetch or persistence.
 *
 * @module IngestionQueue
 */

import {
  claimJob,
  completeJob,
  releaseJob,
} from '../do/client';
import { createLogger, type Logger } from '../logger';
import type { Env } from '../env';
import type { IngestionMessageBody } from './ingestion-message';
import {
  composeIngestionPipeline,
  composeMerchantRegistry,
} from './pipeline';
import { merchantConfigFromRegistry } from '../../../../packages/data-acquisition/src/interfaces/merchant-config.interface';
import type { MerchantConfig } from '../../../../packages/data-acquisition/src/interfaces/merchant-config.interface';

/**
 * Run one merchant's ingestion end to end — the narrow interface task
 * 4.2 keeps when the pipeline becomes a Workflow.
 *
 * `merchant.sourceUrl` is log context from enqueue time; the registry
 * row is re-read so an operator edit wins over the message.
 */
export async function runIngestion(
  merchant: { merchantId: string; sourceUrl?: string },
  ctx: { env: Env; log: Logger },
): Promise<{ productsIngested: number; errors: string[] }> {
  const registry = composeMerchantRegistry(ctx.env);
  const row = await registry.findByMerchantId(merchant.merchantId);
  if (row === null) {
    const message =
      `Merchant "${merchant.merchantId}" is not in the merchant registry — ` +
      'onboard it (registry row + governance grant) before ingestion (D6)';
    ctx.log.error({ message });
    return { productsIngested: 0, errors: [message] };
  }

  const derived = merchantConfigFromRegistry(row);
  if ('error' in derived) {
    ctx.log.error({ message: derived.error });
    return { productsIngested: 0, errors: [derived.error] };
  }

  const report = await composeIngestionPipeline(ctx.env).runForMerchant(
    derived.config satisfies MerchantConfig,
  );

  return {
    productsIngested: report.recordsAdded + report.recordsUpdated,
    errors: [...report.errors],
  };
}

/**
 * Process one Queue batch: claim → run → complete (or release + retry).
 *
 * `run` is a test seam defaulting to {@link runIngestion}; `deps` lets
 * tests inject the job-claim client. A claim/complete DO failure counts
 * as message failure (retry) — the marker is the correctness mechanism
 * and must not degrade silently.
 */
export async function processIngestionMessage(
  body: IngestionMessageBody,
  env: Env,
  deps: {
    log?: Logger;
    run?: typeof runIngestion;
    claims?: {
      claim: typeof claimJob;
      complete: typeof completeJob;
      release: typeof releaseJob;
    };
  } = {},
): Promise<{ processed: boolean; skipped: boolean; error?: string }> {
  const log = deps.log ?? createLogger(env.LOG_LEVEL);
  const claims = deps.claims ?? {
    claim: claimJob,
    complete: completeJob,
    release: releaseJob,
  };
  const run = deps.run ?? runIngestion;

  if (
    typeof body?.dedupeKey !== 'string' ||
    body.dedupeKey.length === 0 ||
    typeof body?.merchantId !== 'string' ||
    body.merchantId.length === 0
  ) {
    // Malformed body — no dedupe key to claim; fail the message so it
    // exhausts retries and lands in the DLQ for inspection.
    throw new Error(`Malformed ingestion message body: ${JSON.stringify(body)}`);
  }

  const outcome = await claims.claim(env, body.dedupeKey);
  if (outcome.status === 'already-completed') {
    log.info({
      message: `Skipping ingestion ${body.dedupeKey}: already processed`,
      dedupeKey: body.dedupeKey,
    });
    return { processed: false, skipped: true };
  }
  if (outcome.status === 'in-flight') {
    log.info({
      message: `Skipping ingestion ${body.dedupeKey}: another delivery is in flight`,
      dedupeKey: body.dedupeKey,
    });
    return { processed: false, skipped: true };
  }

  log.info({
    message: `Ingesting prices for merchant ${body.merchantId} (dedupe key ${body.dedupeKey})`,
    merchantId: body.merchantId,
    dedupeKey: body.dedupeKey,
    sourceUrl: body.sourceUrl,
  });

  try {
    const result = await run(
      { merchantId: body.merchantId, sourceUrl: body.sourceUrl },
      { env, log },
    );
    await claims.complete(env, body.dedupeKey);
    log.info({
      message: `Ingested ${result.productsIngested} products for merchant ${body.merchantId}`,
      merchantId: body.merchantId,
      productsIngested: result.productsIngested,
      errorCount: result.errors.length,
    });
    if (result.errors.length > 0) {
      log.warn({
        message: `Ingestion completed with ${result.errors.length} errors for merchant ${body.merchantId}`,
        merchantId: body.merchantId,
      });
    }
    return { processed: true, skipped: false };
  } catch (err) {
    // Release the claim BEFORE retrying: the redelivery must be able to
    // process the key again (a failed run never suppresses its retry).
    await claims.release(env, body.dedupeKey);
    const message = err instanceof Error ? err.message : String(err);
    log.error({
      message: `Ingestion failed for merchant ${body.merchantId} — claim released, message will retry`,
      merchantId: body.merchantId,
      dedupeKey: body.dedupeKey,
      error: message,
    });
    return { processed: false, skipped: false, error: message };
  }
}

/**
 * The wrangler `queue` consumer entry. Batch size is 1 (per-merchant
 * failure isolation — a slow feed delays nobody, BullMQ concurrency
 * parity), so the batch holds exactly one message; a processing failure
 * retries that message without touching anything else.
 */
export async function handleIngestionBatch(
  batch: MessageBatch<IngestionMessageBody>,
  env: Env,
  deps?: Parameters<typeof processIngestionMessage>[2],
): Promise<void> {
  for (const message of batch.messages) {
    const result = await processIngestionMessage(message.body, env, deps);
    if (result.skipped || result.processed) {
      message.ack();
    } else {
      message.retry({
        delaySeconds: retryDelaySeconds(message.attempts),
      });
    }
  }
}

/**
 * Exponential backoff, 30 s base — the BullMQ price-ingestion
 * defaultJobOptions (`backoff: { type: 'exponential', delay: 30_000 }`).
 */
export function retryDelaySeconds(attemptsMade: number): number {
  return Math.min(30 * 2 ** attemptsMade, 7_200);
}
