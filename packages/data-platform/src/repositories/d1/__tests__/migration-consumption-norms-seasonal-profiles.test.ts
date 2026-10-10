/**
 * Migration 0033 (change seasonal-occasion-templates, task 1.1) — the
 * widened consumption_norms.event_profile CHECK. Proves, against the
 * real SQLite engine with the committed migrations applied:
 *
 *   - the four seasonal occasion profiles (juhannus, vappu, rapujuhlat,
 *     talkoot) insert cleanly alongside the three general ones;
 *   - values outside the set are still rejected;
 *   - a rebuild over a POPULATED database (the state production is in —
 *     standard-drink-fi-2026.1 landed 2026-10-03, possibly published)
 *     preserves every row verbatim: ids, statuses, audit columns;
 *   - the upsert-target UNIQUE index and the status index survive the
 *     rebuild (the seed's idempotency depends on the unique index);
 *   - the stored CHECK constraint ends up textually canonical.
 *
 * @module D1Migration0033Test
 */
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { openMigratedD1 } from './d1-test-harness';

const { db } = openMigratedD1();

function seedNorm(id: number, eventProfile: string): void {
  db.prepare(
    `INSERT INTO consumption_norms (
       id, version_label, drink_type, event_profile,
       norm_value_per_guest_per_hour, source_citation, effective_from
     ) VALUES (?, 'migration-0033-test', 'beer', ?, 0.16, 'test citation', '2026-01-01')`,
  ).run(id, eventProfile);
}

describe('migration 0033 — event_profile CHECK value set', () => {
  it('accepts the three general profiles', () => {
    ['casual_gathering', 'dinner_party', 'celebration'].forEach((profile, i) => {
      expect(() => seedNorm(10 + i, profile)).not.toThrow();
    });
  });

  it('accepts the four seasonal occasion profiles (change seasonal-occasion-templates)', () => {
    ['juhannus', 'vappu', 'rapujuhlat', 'talkoot'].forEach((profile, i) => {
      expect(() => seedNorm(20 + i, profile)).not.toThrow();
    });
  });

  it('rejects values outside the value set', () => {
    expect(() => seedNorm(30, 'midsummer')).toThrow(/CHECK constraint failed/);
    expect(() => seedNorm(31, 'wedding')).toThrow(/CHECK constraint failed/);
  });

  it('stores the CHECK constraint textually canonical (the rename rewrote the self-reference)', () => {
    const table = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'consumption_norms'")
      .get() as { sql: string };
    expect(table.sql).not.toContain('consumption_norms_new');
    expect(table.sql).toContain(
      `"consumption_norms"."event_profile" IN ('casual_gathering', 'dinner_party', 'celebration', 'juhannus', 'vappu', 'rapujuhlat', 'talkoot')`,
    );
  });

  it('recreates the upsert-target UNIQUE index and the status index', () => {
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'consumption_norms' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toEqual([
      'consumption_norms_key_version_unique',
      'consumption_norms_status_idx',
    ]);
  });

  it('leaves FK enforcement on — the migration restores the D1 default', () => {
    const fk = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(fk.foreign_keys).toBe(1);
  });
});

describe('migration 0033 — rebuild over a populated database', () => {
  // Simulates applying 0033 to an environment that already ran 0006 and
  // carries curated norms rows — the state production and staging are in.
  const populated = new DatabaseSync(':memory:');
  const migrationsDir = path.resolve(process.cwd(), 'src/d1/migrations');
  const apply = (target: DatabaseSync, files: string[]): void => {
    for (const file of files) {
      for (const statement of readFileSync(path.join(migrationsDir, file), 'utf8')
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean)) {
        target.exec(statement);
      }
    }
  };

  const baseMigrations = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => f !== '0033_consumption_norms_seasonal_profiles.sql')
    .sort();

  apply(populated, baseMigrations);
  // Seed the pre-rebuild state: one pending and one PUBLISHED curated row
  // (published = the operator already confirmed the standard dataset),
  // with audit columns set the way the repository's publish path sets them.
  populated.exec(
    `INSERT INTO consumption_norms (
       id, version_label, drink_type, event_profile,
       norm_value_per_guest_per_hour, source_citation, status,
       effective_from, effective_to, confirmed_by, confirmed_at, created_at
     ) VALUES
       (1, 'standard-drink-fi-2026.1', 'beer', 'casual_gathering', 0.32,
        'test citation', 'PENDING_CONFIRMATION', '2026-01-01', NULL, NULL, NULL,
        '2026-10-03T00:00:00.000Z'),
       (2, 'standard-drink-fi-2026.1', 'wine_still', 'dinner_party', 0.13,
        'test citation', 'PUBLISHED', '2026-01-01', NULL, 'owner@example.invalid',
        '2026-10-03T12:00:00.000Z', '2026-10-03T00:00:00.000Z')`,
  );
  apply(populated, ['0033_consumption_norms_seasonal_profiles.sql']);

  it('preserves every row verbatim — ids, statuses, audit columns included', () => {
    const rows = populated
      .prepare(
        `SELECT id, version_label, drink_type, event_profile,
                norm_value_per_guest_per_hour, source_citation, status,
                effective_from, effective_to, confirmed_by, confirmed_at, created_at
         FROM consumption_norms ORDER BY id`,
      )
      .all();
    expect(rows).toEqual([
      {
        id: 1,
        version_label: 'standard-drink-fi-2026.1',
        drink_type: 'beer',
        event_profile: 'casual_gathering',
        norm_value_per_guest_per_hour: 0.32,
        source_citation: 'test citation',
        status: 'PENDING_CONFIRMATION',
        effective_from: '2026-01-01',
        effective_to: null,
        confirmed_by: null,
        confirmed_at: null,
        created_at: '2026-10-03T00:00:00.000Z',
      },
      {
        id: 2,
        version_label: 'standard-drink-fi-2026.1',
        drink_type: 'wine_still',
        event_profile: 'dinner_party',
        norm_value_per_guest_per_hour: 0.13,
        source_citation: 'test citation',
        status: 'PUBLISHED',
        effective_from: '2026-01-01',
        effective_to: null,
        confirmed_by: 'owner@example.invalid',
        confirmed_at: '2026-10-03T12:00:00.000Z',
        created_at: '2026-10-03T00:00:00.000Z',
      },
    ]);
  });

  it('keeps the reference graph intact and enforces the widened CHECK on the rebuilt table', () => {
    expect(populated.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    // Seasonal profiles now insert; unknown profiles still fail.
    populated.exec(
      `INSERT INTO consumption_norms (
         id, version_label, drink_type, event_profile,
         norm_value_per_guest_per_hour, source_citation, effective_from
       ) VALUES (3, 'seasonal-occasions-fi-2026.1', 'beer', 'juhannus', 0.40, 'test citation', '2026-01-01')`,
    );
    expect(() =>
      populated.exec(
        `INSERT INTO consumption_norms (
           id, version_label, drink_type, event_profile,
           norm_value_per_guest_per_hour, source_citation, effective_from
         ) VALUES (4, 'seasonal-occasions-fi-2026.1', 'beer', 'juhannus2027', 0.40, 'test citation', '2026-01-01')`,
      ),
    ).toThrow(/CHECK constraint failed/);
  });

  it('keeps the rebuilt UNIQUE constraint upsert-ready (the seed conflict target still resolves)', () => {
    // Re-inserting an existing (drink_type, event_profile, version_label)
    // must hit the UNIQUE conflict — the seed's ON CONFLICT target —
    // not duplicate the row.
    const before = populated
      .prepare('SELECT count(*) AS n FROM consumption_norms')
      .get() as { n: number };
    expect(() =>
      populated.exec(
        `INSERT INTO consumption_norms (
           id, version_label, drink_type, event_profile,
           norm_value_per_guest_per_hour, source_citation, effective_from
         ) VALUES (99, 'seasonal-occasions-fi-2026.1', 'beer', 'juhannus', 0.40, 'test citation', '2026-01-01')`,
      ),
    ).toThrow(/UNIQUE constraint failed/);
    const after = populated
      .prepare('SELECT count(*) AS n FROM consumption_norms')
      .get() as { n: number };
    expect(after.n).toBe(before.n);
  });
});
