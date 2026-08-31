/**
 * R2-backed observation-log store — the worker-side binding adapter for
 * the {@link ObservationLogStore} contract (task 4.1/4.3, design D4 as
 * amended by gate review G1).
 *
 * The log layout (key scheme, JSONL lines, watermark scan) lives in
 * `packages/data-platform/src/d1/observation-log.ts` and stays pure; this
 * adapter is the only piece that touches the R2 binding:
 *
 * - append: one line lands on the day-partitioned object via
 *   read-modify-write (R2 PUT overwrites, so appendLine = GET + concat +
 *   PUT). The observation log appends strictly on the background
 *   ingestion path, so concurrent writers to one partition are bounded
 *   by the consumer's per-merchant processing; a torn concurrent append
 *   would drop one observation, never corrupt the JSONL framing (whole
 *   lines only).
 * - read: the aggregation cron handler lists the day partitions past the
 *   watermark (`observationKeysToScan`) and batch-reads the objects.
 *
 * @module R2ObservationLogStore
 */

import type { ObservationLogStore } from '../../../../packages/data-platform/src/d1/observation-log';

/**
 * Read surface over the observation log the aggregation handler needs —
 * the append-side contract is {@link ObservationLogStore}; this adds the
 * list/get pair the watermark scan consumes.
 */
export interface ObservationLogReader {
  /** All object keys under the log prefix, ascending by key (= by day). */
  listKeys(prefix: string): Promise<string[]>;
  /** One object's full JSONL body, or null when absent. */
  readObject(key: string): Promise<string | null>;
}

/** The full storage surface the worker binds over `env.OBSERVATION_LOG`. */
export type R2ObservationLogStore = ObservationLogStore & ObservationLogReader;

/**
 * Bind the observation log to a real R2 bucket binding. `R2Bucket`
 * satisfies the operations structurally — the same shape the D1 repo
 * layer's constructor injection expected.
 */
export function createR2ObservationLogStore(bucket: R2Bucket): R2ObservationLogStore {
  return {
    appendLine: async (key, line) => {
      const existing = await bucket.get(key);
      const body = existing === null ? '' : await existing.text();
      // JSONL framing: the object body is a set of LF-terminated lines;
      // an empty object gets no leading newline.
      const next = body.length === 0 ? `${line}\n` : `${body}${line}\n`;
      await bucket.put(key, next);
    },
    listKeys: async (prefix) => {
      const keys: string[] = [];
      let cursor: string | undefined;
      // R2 list pages at 1_000 keys; one page per year of partitions is
      // the expected scale, but loop for correctness.
      for (;;) {
        const page = await bucket.list({ prefix, cursor });
        for (const object of page.objects) {
          keys.push(object.key);
        }
        if (page.truncated) {
          cursor = page.cursor;
          continue;
        }
        return keys.sort();
      }
    },
    readObject: async (key) => {
      const object = await bucket.get(key);
      return object === null ? null : object.text();
    },
  };
}

/** Throw-on-use accessor — mirrors the DO client convention for bindings. */
export function observationLogStore(env: {
  OBSERVATION_LOG?: R2Bucket;
}): R2ObservationLogStore {
  if (!env.OBSERVATION_LOG) {
    throw new Error('OBSERVATION_LOG R2 bucket binding is not configured');
  }
  return createR2ObservationLogStore(env.OBSERVATION_LOG);
}
