/**
 * Chunked crawl-fetch steps for the ingestion Workflow (task 3.1,
 * change sitemap-crawl-merchants; design D5) — the crawl-merchant
 * replacement for the single `fetch-feed` step.
 *
 * The loop drives one crawl cycle as durable step pairs:
 * `crawl-discover` (begin or resume; the sitemap is fetched at most
 * once per cycle — a resumed cycle replays the cached discover output
 * or reads the persisted cursor, never re-fetches), then per chunk
 * `crawl-chunk-N` (≤ 300 detail fetches, records reported) and
 * `crawl-advance-N` (cursor past the committed records). The accumulated
 * records and errors return as the ordinary fetch outcome, so the
 * existing map → volume-ceiling-gate → upsert → data-quality steps run
 * UNCHANGED over the full set once the queue drains.
 *
 * Budgets (design D5 + the ingestion chunk-budget rule):
 *
 * - Subrequests: a chunk is ~300 fetches + a handful of D1 statements
 *   (~310 of the ~1,000/invocation ceiling). A durable sleep before
 *   every chunk after the first gives each chunk a fresh invocation —
 *   the same boundary discipline as the upsert loop's D1 quota resets,
 *   here paced by the subrequest ceiling (the walk's own D1 cost is a
 *   few statements per chunk; the crawl's quota window is fetch-bound).
 * - Wall time: at the polite 1 req/s a full chunk costs ~5 min, inside
 *   the engine's 10-minute step timeout; the 1 s sleep is noise.
 * - Steps: {@link CRAWL_MAX_CHUNK_STEPS} pairs cap the loop at
 *   120,000 URLs/instance — far above every configured source and
 *   inside the engine's per-instance step budget. Hitting it leaves
 *   the cycle resumable at its cursor and reports the breach.
 *
 * Failure semantics: page failures ride the chunk output (the walker's
 * collected-errors discipline); store failures throw inside the step
 * so INGESTION_STEP_RETRY retries them; a step exhausting its retries
 * fails the instance, whose claim release lets the next message resume
 * the persisted cursor.
 *
 * This module imports ONLY types from ./ingestion-steps — the retry
 * config arrives as a parameter, so the two workflow files never form
 * a runtime import cycle (the steps module composes this one).
 *
 * @module CrawlFetchSteps
 */

import type { RawFeedRecord } from '../../../../packages/data-acquisition/src/interfaces/feed-adapter.interface';
import type { SitemapCrawlFeedAdapter } from '../../../../packages/data-acquisition/src/adapters/sitemap-crawl.adapter';
import type { MerchantConfig } from '../../../../packages/data-acquisition/src/interfaces/merchant-config.interface';
import type { Logger } from '../logger';
import type {
  FeedFetchOutcome,
  StepRetryConfig,
  WorkflowStepLike,
} from './ingestion-steps';

/**
 * Hard cap on chunk steps per run (see module header): 400 × 300 URLs
 * = 120,000. A larger queue is a registry-config error and stays
 * resumable; do not raise without re-checking the engine's per-instance
 * step budget (chunk + advance + sleep per iteration).
 */
export const CRAWL_MAX_CHUNK_STEPS = 400;

/** Durable-sleep duration between chunk invocations (upsert-loop parity). */
const CRAWL_CHUNK_SLEEP_MS = 1_000;

export interface CrawlFetchStepDeps {
  readonly step: WorkflowStepLike;
  readonly adapter: SitemapCrawlFeedAdapter;
  /** Carries the registry feedUrl (the merchant's product sitemap). */
  readonly config: MerchantConfig;
  /** The steps module's INGESTION_STEP_RETRY, passed in (no import cycle). */
  readonly retry: StepRetryConfig;
  readonly log?: Logger;
}

/**
 * Run (or resume) one merchant's crawl as durable chunked steps and
 * return the accumulated fetch outcome. Never throws for cycle-level
 * failures — they return as collected errors, matching the
 * `fetch-feed` step's contract so the run completes with errors
 * instead of burning retries on feed data.
 */
export async function runCrawlFetchSteps(
  deps: CrawlFetchStepDeps,
): Promise<FeedFetchOutcome> {
  const { step, adapter, config, retry } = deps;
  const log = deps.log;

  const discovered = await step.do('crawl-discover', retry, () =>
    adapter.beginCrawlCycle(config.feedUrl),
  );

  const records: RawFeedRecord[] = [];
  const errors: string[] = [...discovered.errors];
  if (errors.length > 0) {
    // Cycle aborted untouched (sitemap failure, cursor/rollback
    // failure) — nothing crawled, nothing persisted to walk.
    log?.warn({
      message: `Crawl discover for "${config.merchantId}" aborted: ${errors.join('; ')}`,
      merchantId: config.merchantId,
    });
    return { records, errors };
  }

  if (discovered.resumed) {
    log?.info({
      message: `Crawl for "${config.merchantId}" resumes its in-flight cursor ` +
        `(${discovered.queueLength} URL(s) remaining)`,
      merchantId: config.merchantId,
    });
  }

  for (let index = 1; index <= CRAWL_MAX_CHUNK_STEPS; index++) {
    // Fresh invocation per chunk — the subrequest-budget boundary
    // (module header). The engine skips replayed sleeps by name.
    if (index > 1) {
      await step.sleep(`crawl-chunk-budget-reset-${index}`, CRAWL_CHUNK_SLEEP_MS);
    }

    const chunk = await step.do(`crawl-chunk-${index}`, retry, () =>
      adapter.crawlChunk(),
    );
    records.push(...chunk.records);
    errors.push(...chunk.errors);

    // The records are durable (the chunk step's committed output) BEFORE
    // the cursor advances past them — a lost chunk output re-walks its
    // slice; a lost advance resumes from the persisted offset. The
    // final advance ends the cycle (clears the cursor).
    await step.do(`crawl-advance-${index}`, retry, () =>
      adapter.advanceCrawl(chunk.fetched, chunk.done),
    );

    if (chunk.done) {
      return { records, errors };
    }
  }

  const capError =
    `Crawl for "${config.merchantId}" hit the ${CRAWL_MAX_CHUNK_STEPS}-chunk step cap ` +
    '— cycle left resumable at its cursor, remaining URLs stay queued';
  log?.warn({
    message: capError,
    merchantId: config.merchantId,
  });
  return { records, errors: [...errors, capError] };
}
