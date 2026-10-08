/**
 * Seed: merchant registry — the initial merchant set migrated from the
 * static merchants.config.ts (task 7.2, change
 * technical-assessment-remediation).
 *
 * Mirrors DEFAULT_MERCHANTS so the registry is populated with the same
 * onboarding state the static config carried: registry rows make the
 * feed known, permission still comes from governance records (absent
 * until granted). Idempotent: upserts by merchantId, so re-running
 * after an operator edits a row through the registry API would
 * overwrite local tweaks — run it for bootstrap only.
 *
 * @module Seed
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { merchantRegistry } from '../index';
import type { DrizzleDatabase } from '../db/drizzle.provider';

export interface MerchantRegistrySeedRow {
  readonly merchantId: string;
  readonly name: string;
  readonly country: string;
  readonly feedUrl: string;
  readonly feedFormat: 'json' | 'xml' | 'csv';
  readonly pollingIntervalMs: number;
}

/**
 * The bootstrap merchant set. The foreign-catalog merchant was removed
 * with its adapter (change drop-sweden-eur-only-alko-benchmark); the
 * merchant-removal purge script under scripts/ removes its rows from
 * environments that ingested it. `alks` joined via change
 * alks-feed-and-import-vat (task 2.2). `bottleofitaly`, `kuhns`, and
 * `lmdw` joined via change onboard-shopify-lmdw-merchants (task 4.2).
 *
 * All rows run a daily cadence (change
 * daily-scrape-cadence-current-offers, task 2.1): the hourly producer
 * tick honors pollingIntervalMs via interval buckets, so 3,600,000 ms
 * (1 h) is the minimum a row can actually get — 86,400,000 ms (24 h)
 * fires on the 00:00 UTC pass. Existing environments keep their current
 * row until the operator updates it through the ops console.
 *
 * The sitemap-crawl merchants (change sitemap-crawl-merchants, task
 * 2.2) carry `feedFormat: 'xml'` — the crawl walker fetches a sitemap,
 * not a Store API collection. The two parked merchants (spritxxl,
 * lazyshop) have an EMPTY feedUrl: per the registry convention that
 * skips them in the producer, by design (design D6 — parked sources are
 * governance rows, not code; unparking is a data change, not a deploy).
 */
export const MERCHANT_REGISTRY_SEED: readonly MerchantRegistrySeedRow[] = [
  {
    merchantId: 'alko',
    name: 'Alko',
    country: 'FI',
    // Adapter pending (task 7.5) — empty feed URL is skipped by the
    // pipeline, matching the static config's convention.
    feedUrl: '',
    feedFormat: 'json',
    pollingIntervalMs: 86_400_000,
  },
  {
    merchantId: 'alks',
    name: 'Alks',
    country: 'DE',
    feedUrl: 'https://alks.fi',
    feedFormat: 'json',
    pollingIntervalMs: 86_400_000,
  },
  {
    merchantId: 'araxes',
    name: 'Araxes',
    country: 'EE',
    feedUrl: 'https://araxes.ee',
    feedFormat: 'json',
    pollingIntervalMs: 86_400_000,
  },
  // --- Shopify Store API merchants (change onboard-shopify-lmdw-merchants,
  // --- task 4.2): JSON collection feeds on the daily cadence, same
  // --- shape as the alks/araxes rows. lmdw's feed URL is its Shopify
  // --- gateway host, not the storefront.
  {
    merchantId: 'bottleofitaly',
    name: 'Bottle of Italy',
    country: 'IT',
    feedUrl: 'https://bottleofitaly.com',
    feedFormat: 'json',
    pollingIntervalMs: 86_400_000,
  },
  {
    merchantId: 'kuhns',
    name: 'Kuhns',
    country: 'DE',
    feedUrl: 'https://kuhns.shop',
    feedFormat: 'json',
    pollingIntervalMs: 86_400_000,
  },
  {
    merchantId: 'lmdw',
    name: 'La Maison du Whisky',
    country: 'FR',
    feedUrl: 'https://gateway.prod2.whisky.fr',
    feedFormat: 'json',
    pollingIntervalMs: 86_400_000,
  },
  // --- Sitemap-crawl merchants (change sitemap-crawl-merchants, task
  // --- 2.2; recon 2026-10-07, read-only). Governance rows for these
  // --- merchants live in seed/source-governance.seed.ts.
  {
    merchantId: 'viinarannasta',
    name: 'Viinarannasta',
    // WHY 'EE': viinarannasta.eu is a Finnish-language storefront with a
    // Baltic/EU seller; recon did not confirm the selling entity's
    // domicile (the longero precedent — .fi domain, Estonian operator —
    // suggests EE). Country feeds the transport origin and the
    // import-VAT seller signal, so a wrong value has real consequences:
    // uncertain is recorded honestly and the operator corrects via the
    // ops console.
    country: 'EE',
    feedUrl: 'https://viinarannasta.eu/1_fi_0_sitemap.xml',
    feedFormat: 'xml',
    pollingIntervalMs: 86_400_000,
  },
  {
    merchantId: 'viinikauppa',
    name: 'Viinikauppa',
    // WHY 'FI': fi-FI content per recon; seller domicile unverified. A
    // domestic seller is the safe wrong-value case — the import-VAT
    // line is foreign-seller-only and simply never fires. Operator
    // corrects via the ops console if the selling entity sits abroad.
    country: 'FI',
    feedUrl: 'https://www.viinikauppa.com/catalog/xmlsitemap/products',
    feedFormat: 'xml',
    pollingIntervalMs: 86_400_000,
  },
  {
    merchantId: 'licorea',
    name: 'Licorea',
    // Spanish shop (en storefront per recon) — the one confident pick.
    country: 'ES',
    feedUrl: 'https://www.licorea.com/sitemapproducts_en.xml',
    feedFormat: 'xml',
    pollingIntervalMs: 86_400_000,
  },
  {
    merchantId: 'drinkonline',
    name: 'DrinkOnline',
    // WHY 'SK': recon identifies a Slovak-origin SaaS platform; the
    // selling entity behind drinkonline.eu is unconfirmed — uncertain,
    // operator corrects via the ops console.
    //
    // WHY full-refresh: this sitemap exposes no `lastmod` (recon
    // 2026-10-07), so every cycle is a full refresh (design D4; ~1,838
    // pages ≈ 31 min at the walker's 1 req/s — acceptable daily). The
    // registry has no full-refresh column; the marker is carried by the
    // per-source crawl config in data-acquisition (tasks 2.1/3.1 wire
    // it), recorded here so onboarding and the config disagree on
    // nothing.
    country: 'SK',
    feedUrl: 'https://www.drinkonline.eu/sitemap-products.xml',
    feedFormat: 'xml',
    pollingIntervalMs: 86_400_000,
  },
  {
    // Parked (design D6): Fastly JS client challenge blocks the sitemap
    // and robots.txt — the Posti blocked-egress precedent. The empty
    // feedUrl is what the producer skips on; governance carries the
    // machine-readable reason. Unparking is a data change, not a deploy.
    merchantId: 'spritxxl',
    name: 'SpritXXL',
    // WHY 'FI': unverified best-effort (Finnish-market alcohol retailer
    // per recon); parked, so the value is dormant until unparking — the
    // operator must confirm the seller country before that.
    country: 'FI',
    feedUrl: '',
    feedFormat: 'xml',
    pollingIntervalMs: 86_400_000,
  },
  {
    // Parked (design D6): no structured data and no ABV/volume/EAN/brand
    // on the page — rows would be held by the non-alcoholic guard and
    // unmatchable against product_master.
    merchantId: 'lazyshop',
    name: 'Lazyshop',
    country: 'FI',
    feedUrl: '',
    feedFormat: 'xml',
    pollingIntervalMs: 86_400_000,
  },
];

/**
 * Upsert the seed rows into the merchant registry.
 *
 * Accepts the Drizzle database instance so staging tooling and the
 * application module can both run it against their connection.
 */
export async function seedMerchantRegistry(
  db: NodePgDatabase | DrizzleDatabase,
): Promise<void> {
  for (const row of MERCHANT_REGISTRY_SEED) {
    await db
      .insert(merchantRegistry)
      .values({ ...row })
      .onConflictDoUpdate({
        target: merchantRegistry.merchantId,
        set: {
          name: row.name,
          country: row.country,
          feedUrl: row.feedUrl,
          feedFormat: row.feedFormat,
          pollingIntervalMs: row.pollingIntervalMs,
          updatedAt: new Date(),
        },
      });
  }
}
