/**
 * Consumption-norms seed tests (task 4.1, change
 * product-roadmap-phases-1-4; seasonal dataset added by change
 * seasonal-occasion-templates task 1.1) on the node:sqlite harness with
 * the committed migrations applied. Covers the governance contract the
 * spec pins: every row carries a verifiable source citation (a
 * citation-less norms row is unrepresentable), every row lands
 * PENDING_CONFIRMATION (publication is the operator's manual step,
 * never the seed's), both curated matrices are complete and idempotent,
 * and the upsert can never rewrite a PUBLISHED row (append-only) — in
 * either dataset.
 *
 * @module ConsumptionNormsSeedTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from '../../repositories/d1/__tests__/d1-test-harness';
import { D1ConsumptionNormsRepository } from '../../repositories/d1/consumption-norms.repository';
import {
  CONSUMPTION_NORM_DRINK_TYPES,
  CONSUMPTION_NORM_EVENT_PROFILES,
} from '../../repositories/d1/consumption-norms.repository';
import {
  ALL_CONSUMPTION_NORMS_SEED_ROWS,
  CONSUMPTION_NORMS_SEED_ROWS,
  CONSUMPTION_NORMS_SEED_VERSION,
  CONSUMPTION_NORMS_CITATION_URL,
  SEASONAL_CONSUMPTION_NORMS_SEED_ROWS,
  SEASONAL_CONSUMPTION_NORMS_SEED_VERSION,
  SEASONAL_CONSUMPTION_NORM_EVENT_PROFILES,
  seedConsumptionNorms,
} from '../consumption-norms.seed';

const { db, d1 } = openMigratedD1();
const repo = new D1ConsumptionNormsRepository(d1);

function rowCount(): number {
  return (db.prepare('SELECT count(*) AS n FROM consumption_norms').get() as { n: number }).n;
}

describe('consumption norms seed — curated content', () => {
  it('covers the full drink type × event profile matrix, each key exactly once', () => {
    expect(CONSUMPTION_NORMS_SEED_ROWS).toHaveLength(
      CONSUMPTION_NORM_DRINK_TYPES.length * CONSUMPTION_NORM_EVENT_PROFILES.length,
    );

    const keys = CONSUMPTION_NORMS_SEED_ROWS.map((r) => `${r.drinkType}|${r.eventProfile}`);
    expect(new Set(keys).size).toBe(keys.length);

    for (const drinkType of CONSUMPTION_NORM_DRINK_TYPES) {
      for (const eventProfile of CONSUMPTION_NORM_EVENT_PROFILES) {
        expect(keys).toContain(`${drinkType}|${eventProfile}`);
      }
    }
  });

  it('carries a verifiable source citation on every row — a citation-less norm is unrepresentable', () => {
    for (const row of CONSUMPTION_NORMS_SEED_ROWS) {
      expect(row.sourceCitation.trim().length).toBeGreaterThan(0);
      // The verifiable reference an operator can actually open.
      expect(row.sourceCitation).toContain(CONSUMPTION_NORMS_CITATION_URL);
      expect(row.sourceCitation).toContain('https://');
      // The audited derivation (drinks/hour × 15.2 ml ÷ ABV), not a bare link.
      expect(row.sourceCitation).toContain('derivation:');
      expect(row.sourceCitation).toContain('Finnish standard drink');
    }
  });

  it('stays inside the schema vocabularies and positive-value rules (mirrors the CHECKs before they run)', () => {
    for (const row of CONSUMPTION_NORMS_SEED_ROWS) {
      expect(CONSUMPTION_NORM_DRINK_TYPES).toContain(row.drinkType);
      expect(CONSUMPTION_NORM_EVENT_PROFILES).toContain(row.eventProfile);
      expect(row.normValuePerGuestPerHour).toBeGreaterThan(0);
      expect(Number.isFinite(row.normValuePerGuestPerHour)).toBe(true);
    }
  });

  it('is one version, dated 2026-01-01, open-ended — deterministic, never wall-clock', () => {
    for (const row of CONSUMPTION_NORMS_SEED_ROWS) {
      expect(row.versionLabel).toBe(CONSUMPTION_NORMS_SEED_VERSION);
      expect(row.effectiveFrom).toBe('2026-01-01');
      expect(row.effectiveTo).toBeNull();
    }
  });
});

describe('consumption norms seed — seasonal occasion dataset (seasonal-occasion-templates 1.1)', () => {
  it('covers the full drink type × seasonal profile matrix, each key exactly once', () => {
    expect(SEASONAL_CONSUMPTION_NORMS_SEED_ROWS).toHaveLength(
      CONSUMPTION_NORM_DRINK_TYPES.length *
        SEASONAL_CONSUMPTION_NORM_EVENT_PROFILES.length,
    );

    const keys = SEASONAL_CONSUMPTION_NORMS_SEED_ROWS.map(
      (r) => `${r.drinkType}|${r.eventProfile}`,
    );
    expect(new Set(keys).size).toBe(keys.length);

    for (const drinkType of CONSUMPTION_NORM_DRINK_TYPES) {
      for (const eventProfile of SEASONAL_CONSUMPTION_NORM_EVENT_PROFILES) {
        expect(keys).toContain(`${drinkType}|${eventProfile}`);
      }
    }
  });

  it('uses exactly the four seasonal profile slugs, disjoint from the general set', () => {
    const profiles = new Set(
      SEASONAL_CONSUMPTION_NORMS_SEED_ROWS.map((r) => r.eventProfile),
    );
    expect([...profiles].sort()).toEqual(
      [...SEASONAL_CONSUMPTION_NORM_EVENT_PROFILES].sort(),
    );
    for (const profile of SEASONAL_CONSUMPTION_NORM_EVENT_PROFILES) {
      expect(CONSUMPTION_NORM_EVENT_PROFILES).not.toContain(profile);
    }
  });

  it('is a distinct version from the standard dataset, dated 2026-01-01, open-ended', () => {
    expect(SEASONAL_CONSUMPTION_NORMS_SEED_VERSION).not.toBe(
      CONSUMPTION_NORMS_SEED_VERSION,
    );
    for (const row of SEASONAL_CONSUMPTION_NORMS_SEED_ROWS) {
      expect(row.versionLabel).toBe(SEASONAL_CONSUMPTION_NORMS_SEED_VERSION);
      expect(row.effectiveFrom).toBe('2026-01-01');
      expect(row.effectiveTo).toBeNull();
    }
  });

  it('names the occasion-specific pacing basis in every citation, ahead of the standard derivation', () => {
    for (const row of SEASONAL_CONSUMPTION_NORMS_SEED_ROWS) {
      // The occasion basis comes first so operator review sees the why
      // before the arithmetic.
      expect(row.sourceCitation.indexOf('basis:')).toBeGreaterThan(-1);
      expect(row.sourceCitation.indexOf('basis:')).toBeLessThan(
        row.sourceCitation.indexOf('Finnish standard drink'),
      );
      expect(row.sourceCitation.toLowerCase()).toContain(row.eventProfile);
      // Same verifiable tail as every other norms row.
      expect(row.sourceCitation).toContain('derivation:');
      expect(row.sourceCitation).toContain(CONSUMPTION_NORMS_CITATION_URL);
    }
  });

  it('stays inside the schema vocabularies and positive-value rules (mirrors the CHECKs before they run)', () => {
    for (const row of SEASONAL_CONSUMPTION_NORMS_SEED_ROWS) {
      expect(CONSUMPTION_NORM_DRINK_TYPES).toContain(row.drinkType);
      expect(SEASONAL_CONSUMPTION_NORM_EVENT_PROFILES).toContain(row.eventProfile);
      expect(row.normValuePerGuestPerHour).toBeGreaterThan(0);
      expect(Number.isFinite(row.normValuePerGuestPerHour)).toBe(true);
    }
  });

  it('shapes the pacing profiles to their occasions (beer-forward juhannus, sparkling/sima vappu, snaps-led rapujuhlat, modest talkoot)', () => {
    // Same-category comparisons — litres are only comparable within one
    // drink type (ABV differences make cross-category litre rankings
    // meaningless).
    const value = (eventProfile: string, drinkType: string): number =>
      SEASONAL_CONSUMPTION_NORMS_SEED_ROWS.find(
        (r) => r.eventProfile === eventProfile && r.drinkType === drinkType,
      )!.normValuePerGuestPerHour;
    const generalValue = (eventProfile: string, drinkType: string): number =>
      CONSUMPTION_NORMS_SEED_ROWS.find(
        (r) => r.eventProfile === eventProfile && r.drinkType === drinkType,
      )!.normValuePerGuestPerHour;

    // Juhannus: the beer line runs hotter than every general profile's.
    expect(value('juhannus', 'beer')).toBeGreaterThan(generalValue('casual_gathering', 'beer'));
    expect(value('juhannus', 'other_fermented')).toBeGreaterThan(
      generalValue('casual_gathering', 'other_fermented'),
    );
    // Vappu: sparkling and the sima-adjacent fermented specials run hot.
    expect(value('vappu', 'wine_sparkling')).toBeGreaterThan(
      generalValue('casual_gathering', 'wine_sparkling'),
    );
    expect(value('vappu', 'other_fermented')).toBeGreaterThan(value('talkoot', 'other_fermented'));
    // Rapujuhlat: the snaps (spirits) line leads every other profile's.
    for (const profile of CONSUMPTION_NORM_EVENT_PROFILES) {
      expect(value('rapujuhlat', 'spirits')).toBeGreaterThan(
        generalValue(profile, 'spirits'),
      );
    }
    for (const profile of ['juhannus', 'vappu', 'talkoot'] as const) {
      expect(value('rapujuhlat', 'spirits')).toBeGreaterThan(value(profile, 'spirits'));
    }
    // Talkoot: modest provisions — nothing above its own beer line, and
    // every line at or below juhannus's same-category pacing.
    for (const drinkType of CONSUMPTION_NORM_DRINK_TYPES) {
      expect(value('talkoot', drinkType)).toBeLessThanOrEqual(value('talkoot', 'beer'));
      expect(value('talkoot', drinkType)).toBeLessThanOrEqual(value('juhannus', drinkType));
    }
  });
});

describe('consumption norms seed — apply (both datasets)', () => {
  it('lands both curated versions in one batch, every row PENDING_CONFIRMATION', async () => {
    await seedConsumptionNorms(d1);
    expect(rowCount()).toBe(ALL_CONSUMPTION_NORMS_SEED_ROWS.length);
    expect(rowCount()).toBe(
      CONSUMPTION_NORMS_SEED_ROWS.length +
        SEASONAL_CONSUMPTION_NORMS_SEED_ROWS.length,
    );

    const statuses = db
      .prepare('SELECT DISTINCT status FROM consumption_norms')
      .all() as Array<{ status: string }>;
    expect(statuses).toEqual([{ status: 'PENDING_CONFIRMATION' }]);

    // One row of each dataset lands byte-identically to its constant.
    for (const [drinkType, eventProfile] of [
      ['beer', 'casual_gathering'],
      ['beer', 'juhannus'],
    ] as const) {
      const stored = db
        .prepare(
          `SELECT norm_value_per_guest_per_hour, source_citation
           FROM consumption_norms WHERE drink_type = ? AND event_profile = ?`,
        )
        .get(drinkType, eventProfile) as {
        norm_value_per_guest_per_hour: number;
        source_citation: string;
      };
      const curated = ALL_CONSUMPTION_NORMS_SEED_ROWS.find(
        (r) => r.drinkType === drinkType && r.eventProfile === eventProfile,
      )!;
      expect(stored.norm_value_per_guest_per_hour).toBe(
        curated.normValuePerGuestPerHour,
      );
      expect(stored.source_citation).toBe(curated.sourceCitation);
    }
  });

  it('is idempotent: a re-run refreshes pending rows in place, never duplicates (both datasets)', async () => {
    await seedConsumptionNorms(d1);
    await seedConsumptionNorms(d1);
    expect(rowCount()).toBe(ALL_CONSUMPTION_NORMS_SEED_ROWS.length);

    // Stored values match the curated constants exactly (replace, not drift).
    const rows = db
      .prepare('SELECT norm_value_per_guest_per_hour, source_citation FROM consumption_norms')
      .all() as Array<{ norm_value_per_guest_per_hour: number; source_citation: string }>;
    for (const row of rows) {
      expect(
        ALL_CONSUMPTION_NORMS_SEED_ROWS.some(
          (curated) =>
            curated.normValuePerGuestPerHour === row.norm_value_per_guest_per_hour &&
            curated.sourceCitation === row.source_citation,
        ),
      ).toBe(true);
    }
  });

  it('can never rewrite a PUBLISHED row — the append-only guard skips terminal rows on re-run', async () => {
    await seedConsumptionNorms(d1);

    // The operator confirms publication through the manual path.
    const before = await repo.findPublishedEffectiveNorm('beer', 'casual_gathering', '2026-06-01');
    expect(before).toBeNull(); // nothing published yet
    const [pendingRow] = await repo.findByVersionLabel(CONSUMPTION_NORMS_SEED_VERSION);
    const published = await repo.publish(pendingRow.id, 'ops@example.invalid');
    expect(published!.status).toBe('PUBLISHED');

    // Simulate post-publication drift on the published row: the seed's
    // re-run must NOT reconcile it (corrections append a new version).
    db.exec('UPDATE consumption_norms SET norm_value_per_guest_per_hour = 9.99 WHERE id = ' + pendingRow.id);
    await seedConsumptionNorms(d1);

    const after = await repo.findById(pendingRow.id);
    expect(after!.normValuePerGuestPerHour).toBe(9.99); // untouched — still terminal
    expect(after!.status).toBe('PUBLISHED');

    // Pending rows were still refreshed by the same re-run (upsert ran).
    const untouchedCount = (
      db
        .prepare(
          `SELECT count(*) AS n FROM consumption_norms
           WHERE status = 'PENDING_CONFIRMATION' AND norm_value_per_guest_per_hour != 9.99`,
        )
        .get() as { n: number }
    ).n;
    expect(untouchedCount).toBe(ALL_CONSUMPTION_NORMS_SEED_ROWS.length - 1);
  });

  it('guards the seasonal dataset independently: a published juhannus row is terminal, its version siblings still refresh', async () => {
    await seedConsumptionNorms(d1);

    const [pendingSeasonal] = await repo.findByVersionLabel(
      SEASONAL_CONSUMPTION_NORMS_SEED_VERSION,
    );
    const publishedSeasonal = await repo.publish(pendingSeasonal.id, 'ops@example.invalid');
    expect(publishedSeasonal!.status).toBe('PUBLISHED');
    expect(publishedSeasonal!.versionLabel).toBe(SEASONAL_CONSUMPTION_NORMS_SEED_VERSION);

    // Drift the published seasonal row AND one pending sibling of the
    // same version: the re-run must leave the former and repair the latter.
    db.exec(
      `UPDATE consumption_norms SET norm_value_per_guest_per_hour = 7.77
       WHERE id = ${pendingSeasonal.id}`,
    );
    db.exec(
      `UPDATE consumption_norms SET norm_value_per_guest_per_hour = 5.55
       WHERE version_label = '${SEASONAL_CONSUMPTION_NORMS_SEED_VERSION}'
         AND status = 'PENDING_CONFIRMATION'
         AND id != ${pendingSeasonal.id}
         AND id = (SELECT MIN(id) FROM consumption_norms
                   WHERE version_label = '${SEASONAL_CONSUMPTION_NORMS_SEED_VERSION}'
                     AND status = 'PENDING_CONFIRMATION' AND id != ${pendingSeasonal.id})`,
    );
    await seedConsumptionNorms(d1);

    const terminal = await repo.findById(pendingSeasonal.id);
    expect(terminal!.normValuePerGuestPerHour).toBe(7.77);
    expect(terminal!.status).toBe('PUBLISHED');

    // The 23 PENDING rows of the seasonal version were refreshed back to
    // the curated constants (the drifted 5.55 is gone); the terminal row
    // keeps its drifted value.
    const seasonalRows = db
      .prepare(
        `SELECT norm_value_per_guest_per_hour, source_citation, status FROM consumption_norms
         WHERE version_label = ?`,
      )
      .all(SEASONAL_CONSUMPTION_NORMS_SEED_VERSION) as Array<{
      norm_value_per_guest_per_hour: number;
      source_citation: string;
      status: string;
    }>;
    expect(seasonalRows).toHaveLength(SEASONAL_CONSUMPTION_NORMS_SEED_ROWS.length);
    const pendingSeasonalRows = seasonalRows.filter(
      (row) => row.status === 'PENDING_CONFIRMATION',
    );
    expect(pendingSeasonalRows).toHaveLength(
      SEASONAL_CONSUMPTION_NORMS_SEED_ROWS.length - 1,
    );
    for (const row of pendingSeasonalRows) {
      expect(
        SEASONAL_CONSUMPTION_NORMS_SEED_ROWS.some(
          (curated) =>
            curated.normValuePerGuestPerHour === row.norm_value_per_guest_per_hour &&
            curated.sourceCitation === row.source_citation,
        ),
      ).toBe(true);
    }
    expect(
      seasonalRows.find((row) => row.status === 'PUBLISHED')!
        .norm_value_per_guest_per_hour,
    ).toBe(7.77);
  });
});
