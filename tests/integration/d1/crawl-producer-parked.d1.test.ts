/**
 * Parked-merchant producer skip on D1 (task 4.1, change
 * sitemap-crawl-merchants) — integration evidence for "Sources without
 * viable attributes are parked, not scraped": with the task-2.2 seeds
 * applied (the merchant-registry bootstrap incl. the parked spritxxl /
 * lazyshop rows with an EMPTY feedUrl, and the source-governance
 * bootstrap with 4 GRANTED + 2 PENDING COMPLIANT_CRAWLING rows), the
 * real hourly producer pass (`schedulePriceIngestions` over the real D1
 * registry + the real fail-closed governance gate) enqueues messages for
 * exactly the GRANTED feedUrl merchants and produces none for the parked
 * rows (design D6 — the skip is the existing empty-feedUrl registry
 * rule; unparking is a data change, not a deploy).
 *
 * @module CrawlProducerParkedD1IntegrationTest
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import type { IngestionMessageBody } from '../../../apps/api-worker/src/queues/ingestion-message';
import { schedulePriceIngestions } from '../../../apps/api-worker/src/queues/ingestion-producer';
import { permissiveEnv } from '../../../apps/api-worker/src/routes/__tests__/harness';

import { generateSeedSqlFiles } from '../../../packages/data-platform/src/seed/d1/generate';
import { openMigratedD1 } from './harness';

// The hour bucket the daily-cadence rows fire on: 2026-10-07T00:30Z sits
// 30 minutes past the 00:00 UTC 86,400,000 ms boundary, so every seeded
// daily registry row is due on this tick (previousTick = 23:30Z is the
// previous day's bucket).
const NOW = new Date('2026-10-07T00:30:00.000Z');

const opened = openMigratedD1();
const db = opened.db;
const d1 = opened.d1;

// The 2.2 seeds, exactly as the deploy seed step applies them: the
// merchant registry bootstrap (12 rows — alko, alks, araxes, the four
// crawl merchants, the two parked rows, the two Shopify Store API rows
// from onboard-shopify-lmdw-merchants task 4.2, and the lmdw sitemap
// row from onboard-lmdw-crawl-merchant task 4.2) and the
// source-governance bootstrap (4 GRANTED + 2 PENDING COMPLIANT_CRAWLING
// rows — no lmdw row; its grant lands via the ops console in task 6.2).
for (const seed of generateSeedSqlFiles()) {
  db.exec(seed.sql);
}

const sent: IngestionMessageBody[] = [];
let result: Awaited<ReturnType<typeof schedulePriceIngestions>>;

beforeAll(async () => {
  result = await schedulePriceIngestions(permissiveEnv(d1), {
    now: NOW,
    queue: {
      send: async (body: IngestionMessageBody) => {
        sent.push(body);
      },
    },
  });
});

afterAll(() => {
  db.close();
});

describe('hourly producer over the 2.2 seeds (task 4.1)', () => {
  it('considers every registry row and skips only by the documented reasons', () => {
    expect(result.merchants).toBe(12);
    expect(result.enqueued).toBe(4);
    // alko (adapter pending) + the parked spritxxl/lazyshop rows.
    expect(result.skippedNoFeedUrl).toBe(3);
    // alks, araxes, bottleofitaly, kuhns, and lmdw carry feedUrls but no
    // governance rows — fail-closed (lmdw's grant lands via the ops
    // console in task 6.2).
    expect(result.skippedNotPermitted).toBe(5);
    expect(result.skippedNotDue).toBe(0);
    expect(result.enqueueErrors).toBe(0);
  });

  it('enqueues exactly the GRANTED feedUrl merchants — no message for a parked merchant', () => {
    const merchantIds = sent.map((body) => body.merchantId).sort();
    expect(merchantIds).toEqual([
      'drinkonline',
      'licorea',
      'viinarannasta',
      'viinikauppa',
    ]);
    expect(sent.map((body) => body.merchantId)).not.toContain('spritxxl');
    expect(sent.map((body) => body.merchantId)).not.toContain('lazyshop');
  });

  it('carries the registry feedUrl as the message sourceUrl and the hourly dedupe key', () => {
    const byMerchant = new Map(sent.map((body) => [body.merchantId, body]));
    expect(byMerchant.get('licorea')!.sourceUrl).toBe(
      'https://www.licorea.com/sitemapproducts_en.xml',
    );
    expect(byMerchant.get('viinarannasta')!.sourceUrl).toBe(
      'https://viinarannasta.eu/1_fi_0_sitemap.xml',
    );
    expect(byMerchant.get('viinikauppa')!.sourceUrl).toBe(
      'https://www.viinikauppa.com/catalog/xmlsitemap/products',
    );
    expect(byMerchant.get('drinkonline')!.sourceUrl).toBe(
      'https://www.drinkonline.eu/sitemap-products.xml',
    );
    for (const body of sent) {
      expect(body.dedupeKey).toBe(
        `price-ingestion-${body.merchantId}-2026-10-07-00`,
      );
    }
  });

  it('the parked rows are governance rows with a machine-readable reason, not missing data', () => {
    // The registry rows genuinely carry the empty feedUrl the producer
    // skips on — the skip is not an accident of missing data.
    const registry = (
      db
        .prepare(
          `SELECT merchant_id, feed_url FROM merchant_registry
            WHERE merchant_id IN ('spritxxl', 'lazyshop') ORDER BY merchant_id`,
        )
        .all() as unknown as { merchant_id: string; feed_url: string }[]
    ).map((row) => row);
    expect(registry).toEqual([
      { merchant_id: 'lazyshop', feed_url: '' },
      { merchant_id: 'spritxxl', feed_url: '' },
    ]);

    // And the WHY is recorded: PENDING COMPLIANT_CRAWLING rows with a
    // machine-readable statusReason (spec: parked, not scraped — no
    // adapter code, the producer never sees a viable source).
    const governance = (
      db
        .prepare(
          `SELECT merchant_id, permission_status, status_reason
             FROM source_governance
            WHERE merchant_id IN ('spritxxl', 'lazyshop')
            ORDER BY merchant_id`,
        )
        .all() as unknown as {
        merchant_id: string;
        permission_status: string;
        status_reason: string;
      }[]
    ).map((row) => row);
    expect(governance).toHaveLength(2);
    for (const row of governance) {
      expect(row.permission_status).toBe('PENDING');
      expect(row.status_reason).toMatch(/^[a-z0-9_]+$/);
    }
    expect(governance.map((row) => row.status_reason).sort()).toEqual([
      'fastly_js_challenge_blocks_sitemap',
      'no_extractable_product_attributes',
    ]);
  });
});
