/**
 * Price-ingestion Queue consumer tests (task 4.1) — the idempotent-skip
 * lifecycle over the REAL IdempotencyDO job-claim namespace (in-memory DO
 * storage emulation): claim → run → complete, duplicate skip, failure
 * release, and the batch ack/retry wiring.
 *
 * @module IngestionQueueTest
 */

import { describe, it, expect, vi } from 'vitest';
import {
  handleIngestionBatch,
  processIngestionMessage,
  retryDelaySeconds,
  runIngestion,
} from '../ingestion.queue';
import type { IngestionMessageBody } from '../ingestion-message';
import { IdempotencyDO } from '../../do/idempotency.do';
import {
  createMemoryDoState,
  createMemoryDoStorage,
} from '../../do/__tests__/memory-do-storage';
import { composeMerchantRegistry } from '../pipeline';
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';
import { createLogger } from '../../logger';
import type { Env } from '../../env';

const LOG = createLogger('error');

/** Fake DO namespace binding one real IdempotencyDO instance. */
function fakeIdempotencyEnv(): Env {
  const storage = createMemoryDoStorage();
  const instance = new IdempotencyDO(createMemoryDoState(storage), {});
  const stub = { fetch: (request: Request) => instance.fetch(request) };
  const namespace = {
    idFromName: (name: string) => ({ name }),
    get: () => stub,
  } as unknown as DurableObjectNamespace;
  const { d1 } = openMigratedD1();
  return { IDEMPOTENCY: namespace, DB: d1 } as unknown as Env;
}

function messageBody(overrides?: Partial<IngestionMessageBody>): IngestionMessageBody {
  return {
    dedupeKey: 'price-ingestion-alko-2026-08-30-14',
    merchantId: 'alko',
    sourceUrl: 'https://alko.example/api',
    ...overrides,
  };
}

/** Fake MessageBatch with ack/retry spies (batch size 1 — wrangler config). */
function fakeBatch(
  body: IngestionMessageBody,
  attempts = 0,
): MessageBatch<IngestionMessageBody> {
  const message = {
    body,
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  };
  return {
    messages: [message],
    queue: 'price-ingestion',
  } as unknown as MessageBatch<IngestionMessageBody>;
}

describe('processIngestionMessage — idempotent skip over the DO job-claim namespace', () => {
  it('claims, runs, and completes on first delivery', async () => {
    const env = fakeIdempotencyEnv();
    const run = vi.fn().mockResolvedValue({ productsIngested: 3, errors: [] });

    const result = await processIngestionMessage(messageBody(), env, { run });

    expect(result).toEqual({ processed: true, skipped: false });
    expect(run).toHaveBeenCalledWith(
      { merchantId: 'alko', sourceUrl: 'https://alko.example/api' },
      expect.objectContaining({ env }),
    );
    // The marker is completed — a duplicate delivery skips below.
  });

  it('skips a duplicate delivery of the same dedupe key (processed exactly once)', async () => {
    const env = fakeIdempotencyEnv();
    const run = vi.fn().mockResolvedValue({ productsIngested: 1, errors: [] });

    await processIngestionMessage(messageBody(), env, { run });
    const second = await processIngestionMessage(messageBody(), env, { run });

    expect(second).toEqual({ processed: false, skipped: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('releases the claim on failure so the redelivery can process the key again', async () => {
    const env = fakeIdempotencyEnv();
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('feed fetch failed'))
      .mockResolvedValueOnce({ productsIngested: 2, errors: [] });

    const failed = await processIngestionMessage(messageBody(), env, { run });
    expect(failed.processed).toBe(false);
    expect(failed.error).toBe('feed fetch failed');

    // The retry (redelivery) processes the key — a failed run never
    // suppresses its own retry.
    const retried = await processIngestionMessage(messageBody(), env, { run });
    expect(retried).toEqual({ processed: true, skipped: false });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('skips while another delivery holds a live claim (in-flight)', async () => {
    const env = fakeIdempotencyEnv();
    // Claim outside the consumer (simulating a concurrent delivery).
    const { claimJob } = await import('../../do/client');
    await claimJob(env, messageBody().dedupeKey);

    const second = await processIngestionMessage(messageBody(), env, {
      run: () => Promise.resolve({ productsIngested: 9, errors: [] }),
    });
    expect(second).toEqual({ processed: false, skipped: true });
  });

  it('fails malformed bodies (no dedupe key to claim) so they reach the DLQ', async () => {
    const env = fakeIdempotencyEnv();
    await expect(
      processIngestionMessage(
        { dedupeKey: '', merchantId: 'alko', sourceUrl: 'x' },
        env,
        { run: () => Promise.resolve({ productsIngested: 0, errors: [] }) },
      ),
    ).rejects.toThrow(/Malformed ingestion message body/);
  });
});

describe('handleIngestionBatch — ack/retry wiring', () => {
  it('acks processed and skipped messages', async () => {
    const env = fakeIdempotencyEnv();
    const batch = fakeBatch(messageBody());
    await handleIngestionBatch(
      batch,
      env,
      { run: () => Promise.resolve({ productsIngested: 1, errors: [] }) },
    );
    expect(batch.messages[0].ack).toHaveBeenCalled();
    expect(batch.messages[0].retry).not.toHaveBeenCalled();

    // Redelivery of the same key skips AND acks.
    const duplicate = fakeBatch(messageBody());
    await handleIngestionBatch(
      duplicate,
      env,
      { run: () => Promise.resolve({ productsIngested: 1, errors: [] }) },
    );
    expect(duplicate.messages[0].ack).toHaveBeenCalled();
    expect(duplicate.messages[0].retry).not.toHaveBeenCalled();
  });

  it('retries failed messages with the exponential backoff delay', async () => {
    const env = fakeIdempotencyEnv();
    const batch = fakeBatch(messageBody(), 2);
    await handleIngestionBatch(
      batch,
      env,
      { run: () => Promise.reject(new Error('boom')) },
    );
    expect(batch.messages[0].retry).toHaveBeenCalledWith({ delaySeconds: 120 });
    expect(batch.messages[0].ack).not.toHaveBeenCalled();
  });
});

describe('retryDelaySeconds — BullMQ backoff parity (exponential, 30 s base)', () => {
  it('doubles from 30 s and caps at 2 h', () => {
    expect(retryDelaySeconds(0)).toBe(30);
    expect(retryDelaySeconds(1)).toBe(60);
    expect(retryDelaySeconds(2)).toBe(120);
    expect(retryDelaySeconds(7)).toBe(3_840);
    expect(retryDelaySeconds(8)).toBe(7_200);
    expect(retryDelaySeconds(50)).toBe(7_200);
  });
});

describe('runIngestion — registry resolution at run time', () => {
  it('fails closed when the merchant is not in the registry', async () => {
    const env = fakeIdempotencyEnv();
    const result = await runIngestion(
      { merchantId: 'ghost', sourceUrl: 'https://ghost.example' },
      { env, log: LOG },
    );
    expect(result.productsIngested).toBe(0);
    expect(result.errors[0]).toMatch(/not in the merchant registry/);
  });

  it('surfaces an unsupported registry feed format as a per-merchant error', async () => {
    const env = fakeIdempotencyEnv();
    await composeMerchantRegistry(env).upsert({
      merchantId: 'typo-merchant',
      name: 'Typo Merchant',
      country: 'FI',
      feedUrl: 'https://typo.example/feed',
      feedFormat: 'yaml',
      pollingIntervalMs: 3_600_000,
    });

    const result = await runIngestion(
      { merchantId: 'typo-merchant' },
      { env, log: LOG },
    );
    expect(result.productsIngested).toBe(0);
    expect(result.errors[0]).toMatch(/unsupported feed format/);
  });
});
