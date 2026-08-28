/**
 * ReadinessService — dependency-aware readiness checks.
 *
 * Verifies the two shared dependencies the API cannot serve traffic
 * without: PostgreSQL (`SELECT 1`) and Redis (`PING`). Each check runs
 * under a short timeout so the readiness endpoint answers within the
 * Kubernetes probe budget even when a dependency hangs on connect.
 *
 * Liveness is intentionally NOT implemented here — liveness stays cheap
 * and process-only (see HealthController).
 *
 * @module ReadinessService
 */

import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE, type DrizzleDatabase } from '@rajahinta/data-platform';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis';

/** Result of a single dependency probe. */
export interface DependencyCheck {
  readonly status: 'up' | 'down';
  readonly latencyMs: number | null;
  readonly error?: string;
}

/** Readiness response body — overall status plus per-dependency detail. */
export interface ReadinessResponse {
  readonly status: 'ok' | 'error';
  readonly timestamp: string;
  readonly checks: {
    readonly postgres: DependencyCheck;
    readonly redis: DependencyCheck;
  };
}

/**
 * Per-dependency budget. Kept well under the k8s readiness probe
 * timeout (3 s) so both checks combined still answer in time.
 */
const CHECK_TIMEOUT_MS = 1_500;

/** Reject with a timeout error when `promise` exceeds `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  /** Probe both dependencies and assemble the readiness body. */
  async check(): Promise<ReadinessResponse> {
    const [postgres, redis] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
    ]);

    return {
      status: postgres.status === 'up' && redis.status === 'up' ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      checks: { postgres, redis },
    };
  }

  private async checkPostgres(): Promise<DependencyCheck> {
    const start = Date.now();
    try {
      await withTimeout(
        this.db.execute('SELECT 1'),
        CHECK_TIMEOUT_MS,
        'postgres SELECT 1',
      );
      return { status: 'up', latencyMs: Date.now() - start };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        error: errorMessage(err),
      };
    }
  }

  private async checkRedis(): Promise<DependencyCheck> {
    const start = Date.now();
    if (this.redis === null) {
      // A deployment that expects Redis readiness must configure it
      // (REDIS_URL / REDIS_HOST) — "not configured" is a down dependency,
      // not a silent pass.
      return { status: 'down', latencyMs: null, error: 'Redis client not configured' };
    }
    try {
      await withTimeout(this.redis.ping(), CHECK_TIMEOUT_MS, 'redis PING');
      return { status: 'up', latencyMs: Date.now() - start };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        error: errorMessage(err),
      };
    }
  }
}
