/**
 * Catalog-wide name-quality classification script tests (task 1.1,
 * change product-name-quality-gate).
 *
 * The classification fixtures are the live-derived forms from the
 * 2026-10-15 measurement (proposal + task 2.2's test family): the
 * empty and whitespace names, "40 %", "70 cl", "ÀN 2022", the
 * annotated Glenfarclas collector form, an annotation-only name (the
 * quarantined-AND-annotated corner), a pack parenthetical that must
 * never strip, and a quote-carrying normal name. Every verdict must
 * come from the canonical gate the script imports
 * (packages/data-acquisition name-quality.ts) — the tests pin the
 * wiring, not the predicates.
 *
 * The CLI smoke tests run the script as a real `tsx` subprocess
 * against a synthetic node:sqlite fixture (10 rows, minimal
 * product_master shape — no wrangler, no credentials): --stats counts,
 * --dry-run artifact shape, apply's writes + verification, and
 * apply's idempotent re-run (zero statements).
 *
 * @module ClassifyProductNameQualityTest
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  allStatements,
  buildArtifact,
  buildWritePlan,
  chunkIds,
  classifyRow,
  compareWithSample,
  computeStats,
  parseArgs,
  serializeArtifact,
  sqlLiteral,
  CHUNK_IDS,
} from '../classify-product-name-quality';
import type { ClassifiedRow, ClassificationArtifact, RawRow } from '../classify-product-name-quality';

const SCRIPT_PATH = fileURLToPath(new URL('../classify-product-name-quality.ts', import.meta.url));
const TSX_BIN = fileURLToPath(
  new URL('../../packages/data-platform/node_modules/.bin/tsx', import.meta.url),
);

/** Minimal fixture shape — only the columns the script reads or writes. */
const FIXTURE_SCHEMA = `
  CREATE TABLE product_master (
    id integer PRIMARY KEY NOT NULL,
    name text(512) NOT NULL,
    name_quality text(32) NOT NULL DEFAULT 'ok',
    name_annotation text
  )`;

/** The live-derived fixture family: id → name (id order is deterministic). */
const FIXTURE_ROWS: ReadonlyArray<readonly [number, string]> = [
  [1, 'Macallan Double Cask 12 Year Old'],
  [2, ''],
  [3, '   '],
  [4, '40 %'],
  [5, '70 cl'],
  [6, 'ÀN 2022'],
  [7, 'Glenfarclas 70 Year Old Single Malt (saatavuus 1 plo)'],
  [8, '(saatavuus 1 plo)'],
  [9, 'Karhu (24 x 0,33 l)'],
  [10, "Pierre's Extra 7% 0,7 l"],
];

function row(id: number, name: string, quality = 'ok', annotation: string | null = null): RawRow {
  return { id, name, storedQuality: quality, storedAnnotation: annotation };
}

// ---------------------------------------------------------------------------
// Classification wiring — canonical module, reporting split
// ---------------------------------------------------------------------------

describe('classifyRow — canonical-gate wiring over the fixture family', () => {
  const classified = FIXTURE_ROWS.map(([id, name]) => classifyRow(row(id, name)));

  it('quarantines the empty, whitespace, and token-only forms', () => {
    const ids = (name: string): number[] =>
      classified.filter((r) => r.name === name && r.quality === 'quarantined').map((r) => r.id);
    expect(ids('')).toEqual([2]);
    expect(ids('   ')).toEqual([3]);
    expect(ids('40 %')).toEqual([4]);
    expect(ids('70 cl')).toEqual([5]);
    expect(ids('ÀN 2022')).toEqual([6]);
  });

  it('keeps the annotated Glenfarclas form ok with its stripped display name', () => {
    const glenfarclas = classified.find((r) => r.id === 7);
    expect(glenfarclas?.quality).toBe('ok');
    expect(glenfarclas?.annotation).toBe('saatavuus 1 plo');
    expect(glenfarclas?.displayName).toBe('Glenfarclas 70 Year Old Single Malt');
  });

  it('flags the annotation-only name as BOTH quarantined and annotated', () => {
    const annotationOnly = classified.find((r) => r.id === 8);
    expect(annotationOnly?.quality).toBe('quarantined');
    // `empty` reports the RAW name; the annotation-only row is
    // non-informative (its stripped alphabetic residue is empty) but
    // its raw name is not.
    expect(annotationOnly?.empty).toBe(false);
    expect(annotationOnly?.displayName).toBe('');
    expect(annotationOnly?.annotation).toBe('saatavuus 1 plo');
  });

  it('never strips pack parentheticals', () => {
    const karhu = classified.find((r) => r.id === 9);
    expect(karhu?.quality).toBe('ok');
    expect(karhu?.annotation).toBeNull();
    expect(karhu?.displayName).toBe('Karhu (24 x 0,33 l)');
  });
});

describe('computeStats — the empty / non-informative split', () => {
  it('splits quarantined into empty and non-informative over the fixture family', () => {
    const classified = FIXTURE_ROWS.map(([id, name]) => classifyRow(row(id, name)));
    const stats = computeStats(classified, 0);
    expect(stats).toEqual({
      total: 10,
      empty: 2,          // '' and '   '
      nonInformative: 4, // '40 %', '70 cl', 'ÀN 2022', '(saatavuus 1 plo)'
      quarantined: 6,
      annotated: 2,      // Glenfarclas + annotation-only
      ok: 4,
      skippedMalformed: 0,
    });
  });
});

describe('compareWithSample — advisory divergence flag', () => {
  it('flags a metric only beyond 3x the sample rate', () => {
    // 10 non-informative of exactly 1,425 rows ≈ 0.70% — above the
    // 3x line for the non-informative sample rate (3 × 0.14 % = 0.42 %).
    const rows: ClassifiedRow[] = [
      ...Array.from({ length: 1415 }, (_, i): ClassifiedRow =>
        classifyRow(row(i + 1, `Brand Name ${i} 40%`))),
      ...Array.from({ length: 10 }, (_, i): ClassifiedRow =>
        classifyRow(row(10_000 + i, '70 cl'))),
    ];
    const stats = computeStats(rows, 0);
    expect(stats.total).toBe(1425);
    const comparison = compareWithSample(stats);
    expect(comparison.divergent).toBe(true);
    const nonInformative = comparison.entries.find((e) => e.metric === 'non-informative');
    expect(nonInformative?.divergent).toBe(true);
    expect(nonInformative?.catalogRatePct).toBeCloseTo(0.7018, 4);
    // The ok rows' metrics stay near the sample: zero empty, zero annotated.
    expect(comparison.entries.find((e) => e.metric === 'empty')?.divergent).toBe(false);
  });

  it('stays quiet when catalog rates sit near the sample', () => {
    // 3 annotated of 1,425 ≈ 0.21% — exactly the sample rate.
    const rows: ClassifiedRow[] = Array.from({ length: 1425 }, (_, i): ClassifiedRow =>
      classifyRow(row(i + 1, i < 3 ? 'Glenfarclas 70 Year Old Single Malt (saatavuus 1 plo)' : `Brand ${i} 40%`)));
    const comparison = compareWithSample(computeStats(rows, 0));
    expect(comparison.divergent).toBe(false);
    const annotated = comparison.entries.find((e) => e.metric === 'annotated');
    expect(annotated?.ratio).toBeCloseTo(1.0, 2);
  });
});

// ---------------------------------------------------------------------------
// Artifact shape — the task-4.1 verification baseline
// ---------------------------------------------------------------------------

describe('buildArtifact + serializeArtifact', () => {
  const classified = FIXTURE_ROWS.map(([id, name]) => classifyRow(row(id, name)));
  const stats = computeStats(classified, 0);
  const comparison = compareWithSample(stats);
  const artifact = buildArtifact(
    classified,
    stats,
    comparison,
    { kind: 'db-file', dbFile: '/tmp/fixture.db' },
    '2026-10-15T12:00:00.000Z',
  );

  it('carries the task-mandated shape', () => {
    expect(artifact.generatedAt).toBe('2026-10-15T12:00:00.000Z');
    expect(artifact.sourceCounts.total).toBe(10);
    expect(artifact.quarantinedProductIds).toEqual([2, 3, 4, 5, 6, 8]);
    expect(artifact.annotatedProductIds).toEqual([
      { id: 7, annotation: 'saatavuus 1 plo', displayName: 'Glenfarclas 70 Year Old Single Malt' },
      { id: 8, annotation: 'saatavuus 1 plo', displayName: '' },
    ]);
  });

  it('serializes to parseable JSON with identical contents', () => {
    const parsed = JSON.parse(serializeArtifact(artifact)) as ClassificationArtifact;
    expect(parsed.sourceCounts.quarantined).toBe(6);
    expect(parsed.quarantinedProductIds).toHaveLength(6);
    expect(parsed.annotatedProductIds).toHaveLength(2);
    expect(parsed.target).toBe('db-file:/tmp/fixture.db');
    expect(parsed.classifier).toContain('name-quality.ts');
  });
});

// ---------------------------------------------------------------------------
// Write plan — idempotent diff, tight column scope, batching
// ---------------------------------------------------------------------------

describe('buildWritePlan', () => {
  it('emits quarantine IN-lists chunked at CHUNK_IDS and per-row annotated UPDATEs', () => {
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    const rows = ids.map((id): ClassifiedRow => classifyRow(row(id, '70 cl')));
    const plan = buildWritePlan(rows);
    expect(plan.quarantineIds).toHaveLength(250);
    expect(plan.quarantineStatements).toHaveLength(3); // 100 + 100 + 50
    expect(plan.quarantineStatements[0]).toMatch(
      new RegExp(`^UPDATE product_master SET name_quality = 'quarantined' WHERE id IN \\((?:\\d+, ){99}\\d+\\);$`),
    );
    expect(chunkIds(ids, CHUNK_IDS)).toHaveLength(3);
    expect(plan.annotatedRows).toHaveLength(0);
  });

  it('rewrites only the touched columns for annotated rows and escapes quotes', () => {
    const plan = buildWritePlan([classifyRow(row(7, "Pierre's 12 (saatavuus 1 plo)"))]);
    expect(plan.annotatedStatements).toEqual([
      `UPDATE product_master SET name = 'Pierre''s 12', name_annotation = 'saatavuus 1 plo' WHERE id = 7;`,
    ]);
    expect(sqlLiteral("a'b")).toBe(`'a''b'`);
    expect(allStatements(plan)).toHaveLength(1);
  });

  it('is a no-op when stored state already matches the classification', () => {
    const plan = buildWritePlan([
      classifyRow(row(1, 'Macallan Double Cask 12 Year Old')),
      classifyRow(row(2, '70 cl', 'quarantined')),
      classifyRow(row(7, 'Glenfarclas 70 Year Old Single Malt', 'ok', 'saatavuus 1 plo')),
    ]);
    expect(plan.quarantineIds).toHaveLength(0);
    expect(plan.quarantineStatements).toHaveLength(0);
    expect(plan.annotatedRows).toHaveLength(0);
    expect(allStatements(plan)).toHaveLength(0);
  });

  it('writes the quarantined-AND-annotated row through both disjoint statements', () => {
    const plan = buildWritePlan([classifyRow(row(8, '(saatavuus 1 plo)'))]);
    expect(plan.quarantineIds).toEqual([8]);
    expect(plan.annotatedStatements).toEqual([
      `UPDATE product_master SET name = '', name_annotation = 'saatavuus 1 plo' WHERE id = 8;`,
    ]);
  });
});

// ---------------------------------------------------------------------------
// parseArgs — mode resolution and the --yes gate
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('defaults to apply mode with the gitignored artifact path', () => {
    const options = parseArgs(['--local']);
    expect(options.mode).toBe('apply');
    expect(options.yes).toBe(false);
    expect(options.outPath).toMatch(/scripts[/\\]out[/\\]classify-product-name-quality\.json$/);
  });

  it('accepts every target form and validates --env', () => {
    expect(parseArgs(['--stats', '--local']).target).toEqual({ kind: 'local' });
    expect(parseArgs(['--remote', '--env', 'staging']).target).toEqual({ kind: 'remote', env: 'staging' });
    expect(parseArgs(['--db-file', 'x.db']).target).toEqual({ kind: 'db-file', dbFile: 'x.db' });
  });

  it('rejects exclusive-mode violations, bad envs, and stray --yes', () => {
    expect(() => parseArgs(['--stats', '--dry-run', '--local'])).toThrow(/mutually exclusive/);
    expect(() => parseArgs(['--remote'])).toThrow(/--env/);
    expect(() => parseArgs(['--remote', '--env', 'dev'])).toThrow(/staging.*production/);
    expect(() => parseArgs(['--env', 'staging'])).toThrow(/--remote/);
    expect(() => parseArgs(['--db-file'])).toThrow(/path/);
    expect(() => parseArgs([])).toThrow(/target/);
    expect(() => parseArgs(['--yes', '--stats', '--local'])).toThrow(/--yes/);
    expect(() => parseArgs(['--wat', '--local'])).toThrow(/unknown option/);
  });

  it('keeps --yes legal only for apply', () => {
    expect(parseArgs(['--apply', '--yes', '--local']).yes).toBe(true);
    expect(parseArgs(['--yes', '--local']).mode).toBe('apply');
  });
});

// ---------------------------------------------------------------------------
// CLI smoke — tsx subprocess over a synthetic node:sqlite fixture
// ---------------------------------------------------------------------------

describe('CLI smoke (tsx subprocess, --db-file, no wrangler)', () => {
  let workDir: string;
  let dbPath: string;

  const buildDb = (): void => {
    const db = new DatabaseSync(dbPath);
    db.exec(FIXTURE_SCHEMA);
    const insert = db.prepare(
      'INSERT INTO product_master (id, name, name_quality, name_annotation) VALUES (?, ?, ?, ?)',
    );
    for (const [id, name] of FIXTURE_ROWS) insert.run(id, name, 'ok', null);
    db.close();
  };

  const run = (args: string[]): ReturnType<typeof spawnSync> =>
    spawnSync(TSX_BIN, [SCRIPT_PATH, '--db-file', dbPath, ...args], {
      encoding: 'utf8',
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
    });

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'name-quality-smoke-'));
    dbPath = join(workDir, 'catalog.db');
    buildDb();
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('--stats prints the classification counts and exits 0', () => {
    const result = run(['--stats']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('mode stats');
    expect(result.stdout).toContain('classified 10 rows (skipped malformed: 0)');
    expect(result.stdout).toContain('empty:           2');
    expect(result.stdout).toContain('non-informative: 4');
    expect(result.stdout).toContain('annotated (stays ok, name stripped): 2');
    expect(result.stdout).toContain('ok: 4');
  });

  it('--dry-run writes the artifact + SQL and nothing else', () => {
    const outPath = join(workDir, 'dry-run.json');
    const result = run(['--dry-run', '--out', outPath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('nothing executed yet');
    expect(result.stdout).toContain('dry run: no statements executed.');

    const artifact = JSON.parse(readFileSync(outPath, 'utf8')) as ClassificationArtifact;
    expect(artifact.sourceCounts).toEqual({
      total: 10,
      empty: 2,
      nonInformative: 4,
      quarantined: 6,
      annotated: 2,
      ok: 4,
      skippedMalformed: 0,
    });
    expect(artifact.quarantinedProductIds).toEqual([2, 3, 4, 5, 6, 8]);
    expect(artifact.annotatedProductIds).toEqual([
      { id: 7, annotation: 'saatavuus 1 plo', displayName: 'Glenfarclas 70 Year Old Single Malt' },
      { id: 8, annotation: 'saatavuus 1 plo', displayName: '' },
    ]);

    const sql = readFileSync(join(workDir, 'classify-product-name-quality.sql'), 'utf8');
    expect(sql).toContain(
      `UPDATE product_master SET name_quality = 'quarantined' WHERE id IN (2, 3, 4, 5, 6, 8);`,
    );
    expect(sql).toContain(
      `UPDATE product_master SET name = 'Glenfarclas 70 Year Old Single Malt', `
      + `name_annotation = 'saatavuus 1 plo' WHERE id = 7;`,
    );
  });

  it('apply without --yes behaves as --dry-run', () => {
    const result = run(['--out', join(workDir, 'no-yes.json')]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('apply requested without --yes');
    expect(result.stdout).toContain('dry run: no statements executed.');
    // Nothing written.
    const db = new DatabaseSync(dbPath);
    const quarantined = db.prepare(`SELECT COUNT(*) AS n FROM product_master WHERE name_quality = 'quarantined'`).get() as { n: number };
    db.close();
    expect(quarantined.n).toBe(0);
  });

  it('apply --yes writes, verifies, and is an idempotent no-op on re-run', () => {
    const first = run(['--apply', '--yes', '--out', join(workDir, 'apply.json')]);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('about to write (diff against stored state): 6 quarantine row(s) in 1 IN-list statement(s), 2 annotated row(s) rewritten individually');
    expect(first.stdout).toContain('executed 3/3 statement(s)');
    expect(first.stdout).toContain('expected      4  actual      4  MATCH');
    expect(first.stdout).toContain('expected      6  actual      6  MATCH');
    expect(first.stdout).toContain('verification PASSED');

    const db = new DatabaseSync(dbPath);
    const stored = (id: number): { name: string; name_quality: string; name_annotation: string | null } =>
      db.prepare('SELECT name, name_quality, name_annotation FROM product_master WHERE id = ?').get(id) as {
        name: string;
        name_quality: string;
        name_annotation: string | null;
      };
    expect(stored(7)).toEqual({
      name: 'Glenfarclas 70 Year Old Single Malt',
      name_quality: 'ok',
      name_annotation: 'saatavuus 1 plo',
    });
    expect(stored(8)).toEqual({ name: '', name_quality: 'quarantined', name_annotation: 'saatavuus 1 plo' });
    // Pack parenthetical survives; the quote-carrying name is untouched.
    expect(stored(9).name).toBe('Karhu (24 x 0,33 l)');
    expect(stored(10).name).toBe("Pierre's Extra 7% 0,7 l");
    db.close();

    // Idempotency: the re-run classifies identically but writes nothing.
    const second = run(['--apply', '--yes', '--out', join(workDir, 'apply-2.json')]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('nothing to write — stored state already matches the classification (idempotent no-op)');
    expect(second.stdout).toContain('verification PASSED');
  });
});
