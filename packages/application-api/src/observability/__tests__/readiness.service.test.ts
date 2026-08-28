/**
 * ReadinessService tests — dependency probes, timeout behaviour, and
 * body shape. Liveness is out of scope by design (process-only).
 *
 * @module ReadinessServiceTest
 */

import { describe, it, expect, vi } from 'vitest';
import { ReadinessService } from '../readiness.service';

function createDb(executeImpl: () => Promise<unknown>) {
  return { execute: vi.fn(executeImpl) };
}

function createRedis(pingImpl: () => Promise<unknown>) {
  return { ping: vi.fn(pingImpl) };
}

describe('ReadinessService', () => {
  it('reports ok with per-dependency detail when both dependencies answer', async () => {
    const service = new ReadinessService(
      createDb(async () => ({ rows: [{ '?column?': 1 }] })) as never,
      createRedis(async () => 'PONG') as never,
    );

    const result = await service.check();

    expect(result.status).toBe('ok');
    expect(result.checks.postgres.status).toBe('up');
    expect(result.checks.redis.status).toBe('up');
    expect(result.checks.postgres.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.timestamp).toBe('string');
  });

  it('fails readiness and reports the database as down when SELECT 1 rejects', async () => {
    const service = new ReadinessService(
      createDb(async () => {
        throw new Error('ECONNREFUSED');
      }) as never,
      createRedis(async () => 'PONG') as never,
    );

    const result = await service.check();

    expect(result.status).toBe('error');
    expect(result.checks.postgres.status).toBe('down');
    expect(result.checks.postgres.error).toContain('ECONNREFUSED');
    expect(result.checks.redis.status).toBe('up');
  });

  it('fails readiness when the Redis ping rejects', async () => {
    const service = new ReadinessService(
      createDb(async () => ({ rows: [] })) as never,
      createRedis(async () => {
        throw new Error('Stream isn\'t writeable');
      }) as never,
    );

    const result = await service.check();

    expect(result.status).toBe('error');
    expect(result.checks.redis.status).toBe('down');
    expect(result.checks.postgres.status).toBe('up');
  });

  it('treats an unconfigured Redis client as a down dependency', async () => {
    const service = new ReadinessService(
      createDb(async () => ({ rows: [] })) as never,
      null,
    );

    const result = await service.check();

    expect(result.status).toBe('error');
    expect(result.checks.redis.status).toBe('down');
    expect(result.checks.redis.error).toContain('not configured');
  });

  it('bounds a hanging dependency by the short timeout instead of blocking the probe', async () => {
    const hang = () => new Promise(() => undefined) as Promise<unknown>;
    const service = new ReadinessService(
      createDb(hang) as never,
      createRedis(hang) as never,
    );

    const start = Date.now();
    const result = await service.check();

    expect(Date.now() - start).toBeLessThan(5_000);
    expect(result.status).toBe('error');
    expect(result.checks.postgres.status).toBe('down');
    expect(result.checks.postgres.error).toContain('timed out');
    expect(result.checks.redis.status).toBe('down');
    expect(result.checks.redis.error).toContain('timed out');
  });
});
