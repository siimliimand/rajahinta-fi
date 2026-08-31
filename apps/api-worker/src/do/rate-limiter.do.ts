/**
 * RateLimiterDO — exact sliding-window rate limiter (design D5, task 3.3).
 *
 * Replaces the Redis sorted-set + Lua sliding window of
 * `packages/application-api/src/rate-limiting/` with a Durable Object per
 * client: each instance keeps one timestamp log per limit profile in DO
 * storage (strongly consistent, survives eviction), prunes it lazily on
 * every operation, and decides admission with exact counts — an upgrade
 * over the Redis approximation while preserving its observable behavior:
 *
 * - Window semantics match the Lua `ZREMRANGEBYSCORE 0 .. now-window`
 *   exactly: a hit at time `t` is active while `t > now - windowMs`, so
 *   the window is the half-open range `(now - windowMs, now]` and a hit
 *   expires at exactly `t + windowMs`.
 * - `remaining` is `max(0, limit − active)` after the decision (an
 *   admitted request counts against it).
 * - `resetAtMs` is the oldest active hit plus the window; `now + windowMs`
 *   when the log is empty.
 * - `retryAfterSeconds = ceil((resetAtMs − now) / 1000)` — the same math
 *   RateLimitGuard used for its Retry-After header.
 *
 * Client keys do not share instances: the client helper in
 * `./client.ts` resolves one DO per client via `idFromName(clientKey)`;
 * profiles are isolated further inside the instance by storage key.
 * The read-prune-decide-write sequence runs inside a single DO event
 * (input gates hold off concurrent requests while storage awaits are in
 * flight), so admission is atomic without locks.
 *
 * Protocol: POST JSON requests, JSON responses. `nowMs` is optional on
 * every op so tests can pin window boundaries deterministically;
 * production callers omit it. The `ping` op is the readiness probe
 * (task 6.4): an identity/status call that answers without touching
 * storage, so a probe never prunes or contends with live windows.
 *
 * @module RateLimiterDO
 */

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

/** Response payload for the `check` op — everything the guard needs in one DO round trip. */
export interface RateLimitDecision {
  /** Whether the request is admitted. */
  allowed: boolean;
  /** Configured limit, echoed for header computation. */
  limit: number;
  /** Remaining requests after this decision (admitted requests counted). */
  remaining: number;
  /** Unix ms when the oldest active hit leaves the window. */
  resetAtMs: number;
  /** ceil((resetAtMs − now)/1000); 0 when allowed. Retry-After value. */
  retryAfterSeconds: number;
}

/** Discriminated request union for POST bodies. */
export type RateLimiterRequest = {
  op: 'check';
  /** Limit profile — its own isolated window per client (see RATE_LIMIT_PROFILES parity). */
  profile: string;
  /** Maximum admitted requests inside `windowMs`. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
  /** Deterministic clock for tests; defaults to Date.now(). */
  nowMs?: number;
} | {
  op: 'remaining';
  profile: string;
  limit: number;
  windowMs: number;
  nowMs?: number;
} | {
  op: 'resetAt';
  profile: string;
  windowMs: number;
  nowMs?: number;
} | {
  op: 'ping';
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Storage key prefix — one timestamp log per (client instance, profile). */
const WINDOW_PREFIX = 'w:';

/** Hit timestamps still inside the window, oldest first. */
type WindowLog = number[];

/** The active window of one (client, profile) pair. */
function windowStorageKey(profile: string): string {
  return `${WINDOW_PREFIX}${profile}`;
}

// ---------------------------------------------------------------------------
// DO class
// ---------------------------------------------------------------------------

export class RateLimiterDO {
  constructor(
    private readonly state: DurableObjectState,
    // Env is accepted for DO-constructor parity; the limiter needs none.
    _env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    let body: RateLimiterRequest;
    try {
      body = (await request.json()) as RateLimiterRequest;
    } catch {
      return Response.json({ error: 'invalid JSON body' }, { status: 400 });
    }

    try {
      switch (body.op) {
        case 'check':
          return Response.json(await this.check(body.profile, body.limit, body.windowMs, body.nowMs));
        case 'remaining':
          return Response.json({
            remaining: await this.remaining(body.profile, body.limit, body.windowMs, body.nowMs),
          });
        case 'resetAt':
          return Response.json({
            resetAtMs: await this.resetAt(body.profile, body.windowMs, body.nowMs),
          });
        case 'ping':
          // Identity probe for the readiness endpoint — no storage access.
          return Response.json({ pong: true });
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
   * Atomic admission: prune, decide, record. Single round trip returns
   * the full decision so callers never need a second DO fetch for
   * Retry-After.
   */
  private async check(
    profile: string,
    limit: number,
    windowMs: number,
    nowMs?: number,
  ): Promise<RateLimitDecision> {
    assertPositive(limit, 'limit');
    assertPositive(windowMs, 'windowMs');
    const now = nowMs ?? Date.now();

    const key = windowStorageKey(profile);
    const log = await this.loadWindow(key, now, windowMs);

    if (log.length >= limit) {
      const resetAtMs = oldestPlusWindow(log, now, windowMs);
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAtMs,
        retryAfterSeconds: retryAfter(resetAtMs, now),
      };
    }

    // Admitted: record the hit and report remaining after it.
    log.push(now);
    await this.state.storage.put(key, log);

    const resetAtMs = oldestPlusWindow(log, now, windowMs);
    return {
      allowed: true,
      limit,
      remaining: limit - log.length,
      resetAtMs,
      retryAfterSeconds: 0,
    };
  }

  /** Active count (lazy-pruned) against the limit. */
  private async remaining(
    profile: string,
    limit: number,
    windowMs: number,
    nowMs?: number,
  ): Promise<number> {
    assertPositive(limit, 'limit');
    assertPositive(windowMs, 'windowMs');
    const now = nowMs ?? Date.now();

    const key = windowStorageKey(profile);
    const log = await this.loadWindow(key, now, windowMs);
    return Math.max(0, limit - log.length);
  }

  /** Oldest active hit + window; `now + window` when empty (Redis parity). */
  private async resetAt(profile: string, windowMs: number, nowMs?: number): Promise<number> {
    assertPositive(windowMs, 'windowMs');
    const now = nowMs ?? Date.now();

    const log = await this.loadWindow(windowStorageKey(profile), now, windowMs);
    return oldestPlusWindow(log, now, windowMs);
  }

  /**
   * Load the profile's window log with lazy pruning: drop hits at or
   * before `now − windowMs`, persist the pruned log, return it. This is
   * the DO counterpart of the Lua script's ZREMRANGEBYSCORE.
   */
  private async loadWindow(key: string, now: number, windowMs: number): Promise<WindowLog> {
    const stored = await this.state.storage.get<WindowLog>(key);
    if (stored === undefined) {
      return [];
    }
    const cutoff = now - windowMs;
    const active = stored.filter((t) => t > cutoff);
    if (active.length !== stored.length) {
      await this.state.storage.put(key, active);
    }
    return active;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** resetAt per parity: oldest hit + window, or now + window when empty. */
function oldestPlusWindow(log: WindowLog, now: number, windowMs: number): number {
  const oldest = log[0];
  return oldest !== undefined ? oldest + windowMs : now + windowMs;
}

/** Guard math parity: ceil((resetAt − now)/1000), never negative. */
function retryAfter(resetAtMs: number, now: number): number {
  return Math.max(0, Math.ceil((resetAtMs - now) / 1000));
}

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError(`${name} must be a finite number >= 1`);
  }
}
