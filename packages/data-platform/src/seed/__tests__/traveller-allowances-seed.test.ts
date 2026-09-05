/**
 * Traveller-allowances seed tests (task 5.1, change
 * product-roadmap-phases-1-4) on the node:sqlite harness with the
 * committed migrations applied. Covers the governance contract the
 * spec pins: every row carries a verifiable OFFICIAL source citation (a
 * citation-less allowance row is unrepresentable), the version lands
 * PENDING_CONFIRMATION (publication is the operator's manual step,
 * never the seed's), the curated set is complete and idempotent, and
 * the upsert can never rewrite a PUBLISHED version (append-only).
 *
 * @module TravellerAllowancesSeedTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from '../../repositories/d1/__tests__/d1-test-harness';
import { D1TravellerAllowancesRepository } from '../../repositories/d1/traveller-allowances.repository';
import {
  TRAVELLER_ALLOWANCES_SEED,
  TRAVELLER_ALLOWANCES_SEED_VERSION,
  TRAVELLER_ALLOWANCES_CITATION_URL,
  TRAVELLER_ALLOWANCES_DATASET_CITATION,
  seedTravellerAllowances,
} from '../traveller-allowances.seed';

const { db, d1 } = openMigratedD1();
const repo = new D1TravellerAllowancesRepository(d1);

const EXPECTED_CATEGORIES = [
  'spirits',
  'intermediate_products',
  'wine_still',
  'wine_sparkling',
  'beer',
] as const;

function datasetCount(): number {
  return (
    db.prepare('SELECT count(*) AS n FROM traveller_allowance_datasets').get() as {
      n: number;
    }
  ).n;
}

function limitCount(): number {
  return (
    db.prepare('SELECT count(*) AS n FROM traveller_allowance_limits').get() as {
      n: number;
    }
  ).n;
}

describe('traveller allowances seed — curated content', () => {
  it('covers the four EU alcohol lines mapped onto the canonical categories, each exactly once', () => {
    const categories = TRAVELLER_ALLOWANCES_SEED.map((r) => r.category);
    expect(new Set(categories).size).toBe(categories.length);
    for (const category of EXPECTED_CATEGORIES) {
      expect(categories).toContain(category);
    }
    // No distinct EU allowance line exists for other fermented beverages
    // (cider, long drink) — explicit absence, never a fabricated number.
    expect(categories).not.toContain('other_fermented');
  });

  it('carries an official, verifiable source citation on every row', () => {
    for (const row of TRAVELLER_ALLOWANCES_SEED) {
      expect(row.sourceCitation.trim().length).toBeGreaterThan(0);
      // The verifiable official reference an operator can actually open.
      expect(row.sourceCitation).toContain(TRAVELLER_ALLOWANCES_CITATION_URL);
      expect(row.sourceCitation).toContain('https://');
      expect(row.sourceCitation).toContain('Commission Directive 2007/74/EC');
      // The specific rule, not a bare link.
      expect(row.sourceCitation).toContain('litres');
    }
    expect(TRAVELLER_ALLOWANCES_DATASET_CITATION).toContain(
      TRAVELLER_ALLOWANCES_CITATION_URL,
    );
  });

  it('represents the shared wine quota correctly — 90 l total, sparkling sub-cap 60 l', () => {
    const caps = new Map(
      TRAVELLER_ALLOWANCES_SEED.map((r) => [r.category, r.volumeCapLitres]),
    );
    expect(caps.get('spirits')).toBe(10);
    expect(caps.get('intermediate_products')).toBe(20);
    expect(caps.get('wine_still')).toBe(90); // the combined wine quota
    expect(caps.get('wine_sparkling')).toBe(60); // the sub-cap within it
    expect(caps.get('beer')).toBe(110);
  });

  it('every row has a volume and/or quantity cap, positive, inside the schema vocabulary', () => {
    for (const row of TRAVELLER_ALLOWANCES_SEED) {
      expect(row.volumeCapLitres !== null || row.quantityCap !== null).toBe(true);
      if (row.volumeCapLitres !== null) {
        expect(row.volumeCapLitres).toBeGreaterThan(0);
      }
      if (row.quantityCap !== null) {
        expect(row.quantityCap).toBeGreaterThan(0);
      }
    }
  });

  it('is one version, dated 2026-01-01, open-ended — deterministic, never wall-clock', () => {
    expect(TRAVELLER_ALLOWANCES_SEED.length).toBeGreaterThan(0);
    for (const row of TRAVELLER_ALLOWANCES_SEED) {
      expect(row.effectiveFrom).toBe('2026-01-01');
      expect(row.effectiveTo).toBeNull();
    }
  });
});

describe('traveller allowances seed — apply', () => {
  it('lands the whole version in one batch — dataset + limit rows, PENDING_CONFIRMATION', async () => {
    await seedTravellerAllowances(d1);
    expect(datasetCount()).toBe(1);
    expect(limitCount()).toBe(TRAVELLER_ALLOWANCES_SEED.length);

    const statuses = db
      .prepare('SELECT DISTINCT status FROM traveller_allowance_datasets')
      .all() as Array<{ status: string }>;
    expect(statuses).toEqual([{ status: 'PENDING_CONFIRMATION' }]);

    const version = await repo.findDatasetByVersionLabel(
      TRAVELLER_ALLOWANCES_SEED_VERSION,
    );
    expect(version).not.toBeNull();
    expect(version!.dataset.sourceCitation).toBe(
      TRAVELLER_ALLOWANCES_DATASET_CITATION,
    );
    const stored = new Map(
      version!.limits.map((l) => [l.category, l.volumeCapLitres]),
    );
    for (const row of TRAVELLER_ALLOWANCES_SEED) {
      expect(stored.get(row.category)).toBe(row.volumeCapLitres);
      const storedRow = version!.limits.find((l) => l.category === row.category)!;
      expect(storedRow.sourceCitation).toBe(row.sourceCitation);
      expect(storedRow.datasetId).toBe(version!.dataset.id);
    }
  });

  it('is idempotent: a re-run refreshes pending rows in place, never duplicates', async () => {
    await seedTravellerAllowances(d1);
    await seedTravellerAllowances(d1);
    expect(datasetCount()).toBe(1);
    expect(limitCount()).toBe(TRAVELLER_ALLOWANCES_SEED.length);

    // Stored values match the curated constants exactly (replace, not drift).
    const rows = db
      .prepare(
        'SELECT volume_cap_litres, source_citation FROM traveller_allowance_limits',
      )
      .all() as Array<{ volume_cap_litres: number; source_citation: string }>;
    for (const row of rows) {
      expect(
        TRAVELLER_ALLOWANCES_SEED.some(
          (curated) =>
            curated.volumeCapLitres === row.volume_cap_litres &&
            curated.sourceCitation === row.source_citation,
        ),
      ).toBe(true);
    }
  });

  it('can never rewrite a PUBLISHED version — the append-only guard skips terminal rows on re-run', async () => {
    await seedTravellerAllowances(d1);

    // Nothing is published yet — the seed never publishes.
    await expect(repo.findPublishedEffectiveOn('2026-06-01')).resolves.toBeNull();

    // The operator confirms publication through the manual path.
    const version = await repo.findDatasetByVersionLabel(
      TRAVELLER_ALLOWANCES_SEED_VERSION,
    );
    expect(version).not.toBeNull();
    const published = await repo.publish(version!.dataset.id, 'ops@example.invalid');
    expect(published!.dataset.status).toBe('PUBLISHED');

    // Simulate post-publication drift on the published version: the
    // seed's re-run must NOT reconcile it (corrections append a new
    // version) — on the dataset row AND the limit rows.
    db.exec(
      `UPDATE traveller_allowance_datasets SET source_citation = 'drifted' WHERE version_label = '${TRAVELLER_ALLOWANCES_SEED_VERSION}'`,
    );
    db.exec(
      `UPDATE traveller_allowance_limits SET volume_cap_litres = 999 WHERE category = 'spirits'`,
    );
    await seedTravellerAllowances(d1);

    const after = await repo.findDatasetByVersionLabel(
      TRAVELLER_ALLOWANCES_SEED_VERSION,
    );
    expect(after!.dataset.sourceCitation).toBe('drifted'); // untouched — still terminal
    expect(after!.dataset.status).toBe('PUBLISHED');
    expect(after!.limits.find((l) => l.category === 'spirits')!.volumeCapLitres).toBe(
      999,
    ); // untouched — still terminal
  });
});
