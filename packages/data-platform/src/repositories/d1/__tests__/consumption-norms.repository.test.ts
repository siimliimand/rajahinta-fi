/**
 * D1ConsumptionNormsRepository — real-SQLite tests (task 4.1, change
 * product-roadmap-phases-1-4) on the node:sqlite harness with the
 * committed migrations applied. Covers the FX-dataset contract the
 * norms reuse: the half-open effective-window resolution (boundary
 * dates at both edges), PENDING_CONFIRMATION invisibility, the
 * manual-only publish transition with the defensive citation guard,
 * append-only versioning (historical versions stay queryable, norm
 * values have no update path), and the version identifier surfaced by
 * every resolved row.
 *
 * @module D1ConsumptionNormsRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import {
  D1ConsumptionNormsRepository,
  MissingNormSourceCitationError,
  NormVersionMismatchError,
  type ConsumptionNormInsert,
} from '../consumption-norms.repository';

const { db, d1 } = openMigratedD1();
const repo = new D1ConsumptionNormsRepository(d1);

const CITATION =
  'Finnish standard drink = 12 g ethanol (15.2 ml) — "Standard drink", Finland row (https://en.wikipedia.org/wiki/Standard_drink)';

/** One pending norm row with a unique-enough version label. */
function row(overrides: Partial<ConsumptionNormInsert> = {}): ConsumptionNormInsert {
  return {
    versionLabel: 'norms-test-2026.1',
    drinkType: 'beer',
    eventProfile: 'casual_gathering',
    normValuePerGuestPerHour: 0.32,
    sourceCitation: CITATION,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...overrides,
  };
}

describe('D1ConsumptionNormsRepository — append-only versioning', () => {
  it('appends a version atomically, every row PENDING_CONFIRMATION, ids assigned', async () => {
    const created = await repo.createPendingVersion([
      row({ drinkType: 'beer' }),
      row({ drinkType: 'wine_still', normValuePerGuestPerHour: 0.06 }),
    ]);

    expect(created).toHaveLength(2);
    for (const norm of created) {
      expect(norm.status).toBe('PENDING_CONFIRMATION');
      expect(norm.versionLabel).toBe('norms-test-2026.1');
      expect(norm.confirmedBy).toBeNull();
      expect(norm.confirmedAt).toBeNull();
      expect(norm.id).toBeGreaterThan(0);
      expect(norm.createdAt).toBeInstanceOf(Date);
    }
  });

  it('refuses a version append whose rows span version labels', async () => {
    await expect(
      repo.createPendingVersion([row(), row({ versionLabel: 'norms-test-2026.2' })]),
    ).rejects.toBeInstanceOf(NormVersionMismatchError);
  });

  it('keeps historical versions queryable after a new version is appended — append-only, no overwrite', async () => {
    await repo.createPendingVersion([
      row({ versionLabel: 'norms-history-v1', normValuePerGuestPerHour: 0.32 }),
    ]);
    await repo.createPendingVersion([
      row({
        versionLabel: 'norms-history-v2',
        drinkType: 'wine_still',
        normValuePerGuestPerHour: 0.07,
      }),
    ]);

    const v1 = await repo.findByVersionLabel('norms-history-v1');
    const v2 = await repo.findByVersionLabel('norms-history-v2');
    expect(v1).toHaveLength(1);
    expect(v1[0].normValuePerGuestPerHour).toBe(0.32);
    expect(v2).toHaveLength(1);

    // Both versions coexist: appending never mutated v1's values.
    expect(v1[0].normValuePerGuestPerHour).toBe(0.32);
  });

  it('publishes only a PENDING_CONFIRMATION row and stamps the confirmer; republish returns null', async () => {
    const [created] = await repo.createPendingVersion([row({ versionLabel: 'norms-publish-1' })]);

    const published = await repo.publish(created.id, 'ops@example.invalid');
    expect(published).toMatchObject({
      status: 'PUBLISHED',
      confirmedBy: 'ops@example.invalid',
      versionLabel: 'norms-publish-1',
    });
    expect(published!.confirmedAt).toBeInstanceOf(Date);

    // PUBLISHED is terminal — the constrained UPDATE matches no row.
    await expect(repo.publish(created.id, 'ops-again')).resolves.toBeNull();
    await expect(repo.publish(999_999, 'ops')).resolves.toBeNull();
  });

  it('defensively refuses to publish a row whose citation is blank (the NOT NULL column admits empty strings)', async () => {
    // Schema-level guard: source_citation is NOT NULL. This raw insert
    // reaches the defensive repository guard exactly because '' passes
    // NOT NULL — the publish path must catch what the column cannot.
    db.exec(`
      INSERT INTO consumption_norms (
        version_label, drink_type, event_profile, norm_value_per_guest_per_hour,
        source_citation, status, effective_from
      ) VALUES ('norms-blank-citation', 'spirits', 'dinner_party', 0.01, '', 'PENDING_CONFIRMATION', '2026-01-01')
    `);
    const blankRow = await repo.findByVersionLabel('norms-blank-citation');
    expect(blankRow).toHaveLength(1);

    await expect(repo.publish(blankRow[0].id, 'ops')).rejects.toBeInstanceOf(
      MissingNormSourceCitationError,
    );
    // And the refused publish left the row pending.
    expect((await repo.findById(blankRow[0].id))!.status).toBe('PENDING_CONFIRMATION');

    // A whitespace-only citation is refused the same way.
    db.exec(`
      INSERT INTO consumption_norms (
        version_label, drink_type, event_profile, norm_value_per_guest_per_hour,
        source_citation, status, effective_from
      ) VALUES ('norms-blank-citation', 'spirits', 'celebration', 0.01, '   ', 'PENDING_CONFIRMATION', '2026-01-01')
    `);
    const wsRow = (await repo.findByVersionLabel('norms-blank-citation'))[1];
    await expect(repo.publish(wsRow.id, 'ops')).rejects.toBeInstanceOf(
      MissingNormSourceCitationError,
    );
  });
});

describe('D1ConsumptionNormsRepository — half-open effective-date resolution', () => {
  it('resolves only PUBLISHED rows; PENDING_CONFIRMATION is invisible to the calculator', async () => {
    // A key no earlier test in this shared harness has published.
    const key = { drinkType: 'intermediate_products', eventProfile: 'casual_gathering' };
    const before = await repo.findPublishedEffectiveNorm(
      key.drinkType,
      key.eventProfile,
      '2026-02-01',
    );
    expect(before).toBeNull(); // nothing published for the key yet

    const [pending] = await repo.createPendingVersion([
      row({
        versionLabel: 'norms-resolve-v1',
        ...key,
        normValuePerGuestPerHour: 0.01,
        effectiveFrom: '2026-02-01',
      }),
    ]);
    // Still pending → invisible even inside its window.
    await expect(
      repo.findPublishedEffectiveNorm(key.drinkType, key.eventProfile, '2026-03-01'),
    ).resolves.toBeNull();

    await repo.publish(pending.id, 'ops');

    const resolved = await repo.findPublishedEffectiveNorm(
      key.drinkType,
      key.eventProfile,
      '2026-03-01',
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.versionLabel).toBe('norms-resolve-v1'); // the version identifier results can name
    expect(resolved!.normValuePerGuestPerHour).toBe(0.01);
  });

  it('honors the half-open window: effectiveFrom inclusive, effectiveTo exclusive', async () => {
    const [v1] = await repo.createPendingVersion([
      row({
        versionLabel: 'norms-window-v1',
        drinkType: 'wine_still',
        eventProfile: 'dinner_party',
        normValuePerGuestPerHour: 0.13,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2027-01-01',
      }),
    ]);
    await repo.publish(v1.id, 'ops');

    // The day before the window opens → null.
    await expect(
      repo.findPublishedEffectiveNorm('wine_still', 'dinner_party', '2025-12-31'),
    ).resolves.toBeNull();
    // On the opening date → inclusive lower bound holds (<=).
    const atOpen = await repo.findPublishedEffectiveNorm('wine_still', 'dinner_party', '2026-01-01');
    expect(atOpen!.versionLabel).toBe('norms-window-v1');
    // Deep inside the window → resolved.
    await expect(
      repo.findPublishedEffectiveNorm('wine_still', 'dinner_party', '2026-06-15'),
    ).resolves.toMatchObject({ versionLabel: 'norms-window-v1' });
    // On the closing date → STRICT upper bound excludes it (the < in [from, to)).
    await expect(
      repo.findPublishedEffectiveNorm('wine_still', 'dinner_party', '2027-01-01'),
    ).resolves.toBeNull();
    // After the window closed → null (no open-ended successor yet).
    await expect(
      repo.findPublishedEffectiveNorm('wine_still', 'dinner_party', '2027-06-01'),
    ).resolves.toBeNull();
  });

  it('a null effectiveTo is open-ended — resolved both at the boundary date and far in the future', async () => {
    const [v] = await repo.createPendingVersion([
      row({ versionLabel: 'norms-open-v1', drinkType: 'spirits', eventProfile: 'celebration', normValuePerGuestPerHour: 0.01 }),
    ]);
    await repo.publish(v.id, 'ops');

    await expect(
      repo.findPublishedEffectiveNorm('spirits', 'celebration', '2026-01-01'),
    ).resolves.toMatchObject({ versionLabel: 'norms-open-v1' });
    await expect(
      repo.findPublishedEffectiveNorm('spirits', 'celebration', '2099-12-31'),
    ).resolves.toMatchObject({ versionLabel: 'norms-open-v1' });
  });

  it('prefers the newest effectiveFrom per drink type when published windows overlap', async () => {
    const [older] = await repo.createPendingVersion([
      row({
        versionLabel: 'norms-overlap-old',
        drinkType: 'other_fermented',
        eventProfile: 'celebration',
        normValuePerGuestPerHour: 0.28,
        effectiveFrom: '2026-01-01',
      }),
    ]);
    await repo.publish(older.id, 'ops');

    const [newer] = await repo.createPendingVersion([
      row({
        versionLabel: 'norms-overlap-new',
        drinkType: 'other_fermented',
        eventProfile: 'celebration',
        normValuePerGuestPerHour: 0.14,
        effectiveFrom: '2026-03-01',
      }),
    ]);
    await repo.publish(newer.id, 'ops');

    // Both windows cover this date — the most recent effectiveFrom wins.
    const resolved = await repo.findPublishedEffectiveNorm(
      'other_fermented',
      'celebration',
      '2026-04-01',
    );
    expect(resolved!.versionLabel).toBe('norms-overlap-new');
    expect(resolved!.normValuePerGuestPerHour).toBe(0.14);

    // Profile-wide resolution returns exactly one row per drink type.
    const all = await repo.findPublishedEffectiveOn('celebration', '2026-04-01');
    const fermented = all.filter((n) => n.drinkType === 'other_fermented');
    expect(fermented).toHaveLength(1);
    expect(fermented[0].versionLabel).toBe('norms-overlap-new');
  });

  it('profile-wide resolution covers every published drink type for the profile, each naming its version', async () => {
    // Keys untouched by earlier tests in this shared harness — the
    // overlap rule means older published versions of the same key would
    // (correctly) shadow these rows otherwise.
    const versionLabel = 'norms-profile-v1';
    const rows = [
      row({ versionLabel, drinkType: 'intermediate_products', eventProfile: 'dinner_party', normValuePerGuestPerHour: 0.02, effectiveFrom: '2026-01-01' }),
      row({ versionLabel, drinkType: 'other_fermented', eventProfile: 'dinner_party', normValuePerGuestPerHour: 0.07, effectiveFrom: '2026-01-01' }),
      row({ versionLabel, drinkType: 'wine_sparkling', eventProfile: 'dinner_party', normValuePerGuestPerHour: 0.03, effectiveFrom: '2026-01-01' }),
    ];
    const created = await repo.createPendingVersion(rows);
    for (const norm of created) {
      await repo.publish(norm.id, 'ops');
    }

    const resolved = await repo.findPublishedEffectiveOn('dinner_party', '2026-05-01');
    // Exactly one row per drink type — no transient-overlap duplicates.
    const typeCounts = new Map<string, number>();
    for (const norm of resolved) {
      typeCounts.set(norm.drinkType, (typeCounts.get(norm.drinkType) ?? 0) + 1);
    }
    for (const count of typeCounts.values()) {
      expect(count).toBe(1);
    }

    const labels = resolved.map((n) => [n.drinkType, n.versionLabel, n.normValuePerGuestPerHour]);
    expect(labels).toContainEqual(['intermediate_products', versionLabel, 0.02]);
    expect(labels).toContainEqual(['other_fermented', versionLabel, 0.07]);
    expect(labels).toContainEqual(['wine_sparkling', versionLabel, 0.03]);
  });

  it('a key with no published row resolves null — never guessed from other keys', async () => {
    // Only PENDING_CONFIRMATION rows exist for this key (from the first
    // test in this file) — invisible to resolution.
    await expect(
      repo.findPublishedEffectiveNorm('wine_still', 'casual_gathering', '2026-05-01'),
    ).resolves.toBeNull();
  });
});

describe('D1ConsumptionNormsRepository — schema guards', () => {
  it('the status CHECK is the first guard against an unknown lifecycle state', async () => {
    await expect(
      d1
        .prepare(
          `INSERT INTO consumption_norms (
             version_label, drink_type, event_profile, norm_value_per_guest_per_hour,
             source_citation, status, effective_from
           ) VALUES ('norms-corrupt', 'beer', 'casual_gathering', 0.3, ?, 'EFFECTIVE', '2026-01-01')`,
        )
        .bind(CITATION)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it('an inverted effective window is unrepresentable at rest', async () => {
    await expect(
      d1
        .prepare(
          `INSERT INTO consumption_norms (
             version_label, drink_type, event_profile, norm_value_per_guest_per_hour,
             source_citation, status, effective_from, effective_to
           ) VALUES ('norms-inverted', 'beer', 'casual_gathering', 0.3, ?, 'PENDING_CONFIRMATION', '2027-01-01', '2026-01-01')`,
        )
        .bind(CITATION)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it('an unknown drink type or event profile is unrepresentable at rest', async () => {
    await expect(
      d1
        .prepare(
          `INSERT INTO consumption_norms (
             version_label, drink_type, event_profile, norm_value_per_guest_per_hour,
             source_citation, status, effective_from
           ) VALUES ('norms-vocab', 'kombucha', 'casual_gathering', 0.3, ?, 'PENDING_CONFIRMATION', '2026-01-01')`,
        )
        .bind(CITATION)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);

    await expect(
      d1
        .prepare(
          `INSERT INTO consumption_norms (
             version_label, drink_type, event_profile, norm_value_per_guest_per_hour,
             source_citation, status, effective_from
           ) VALUES ('norms-vocab', 'beer', 'wedding', 0.3, ?, 'PENDING_CONFIRMATION', '2026-01-01')`,
        )
        .bind(CITATION)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it('a non-positive norm value is unrepresentable at rest', async () => {
    await expect(
      d1
        .prepare(
          `INSERT INTO consumption_norms (
             version_label, drink_type, event_profile, norm_value_per_guest_per_hour,
             source_citation, status, effective_from
           ) VALUES ('norms-zero', 'beer', 'casual_gathering', 0, ?, 'PENDING_CONFIRMATION', '2026-01-01')`,
        )
        .bind(CITATION)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});
