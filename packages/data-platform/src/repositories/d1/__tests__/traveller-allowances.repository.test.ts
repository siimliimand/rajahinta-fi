/**
 * D1TravellerAllowancesRepository — real-SQLite tests (task 5.1, change
 * product-roadmap-phases-1-4) on the node:sqlite harness with the
 * committed migrations applied. Covers the FX-dataset contract the
 * allowances reuse: the half-open effective-window resolution (boundary
 * dates at both edges, on the dataset AND its limit rows), the version
 * resolved as a unit (no per-category fallback to an older version),
 * PENDING_CONFIRMATION invisibility, the manual-only publish transition
 * with the defensive citation guard, and append-only versioning
 * (historical versions stay queryable, caps have no update path).
 *
 * Resolution is DATE-keyed (a version covers all categories at once),
 * unlike the per-key norms reads — so each resolution test owns a
 * disjoint calendar region and the tests run in definition order:
 * window 2031, past-version 2033, overlap 2035, unit 2037,
 * limit-window 2039, pending-invisible 2041, open-ended 2045.
 * Versions never publish inside another test's region with a newer
 * effectiveFrom (vitest runs a file's tests in order).
 *
 * @module D1TravellerAllowancesRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import {
  D1TravellerAllowancesRepository,
  MissingAllowanceSourceCitationError,
  type TravellerAllowanceDatasetInsert,
  type TravellerAllowanceLimitInsert,
} from '../traveller-allowances.repository';

const { d1 } = openMigratedD1();
const repo = new D1TravellerAllowancesRepository(d1);

const DIRECTIVE_URL =
  'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32007L0074';
const CITATION = `Commission Directive 2007/74/EC, Annex (${DIRECTIVE_URL})`;

/** One pending dataset version insert. */
function dataset(
  overrides: Partial<TravellerAllowanceDatasetInsert> = {},
): TravellerAllowanceDatasetInsert {
  return {
    versionLabel: 'allowances-test-2026.1',
    sourceCitation: CITATION,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...overrides,
  };
}

function limit(
  overrides: Partial<TravellerAllowanceLimitInsert> = {},
): TravellerAllowanceLimitInsert {
  return {
    category: 'spirits',
    volumeCapLitres: 10,
    quantityCap: null,
    sourceCitation: CITATION,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...overrides,
  };
}

describe('D1TravellerAllowancesRepository — append-only versioning', () => {
  it('appends a version atomically — dataset + limit rows land together, all PENDING_CONFIRMATION', async () => {
    const version = await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-append-1' }),
      [limit(), limit({ category: 'beer', volumeCapLitres: 110 })],
    );

    expect(version.dataset.versionLabel).toBe('allowances-append-1');
    expect(version.dataset.status).toBe('PENDING_CONFIRMATION');
    expect(version.dataset.confirmedBy).toBeNull();
    expect(version.dataset.confirmedAt).toBeNull();
    expect(version.dataset.id).toBeGreaterThan(0);
    expect(version.dataset.createdAt).toBeInstanceOf(Date);

    expect(version.limits).toHaveLength(2);
    for (const row of version.limits) {
      expect(row.datasetId).toBe(version.dataset.id);
      expect(row.effectiveFrom).toBe('2026-01-01');
    }
    expect(version.limits.map((l) => l.category).sort()).toEqual([
      'beer',
      'spirits',
    ]);
  });

  it('refuses to append a version without limit rows (a version is dataset + limits)', async () => {
    await expect(
      repo.createPendingVersion(dataset({ versionLabel: 'allowances-empty' }), []),
    ).rejects.toThrow(/cannot be appended without limit rows/);
    await expect(
      repo.findDatasetByVersionLabel('allowances-empty'),
    ).resolves.toBeNull(); // nothing landed
  });

  it('keeps historical versions queryable after a new version is appended — append-only, no overwrite', async () => {
    await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-history-v1' }),
      [limit({ volumeCapLitres: 10 })],
    );
    await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-history-v2' }),
      [limit({ volumeCapLitres: 9 })],
    );

    const v1 = await repo.findDatasetByVersionLabel('allowances-history-v1');
    const v2 = await repo.findDatasetByVersionLabel('allowances-history-v2');
    expect(v1!.limits[0].volumeCapLitres).toBe(10); // v1 untouched by the v2 append
    expect(v2!.limits[0].volumeCapLitres).toBe(9);
  });
});

describe('D1TravellerAllowancesRepository — manual publish transition', () => {
  it('publishes only a PENDING_CONFIRMATION version and stamps the confirmer; republish returns null', async () => {
    // Bounded window — later tests' date-region assertions must not see
    // this version's coverage past 2028.
    const created = await repo.createPendingVersion(
      dataset({
        versionLabel: 'allowances-publish-1',
        effectiveFrom: '2026-01-01',
        effectiveTo: '2028-01-01',
      }),
      [
        limit({ effectiveFrom: '2026-01-01', effectiveTo: '2028-01-01' }),
        limit({
          category: 'beer',
          volumeCapLitres: 110,
          effectiveFrom: '2026-01-01',
          effectiveTo: '2028-01-01',
        }),
      ],
    );

    const published = await repo.publish(
      created.dataset.id,
      'ops@example.invalid',
    );
    expect(published).not.toBeNull();
    expect(published!.dataset.status).toBe('PUBLISHED');
    expect(published!.dataset.confirmedBy).toBe('ops@example.invalid');
    expect(published!.dataset.confirmedAt).toBeInstanceOf(Date);
    // The limits publish with their dataset — visible under the version.
    expect(published!.limits).toHaveLength(2);

    // PUBLISHED is terminal — the constrained UPDATE matches no row.
    await expect(
      repo.publish(created.dataset.id, 'ops-again'),
    ).resolves.toBeNull();
    await expect(repo.publish(999_999, 'ops')).resolves.toBeNull();
  });

  it('refuses to publish a version with no limit rows (it would cap nothing)', async () => {
    await d1
      .prepare(
        `INSERT INTO traveller_allowance_datasets (
           version_label, source_citation, status, effective_from
         ) VALUES ('allowances-no-limits', ?, 'PENDING_CONFIRMATION', '2026-01-01')`,
      )
      .bind(CITATION)
      .run();
    const version = await repo.findDatasetByVersionLabel('allowances-no-limits');

    await expect(repo.publish(version!.dataset.id, 'ops')).rejects.toThrow(
      /no limit rows/,
    );
    // The refused publish left the dataset pending.
    expect(
      (await repo.findDatasetByVersionLabel('allowances-no-limits'))!.dataset
        .status,
    ).toBe('PENDING_CONFIRMATION');
  });

  it('defensively refuses to publish when the dataset citation is blank (the NOT NULL column admits empty strings)', async () => {
    await d1
      .prepare(
        `INSERT INTO traveller_allowance_datasets (
           version_label, source_citation, status, effective_from
         ) VALUES ('allowances-blank-ds', '', 'PENDING_CONFIRMATION', '2026-01-01')`,
      )
      .run();
    await d1
      .prepare(
        `INSERT INTO traveller_allowance_limits (
           dataset_id, category, volume_cap_litres, quantity_cap, source_citation, effective_from
         ) VALUES (
           (SELECT id FROM traveller_allowance_datasets WHERE version_label = 'allowances-blank-ds'),
           'spirits', 10, NULL, ?, '2026-01-01'
         )`,
      )
      .bind(CITATION)
      .run();
    const version = await repo.findDatasetByVersionLabel('allowances-blank-ds');

    await expect(
      repo.publish(version!.dataset.id, 'ops'),
    ).rejects.toBeInstanceOf(MissingAllowanceSourceCitationError);
    expect(
      (await repo.findDatasetByVersionLabel('allowances-blank-ds'))!.dataset
        .status,
    ).toBe('PENDING_CONFIRMATION');
  });

  it('defensively refuses to publish when a limit row citation is blank — even with a fine dataset citation', async () => {
    const version = await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-blank-limit' }),
      [limit({ sourceCitation: '   ' })], // whitespace-only citation
    );

    await expect(
      repo.publish(version.dataset.id, 'ops'),
    ).rejects.toBeInstanceOf(MissingAllowanceSourceCitationError);
    expect(
      (await repo.findDatasetByVersionLabel('allowances-blank-limit'))!.dataset
        .status,
    ).toBe('PENDING_CONFIRMATION');
  });
});

describe('D1TravellerAllowancesRepository — half-open effective-date resolution', () => {
  it('honors the half-open window: effectiveFrom inclusive, effectiveTo exclusive', async () => {
    const created = await repo.createPendingVersion(
      dataset({
        versionLabel: 'allowances-window-v1',
        effectiveFrom: '2031-01-01',
        effectiveTo: '2032-01-01',
      }),
      [
        limit({
          volumeCapLitres: 10,
          effectiveFrom: '2031-01-01',
          effectiveTo: '2032-01-01',
        }),
      ],
    );
    await repo.publish(created.dataset.id, 'ops');

    // The day before the window opens → null.
    await expect(repo.findPublishedEffectiveOn('2030-12-31')).resolves.toBeNull();
    // On the opening date → inclusive lower bound holds (<=).
    await expect(
      repo.findPublishedEffectiveOn('2031-01-01'),
    ).resolves.toMatchObject({ dataset: { versionLabel: 'allowances-window-v1' } });
    // Deep inside the window → resolved.
    await expect(
      repo.findPublishedEffectiveOn('2031-06-15'),
    ).resolves.toMatchObject({ dataset: { versionLabel: 'allowances-window-v1' } });
    // On the closing date → STRICT upper bound excludes it (the < in [from, to)).
    await expect(repo.findPublishedEffectiveOn('2032-01-01')).resolves.toBeNull();
    // After the window closed → null (no open-ended successor yet).
    await expect(repo.findPublishedEffectiveOn('2032-06-01')).resolves.toBeNull();
    // The per-category read follows the same window edges.
    await expect(
      repo.findPublishedEffectiveLimit('spirits', '2032-01-01'),
    ).resolves.toBeNull();
    await expect(
      repo.findPublishedEffectiveLimit('spirits', '2031-06-15'),
    ).resolves.toMatchObject({
      dataset: { versionLabel: 'allowances-window-v1' },
      limit: { volumeCapLitres: 10 },
    });
  });

  it('a past version remains queryable and still resolves for dates within its window after a newer version is published', async () => {
    const v1 = await repo.createPendingVersion(
      dataset({
        versionLabel: 'allowances-past-v1',
        effectiveFrom: '2033-01-01',
        effectiveTo: '2033-06-01',
      }),
      [
        limit({
          volumeCapLitres: 10,
          effectiveFrom: '2033-01-01',
          effectiveTo: '2033-06-01',
        }),
      ],
    );
    await repo.publish(v1.dataset.id, 'ops');

    const v2 = await repo.createPendingVersion(
      dataset({
        versionLabel: 'allowances-past-v2',
        effectiveFrom: '2033-06-01',
      }),
      [limit({ volumeCapLitres: 8, effectiveFrom: '2033-06-01' })],
    );
    await repo.publish(v2.dataset.id, 'ops');

    // A date inside the old version's window still resolves the OLD
    // version — history stays queryable and authoritative for its dates
    // (spec: product-data-model, "Past version remains queryable").
    await expect(
      repo.findPublishedEffectiveOn('2033-03-01'),
    ).resolves.toMatchObject({ dataset: { versionLabel: 'allowances-past-v1' } });
    await expect(
      repo.findPublishedEffectiveLimit('spirits', '2033-03-01'),
    ).resolves.toMatchObject({
      dataset: { versionLabel: 'allowances-past-v1' },
      limit: { volumeCapLitres: 10 },
    });

    // The new version takes over exactly at its effectiveFrom.
    await expect(
      repo.findPublishedEffectiveOn('2033-06-01'),
    ).resolves.toMatchObject({ dataset: { versionLabel: 'allowances-past-v2' } });
    await expect(
      repo.findPublishedEffectiveLimit('spirits', '2033-06-01'),
    ).resolves.toMatchObject({
      dataset: { versionLabel: 'allowances-past-v2' },
      limit: { volumeCapLitres: 8 },
    });
  });

  it('prefers the newest effectiveFrom when published windows overlap transiently', async () => {
    const older = await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-overlap-old', effectiveFrom: '2035-01-01' }),
      [limit({ category: 'beer', volumeCapLitres: 120, effectiveFrom: '2035-01-01' })],
    );
    await repo.publish(older.dataset.id, 'ops');

    const newer = await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-overlap-new', effectiveFrom: '2035-03-01' }),
      [limit({ category: 'beer', volumeCapLitres: 110, effectiveFrom: '2035-03-01' })],
    );
    await repo.publish(newer.dataset.id, 'ops');

    // Multiple published windows cover this date — the most recent
    // effectiveFrom wins, deterministically.
    await expect(
      repo.findPublishedEffectiveLimit('beer', '2035-04-01'),
    ).resolves.toMatchObject({
      dataset: { versionLabel: 'allowances-overlap-new' },
      limit: { volumeCapLitres: 110 },
    });
  });

  it('resolves a version as a unit: a category missing from the effective version is null, never an older version cap', async () => {
    const v1 = await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-unit-v1', effectiveFrom: '2037-01-01' }),
      [limit({ category: 'beer', volumeCapLitres: 110, effectiveFrom: '2037-01-01' })],
    );
    await repo.publish(v1.dataset.id, 'ops');

    const v2 = await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-unit-v2', effectiveFrom: '2037-06-01' }),
      [limit({ volumeCapLitres: 10, effectiveFrom: '2037-06-01' })], // spirits only
    );
    await repo.publish(v2.dataset.id, 'ops');

    // v2 is effective on this date and has spirits — resolved from v2.
    await expect(
      repo.findPublishedEffectiveLimit('spirits', '2037-07-01'),
    ).resolves.toMatchObject({ dataset: { versionLabel: 'allowances-unit-v2' } });
    // v2 has NO beer row — null (surfacing the partial version), never
    // v1's beer cap silently substituted.
    await expect(
      repo.findPublishedEffectiveLimit('beer', '2037-07-01'),
    ).resolves.toBeNull();
    // A category no version ever carried → null, never guessed.
    await expect(
      repo.findPublishedEffectiveLimit('intermediate_products', '2037-07-01'),
    ).resolves.toBeNull();
  });

  it('a limit whose own window does not cover the date is not resolved — the limit window is enforced too', async () => {
    const created = await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-limitwindow-v1', effectiveFrom: '2039-01-01' }),
      [
        limit({
          category: 'wine_still',
          volumeCapLitres: 90,
          effectiveFrom: '2039-01-01',
          effectiveTo: '2039-05-01',
        }),
      ],
    );
    await repo.publish(created.dataset.id, 'ops');

    // Dataset window is open-ended, but the limit row's own window has
    // closed by June → the category resolves to null.
    await expect(
      repo.findPublishedEffectiveLimit('wine_still', '2039-06-01'),
    ).resolves.toBeNull();
    // Inside the limit's own window → resolved.
    await expect(
      repo.findPublishedEffectiveLimit('wine_still', '2039-04-01'),
    ).resolves.toMatchObject({ limit: { volumeCapLitres: 90 } });
    // On the limit window's exclusive edge → excluded.
    await expect(
      repo.findPublishedEffectiveLimit('wine_still', '2039-05-01'),
    ).resolves.toBeNull();
  });

  it('resolves only PUBLISHED versions; PENDING_CONFIRMATION is invisible to the calculator', async () => {
    // intermediate_products is carried by no earlier open-ended PUBLISHED
    // version in this harness, so the pre-check can only pass via this
    // version.
    const before = await repo.findPublishedEffectiveLimit(
      'intermediate_products',
      '2041-03-01',
    );
    expect(before).toBeNull(); // nothing published for the key yet

    const created = await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-resolve-v1', effectiveFrom: '2041-01-01' }),
      [
        limit({
          category: 'intermediate_products',
          volumeCapLitres: 20,
          effectiveFrom: '2041-01-01',
        }),
      ],
    );
    // Still pending → invisible even inside its window.
    await expect(
      repo.findPublishedEffectiveLimit('intermediate_products', '2041-03-01'),
    ).resolves.toBeNull();

    await repo.publish(created.dataset.id, 'ops');

    const resolved = await repo.findPublishedEffectiveLimit(
      'intermediate_products',
      '2041-03-01',
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.dataset.versionLabel).toBe('allowances-resolve-v1'); // the version results can name
    expect(resolved!.limit.volumeCapLitres).toBe(20);
    // The dataset-wide read resolves the newest effective version.
    await expect(
      repo.findPublishedEffectiveOn('2041-03-01'),
    ).resolves.toMatchObject({ dataset: { versionLabel: 'allowances-resolve-v1' } });
  });

  it('a null effectiveTo is open-ended — resolved both at the boundary date and far in the future', async () => {
    const created = await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-open-v1', effectiveFrom: '2045-01-01' }),
      [limit({ category: 'beer', volumeCapLitres: 110, effectiveFrom: '2045-01-01' })],
    );
    await repo.publish(created.dataset.id, 'ops');

    await expect(
      repo.findPublishedEffectiveOn('2045-01-01'),
    ).resolves.toMatchObject({ dataset: { versionLabel: 'allowances-open-v1' } });
    // Far in the future the newest open-ended effectiveFrom wins — this
    // version's.
    await expect(
      repo.findPublishedEffectiveOn('2099-12-31'),
    ).resolves.toMatchObject({ dataset: { versionLabel: 'allowances-open-v1' } });
  });
});

describe('D1TravellerAllowancesRepository — schema guards', () => {
  it('the status CHECK is the first guard against an unknown lifecycle state', async () => {
    await expect(
      d1
        .prepare(
          `INSERT INTO traveller_allowance_datasets (
             version_label, source_citation, status, effective_from
           ) VALUES ('allowances-corrupt', ?, 'EFFECTIVE', '2026-01-01')`,
        )
        .bind(CITATION)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it('an inverted effective window is unrepresentable at rest — on the dataset and its limits', async () => {
    await expect(
      d1
        .prepare(
          `INSERT INTO traveller_allowance_datasets (
             version_label, source_citation, status, effective_from, effective_to
           ) VALUES ('allowances-inverted-ds', ?, 'PENDING_CONFIRMATION', '2027-01-01', '2026-01-01')`,
        )
        .bind(CITATION)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);

    const host = await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-inverted-limit' }),
      [limit({ category: 'beer', volumeCapLitres: 110 })],
    );
    await expect(
      d1
        .prepare(
          `INSERT INTO traveller_allowance_limits (
             dataset_id, category, volume_cap_litres, quantity_cap, source_citation, effective_from, effective_to
           ) VALUES (?, 'spirits', 10, NULL, ?, '2027-01-01', '2026-01-01')`,
        )
        .bind(host.dataset.id, CITATION)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it('an unknown category is unrepresentable at rest', async () => {
    const host = await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-vocab-host' }),
      [limit({ category: 'beer', volumeCapLitres: 110 })],
    );
    await expect(
      d1
        .prepare(
          `INSERT INTO traveller_allowance_limits (
             dataset_id, category, volume_cap_litres, quantity_cap, source_citation, effective_from
           ) VALUES (?, 'cigarettes', NULL, 200, ?, '2026-01-01')`,
        )
        .bind(host.dataset.id, CITATION)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it('a cap-less limit row is unrepresentable at rest — volume or quantity must be present', async () => {
    const host = await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-capless-host' }),
      [limit({ category: 'beer', volumeCapLitres: 110 })],
    );
    await expect(
      d1
        .prepare(
          `INSERT INTO traveller_allowance_limits (
             dataset_id, category, volume_cap_litres, quantity_cap, source_citation, effective_from
           ) VALUES (?, 'spirits', NULL, NULL, ?, '2026-01-01')`,
        )
        .bind(host.dataset.id, CITATION)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it('a non-positive cap is unrepresentable at rest', async () => {
    const host = await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-nonpos-host' }),
      [limit({ category: 'beer', volumeCapLitres: 110 })],
    );
    await expect(
      d1
        .prepare(
          `INSERT INTO traveller_allowance_limits (
             dataset_id, category, volume_cap_litres, quantity_cap, source_citation, effective_from
           ) VALUES (?, 'spirits', 0, NULL, ?, '2026-01-01')`,
        )
        .bind(host.dataset.id, CITATION)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it('two rows of one category inside a version are unrepresentable at rest (the per-version identity)', async () => {
    const host = await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-dup-host' }),
      [limit({ category: 'beer', volumeCapLitres: 110 })],
    );
    await expect(
      d1
        .prepare(
          `INSERT INTO traveller_allowance_limits (
             dataset_id, category, volume_cap_litres, quantity_cap, source_citation, effective_from
           ) VALUES (?, 'beer', 90, NULL, ?, '2026-01-01')`,
        )
        .bind(host.dataset.id, CITATION)
        .run(),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });
});

describe('D1TravellerAllowancesRepository — the review queue', () => {
  it('findPending lists pending versions with their limits; published versions stay out', async () => {
    const publishedVersion = await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-queue-pub' }),
      [limit({ category: 'beer', volumeCapLitres: 110 })],
    );
    await repo.publish(publishedVersion.dataset.id, 'ops');

    const pendingVersion = await repo.createPendingVersion(
      dataset({ versionLabel: 'allowances-queue-pending' }),
      [limit({ category: 'spirits', volumeCapLitres: 10 })],
    );

    const pending = await repo.findPending();
    const labels = pending.map((v) => v.dataset.versionLabel);
    expect(labels).not.toContain('allowances-queue-pub');
    expect(labels).toContain('allowances-queue-pending');
    const listed = pending.find(
      (v) => v.dataset.versionLabel === 'allowances-queue-pending',
    )!;
    expect(listed.dataset.id).toBe(pendingVersion.dataset.id);
    expect(listed.limits).toHaveLength(1);
    expect(listed.limits[0].category).toBe('spirits');
  });
});
