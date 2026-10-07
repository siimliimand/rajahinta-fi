/**
 * Seed: source governance — the bootstrap permission records for the
 * sitemap-crawl merchants (task 2.2, change sitemap-crawl-merchants).
 *
 * Scope: local and staging environments via the deploy seed step, same
 * as the merchant-registry seed. Production governance is NEVER seeded —
 * rows are operator-created runtime data registered through the audited
 * ops console (the araxes precedent: registration + blanket-permission
 * auto-grant, every mutation audited to audit_events).
 *
 * Idempotency — the critical property is different from the registry's
 * natural-key upsert: `source_governance` has NO unique key, and the
 * repository mutates status IN PLACE (forward-only PENDING → GRANTED →
 * REVOKED). A re-run therefore guards on source PRESENCE (merchant_id +
 * acquisition_method + source_url, any status), never on (re-)inserting
 * the seeded status: a row an operator has REVOKED must stay REVOKED —
 * re-seeding must never resurrect a withdrawn permission, and a row an
 * operator has GRANTED must never be downgraded back to the seed's
 * PENDING. The seed is bootstrap-only, like every other seed here.
 *
 * @module Seed
 */

import type { D1DatabaseLike } from '../d1/executor';

export interface SourceGovernanceSeedRow {
  readonly merchantId: string;
  readonly acquisitionMethod:
    | 'PERMITTED_FEED'
    | 'RETAILER_API'
    | 'STRUCTURED_MERCHANT_FEED'
    | 'LICENSED_PROVIDER'
    | 'COMPLIANT_CRAWLING'
    | 'MANUAL_VERIFICATION';
  readonly permissionStatus: 'GRANTED' | 'PENDING' | 'EXPIRED' | 'REVOKED';
  readonly sourceUrl: string;
  readonly statusReason: string;
  readonly lastVerifiedAt: string;
}

/** The 2026-10-07 reconnaissance date (sitemap-crawl-merchants proposal). */
export const SITEMAP_CRAWL_RECON_DATE = '2026-10-07T00:00:00.000Z';

/**
 * Machine-readable status reason shared by the four granted sources —
 * recon recorded documented scraping rights for all of them.
 */
export const RECON_SCRAPING_RIGHTS_REASON =
  'documented_scraping_rights_recon_2026_10_07';

/**
 * The bootstrap governance rows. Active: four `COMPLIANT_CRAWLING`
 * GRANTED sources whose sitemaps the crawler may walk. Parked: two
 * PENDING sources recorded but deliberately not scraped (design D6 —
 * parked sources are governance rows, not code; the producer skips them
 * by the registry's empty-feedUrl rule, these rows carry the WHY).
 * Every row carries a machine-readable statusReason, granted ones
 * included.
 */
export const SOURCE_GOVERNANCE_SEED: readonly SourceGovernanceSeedRow[] = [
  {
    merchantId: 'viinarannasta',
    acquisitionMethod: 'COMPLIANT_CRAWLING',
    permissionStatus: 'GRANTED',
    sourceUrl: 'https://viinarannasta.eu/1_fi_0_sitemap.xml',
    statusReason: RECON_SCRAPING_RIGHTS_REASON,
    lastVerifiedAt: SITEMAP_CRAWL_RECON_DATE,
  },
  {
    merchantId: 'viinikauppa',
    acquisitionMethod: 'COMPLIANT_CRAWLING',
    permissionStatus: 'GRANTED',
    sourceUrl: 'https://www.viinikauppa.com/catalog/xmlsitemap/products',
    statusReason: RECON_SCRAPING_RIGHTS_REASON,
    lastVerifiedAt: SITEMAP_CRAWL_RECON_DATE,
  },
  {
    merchantId: 'licorea',
    acquisitionMethod: 'COMPLIANT_CRAWLING',
    permissionStatus: 'GRANTED',
    sourceUrl: 'https://www.licorea.com/sitemapproducts_en.xml',
    statusReason: RECON_SCRAPING_RIGHTS_REASON,
    lastVerifiedAt: SITEMAP_CRAWL_RECON_DATE,
  },
  {
    // Full-refresh source (no sitemap lastmod) — the crawl-cadence marker
    // lives in the merchant registry seed row and the per-source crawl
    // config (design D4), not in governance, which owns permission only.
    merchantId: 'drinkonline',
    acquisitionMethod: 'COMPLIANT_CRAWLING',
    permissionStatus: 'GRANTED',
    sourceUrl: 'https://www.drinkonline.eu/sitemap-products.xml',
    statusReason: RECON_SCRAPING_RIGHTS_REASON,
    lastVerifiedAt: SITEMAP_CRAWL_RECON_DATE,
  },
  {
    // Parked: Fastly JS client challenge on sitemap and robots.txt — the
    // Posti blocked-egress precedent (design D6). Not scraped; unparking
    // is a data change.
    merchantId: 'spritxxl',
    acquisitionMethod: 'COMPLIANT_CRAWLING',
    permissionStatus: 'PENDING',
    sourceUrl: 'https://spritxxl.net/',
    statusReason: 'fastly_js_challenge_blocks_sitemap',
    lastVerifiedAt: SITEMAP_CRAWL_RECON_DATE,
  },
  {
    // Parked: no extractable product attributes (no structured data, no
    // ABV/volume/EAN/brand) — rows would be held by the non-alcoholic
    // guard and unmatchable against product_master.
    merchantId: 'lazyshop',
    acquisitionMethod: 'COMPLIANT_CRAWLING',
    permissionStatus: 'PENDING',
    sourceUrl: 'https://lazyshop.fi/',
    statusReason: 'no_extractable_product_attributes',
    lastVerifiedAt: SITEMAP_CRAWL_RECON_DATE,
  },
];

/**
 * Existence guard for one seed row: the source is seeded only when the
 * merchant has NO row for this (acquisition_method, source_url) pair in
 * ANY status — see the module docblock for why the status is excluded
 * (operator transitions must survive every re-seed).
 */
const PRESENCE_GUARD_SQL = `
  SELECT 1 FROM source_governance
  WHERE merchant_id = ? AND acquisition_method = ? AND source_url = ?`;

/**
 * Insert seed rows whose (merchant_id, acquisition_method, source_url)
 * is not yet present — in any status. Never updates, never deletes,
 * never resurrects: a REVOKED or operator-GRANTED row blocks its seed
 * row permanently.
 */
export async function seedSourceGovernance(
  d1: D1DatabaseLike,
): Promise<void> {
  const statements = [];
  for (const row of SOURCE_GOVERNANCE_SEED) {
    const existing = await d1
      .prepare(PRESENCE_GUARD_SQL)
      .bind(row.merchantId, row.acquisitionMethod, row.sourceUrl)
      .first();
    if (existing) continue;
    statements.push(
      d1
        .prepare(
          `INSERT INTO source_governance (
             merchant_id, acquisition_method, permission_status,
             source_url, status_reason, last_verified_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.merchantId,
          row.acquisitionMethod,
          row.permissionStatus,
          row.sourceUrl,
          row.statusReason,
          row.lastVerifiedAt,
        ),
    );
  }
  if (statements.length > 0) {
    await d1.batch(statements);
  }
}
