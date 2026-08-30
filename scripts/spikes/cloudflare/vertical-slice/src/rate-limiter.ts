/**
 * G3 vertical slice spike — RateLimiterDO.
 *
 * Stub-level Durable Object: an in-memory sliding-window log per client
 * key. Each client gets its own DO instance (idFromName(clientIp)); the
 * log lives only in the isolate's memory — no storage, no fairness
 * guarantees, and it resets on eviction. Exact-parity with the Redis
 * limiter is task 3.3, not this spike.
 *
 * The middleware passes {key, windowMs, max} in the request body so the
 * limits are test-configurable via worker env vars.
 *
 * @module G3SpikeRateLimiter
 */

export class RateLimiterDO {
  /** client key → sliding-window timestamp log. */
  private readonly hits: Map<string, number[]> = new Map();

  async fetch(request: Request): Promise<Response> {
    let body: { key?: string; windowMs?: number; max?: number };
    try {
      body = (await request.json()) as {
        key?: string;
        windowMs?: number;
        max?: number;
      };
    } catch {
      return Response.json({ error: 'invalid body' }, { status: 400 });
    }

    const key = body.key ?? 'anonymous';
    const windowMs = body.windowMs ?? 60_000;
    const max = body.max ?? 60;
    const now = Date.now();

    // Slide: drop timestamps outside the window, then decide.
    const log = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (log.length >= max) {
      this.hits.set(key, log);
      return Response.json(
        {
          allowed: false,
          limit: max,
          retryAfterMs: log.length > 0 ? windowMs - (now - log[0]!) : windowMs,
        },
        { status: 429 },
      );
    }

    log.push(now);
    this.hits.set(key, log);
    return Response.json({ allowed: true, limit: max, remaining: max - log.length });
  }
}
