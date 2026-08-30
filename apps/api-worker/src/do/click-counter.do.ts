/**
 * ClickCounterDO — durable click counting with alarm-driven snapshot
 * flush (design D5, task 3.4).
 *
 * Replaces the Redis counter half of
 * `packages/application-api/src/audit/redis-click-analytics.service.ts`
 * (HINCRBY hashes + periodic PostgreSQL snapshot into
 * `click_counter_snapshots`). Dimensions are unchanged — one counter per
 * (merchantId, url) pair, the exact shape the in-memory
 * `ClickAnalyticsService`, the Redis service, and the D1 snapshot table
 * all share. The Redis design truncated URLs to 16 hex chars and kept a
 * reverse-map hash only because Redis hash fields had to stay short; DO
 * storage keys carry the full URL directly, so the reverse map is gone
 * and the full URL survives end-to-end into the D1 rows.
 *
 * Two counters per pair:
 * - cumulative total — never reset; this is what snapshot rows carry,
 *   matching the legacy snapshot semantics (the archive holds the
 *   cumulative count at each capture instant, so re-running a capture
 *   converges on the (merchant, url, capturedAt) unique key instead of
 *   double-counting);
 * - delta since the last capture — drained (deleted) by every capture.
 *
 * Flush choreography, kept free of any D1 dependency in the DO:
 * 1. `increment` persists the click exactly (single DO event; input
 *    gates hold concurrent requests off storage awaits) and arms the
 *    alarm one flush interval out when none is pending.
 * 2. `alarm()` harvests the deltas into a `pending` snapshot payload in
 *    storage (merging into a not-yet-taken payload, so late flushers
 *    never lose rows — cumulative totals only grow) and reschedules
 *    itself. Snapshots thus happen even with no traffic — the same
 *    property the legacy cron snapshot documented for itself.
 * 3. The worker-side flusher (`../analytics/click-counter-flusher.ts`)
 *    calls the `drain` op — harvest, then hand over the pending payload
 *    and clear it — and upserts it into D1 via the D1 snapshot
 *    repository. A lost or failed handover loses no counts: the totals
 *    persist, and the next capture run carries the higher cumulative
 *    numbers, exactly like a missed legacy cron tick.
 *
 * Protocol: POST JSON requests, JSON responses. `nowMs` is optional on
 * ops so tests pin time deterministically; production callers omit it.
 *
 * @module ClickCounterDO
 */

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

/** Default flush interval — 6 h, legacy six-hourly `@Cron` parity. */
export const DEFAULT_FLUSH_INTERVAL_MS = 21_600_000;

/** One snapshot row — the cumulative count for a (merchant, url) pair. */
export interface ClickCounterSnapshotRow {
  readonly merchantId: string;
  readonly url: string;
  /** Cumulative count at the capture instant (legacy snapshot parity). */
  readonly clickCount: number;
}

/** Snapshot payload the worker-side flusher upserts into D1. */
export interface ClickCounterSnapshot {
  /** Capture instant, ISO-8601 UTC — becomes `captured_at` in D1. */
  readonly capturedAt: string;
  /** One row per (merchant, url) pair clicked since the last capture. */
  readonly rows: readonly ClickCounterSnapshotRow[];
}

/** Discriminated request union for POST bodies. */
export type ClickCounterRequest = {
  op: 'increment';
  /** Merchant identifier — first counter dimension. */
  merchantId: string;
  /** Full outbound link URL — second counter dimension. */
  url: string;
  /** Positive integer increment; defaults to 1 (redirect-path parity). */
  by?: number;
  /** Flush interval in ms; defaults to the persisted or legacy 6 h value. */
  flushIntervalMs?: number;
  /** Deterministic clock for tests; defaults to Date.now(). */
  nowMs?: number;
} | {
  op: 'counts';
} | {
  op: 'drain';
  nowMs?: number;
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Cumulative total per (merchant, url) — never reset. */
const TOTAL_PREFIX = 't:';
/** Delta since the last capture — drained by every capture. */
const DELTA_PREFIX = 'd:';
/** Snapshot produced by alarm() awaiting the worker-side flusher. */
const PENDING_KEY = 'p:snapshot';
/** Persisted flush interval (first increment pins it). */
const INTERVAL_KEY = 'cfg:intervalMs';

/** Storage key for a pair — JSON keeps arbitrary merchant ids/URLs unambiguous. */
function pairKey(prefix: string, merchantId: string, url: string): string {
  return `${prefix}${JSON.stringify([merchantId, url])}`;
}

/** Inverse of pairKey; storage keys are only ever written by this class. */
function parsePairKey(prefix: string, key: string): [string, string] {
  const [merchantId, url] = JSON.parse(key.slice(prefix.length)) as [string, string];
  return [merchantId, url];
}

// ---------------------------------------------------------------------------
// DO class
// ---------------------------------------------------------------------------

export class ClickCounterDO {
  constructor(
    private readonly state: DurableObjectState,
    // Env is accepted for DO-constructor parity; the counter needs none.
    _env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    let body: ClickCounterRequest;
    try {
      body = (await request.json()) as ClickCounterRequest;
    } catch {
      return Response.json({ error: 'invalid JSON body' }, { status: 400 });
    }

    try {
      switch (body.op) {
        case 'increment':
          return Response.json({
            total: await this.increment(
              body.merchantId,
              body.url,
              body.by,
              body.flushIntervalMs,
              body.nowMs,
            ),
          });
        case 'counts':
          return Response.json({ counts: await this.counts() });
        case 'drain':
          return Response.json({ snapshot: await this.drain(body.nowMs) });
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
   * Alarm tick: harvest the deltas into the pending snapshot payload and
   * reschedule one interval out. workerd clears the alarm before invoking
   * it, so re-arming here is unconditional (same pattern as IdempotencyDO).
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    await this.harvest(now);
    await this.state.storage.setAlarm(now + (await this.flushInterval()));
  }

  // -----------------------------------------------------------------------
  // Ops
  // -----------------------------------------------------------------------

  /**
   * Exact, persisted increment of one (merchant, url) counter — both the
   * cumulative total and the open delta. Single DO event; input gates
   * make read-modify-write atomic against concurrent requests. Arms the
   * alarm when none is pending so captures happen even if traffic stops.
   */
  private async increment(
    merchantId: string,
    url: string,
    by: number | undefined,
    flushIntervalMs: number | undefined,
    nowMs?: number,
  ): Promise<number> {
    assertNonEmpty(merchantId, 'merchantId');
    assertNonEmpty(url, 'url');
    const step = assertPositiveInteger(by ?? 1, 'by');
    if (flushIntervalMs !== undefined) {
      assertPositiveInteger(flushIntervalMs, 'flushIntervalMs');
      await this.state.storage.put(INTERVAL_KEY, flushIntervalMs);
    }
    const now = nowMs ?? Date.now();

    const totalKey = pairKey(TOTAL_PREFIX, merchantId, url);
    const deltaKey = pairKey(DELTA_PREFIX, merchantId, url);

    const total = ((await this.state.storage.get<number>(totalKey)) ?? 0) + step;
    const delta = ((await this.state.storage.get<number>(deltaKey)) ?? 0) + step;
    await this.state.storage.put(totalKey, total);
    await this.state.storage.put(deltaKey, delta);

    await this.armAlarm(now);
    return total;
  }

  /**
   * Cumulative counts as `Record<merchantId, Record<url, count>>` —
   * getClickCounts parity with the Redis service (full URLs, no hash
   * fields, no reverse map).
   */
  private async counts(): Promise<Record<string, Record<string, number>>> {
    const result: Record<string, Record<string, number>> = {};
    for (const [key, count] of await this.listPairs(TOTAL_PREFIX)) {
      const [merchantId, url] = parsePairKey(TOTAL_PREFIX, key);
      (result[merchantId] ??= {})[url] = count;
    }
    return result;
  }

  /**
   * Harvest the open deltas into the pending payload, then hand the
   * payload to the caller and clear it — the worker-side flusher's entry
   * point. Returns null when nothing was clicked since the last capture.
   */
  private async drain(nowMs?: number): Promise<ClickCounterSnapshot | null> {
    const now = nowMs ?? Date.now();
    await this.harvest(now);

    const pending = await this.state.storage.get<ClickCounterSnapshot>(PENDING_KEY);
    if (pending === undefined) {
      return null;
    }
    await this.state.storage.delete(PENDING_KEY);
    return pending;
  }

  // -----------------------------------------------------------------------
  // Capture choreography
  // -----------------------------------------------------------------------

  /**
   * Move the open deltas into the pending snapshot: one row per pair
   * carrying its *cumulative* total at `now` (the archive convention that
   * makes re-running a capture idempotent on the D1 unique key). A
   * not-yet-taken pending payload is merged in place — its rows update
   * monotonically and its capture instant refreshes; no count is ever
   * duplicated because deltas are deleted, not re-read.
   */
  private async harvest(now: number): Promise<void> {
    const deltas = await this.listPairs(DELTA_PREFIX);
    if (deltas.size === 0) {
      return;
    }

    const pending =
      (await this.state.storage.get<ClickCounterSnapshot>(PENDING_KEY)) ?? {
        capturedAt: new Date(now).toISOString(),
        rows: [],
      };
    const byPair = new Map<string, ClickCounterSnapshotRow>(
      pending.rows.map((row) => [pairKey('', row.merchantId, row.url), row]),
    );

    for (const [deltaKey, delta] of deltas) {
      await this.state.storage.delete(deltaKey);
      if (delta === 0) continue;
      const [merchantId, url] = parsePairKey(DELTA_PREFIX, deltaKey);
      const clickCount =
        (await this.state.storage.get<number>(pairKey(TOTAL_PREFIX, merchantId, url))) ?? 0;
      byPair.set(pairKey('', merchantId, url), { merchantId, url, clickCount });
    }

    const rows = [...byPair.values()].sort(
      (a, b) => a.merchantId.localeCompare(b.merchantId) || a.url.localeCompare(b.url),
    );
    await this.state.storage.put(PENDING_KEY, {
      capturedAt: new Date(now).toISOString(),
      rows,
    });
  }

  /** Point the alarm one interval out unless one is already armed. */
  private async armAlarm(now: number): Promise<void> {
    const current = await this.state.storage.getAlarm();
    if (current === null) {
      await this.state.storage.setAlarm(now + (await this.flushInterval()));
    }
  }

  /** Persisted flush interval, or the legacy 6 h default. */
  private async flushInterval(): Promise<number> {
    return (await this.state.storage.get<number>(INTERVAL_KEY)) ?? DEFAULT_FLUSH_INTERVAL_MS;
  }

  /** All `prefix:`-keys with their numeric values. */
  private async listPairs(prefix: string): Promise<Map<string, number>> {
    const options: DurableObjectListOptions = { prefix };
    const entries = await this.state.storage.list<number>(options);
    const numbers = new Map<string, number>();
    for (const [key, value] of entries) {
      if (typeof value === 'number') numbers.set(key, value);
    }
    return numbers;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertNonEmpty(value: string, name: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RangeError(`${name} must be a non-empty string`);
  }
}

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be an integer >= 1`);
  }
  return value;
}
