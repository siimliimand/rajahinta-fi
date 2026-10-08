/**
 * Sitemap-crawl → ingestion end-to-end on mocked HTTP (task 4.1, change
 * sitemap-crawl-merchants) — a real `LicoreaFeedAdapter` crawl (golden
 * fixture HTML + a held-row page served by a fake fetcher) driven through
 * the REAL ingestion Workflow steps (`runIngestionWorkflow`) over a fully
 * migrated, seeded D1 (node:sqlite harness): the chunked crawl fetch
 * stage (crawl-discover / crawl-chunk-N / crawl-advance-N) hands its
 * records to the unchanged map → volume-gate → upsert → data-quality
 * steps, and the rows land in `product_master` / `retail_offers`.
 *
 * Pins (task 4.1 acceptance evidence):
 *
 * - Offer upserts from crawl records: EUR `price_cents`, `source_url` =
 *   the crawled product page URL, `observed_at` serialized, and
 *   `reliability_status` ESTIMATED on every new offer — never VERIFIED
 *   (operator-only; the ingestion contract pins every new offer
 *   ESTIMATED), exactly as for the API-feed merchants.
 * - Held rows: an attribute-less crawl record (a page whose name yields
 *   no parseable ABV while the name token resolves to an alcohol
 *   category) still ingests — its offer persists ESTIMATED, the ESTIMATED
 *   contract intact — but the row carries
 *   `review_hold_reason = 'nonalcoholic_in_alcohol_category'` and falls
 *   outside `PRODUCT_LISTING_UNIVERSE_SQL`: absent from `findById`, from
 *   `listCatalogKeys`, and from search, while `findByIdDirect` keeps it
 *   computable (the one-listing-universe rule, read the way the product
 *   surfaces read).
 *
 * @module CrawlIngestionAdapterD1IntegrationTest
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { NONALCOHOLIC_HOLD_REASON } from '@rajahinta/core-domain';

import { LicoreaFeedAdapter } from '../../../packages/data-acquisition/src/adapters/licorea.adapter';
import {
  LICOREA_PRODUCT_HTML,
  LICOREA_PRODUCT_URL,
} from '../../../packages/data-acquisition/src/crawl/extract/__fixtures__/licorea-product.fixture';
import type { PageFetcher } from '../../../packages/data-acquisition/src/crawl/crawl-walker';

import { D1CrawlWatermarkStore } from '../../../apps/api-worker/src/adapters/d1-crawl-watermark.store';
import {
  composeIngestionStageServices,
  runIngestionWorkflow,
} from '../../../apps/api-worker/src/workflows/ingestion-steps';
import type {
  WorkflowStepLike,
  StepRetryConfig,
} from '../../../apps/api-worker/src/workflows/ingestion-steps';

import {
  permissiveEnv,
} from '../../../apps/api-worker/src/routes/__tests__/harness';
import { D1ProductSearchRepository } from '../../../packages/data-platform/src/repositories/d1/product-search.repository';

import { generateSeedSqlFiles } from '../../../packages/data-platform/src/seed/d1/generate';
import { InMemoryR2Bucket, openMigratedD1 } from './harness';

// ---------------------------------------------------------------------------
// Fixtures — the licorea sitemap plus its two detail pages
// ---------------------------------------------------------------------------

const LICOREA_SITEMAP_URL = 'https://www.licorea.com/sitemapproducts_en.xml';

/** A complete page EXCEPT the alcohol attributes: no ABV anywhere —
 * the name token ("vodka") still resolves to an alcohol category, so
 * the ingestion guard must hold the row. */
const HELD_PRODUCT_URL =
  'https://www.licorea.com/koskenkorva-vodka-05l-en-p-31416.html';
const HELD_PRODUCT_NAME = 'Koskenkorva Vodka 0.5 l';
const HELD_PRODUCT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>${HELD_PRODUCT_NAME} - Licorea</title>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "${HELD_PRODUCT_NAME}",
    "brand": { "@type": "Brand", "name": "Koskenkorva" },
    "url": "${HELD_PRODUCT_URL}",
    "offers": {
      "@type": "Offer",
      "price": "12.50",
      "priceCurrency": "EUR",
      "availability": "https://schema.org/InStock"
    }
  }
  </script>
</head>
<body><h1>${HELD_PRODUCT_NAME}</h1></body>
</html>`;

function licoreaSitemap(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url><loc>${LICOREA_PRODUCT_URL}</loc><lastmod>2026-10-06</lastmod></url>\n` +
    `  <url><loc>${HELD_PRODUCT_URL}</loc><lastmod>2026-10-06</lastmod></url>\n` +
    `</urlset>`
  );
}

// ---------------------------------------------------------------------------
// The one workflow run every test reads (beforeAll — read-only after)
// ---------------------------------------------------------------------------

const RUN_STARTED_AT = new Date();

const opened = openMigratedD1();
const db = opened.db;
const d1 = opened.d1;

// The 2.2 seeds: the merchant registry (licorea row incl. the sitemap
// feedUrl and country ES) and the source-governance bootstrap (licorea
// GRANTED under COMPLIANT_CRAWLING) — the same files the deploy seed step
// applies, generated from the seed modules.
for (const seed of generateSeedSqlFiles()) {
  db.exec(seed.sql);
}

/** Step recorder — records the executed step names, runs each once. */
class RecordingStep implements WorkflowStepLike {
  readonly names: string[] = [];
  readonly sleeps: { name: string; sleepFor: number }[] = [];

  do<T>(
    name: string,
    _config: StepRetryConfig,
    callback: () => Promise<T>,
  ): Promise<T> {
    this.names.push(name);
    return callback();
  }

  sleep(name: string, sleepFor: number): Promise<void> {
    this.sleeps.push({ name, sleepFor });
    return Promise.resolve();
  }
}

const env = permissiveEnv(d1);
const store = new D1CrawlWatermarkStore(d1);

const pageBodies = new Map<string, string>([
  [LICOREA_SITEMAP_URL, licoreaSitemap()],
  [LICOREA_PRODUCT_URL, LICOREA_PRODUCT_HTML],
  [HELD_PRODUCT_URL, HELD_PRODUCT_HTML],
]);
const fetched: string[] = [];
const fakePageFetcher: PageFetcher = async (url) => {
  fetched.push(url);
  const body = pageBodies.get(url);
  if (body === undefined) {
    return new Response('not found', { status: 404, statusText: 'Not Found' });
  }
  return new Response(body, { status: 200 });
};

// The production composition, with ONLY the network mocked: the crawl
// adapter stays real (walker + extractor) over the durable D1 store, and
// the stage services are exactly what production composes.
const crawlAdapter = new LicoreaFeedAdapter({
  watermarkStore: store,
  cursorStore: store,
  fetcher: fakePageFetcher,
  sleep: async () => {},
});
const services = composeIngestionStageServices(env, {
  crawlFeedAdaptersOverride: new Map([['licorea', crawlAdapter]]),
  observationStoreOverride: new InMemoryR2Bucket(),
});
const step = new RecordingStep();

let outcome: Awaited<ReturnType<typeof runIngestionWorkflow>>;

beforeAll(async () => {
  outcome = await runIngestionWorkflow(
    {
      dedupeKey: 'price-ingestion-licorea-2026-10-07-00',
      merchantId: 'licorea',
      sourceUrl: LICOREA_SITEMAP_URL,
    },
    {
      env,
      step,
      NonRetryableError: class extends Error {},
      services,
      claims: { complete: async () => {}, release: async () => {} },
    },
  );
});

afterAll(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// Shared read helpers
// ---------------------------------------------------------------------------

interface OfferRow {
  readonly id: number;
  readonly product_id: number;
  readonly country: string;
  readonly price_cents: number;
  readonly currency: string;
  readonly availability: string;
  readonly source_url: string | null;
  readonly observed_at: string;
  readonly reliability_status: string;
}

function licoreaOfferRows(): OfferRow[] {
  return db
    .prepare(
      `SELECT id, product_id, country, price_cents, currency,
              availability, source_url, observed_at, reliability_status
         FROM retail_offers WHERE merchant = ? ORDER BY id`,
    )
    .all('licorea') as unknown as OfferRow[];
}

interface ProductRow {
  readonly id: number;
  readonly name: string;
  readonly category: string;
  readonly alcohol_by_volume: number | null;
  readonly unit_volume: number;
  readonly ean: string | null;
  readonly review_hold_reason: string | null;
}

function productRowByName(name: string): ProductRow {
  const row = db
    .prepare('SELECT * FROM product_master WHERE name = ?')
    .get(name) as unknown as ProductRow | undefined;
  expect(row, `product_master row for "${name}"`).toBeDefined();
  return row!;
}

// ---------------------------------------------------------------------------
// 1. The chunked crawl stage drove the fetch; records flowed downstream
// ---------------------------------------------------------------------------

describe('crawl records through the ingestion steps (task 4.1, mocked HTTP)', () => {
  it('runs the chunked crawl steps, not the single fetch-feed step', () => {
    // The fetch stage branches to the crawl steps after the gate; no
    // single fetch-feed step ever runs for a crawl merchant.
    expect(step.names[0]).toBe('resolve-merchant');
    expect(step.names[1]).toBe('governance-gate');
    expect(step.names[2]).toBe('crawl-discover');
    expect(step.names).toContain('crawl-chunk-1');
    expect(step.names).toContain('crawl-advance-1');
    expect(step.names).not.toContain('fetch-feed');

    // Polite discovery: the sitemap exactly once; each product page once.
    expect(fetched.filter((url) => url === LICOREA_SITEMAP_URL)).toHaveLength(1);
    expect(new Set(fetched).size).toBe(fetched.length);
    expect(fetched).toHaveLength(3); // sitemap + 2 product pages
  });

  it('completes the run with both crawled records ingested', () => {
    expect(outcome.productsIngested).toBe(2);
    // The only expected error is the held row's review flag — no crawl or
    // upsert failures.
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]).toContain('Held for review');
    expect(outcome.errors[0]).toContain(NONALCOHOLIC_HOLD_REASON);
  });
});

// ---------------------------------------------------------------------------
// 2. Offer upserts from crawl records
// ---------------------------------------------------------------------------

describe('retail_offers from crawl records (task 4.1)', () => {
  it('persists one ESTIMATED EUR offer per crawled product, source_url = the product page', () => {
    const offers = licoreaOfferRows();
    expect(offers).toHaveLength(2);
    const byUrl = new Map(offers.map((o) => [o.source_url, o]));

    const brugal = byUrl.get(LICOREA_PRODUCT_URL);
    expect(brugal, 'offer for the golden licorea page').toBeDefined();
    expect(brugal!.price_cents).toBe(1895); // 18.95 € from the JSON-LD Offer
    expect(brugal!.currency).toBe('EUR');
    expect(brugal!.country).toBe('ES'); // the registry row's market
    expect(brugal!.availability).toBe('in_stock');

    const held = byUrl.get(HELD_PRODUCT_URL);
    expect(held, 'offer for the attribute-less page').toBeDefined();
    expect(held!.price_cents).toBe(1250);
    expect(held!.currency).toBe('EUR');
  });

  it('keys every new offer ESTIMATED — never VERIFIED (operator-only)', () => {
    const offers = licoreaOfferRows();
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      expect(offer.reliability_status).toBe('ESTIMATED');
      expect(offer.reliability_status).not.toBe('VERIFIED');
    }
    const verified = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM retail_offers
            WHERE merchant = 'licorea' AND reliability_status = 'VERIFIED'`,
        )
        .get() as { n: number }
    ).n;
    expect(verified).toBe(0);
  });

  it('serializes observed_at as an ISO-8601 instant taken during the run', () => {
    for (const offer of licoreaOfferRows()) {
      const observedAt = new Date(offer.observed_at);
      expect(observedAt.getTime()).not.toBeNaN();
      expect(observedAt.getTime()).toBeGreaterThanOrEqual(RUN_STARTED_AT.getTime());
      expect(observedAt.getTime()).toBeLessThanOrEqual(Date.now());
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Held rows — ingested, held, and outside the listing universe
// ---------------------------------------------------------------------------

describe('attribute-less crawl row lands held, never listed (task 4.1)', () => {
  it('persists the clean page as an ordinary alcohol product', () => {
    const brugal = productRowByName('Brugal Añejo Rum 40% 0.7 l');
    expect(brugal.category).toBe('spirits');
    expect(brugal.alcohol_by_volume).toBeCloseTo(0.4);
    expect(brugal.unit_volume).toBeCloseTo(0.7);
    expect(brugal.ean).toBe('8410184100115'); // gtin13 captured, no fallback
    expect(brugal.review_hold_reason).toBeNull();
  });

  it('persists the ABV-less page with the non-alcoholic review hold', () => {
    const held = productRowByName(HELD_PRODUCT_NAME);
    // Ingested (the ESTIMATED contract intact — its offer row exists and
    // is ESTIMATED), but held out of the alcohol category.
    expect(held.category).toBe('other_fermented');
    expect(held.alcohol_by_volume).toBeNull();
    expect(held.review_hold_reason).toBe(NONALCOHOLIC_HOLD_REASON);
  });

  it('excludes the held row from the product surfaces\' listing universe', async () => {
    const brugal = productRowByName('Brugal Añejo Rum 40% 0.7 l');
    const held = productRowByName(HELD_PRODUCT_NAME);
    const search = new D1ProductSearchRepository(d1);

    // Detail surface: the universe read 404-shapes the held row; the
    // direct read keeps it computable when addressed exactly.
    expect(await search.findById(brugal.id)).not.toBeNull();
    expect(await search.findById(held.id)).toBeNull();
    const direct = await search.findByIdDirect(held.id);
    expect(direct).not.toBeNull();
    expect(direct!.reviewHoldReason).toBe(NONALCOHOLIC_HOLD_REASON);

    // Catalog surface (the fragment every filter conjoins onto) — with
    // and without a category filter, the held row never appears.
    const keys = await search.listCatalogKeys();
    expect(keys.map((k) => k.id)).toContain(brugal.id);
    expect(keys.map((k) => k.id)).not.toContain(held.id);
    const spiritsKeys = await search.listCatalogKeys('spirits');
    expect(spiritsKeys.map((k) => k.id)).toContain(brugal.id);
    expect(spiritsKeys.map((k) => k.id)).not.toContain(held.id);

    // Search surfaces — FTS and the LIKE recall lane both carry the
    // universe predicate; the held row is absent from both.
    const brugalHits = await search.searchRanked('Brugal', 10);
    expect(brugalHits.map((p) => p.id)).toContain(brugal.id);
    const vodkaHits = await search.searchRanked(`${HELD_PRODUCT_NAME}`, 25);
    expect(vodkaHits.map((p) => p.id)).not.toContain(held.id);
  });
});
