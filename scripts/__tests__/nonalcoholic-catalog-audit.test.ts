/**
 * Non-alcoholic catalog audit script tests (task 3.3, change
 * nonalcoholic-catalog-hygiene; design D4 — dry-run-first, audited,
 * idempotent; design D1 — hold, never delete).
 *
 * The enumeration/apply logic runs against a local in-memory SQLite with
 * every committed migration applied (the d1-test-harness mechanism —
 * requires the repo root as the vitest cwd, like the harness itself):
 * dry-run enumerates exactly the unheld zero/unknown-ABV rows and writes
 * nothing; apply flags exactly those rows with the core-domain
 * NONALCOHOLIC_HOLD_REASON token, leaving healthy rows, already-held
 * rows (either hold reason), and every `updated_at` untouched; a
 * re-apply is a no-op (held rows are outside the enumeration by
 * construction). An empty affected set is success — honest shrinkage.
 *
 * The CLI smoke test runs the script as a real tsx subprocess in
 * --db-file mode (no wrangler, no credentials): dry-run output, apply
 * output, and the idempotent re-apply through the exact commands the
 * runbook documents.
 *
 * @module NonalcoholicCatalogAuditTest
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openMigratedD1 } from '../../packages/data-platform/src/repositories/d1/__tests__/d1-test-harness';
// Token parity is asserted against the SAME module the script imports —
// not a re-typed literal.
import { NONALCOHOLIC_HOLD_REASON } from '../../packages/core-domain/src/normalization/source-category.mapper';
import {
  buildApplySql,
  collectAuditReport,
  runAudit,
  type AffectedRow,
} from '../nonalcoholic-catalog-audit';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'nonalcoholic-catalog-audit.ts');
const TSX_BIN = join(REPO_ROOT, 'packages', 'data-platform', 'node_modules', '.bin', 'tsx');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'data-platform', 'src', 'd1', 'migrations');

// ---------------------------------------------------------------------------
// Fixtures — the shapes the proposal observed in production (2026-10-04)
// ---------------------------------------------------------------------------

interface Fixture {
  readonly id: number;
  readonly name: string;
  readonly category: string;
  /** null = unknown ABV (the unparseable shape). */
  readonly abv: number | null;
  readonly ean?: string;
  /** Pre-existing hold; null = not held. */
  readonly hold?: string;
}

/**
 * 8 rows: 2 healthy, 2 already held (the guard's token + a foreign
 * reason), 4 affected — ids 2, 3, 7, 8.
 */
const FIXTURES: readonly Fixture[] = [
  { id: 1, name: 'Karhu Olut 4,7% 0,33 l', category: 'beer', abv: 0.047 },
  // The Red Bull shape: 0.0 % ABV under a fermented bucket, with an EAN.
  { id: 2, name: 'Red Bull Sugarfree tölkki 0,25 l', category: 'other_fermented', abv: 0, ean: '6401234567890' },
  // The unknown-ABV shape (unparseable).
  { id: 3, name: 'Kirsikkamehu 1 l', category: 'other_fermented', abv: null },
  // Already held by the audit's own token — excluded, never re-stamped.
  { id: 4, name: 'San Pellegrino 0,75 l', category: 'other_fermented', abv: 0, hold: NONALCOHOLIC_HOLD_REASON },
  // Held with a foreign reason — a hold is never lifted or overwritten.
  { id: 5, name: 'Mystery Row 0,5 l', category: 'beer', abv: 0, hold: 'operator_review' },
  { id: 6, name: 'Sisu Vodka 40% 0,5 l', category: 'spirits', abv: 0.4 },
  // Near-alcohol-free but branded beer (Karhu 0,0 shape) — held by design
  // (design Risks: the platform has nothing to compute for it either).
  { id: 7, name: 'Karhu 0,0 % 0,33 l', category: 'beer', abv: 0 },
  { id: 8, name: 'Ramlösa Vichy 0,5 l', category: 'wine_still', abv: null },
];

const EXPECTED_AFFECTED_IDS = [2, 3, 7, 8];

function seedProduct(db: DatabaseSync, fixture: Fixture): void {
  db.prepare(
    `INSERT INTO product_master (id, name, manufacturer, brand, category,
        alcohol_by_volume, unit_volume, container_type, regulatory_classification,
        ean, review_hold_reason)
     VALUES (?, ?, 'Merchant', 'Brand', ?, ?, 0.33, 'can', 'beer', ?, ?)`,
  ).run(
    fixture.id,
    fixture.name,
    fixture.category,
    fixture.abv,
    fixture.ean ?? null,
    fixture.hold ?? null,
  );
}

function seedFixtures(db: DatabaseSync): void {
  for (const fixture of FIXTURES) seedProduct(db, fixture);
}

/** Minimal D1Backend over a raw node:sqlite handle (the SqliteBackend shape). */
function sqliteBackendOf(db: DatabaseSync) {
  return {
    label: 'test:memory',
    query: (sql: string) => db.prepare(sql).all() as unknown as Record<string, unknown>[],
    execute: (sql: string) => Number(db.prepare(sql).run().changes),
    close: () => db.close(),
  };
}

interface RowState {
  readonly hold: string | null;
  readonly updatedAt: string;
}

function rowState(db: DatabaseSync, id: number): RowState {
  const row = db
    .prepare('SELECT review_hold_reason AS hold, updated_at AS updated FROM product_master WHERE id = ?')
    .get(id) as { hold: string | null; updated: string };
  return { hold: row.hold, updatedAt: row.updated };
}

function allStates(db: DatabaseSync): Map<number, RowState> {
  const states = new Map<number, RowState>();
  for (const fixture of FIXTURES) states.set(fixture.id, rowState(db, fixture.id));
  return states;
}

// ---------------------------------------------------------------------------
// Enumeration / dry-run / apply / idempotence (in-memory, migrated)
// ---------------------------------------------------------------------------

describe('nonalcoholic-catalog-audit enumeration', () => {
  it('enumerates exactly the unheld zero/unknown-ABV rows with per-category counts', () => {
    const { db } = openMigratedD1();
    seedFixtures(db);
    const report = collectAuditReport(sqliteBackendOf(db));

    expect(report.affected.map((row: AffectedRow) => row.id)).toEqual(EXPECTED_AFFECTED_IDS);
    expect(report.totalRows).toBe(FIXTURES.length);
    expect(report.heldRows).toBe(2);
    expect(report.categoryCounts).toEqual([
      { category: 'other_fermented', rows: 2 },
      { category: 'beer', rows: 1 },
      { category: 'wine_still', rows: 1 },
    ]);
    // The sampled fields carry what the operator reviews.
    const redbull = report.affected[0] as AffectedRow;
    expect(redbull).toMatchObject({
      id: 2,
      name: 'Red Bull Sugarfree tölkki 0,25 l',
      category: 'other_fermented',
      alcoholByVolume: 0,
      ean: '6401234567890',
    });
  });

  it('dry-run (apply: false) writes nothing and exits 0', () => {
    const { db } = openMigratedD1();
    seedFixtures(db);
    const before = allStates(db);

    const exit = runAudit(sqliteBackendOf(db), { apply: false, sample: 2 });

    expect(exit).toBe(0);
    expect(allStates(db)).toEqual(before);
  });

  it('an empty affected set is success (honest shrinkage)', () => {
    const { db } = openMigratedD1();
    // Fresh migrated catalog, zero products: the post-cleanup end state.
    const exit = runAudit(sqliteBackendOf(db), { apply: true, sample: 5 });
    const report = collectAuditReport(sqliteBackendOf(db));
    expect(exit).toBe(0);
    expect(report.affected).toHaveLength(0);
  });
});

describe('nonalcoholic-catalog-audit apply', () => {
  it('holds exactly the affected rows with the core-domain token', () => {
    const { db } = openMigratedD1();
    seedFixtures(db);
    const before = allStates(db);

    const exit = runAudit(sqliteBackendOf(db), { apply: true, sample: 10 });

    expect(exit).toBe(0);
    for (const id of EXPECTED_AFFECTED_IDS) {
      expect(rowState(db, id).hold).toBe(NONALCOHOLIC_HOLD_REASON);
    }
    // Healthy rows stay unheld; existing holds are neither lifted nor
    // re-stamped; updated_at never churns (hold is not a freshness event).
    expect(rowState(db, 1).hold).toBeNull();
    expect(rowState(db, 6).hold).toBeNull();
    expect(rowState(db, 4).hold).toBe(NONALCOHOLIC_HOLD_REASON);
    expect(rowState(db, 5).hold).toBe('operator_review');
    for (const fixture of FIXTURES) {
      expect(rowState(db, fixture.id).updatedAt).toBe(before.get(fixture.id)?.updatedAt);
    }
  });

  it('re-running apply is a no-op', () => {
    const { db } = openMigratedD1();
    seedFixtures(db);
    runAudit(sqliteBackendOf(db), { apply: true, sample: 0 });
    const afterFirst = allStates(db);

    const report = collectAuditReport(sqliteBackendOf(db));
    const exit = runAudit(sqliteBackendOf(db), { apply: true, sample: 0 });

    expect(report.affected).toHaveLength(0);
    expect(exit).toBe(0);
    expect(allStates(db)).toEqual(afterFirst);
  });
});

describe('buildApplySql', () => {
  it('guards on the hold column and chunks ids', () => {
    const single = buildApplySql([2, 3]);
    expect(single).toHaveLength(1);
    expect(single[0]).toContain('review_hold_reason IS NULL');
    expect(single[0]).toContain(`review_hold_reason = '${NONALCOHOLIC_HOLD_REASON}'`);
    expect(single[0]).toContain('id IN (2, 3)');

    const chunked = buildApplySql(Array.from({ length: 501 }, (_, i) => i + 1));
    expect(chunked).toHaveLength(2);
  });

  it('emits nothing for an empty id set', () => {
    expect(buildApplySql([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CLI smoke test — the exact commands the runbook documents, --db-file mode
// ---------------------------------------------------------------------------

/**
 * A migrated SQLite FILE for --db-file (the harness opens :memory: only),
 * migrations applied with the same statement-breakpoint discipline.
 */
function openMigratedFile(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) db.exec(trimmed);
    }
  }
  return db;
}

describe('nonalcoholic-catalog-audit CLI', () => {
  let dbFile = '';

  beforeAll(() => {
    dbFile = join(mkdtempSync(join(tmpdir(), 'nonalcoholic-audit-')), 'catalog.sqlite');
    const seedDb = openMigratedFile(dbFile);
    seedFixtures(seedDb);
    seedDb.close();
  });

  function runCli(args: readonly string[]): { status: number | null; stdout: string } {
    const result = spawnSync(TSX_BIN, [SCRIPT_PATH, '--db-file', dbFile, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    return { status: result.status, stdout: result.stdout ?? '' };
  }

  it('dry-run is the default: reports the affected set, writes nothing, exits 0', () => {
    const { status, stdout } = runCli(['--sample', '2']);

    expect(status).toBe(0);
    expect(stdout).toContain('DRY-RUN');
    expect(stdout).toContain('nothing written');
    expect(stdout).toContain('affected rows (not held, ABV zero/negative/unknown): 4');
    expect(stdout).toContain('other_fermented=2, beer=1, wine_still=1');
    expect(stdout).toContain('id=2 "Red Bull Sugarfree tölkki 0,25 l"');
    expect(stdout).toContain('apply would set');
    // Nothing was held by the dry-run: the only token-held row is the
    // pre-existing fixture 4 (id 5 holds a foreign reason).
    const db = new DatabaseSync(dbFile);
    const held = db
      .prepare('SELECT COUNT(*) AS n FROM product_master WHERE review_hold_reason = ?')
      .get(NONALCOHOLIC_HOLD_REASON) as { n: number };
    db.close();
    expect(held.n).toBe(1);
  });

  it('apply holds exactly the enumerated rows and reports idempotence', () => {
    const { status, stdout } = runCli(['--apply']);

    expect(status).toBe(0);
    expect(stdout).toContain('APPLY');
    expect(stdout).toContain(`applied: 4 row(s) now held with '${NONALCOHOLIC_HOLD_REASON}'`);
    expect(stdout).toContain('re-enumeration finds 0 remaining');
    const db = new DatabaseSync(dbFile);
    const held = db
      .prepare(`SELECT COUNT(*) AS n FROM product_master WHERE review_hold_reason = ?`)
      .get(NONALCOHOLIC_HOLD_REASON) as { n: number };
    const foreign = db
      .prepare(`SELECT COUNT(*) AS n FROM product_master WHERE review_hold_reason = 'operator_review'`)
      .get() as { n: number };
    db.close();
    // 4 newly held + the pre-existing fixture 4; the foreign hold is intact.
    expect(held.n).toBe(5);
    expect(foreign.n).toBe(1);
  });

  it('re-running apply is a no-op exit 0 (held rows are outside the enumeration)', () => {
    const { status, stdout } = runCli(['--apply']);

    expect(status).toBe(0);
    expect(stdout).toContain('affected rows: 0 — nothing to apply');
  });
});
