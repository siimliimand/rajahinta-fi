/**
 * RedisClickAnalyticsService — durable click counting on Redis (task
 * 4.3, change technical-assessment-remediation).
 *
 * Counters live in Redis hashes shared by every app instance and
 * surviving app restarts (design D8 prerequisite for multi-replica
 * scaling); a periodic snapshot service archives them to PostgreSQL so
 * a Redis flush does not erase analytics history. The in-memory
 * ClickAnalyticsService stays for tests only.
 *
 * Key layout (both hashes keyed by a truncated SHA-256 of the URL):
 *   rajahinta:clicks:counts:{merchantId}   hash → cumulative count
 *   rajahinta:clicks:urls:{merchantId}     hash → full URL (reverse map)
 *
 * Recording never throws to its caller: click counting is on the
 * outbound-redirect path, and lost analytics must never break a
 * redirect. Read paths surface failures so operators see them.
 *
 * @module RedisClickAnalyticsService
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import type { ClickStats } from '../analytics/click-analytics.service';

const COUNTS_KEY_PREFIX = 'rajahinta:clicks:counts:';
const URLS_KEY_PREFIX = 'rajahinta:clicks:urls:';

@Injectable()
export class RedisClickAnalyticsService {
  private readonly logger = new Logger(RedisClickAnalyticsService.name);

  constructor(
    @Optional()
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis | null,
  ) {}

  /**
   * Record a click for a merchant link. Fire-and-forget by contract —
   * Redis outages degrade analytics, never the redirect path.
   */
  async recordClick(merchantId: string, url: string): Promise<void> {
    if (!this.redis) {
      this.logger.warn(
        'Redis not configured — click not counted (set REDIS_URL/REDIS_HOST to enable durable analytics)',
      );
      return;
    }
    const field = this.urlField(url);
    try {
      await this.redis
        .multi()
        .hincrby(COUNTS_KEY_PREFIX + merchantId, field, 1)
        .hset(URLS_KEY_PREFIX + merchantId, field, url)
        .exec();
    } catch (err) {
      this.logger.error(
        `Click count lost for merchant "${merchantId}": ` +
          (err instanceof Error ? err.message : 'unknown error'),
      );
    }
  }

  /** Cumulative counts per merchant per URL. */
  async getClickCounts(): Promise<Record<string, Record<string, number>>> {
    const result: Record<string, Record<string, number>> = {};
    for (const merchantId of await this.listMerchants()) {
      const [countEntries, urlEntries] = await Promise.all([
        this.redis!.hgetall(COUNTS_KEY_PREFIX + merchantId),
        this.redis!.hgetall(URLS_KEY_PREFIX + merchantId),
      ]);
      const counts: Record<string, number> = {};
      for (const [field, rawCount] of Object.entries(countEntries)) {
        const url = urlEntries[field];
        if (url === undefined) {
          // Counter without a reverse map entry is unreadable — surface
          // it under the hash rather than dropping it silently.
          counts[field] = Number.parseInt(rawCount, 10);
          continue;
        }
        counts[url] = Number.parseInt(rawCount, 10);
      }
      result[merchantId] = counts;
    }
    return result;
  }

  /** Per-merchant summaries — same shape as the in-memory service. */
  async getClickStats(): Promise<Record<string, ClickStats>> {
    const counts = await this.getClickCounts();
    const result: Record<string, ClickStats> = {};
    for (const [merchantId, perUrl] of Object.entries(counts)) {
      const totalClicks = Object.values(perUrl).reduce((a, b) => a + b, 0);
      result[merchantId] = {
        totalClicks,
        uniqueUrls: Object.keys(perUrl).length,
        perUrl,
        // Same Phase 1 convention as the in-memory service: literal
        // zeros assert these dimensions are not tracked.
        purchaseCount: 0,
        commissionTotalCents: 0,
        affiliateCommissionCents: 0,
        transactionCount: 0,
      };
    }
    return result;
  }

  /** Merchant ids that have at least one counted click. */
  async listMerchants(): Promise<string[]> {
    if (!this.redis) {
      return [];
    }
    const merchants: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        COUNTS_KEY_PREFIX + '*',
        'COUNT',
        '100',
      );
      cursor = next;
      merchants.push(
        ...keys.map((key) => key.slice(COUNTS_KEY_PREFIX.length)),
      );
    } while (cursor !== '0');
    return [...new Set(merchants)].sort();
  }

  /** Stable short field name for a URL inside the Redis hashes. */
  private urlField(url: string): string {
    return createHash('sha256').update(url).digest('hex').slice(0, 16);
  }
}
