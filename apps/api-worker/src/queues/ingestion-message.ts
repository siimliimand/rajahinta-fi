/**
 * Price-ingestion Queue message contract (migrate-to-cloudflare task 4.1,
 * design D6).
 *
 * The BullMQ job data (`PriceIngestionJobData`: merchantId + sourceUrl)
 * carries over one-for-one, plus the dedupe key in the body: Cloudflare
 * Queues has no server-side job-id dedupe, so the BullMQ jobId
 * (`price-ingestion-<merchantId>-<hour>`) moves INTO the message and the
 * consumer enforces it as an idempotency marker (see ingestion.queue.ts).
 *
 * Own module (imports nothing) so env.ts can type the Queue binding
 * without an import cycle through the consumer/producer modules.
 *
 * @module IngestionMessage
 */

/**
 * One per permitted merchant per hourly scheduling run — the body of a
 * `price-ingestion` Queue message.
 */
export interface IngestionMessageBody {
  /**
   * Dedupe key, `price-ingestion-<merchantId>-<hour>` — the exact BullMQ
   * jobId shape (hour = UTC `YYYY-MM-DD-HH`, `hourlyBucket()` parity).
   * The consumer skips work whose key was already processed.
   */
  readonly dedupeKey: string;
  /** Registry merchant the message ingests. */
  readonly merchantId: string;
  /**
   * Feed URL at enqueue time — LOG CONTEXT ONLY. The consumer re-reads
   * the registry row at run time (PipelinePriceIngestionAdapter parity:
   * a registry edit takes effect on the next job without a deploy).
   */
  readonly sourceUrl: string;
}
