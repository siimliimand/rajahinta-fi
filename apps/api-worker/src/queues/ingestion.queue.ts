/**
 * Price-ingestion Queue consumer (task 4.1, design D6) — the BullMQ
 * `PriceIngestionWorker` port with idempotent skip; task 4.2 moves the
 * pipeline invocation into a Cloudflare Workflow handoff.
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
 * 2. hand the message to the ingestion Workflow — the instance id IS
 *    the dedupe key, so at-least-once delivery collapses onto one
 *    instance (see src/workflows/handoff.ts).
 * 3. on handoff failure RELEASE the claim and retry the message — a
 *    failed handoff must never leave a marker that suppresses its own
 *    retry (at-least-once completion).
 *
 * ## Claim ownership (task 4.2 pick, documented)
 *
 * The consumer only CLAIMS and RELEASES-on-failure. Completion moved
 * INTO the workflow: its `complete-job-claim` step marks the key
 * completed on success and its `release-job-claim` step releases on
 * terminal instance failure (see src/workflows/ingestion-steps.ts).
 * While the instance runs, duplicate deliveries skip as `in-flight`.
 *
 * ## Pipeline invocation
 *
 * {@link runIngestionViaWorkflow} (default) creates the Workflow
 * instance; {@link runIngestion} remains the direct in-consumer runner
 * (registry re-read at run time → derived MerchantConfig → composed
 * pipeline, governance gate applied inside) for tests and as the
 * pre-Workflow fallback. Both re-read the registry so an operator edit
 * wins over the message without a deploy.
 *
 * @module IngestionQueue
 */

import {
  claimJob,
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
import { ensureWorkflowInstance } from '../workflows/handoff';

/**
 * Outcome of one consumer invocation (run or handoff). `handedOff`
 * marks the Workflow path — the product count becomes known only when
 * the instance finishes, so the consumer logs the handoff, not a count.
 */
export interface IngestionRunOutcome {
  readonly productsIngested: number;
  readonly errors: string[];
  /** True when the run was handed to a durable Workflow instance. */
  readonly handedOff?: boolean;
}

/**
 * Run one merchant's ingestion end to end — the direct in-consumer
 * runner (pre-4.2 default). Kept as the test/fallback seam; production
 * hands off to the Workflow via {@link runIngestionViaWorkflow}.
 *
 * `merchant.sourceUrl` is log context from enqueue time; the registry
 * row is re-read so an operator edit wins over the message.
 */
export async function runIngestion(
  merchant: { merchantId: string; sourceUrl?: string },
  ctx: { env: Env; log: Logger },
): Promise<IngestionRunOutcome> {
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
 * Hand one message to the ingestion Workflow (task 4.2 default seam).
 *
 * The instance id IS the dedupe key — the idempotent handoff: a
 * duplicate delivery resolves to the SAME instance (no duplicate
 * ingestion) and the durable instance carries the per-step retries that
 * BullMQ realized as job-level attempts. The product count is unknowable
 * at handoff time; the instance reports it through its own completion.
 */
export async function runIngestionViaWorkflow(
  merchant: { merchantId: string; sourceUrl?: string; dedupeKey?: string },
  ctx: { env: Env; log: Logger },
): Promise<IngestionRunOutcome> {
  if (!merchant.dedupeKey) {
    throw new Error(
      'Workflow handoff requires the message dedupeKey — it is the idempotent instance id',
    );
  }
  const workflow = ctx.env.INGESTION_WORKFLOW;
  if (!workflow) {
    throw new Error('INGESTION_WORKFLOW Workflow binding is not configured');
  }
  await ensureWorkflowInstance(workflow, merchant.dedupeKey, {
    dedupeKey: merchant.dedupeKey,
    merchantId: merchant.merchantId,
    sourceUrl: merchant.sourceUrl ?? '',
  });
  return { productsIngested: 0, errors: [], handedOff: true };
}

/**
 * Process one Queue batch message: claim → run/handoff → (completion is
 * the runner's business now) — or release + retry on failure.
 *
 * `run` is a test seam defaulting to {@link runIngestionViaWorkflow};
 * `deps` lets tests inject the job-claim client. A claim/release DO
 * failure counts as message failure (retry) — the marker is the
 * correctness mechanism and must not degrade silently.
 */
export async function processIngestionMessage(
  body: IngestionMessageBody,
  env: Env,
  deps: {
    log?: Logger;
    run?: (
      merchant: { merchantId: string; sourceUrl?: string; dedupeKey?: string },
      ctx: { env: Env; log: Logger },
    ) => Promise<IngestionRunOutcome>;
    claims?: {
      claim: typeof claimJob;
      release: typeof releaseJob;
    };
  } = {},
): Promise<{ processed: boolean; skipped: boolean; error?: string }> {
  const log = deps.log ?? createLogger(env.LOG_LEVEL);
  const claims = deps.claims ?? {
    claim: claimJob,
    release: releaseJob,
  };
  const run = deps.run ?? runIngestionViaWorkflow;

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
      { merchantId: body.merchantId, sourceUrl: body.sourceUrl, dedupeKey: body.dedupeKey },
      { env, log },
    );
    if (result.handedOff === true) {
      log.info({
        message: `Handed off ingestion ${body.dedupeKey} to Workflow instance ${body.dedupeKey} — durable per-step retries; the instance completes the claim`,
        merchantId: body.merchantId,
        dedupeKey: body.dedupeKey,
      });
    } else {
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
