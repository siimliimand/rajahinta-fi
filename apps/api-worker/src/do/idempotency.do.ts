/**
 * IdempotencyDO — version-aware idempotency cache (design D5, task 3.3).
 *
 * Replaces the Redis-backed idempotency cache of
 * `packages/application-api/src/idempotency/` with a Durable Object whose
 * storage is strongly consistent — where Redis/KV eventual visibility
 * could admit duplicate calculations, the DO cannot.
 *
 * Version-aware keys: cache keys are SHA-256 digests of the calculation
 * inputs PLUS the resolved dataset versions (tax, transport proxy, FX).
 * `hashCacheKey` reproduces the legacy `hashInput` byte stream exactly and
 * digests it with WebCrypto, so identical inputs hash identically across
 * the old node:crypto stack and this Worker (pinned by a cross-runtime
 * test). A dataset version change therefore produces a different key and
 * a guaranteed fresh calculation — invalidation by construction.
 *
 * TTL: DO storage has no native per-key expiry, so entries carry an
 * `expiresAt` enforced lazily on read (the correctness path — matches a
 * Redis key becoming invisible after its TTL) and swept by the DO alarm
 * (housekeeping, mirrors Redis active expiry). Default TTL is 3600s,
 * matching `RedisIdempotencyCache.DEFAULT_TTL_SECONDS`.
 *
 * Atomic put-if-absent: the check-then-put runs inside one DO event, and
 * input gates hold concurrent requests off while storage awaits are in
 * flight — first writer wins, no duplicate calculation can interleave.
 *
 * Job-claim namespace (task 4.1): the same storage carries a
 * strongly-consistent, atomic claim marker for background-job dedupe keys
 * (`claimJob`/`completeJob`/`releaseJob`, `job:` key prefix). The Queue
 * consumer uses it to skip ingestion work whose dedupe key was already
 * processed — the D6 carry-over of the BullMQ jobId semantics. Completed
 * markers expire lazily (default 25 h; keys are hourly) and are swept by
 * the shared alarm.
 *
 * Protocol: POST JSON requests, JSON responses. `nowMs` is optional on
 * every op for deterministic tests; production callers omit it.
 *
 * @module IdempotencyDO
 */

// ---------------------------------------------------------------------------
// Types (shape parity with application-api IdempotencyService)
// ---------------------------------------------------------------------------

/** Calculation inputs that uniquely identify a request — CacheKeyInput parity. */
export interface CacheKeyInput {
  readonly productId: number;
  readonly quantity: number;
  readonly destination: string;
  readonly transportMethod?: string;
  /**
   * Basket items — when present (and non-empty) they replace the
   * productId/quantity dimension (basket-optimization requests).
   */
  readonly items?: readonly { productId: number; quantity: number }[];
  /**
   * Resolved dataset version labels (tax, transport proxy, FX) at request
   * time — sorted before hashing so order does not affect the key.
   */
  readonly datasetVersions?: readonly string[];
}

/** Cached calculation result plus the versions that produced it. */
export interface IdempotencyEntry<T = unknown> {
  /** The cached calculation result (opaque to the DO). */
  readonly result: T;
  /** Dataset versions that produced this result. */
  readonly datasetVersions: readonly string[];
  /** Creation time, ISO-8601 UTC. */
  readonly createdAt: string;
  /** Expiry, Unix ms — DO storage has no native TTL. */
  readonly expiresAt: number;
}

/** Default entry TTL — parity with RedisIdempotencyCache (1 hour). */
export const DEFAULT_TTL_SECONDS = 3_600;

// ---------------------------------------------------------------------------
// Key hashing (byte-stream parity with application-api hashInput)
// ---------------------------------------------------------------------------

/**
 * Deterministic SHA-256 cache key over the inputs and dataset versions.
 *
 * Reproduces the legacy `hashInput` byte stream exactly:
 * `[items|]productId|quantity|DEST|transportMethod?__NONE__|V|v1|v2|…`
 * with versions sorted — digested with WebCrypto SHA-256 (identical
 * digests to the old node:crypto path; see the parity test).
 */
export async function hashCacheKey(input: CacheKeyInput): Promise<string> {
  const parts: string[] = [];

  if (input.items !== undefined && input.items.length > 0) {
    for (const item of input.items) {
      parts.push(String(item.productId), '|', String(item.quantity), '|');
    }
  } else {
    parts.push(String(input.productId), '|', String(input.quantity), '|');
  }

  parts.push(input.destination.toUpperCase(), '|');
  parts.push(input.transportMethod ?? '__NONE__');
  parts.push('|V|');
  if (input.datasetVersions && input.datasetVersions.length > 0) {
    for (const v of [...input.datasetVersions].sort()) {
      parts.push(v, '|');
    }
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(parts.join('')),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Job-claim namespace (task 4.1 — Queue consumer idempotent skip)
// ---------------------------------------------------------------------------

/** A background-job claim marker stored under the `job:` prefix. */
export interface JobClaimRecord {
  readonly state: 'processing' | 'completed';
  /** Unix ms — when the current (or last) claim was taken. */
  readonly claimedAt: number;
  /** Unix ms — present once the job finished successfully. */
  readonly completedAt?: number;
  /** Unix ms — lazy TTL; absent on `processing` records. */
  readonly expiresAt?: number;
}

/** Result of an atomic {@link claimJob} attempt. */
export type JobClaimOutcome =
  | { readonly status: 'claimed' }
  | { readonly status: 'already-completed' }
  | { readonly status: 'in-flight' };

/**
 * Default expiry of a completed marker — 25 h (BullMQ removeOnComplete
 * age was 1 day; the keys are hourly buckets so redeliveries land within
 * minutes, making 25 h a generous bound).
 */
export const JOB_CLAIM_TTL_SECONDS = 25 * 3_600;

/**
 * A `processing` claim older than this is a dead attempt (isolate evicted
 * mid-run, ack deadline lapse) — reclaim and re-run rather than skip the
 * job for the rest of the marker's life. One ingestion pass is a single
 * fetch-map-upsert cycle, so 15 min is far beyond any live run.
 */
export const JOB_CLAIM_STALE_MS = 15 * 60_000;

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

/** Discriminated request union for POST bodies. */
export type IdempotencyRequest =
  | { op: 'get'; input: CacheKeyInput; nowMs?: number }
  | {
      op: 'put';
      input: CacheKeyInput;
      /** Cached result — plain JSON; `result.metadata.datasetVersions` is honored when `datasetVersions` is omitted. */
      result: unknown;
      /** Version labels backing this entry; defaults to result.metadata.datasetVersions ?? []. */
      datasetVersions?: readonly string[];
      ttlSeconds?: number;
      nowMs?: number;
    }
  | {
      op: 'putIfAbsent';
      input: CacheKeyInput;
      result: unknown;
      datasetVersions?: readonly string[];
      ttlSeconds?: number;
      nowMs?: number;
    }
  | { op: 'invalidateVersions'; versions: string[]; nowMs?: number }
  | { op: 'size'; nowMs?: number }
  | { op: 'clear'; nowMs?: number }
  | {
      op: 'claimJob';
      /** Background-job dedupe key (e.g. `price-ingestion-<merchantId>-<hour>`). */
      key: string;
      /** A `processing` claim older than this is reclaimed. Default {@link JOB_CLAIM_STALE_MS}. */
      staleAfterMs?: number;
      nowMs?: number;
    }
  | { op: 'completeJob'; key: string; ttlSeconds?: number; nowMs?: number }
  | { op: 'releaseJob'; key: string };

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const ENTRY_PREFIX = 'e:';

/** Storage-key prefix of the job-claim namespace. */
const JOB_PREFIX = 'job:';

function entryStorageKey(key: string): string {
  return `${ENTRY_PREFIX}${key}`;
}

function jobStorageKey(key: string): string {
  return `${JOB_PREFIX}${key}`;
}

/** Stored shape (entry + expiry). */
type StoredEntry = IdempotencyEntry;

// ---------------------------------------------------------------------------
// DO class
// ---------------------------------------------------------------------------

export class IdempotencyDO {
  constructor(
    private readonly state: DurableObjectState,
    // Env is accepted for DO-constructor parity; the cache needs none.
    _env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    let body: IdempotencyRequest;
    try {
      body = (await request.json()) as IdempotencyRequest;
    } catch {
      return Response.json({ error: 'invalid JSON body' }, { status: 400 });
    }

    try {
      switch (body.op) {
        case 'get':
          return Response.json(await this.get(body.input, body.nowMs));
        case 'put':
          await this.put(
            body.input,
            body.result,
            body.datasetVersions,
            body.ttlSeconds,
            body.nowMs,
          );
          return Response.json({ stored: true });
        case 'putIfAbsent':
          return Response.json({
            stored: await this.putIfAbsent(
              body.input,
              body.result,
              body.datasetVersions,
              body.ttlSeconds,
              body.nowMs,
            ),
          });
        case 'invalidateVersions':
          return Response.json({
            deleted: await this.invalidateVersions(body.versions, body.nowMs),
          });
        case 'size':
          return Response.json({ size: await this.size(body.nowMs) });
        case 'clear':
          return Response.json({ deleted: await this.clear() });
        case 'claimJob':
          return Response.json({
            outcome: await this.claimJob(body.key, body.staleAfterMs, body.nowMs),
          });
        case 'completeJob':
          await this.completeJob(body.key, body.ttlSeconds, body.nowMs);
          return Response.json({ completed: true });
        case 'releaseJob':
          await this.releaseJob(body.key);
          return Response.json({ released: true });
        default:
          return Response.json({ error: 'unknown op' }, { status: 400 });
      }
    } catch (err) {
      if (err instanceof RangeError) {
        return Response.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  /**
   * Active alarm: sweeps expired entries and job markers, then
   * reschedules itself for the next soonest expiry (Redis active-expiry
   * parity; keeps storage bounded). workerd clears the alarm before
   * invoking it, so re-arming here is unconditional.
   */
  async alarm(): Promise<void> {
    const nextEntry = await this.sweepExpired(Date.now());
    const nextJob = await this.sweepExpiredJobs(Date.now());
    const next =
      nextEntry !== null && nextJob !== null
        ? Math.min(nextEntry, nextJob)
        : (nextEntry ?? nextJob);
    if (next !== null) {
      await this.state.storage.setAlarm(next);
    }
  }

  // -----------------------------------------------------------------------
  // Ops
  // -----------------------------------------------------------------------

  private async get(
    input: CacheKeyInput,
    nowMs?: number,
  ): Promise<{ found: boolean; entry?: IdempotencyEntry }> {
    const now = nowMs ?? Date.now();
    const key = entryStorageKey(await hashCacheKey(input));
    const stored = await this.state.storage.get<StoredEntry>(key);

    if (stored === undefined) {
      return { found: false };
    }
    if (stored.expiresAt <= now) {
      // Lazy TTL enforcement — the entry is invisible from here on.
      await this.state.storage.delete(key);
      return { found: false };
    }
    return { found: true, entry: stored };
  }

  private async put(
    input: CacheKeyInput,
    result: unknown,
    datasetVersions: readonly string[] | undefined,
    ttlSeconds: number | undefined,
    nowMs?: number,
  ): Promise<void> {
    const now = nowMs ?? Date.now();
    const ttl = assertTtl(ttlSeconds);
    const key = entryStorageKey(await hashCacheKey(input));
    const entry = buildEntry(result, datasetVersions, ttl, now);

    await this.state.storage.put(key, entry);
    await this.scheduleSweep(entry.expiresAt);
  }

  /**
   * Store only when the key has no live entry. Atomic by construction:
   * DO input gates serialize requests while storage awaits resolve, so no
   * interleaving writer can slip between the get and the put.
   */
  private async putIfAbsent(
    input: CacheKeyInput,
    result: unknown,
    datasetVersions: readonly string[] | undefined,
    ttlSeconds: number | undefined,
    nowMs?: number,
  ): Promise<boolean> {
    const now = nowMs ?? Date.now();
    const ttl = assertTtl(ttlSeconds);
    const key = entryStorageKey(await hashCacheKey(input));

    const existing = await this.state.storage.get<StoredEntry>(key);
    if (existing !== undefined && existing.expiresAt > now) {
      return false;
    }

    const entry = buildEntry(result, datasetVersions, ttl, now);
    await this.state.storage.put(key, entry);
    await this.scheduleSweep(entry.expiresAt);
    return true;
  }

  /**
   * Delete every entry whose datasetVersions intersect the given labels —
   * `invalidateOnVersionChange` parity (the in-memory/Redis scans stand in
   * for the version-index sets here; the keyspace is TTL-bounded).
   */
  private async invalidateVersions(
    versions: string[],
    nowMs?: number,
  ): Promise<number> {
    if (versions.length === 0) return 0;
    const now = nowMs ?? Date.now();
    const targets = new Set(versions);

    let deleted = 0;
    for (const [key, entry] of await this.listEntries()) {
      if (entry.expiresAt > now && entry.datasetVersions.some((v) => targets.has(v))) {
        await this.state.storage.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  /** Live (non-expired, without sweeping) entry count. */
  private async size(nowMs?: number): Promise<number> {
    const now = nowMs ?? Date.now();
    let count = 0;
    for (const entry of (await this.listEntries()).values()) {
      if (entry.expiresAt > now) count++;
    }
    return count;
  }

  private async clear(): Promise<number> {
    const entries = await this.listEntries();
    for (const key of entries.keys()) {
      await this.state.storage.delete(key);
    }
    return entries.size;
  }

  // -----------------------------------------------------------------------
  // Job claims (task 4.1 — consumer idempotent skip)
  // -----------------------------------------------------------------------

  /**
   * Atomically claim a background-job dedupe key. DO input gates
   * serialize requests, so no interleaving claimant can slip between the
   * read and the write.
   *
   * Outcomes: `claimed` (caller runs the job), `already-completed` (the
   * key was processed within its TTL — skip), `in-flight` (another
   * delivery is actively running the key — skip). A `processing` claim
   * older than `staleAfterMs` is a dead attempt and is reclaimed.
   */
  private async claimJob(
    key: string,
    staleAfterMs: number | undefined,
    nowMs?: number,
  ): Promise<JobClaimOutcome> {
    const now = nowMs ?? Date.now();
    const staleAfter = staleAfterMs ?? JOB_CLAIM_STALE_MS;
    const storageKey = jobStorageKey(key);
    const stored = await this.state.storage.get<JobClaimRecord>(storageKey);

    if (stored !== undefined) {
      const expired = stored.expiresAt !== undefined && stored.expiresAt <= now;
      if (!expired) {
        if (stored.state === 'completed') {
          return { status: 'already-completed' };
        }
        if (now - stored.claimedAt <= staleAfter) {
          return { status: 'in-flight' };
        }
        // Dead `processing` claim — fall through and reclaim it.
      } else {
        await this.state.storage.delete(storageKey);
      }
    }

    await this.state.storage.put(storageKey, {
      state: 'processing',
      claimedAt: now,
    } satisfies JobClaimRecord);
    return { status: 'claimed' };
  }

  /**
   * Mark a claimed key completed. Only meaningful after a `claimed`
   * outcome; completed markers expire after `ttlSeconds` so hourly keys
   * do not accumulate.
   */
  private async completeJob(
    key: string,
    ttlSeconds: number | undefined,
    nowMs?: number,
  ): Promise<void> {
    const now = nowMs ?? Date.now();
    // Job-claim default TTL (25 h) — NOT the calculation-cache default.
    const ttl = assertTtl(ttlSeconds ?? JOB_CLAIM_TTL_SECONDS);
    const storageKey = jobStorageKey(key);
    const stored = await this.state.storage.get<JobClaimRecord>(storageKey);
    const claimedAt = stored?.claimedAt ?? now;
    const expiresAt = now + ttl * 1_000;

    const record: JobClaimRecord = {
      state: 'completed',
      claimedAt,
      completedAt: now,
      expiresAt,
    };
    await this.state.storage.put(storageKey, record);
    await this.scheduleSweep(expiresAt);
  }

  /**
   * Release a claim without marking completion — the job failed and the
   * Queue will redeliver. The next delivery runs the key again
   * (at-least-once completion; a failed run never leaves a marker that
   * would suppress its own retry).
   */
  private async releaseJob(key: string): Promise<void> {
    await this.state.storage.delete(jobStorageKey(key));
  }

  /** Delete expired job markers; returns the next soonest expiry, if any. */
  private async sweepExpiredJobs(now: number): Promise<number | null> {
    let next: number | null = null;
    for (const [key, record] of await this.listJobClaims()) {
      if (record.expiresAt !== undefined && record.expiresAt <= now) {
        await this.state.storage.delete(key);
      } else if (
        record.expiresAt !== undefined &&
        (next === null || record.expiresAt < next)
      ) {
        next = record.expiresAt;
      }
    }
    return next;
  }

  private async listJobClaims(): Promise<Map<string, JobClaimRecord>> {
    const options: DurableObjectListOptions = { prefix: JOB_PREFIX };
    return this.state.storage.list<JobClaimRecord>(options);
  }

  // -----------------------------------------------------------------------
  // Expiry housekeeping
  // -----------------------------------------------------------------------

  /** Delete expired entries; returns the next soonest expiry, if any. */
  private async sweepExpired(now: number): Promise<number | null> {
    let next: number | null = null;
    for (const [key, entry] of await this.listEntries()) {
      if (entry.expiresAt <= now) {
        await this.state.storage.delete(key);
      } else if (next === null || entry.expiresAt < next) {
        next = entry.expiresAt;
      }
    }
    return next;
  }

  /** Point the alarm at `expiresAt` unless an earlier one is set. */
  private async scheduleSweep(expiresAt: number): Promise<void> {
    const current = await this.state.storage.getAlarm();
    if (current === null || expiresAt < current) {
      await this.state.storage.setAlarm(expiresAt);
    }
  }

  private async listEntries(): Promise<Map<string, StoredEntry>> {
    const options: DurableObjectListOptions = { prefix: ENTRY_PREFIX };
    return this.state.storage.list<StoredEntry>(options);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEntry(
  result: unknown,
  datasetVersions: readonly string[] | undefined,
  ttlSeconds: number,
  now: number,
): StoredEntry {
  // store() parity: versions come from result.metadata.datasetVersions
  // unless the caller supplies them explicitly.
  const versions =
    datasetVersions ??
    readResultVersions(result) ??
    [];
  return {
    result,
    datasetVersions: versions,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + ttlSeconds * 1_000,
  };
}

function readResultVersions(result: unknown): readonly string[] | undefined {
  if (
    typeof result === 'object' &&
    result !== null &&
    'metadata' in result &&
    typeof (result as { metadata: unknown }).metadata === 'object' &&
    (result as { metadata: unknown }).metadata !== null
  ) {
    const versions = (result as { metadata: { datasetVersions?: unknown } }).metadata
      .datasetVersions;
    if (Array.isArray(versions)) {
      return versions.filter((v): v is string => typeof v === 'string');
    }
  }
  return undefined;
}

function assertTtl(ttlSeconds: number | undefined): number {
  const ttl = ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(ttl) || ttl < 1) {
    throw new RangeError('ttlSeconds must be a finite number >= 1');
  }
  return ttl;
}
