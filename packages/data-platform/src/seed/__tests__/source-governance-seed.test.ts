/**
 * Source-governance seed tests (task 2.2, change sitemap-crawl-merchants)
 * on the node:sqlite harness with the committed migrations applied.
 * Covers the properties the change pins: four GRANTED COMPLIANT_CRAWLING
 * sources, two parked PENDING sources, a machine-readable statusReason on
 * every row (granted ones included), the fixed recon verification date —
 * and the bootstrap-only contract that makes re-seeding safe: an
 * operator's in-place status transition (GRANTED → REVOKED) survives
 * every re-run, and a console-registered source is never duplicated.
 *
 * @module SourceGovernanceSeedTest
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openMigratedD1 } from '../../repositories/d1/__tests__/d1-test-harness';
import {
  SOURCE_GOVERNANCE_SEED,
  SITEMAP_CRAWL_RECON_DATE,
  RECON_SCRAPING_RIGHTS_REASON,
  seedSourceGovernance,
} from '../source-governance.seed';

const { db, d1 } = openMigratedD1();

function rows(): Array<{
  merchant_id: string;
  acquisition_method: string;
  permission_status: string;
  source_url: string;
  status_reason: string;
  last_verified_at: string;
}> {
  return db
    .prepare(
      `SELECT merchant_id, acquisition_method, permission_status,
              source_url, status_reason, last_verified_at
       FROM source_governance ORDER BY merchant_id`,
    )
    .all() as Array<{
    merchant_id: string;
    acquisition_method: string;
    permission_status: string;
    source_url: string;
    status_reason: string;
    last_verified_at: string;
  }>;
}

describe('source governance seed — curated content', () => {
  it('seeds exactly the six sitemap-crawl sources, each merchant once', () => {
    expect(SOURCE_GOVERNANCE_SEED).toHaveLength(6);
    expect(new Set(SOURCE_GOVERNANCE_SEED.map((r) => r.merchantId)).size).toBe(6);
  });

  it('grants the four active crawl sources and parks exactly two', () => {
    const granted = SOURCE_GOVERNANCE_SEED.filter((r) => r.permissionStatus === 'GRANTED');
    const pending = SOURCE_GOVERNANCE_SEED.filter((r) => r.permissionStatus === 'PENDING');
    expect(granted.map((r) => r.merchantId).sort()).toEqual([
      'drinkonline',
      'licorea',
      'viinarannasta',
      'viinikauppa',
    ]);

    expect(pending.map((r) => r.merchantId).sort()).toEqual(['lazyshop', 'spritxxl']);
    for (const row of SOURCE_GOVERNANCE_SEED) {
      expect(row.acquisitionMethod).toBe('COMPLIANT_CRAWLING');
    }
  });

  it('carries a machine-readable statusReason on every row — granted ones included', () => {
    for (const row of SOURCE_GOVERNANCE_SEED) {
      expect(row.statusReason.trim().length).toBeGreaterThan(0);
      expect(row.statusReason).toMatch(/^[a-z0-9_]+$/);
    }
    const granted = SOURCE_GOVERNANCE_SEED.filter((r) => r.permissionStatus === 'GRANTED');
    for (const row of granted) {
      expect(row.statusReason).toBe(RECON_SCRAPING_RIGHTS_REASON);
    }
    const parked = Object.fromEntries(
      SOURCE_GOVERNANCE_SEED.filter((r) => r.permissionStatus === 'PENDING').map((r) => [
        r.merchantId,
        r.statusReason,
      ]),
    );
    expect(parked['spritxxl']).toBe('fastly_js_challenge_blocks_sitemap');
    expect(parked['lazyshop']).toBe('no_extractable_product_attributes');
  });

  it('pins every sourceUrl to the recon record and the verification date to the recon day', () => {
    const urls = new Map(SOURCE_GOVERNANCE_SEED.map((r) => [r.merchantId, r.sourceUrl]));
    expect(urls.get('viinarannasta')).toBe('https://viinarannasta.eu/1_fi_0_sitemap.xml');
    expect(urls.get('viinikauppa')).toBe(
      'https://www.viinikauppa.com/catalog/xmlsitemap/products',
    );
    expect(urls.get('licorea')).toBe('https://www.licorea.com/sitemapproducts_en.xml');
    expect(urls.get('drinkonline')).toBe('https://www.drinkonline.eu/sitemap-products.xml');
    // Parked sources point at the site root — there is no trusted sitemap.
    expect(urls.get('spritxxl')).toBe('https://spritxxl.net/');
    expect(urls.get('lazyshop')).toBe('https://lazyshop.fi/');
    for (const row of SOURCE_GOVERNANCE_SEED) {
      expect(row.lastVerifiedAt).toBe(SITEMAP_CRAWL_RECON_DATE);
    }
  });
});

describe('source governance seed — apply', () => {
  // Each apply test starts from an empty governance table so the guard's
  // behavior is observable in isolation (the module-level harness shares
  // one migrated database across tests).
  beforeEach(() => {
    db.exec('DELETE FROM source_governance');
  });

  it('lands all six rows in one pass, values verbatim', async () => {
    await seedSourceGovernance(d1);
    const stored = rows();
    expect(stored).toHaveLength(SOURCE_GOVERNANCE_SEED.length);
    for (const row of SOURCE_GOVERNANCE_SEED) {
      const match = stored.find((s) => s.merchant_id === row.merchantId);
      expect(match).toBeDefined();
      expect(match!.acquisition_method).toBe(row.acquisitionMethod);
      expect(match!.permission_status).toBe(row.permissionStatus);
      expect(match!.source_url).toBe(row.sourceUrl);
      expect(match!.status_reason).toBe(row.statusReason);
      expect(match!.last_verified_at).toBe(row.lastVerifiedAt);
    }
  });

  it('is idempotent: a re-run inserts nothing when every source is present', async () => {
    await seedSourceGovernance(d1);
    await seedSourceGovernance(d1);
    expect(rows()).toHaveLength(SOURCE_GOVERNANCE_SEED.length);
  });

  it('never resurrects a REVOKED row and never downgrades an operator-GRANTED row', async () => {
    // Operator actions: revoke viinarannasta in place (the console's
    // forward-only transition) and grant spritxxl (unparked).
    await seedSourceGovernance(d1);
    db.exec(
      `UPDATE source_governance SET permission_status = 'REVOKED' WHERE merchant_id = 'viinarannasta'`,
    );
    db.exec(
      `UPDATE source_governance SET permission_status = 'GRANTED' WHERE merchant_id = 'spritxxl'`,
    );

    await seedSourceGovernance(d1);

    const stored = rows();
    expect(stored).toHaveLength(SOURCE_GOVERNANCE_SEED.length);
    const byMerchant = new Map(stored.map((r) => [r.merchant_id, r.permission_status]));
    // Resurrecting GRANTED after a withdrawal would reopen crawling
    // behind the operator's back — the guard excludes permission_status
    // so the seed can never re-insert the seeded status.
    expect(byMerchant.get('viinarannasta')).toBe('REVOKED');
    expect(byMerchant.get('spritxxl')).toBe('GRANTED');
  });

  it('does not duplicate a source the console registered while the seed was absent', async () => {
    // A staging env where the operator pre-registered spritxxl through
    // the console before the seed ever ran: the seed row must stay
    // absent for that source identity, not add a second row (the table
    // has no unique key — the guard is the only dedupe).
    db.exec(
      `INSERT INTO source_governance (
         merchant_id, acquisition_method, permission_status,
         source_url, status_reason, last_verified_at
       ) VALUES ('spritxxl', 'COMPLIANT_CRAWLING', 'GRANTED', 'https://spritxxl.net/', 'console_registration', '2026-10-08T00:00:00.000Z')`,
    );

    await seedSourceGovernance(d1);

    const spritxxlRows = rows().filter((r) => r.merchant_id === 'spritxxl');
    expect(spritxxlRows).toHaveLength(1);
    expect(spritxxlRows[0].permission_status).toBe('GRANTED');
    expect(spritxxlRows[0].status_reason).toBe('console_registration');
  });
});
