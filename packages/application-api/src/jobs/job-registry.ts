import { QUEUES, type QueueName } from '@rajahinta/data-acquisition';
import type { JobsOptions } from 'bullmq';

// ---------------------------------------------------------------------------
// Queue configuration — retry, backoff, concurrency settings per queue
// ---------------------------------------------------------------------------

export interface QueueConfig {
  /** Queue name (matches data-acquisition constant). */
  readonly name: QueueName;
  /** Default job options applied to every job enqueued on this queue. */
  readonly defaultJobOptions: JobsOptions;
  /** Max concurrent jobs this queue's workers process. */
  readonly concurrency: number;
}

/**
 * Registry of all background job queues.
 *
 * Each entry maps one-to-one with `QUEUES` from @rajahinta/data-acquisition.
 * Configs control retry policy, backoff strategy, and worker concurrency
 * per queue — keeping this isolated from request/response path.
 */
export const JOB_REGISTRY: Record<QueueName, QueueConfig> = {
  [QUEUES.PRICE_INGESTION]: {
    name: QUEUES.PRICE_INGESTION,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 86_400 },   // 1 day
      removeOnFail: { age: 604_800 },       // 7 days
    },
    concurrency: 3,
  },

  [QUEUES.TRANSPORT_REFRESH]: {
    name: QUEUES.TRANSPORT_REFRESH,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { age: 86_400 },
      removeOnFail: { age: 604_800 },
    },
    concurrency: 2,
  },

  [QUEUES.TAX_DATASET_REVIEW]: {
    name: QUEUES.TAX_DATASET_REVIEW,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 120_000 },
      removeOnComplete: { age: 604_800 },   // keep longer for audit trail
      removeOnFail: { age: 2_592_000 },     // 30 days
    },
    concurrency: 1,
  },

  [QUEUES.TIME_SERIES_AGGREGATION]: {
    name: QUEUES.TIME_SERIES_AGGREGATION,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 10_000 },
      removeOnComplete: { age: 3_600 },     // 1 hour
      removeOnFail: { age: 86_400 },
    },
    concurrency: 1,
  },

  [QUEUES.FX_DATASET_REVIEW]: {
    name: QUEUES.FX_DATASET_REVIEW,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 120_000 },
      removeOnComplete: { age: 604_800 },   // keep longer for audit trail
      removeOnFail: { age: 2_592_000 },     // 30 days
    },
    concurrency: 1,
  },
} as const;

/** Convenience: get config for a named queue. */
export function getQueueConfig(name: QueueName): QueueConfig {
  const config = JOB_REGISTRY[name];
  if (!config) {
    throw new Error(`Unknown queue: ${name}`);
  }
  return config;
}