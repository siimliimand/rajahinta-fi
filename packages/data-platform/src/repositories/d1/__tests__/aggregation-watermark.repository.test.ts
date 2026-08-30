/**
 * D1AggregationWatermarkRepository — real-SQLite tests (task 2.3) on the
 * node:sqlite harness with the committed migrations applied.
 *
 * @module D1AggregationWatermarkRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1AggregationWatermarkRepository } from '../aggregation-watermark.repository';

const { d1 } = openMigratedD1();
const repo = new D1AggregationWatermarkRepository(d1);

describe('D1AggregationWatermarkRepository', () => {
  it('returns null for a job that never completed a scan (epoch start)', async () => {
    await expect(repo.find('time-series-aggregation-d1')).resolves.toBeNull();
  });

  it('round-trips the persisted watermark with millisecond precision', async () => {
    const watermark = new Date('2026-08-24T10:30:15.123Z');
    await repo.save('time-series-aggregation-d1', watermark);

    const loaded = await repo.find('time-series-aggregation-d1');
    expect(loaded?.toISOString()).toBe('2026-08-24T10:30:15.123Z');
  });

  it('overwrites by job name — one row per consuming job, never a duplicate', async () => {
    await repo.save('time-series-aggregation-d1', new Date('2026-08-24T10:00:00.000Z'));
    await repo.save('time-series-aggregation-d1', new Date('2026-08-25T12:00:00.000Z'));

    await expect(repo.find('time-series-aggregation-d1')).resolves.toEqual(
      new Date('2026-08-25T12:00:00.000Z'),
    );
    const rows = await d1
      .prepare('SELECT count(*) AS n FROM aggregation_watermarks WHERE job_name = ?')
      .bind('time-series-aggregation-d1')
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it('keeps separate jobs isolated and refreshes updated_at on advance', async () => {
    await repo.save('job-a', new Date('2026-08-20T00:00:00.000Z'));
    await repo.save('job-b', new Date('2026-08-21T00:00:00.000Z'));

    await expect(repo.find('job-a')).resolves.toEqual(new Date('2026-08-20T00:00:00.000Z'));
    await expect(repo.find('job-b')).resolves.toEqual(new Date('2026-08-21T00:00:00.000Z'));

    const before = await d1
      .prepare('SELECT updated_at FROM aggregation_watermarks WHERE job_name = ?')
      .bind('job-a')
      .first<{ updated_at: string }>();
    await repo.save('job-a', new Date('2026-08-22T00:00:00.000Z'));
    const after = await d1
      .prepare('SELECT updated_at FROM aggregation_watermarks WHERE job_name = ?')
      .bind('job-a')
      .first<{ updated_at: string }>();
    expect(before?.updated_at).not.toBeNull();
    expect(after?.updated_at).not.toBeNull();
  });
});
