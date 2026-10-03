/**
 * Category reclassification script tests (task 1.2, change
 * first-impression-pass).
 *
 * The 26-row fixture family pins the production snapshot the audit
 * attributed: products above the EU intermediate-products boundary
 * stored under the fermented duty key from keyword source categories
 * ("Muut juomat" ×17, "Juomasekoitus" ×2, "Other drinks" ×1 in the
 * live audit; the snapshot totals 26 — catalog drift is expected, the
 * count is never hard-coded). Every family row must re-derive to
 * spirits through the SAME guarded mapper ingestion uses, with
 * `regulatory_classification` healed alongside `category` and
 * `updated_at` untouched. Already-correct rows — including
 * above-boundary spirits and every non-fermented bucket at any ABV —
 * must produce zero statements, and re-running on the post-apply state
 * is a no-op (idempotence). Rows without a usable ABV cannot key the
 * guard and are counted as honest unknowns, never guessed; unknown
 * stored keys and wrong-scale ABVs are refused and listed.
 *
 * The CLI smoke test runs the script as a real `node
 * --experimental-strip-types` subprocess in --stats mode (no SQL
 * artifact is written) — pinning the module-resolution hooks that let
 * the script load the core-domain source chain without a build.
 *
 * @module ReclassifyCategoryTest
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  asAbvFraction,
  buildUpdate,
  classify,
  loadMapper,
  loadRows,
  runReclassification,
  STORED_KEY_TO_CANONICAL,
} from '../reclassify-category.mts';
import type { BackfillRow } from '../reclassify-category.mts';

const SCRIPT_PATH = fileURLToPath(new URL('../reclassify-category.mts', import.meta.url));

// ---------------------------------------------------------------------------
// Fixture family — the 26-row production snapshot
// ---------------------------------------------------------------------------

/** The live audit's keyword-hit mix plus the snapshot residue: 26 rows. */
const FAMILY_KEYWORD_MIX: ReadonlyArray<{ keyword: string; count: number }> = [
  { keyword: 'Muut juomat', count: 17 }, // FI "other drinks"
  { keyword: 'Juomasekoitus', count: 2 }, // FI premixed
  { keyword: 'Other drinks', count: 1 }, // EN
  { keyword: 'snapshot residue', count: 6 }, // production snapshot totals 26
];

/** Anchored names: the audit's named family members. */
const ANCHORED_NAMES: ReadonlyArray<{ name: string; fraction: number }> = [
  { name: 'Lignell Akvavit 41% 0,5 l', fraction: 0.41 },
  { name: 'Antica Sambuca 38% 0,7 l', fraction: 0.38 },
  { name: 'Arrak 58% 0,5 l', fraction: 0.58 },
];

function familyRows(): BackfillRow[] {
  const rows: BackfillRow[] = [];
  let id = 4100;
  let anchorIndex = 0;
  for (const { keyword, count } of FAMILY_KEYWORD_MIX) {
    for (let i = 0; i < count; i++) {
      const anchor = ANCHORED_NAMES[anchorIndex];
      const name = anchor !== undefined
        ? anchor.name
        : `${keyword} ${id} ${24 + (id % 20)}% 0,5 l`;
      const fraction = anchor !== undefined ? anchor.fraction : 0.24 + ((id % 20) / 100);
      if (anchor !== undefined) anchorIndex += 1;
      rows.push({
        id: id++,
        name,
        category: 'other_fermented',
        abvRaw: fraction,
      });
    }
  }
  return rows;
}

/** Already-correct rows: zero diff at their ABV, boundary or not. */
const CORRECT_ROWS: ReadonlyArray<BackfillRow> = [
  { id: 201, name: 'Karhu Olut 4.7% 0,33 l', category: 'beer', abvRaw: 0.047 },
  { id: 202, name: 'Katkero 30% 0,5 l', category: 'spirits', abvRaw: 0.30 },
  { id: 203, name: 'Sisu Vodka 40% 0,5 l', category: 'spirits', abvRaw: 0.40 },
  { id: 204, name: 'Apu Long Drink 5,5% 0,33 l', category: 'other_fermented', abvRaw: 0.055 },
  { id: 205, name: 'Siideri 4,7% 0,33 l', category: 'other_fermented', abvRaw: 0.047 },
  { id: 206, name: 'Wolfie Long Drink 8,5% 0,33 l', category: 'other_fermented', abvRaw: 0.085 },
  // The boundary is strict: exactly 22 % is still the fermented bucket.
  { id: 207, name: 'Jaloviina 22% 0,5 l', category: 'other_fermented', abvRaw: 0.22 },
  // Non-fermented buckets pass through unchanged at ANY ABV — the guard
  // never re-keys them, so re-ingestion and this script agree.
  { id: 208, name: 'Portviini 20% 0,75 l', category: 'intermediate_products', abvRaw: 0.20 },
  { id: 209, name: 'Kuohuviini 12% 0,75 l', category: 'wine_sparkling', abvRaw: 0.12 },
  { id: 210, name: 'Punaviini 13,5% 0,75 l', category: 'wine_still', abvRaw: 0.135 },
  // An above-boundary akvavit already keyed spirits by its keyword.
  { id: 211, name: 'Akvavit 41% 0,5 l', category: 'spirits', abvRaw: 0.41 },
];

/** Honest unknowns: the guard cannot key without a usable ABV. */
const CANNOT_KEY_ROWS: ReadonlyArray<BackfillRow> = [
  { id: 301, name: 'Lonkero 0,5 l', category: 'other_fermented', abvRaw: null },
  { id: 302, name: 'Other Drinks Mix 0,33 l', category: 'other_fermented', abvRaw: '' },
];

/** Refused rows: never guessed, listed in the report. */
const REFUSED_ROWS: ReadonlyArray<BackfillRow> = [
  // Percent-scale value — rescaling would be a guessed unit conversion.
  { id: 401, name: 'Mystery 41', category: 'other_fermented', abvRaw: 41 },
  { id: 402, name: 'Lahjakortti', category: 'giftcard', abvRaw: null },
];

function fullDump(): BackfillRow[] {
  return [...familyRows(), ...CORRECT_ROWS, ...CANNOT_KEY_ROWS, ...REFUSED_ROWS];
}

const serializeDump = (rows: ReadonlyArray<BackfillRow>): string =>
  JSON.stringify(rows.map(({ id, name, category, abvRaw }) => ({
    id, name, category, alcohol_by_volume: abvRaw,
  })));

describe('reclassify-category — guarded-mapper decisions (real mapper)', () => {
  let mapper: Awaited<ReturnType<typeof loadMapper>>;
  let report: ReturnType<typeof runReclassification>;

  beforeAll(async () => {
    mapper = await loadMapper();
    report = runReclassification(fullDump(), 0, mapper);
  });

  it('re-derives the whole 26-row fixture family to spirits', () => {
    expect(report.updates).toHaveLength(26);
    for (const decision of report.updates) {
      expect(decision.stored).toBe('other_fermented');
      expect(decision.derived).toBe('spirits');
      // Every family update is attributable to the boundary rule —
      // keyword outcomes carry the spirit family at any ABV, so a
      // fermented-key row reaching spirits here is always the ceiling.
      expect(decision.boundaryApplied).toBe(true);
    }
  });

  it('anchors the audit-named members — akvavit 41 %, sambuca 38 %, arrak 58 %', () => {
    const byId = new Map(report.updates.map((d) => [d.id, d]));
    expect(byId.get(4100)?.name).toBe('Lignell Akvavit 41% 0,5 l');
    expect(byId.get(4100)?.derived).toBe('spirits');
    expect(byId.get(4101)?.name).toBe('Antica Sambuca 38% 0,7 l');
    expect(byId.get(4102)?.name).toBe('Arrak 58% 0,5 l');
    expect(byId.get(4102)?.derived).toBe('spirits');
    expect(byId.get(4101)?.abv).toBe(0.38);
    expect(byId.get(4102)?.abv).toBe(0.58);
  });

  it('emits zero statements for already-correct rows at every ABV', () => {
    const updateIds = new Set(report.updates.map((d) => d.id));
    for (const row of CORRECT_ROWS) {
      expect(updateIds.has(row.id)).toBe(false);
    }
    expect(report.correct.map((d) => d.id)).toEqual(CORRECT_ROWS.map((r) => r.id));
  });

  it('counts no-ABV fermented rows as cannot-key honest unknowns — never updates them', () => {
    expect(report.cannotKey.map((d) => d.id)).toEqual([301, 302]);
    expect(report.statements.join('\n')).not.toContain('WHERE id = 301');
  });

  it('refuses unknown stored keys and wrong-scale ABVs, listing both', () => {
    expect(report.refused.map((d) => d.id)).toEqual([401, 402]);
    expect(report.refused[0]?.refusal).toContain('0–1 fraction scale');
    expect(report.refused[1]?.refusal).toContain('six product_master category keys');
    expect(report.statements).toHaveLength(26);
  });

  it('pins the boundary through the script path: 0.22 stays, 0.220001 moves', () => {
    const atBoundary = classify(
      { id: 501, name: 'x 22% 0,5 l', category: 'other_fermented', abvRaw: 0.22 },
      mapper,
    );
    const pastBoundary = classify(
      { id: 502, name: 'x 22,0001% 0,5 l', category: 'other_fermented', abvRaw: 0.220001 },
      mapper,
    );
    expect(atBoundary.outcome).toBe('correct');
    expect(pastBoundary.outcome).toBe('update');
    expect(pastBoundary.derived).toBe('spirits');
  });

  it('is idempotent — the post-apply state re-derives to zero statements', () => {
    const applied = fullDump().map((row) => ({
      ...row,
      category: report.updates.some((d) => d.id === row.id) ? 'spirits' : row.category,
    }));
    const rerun = runReclassification(applied, 0, mapper);
    expect(rerun.statements).toEqual([]);
    expect(rerun.updates).toHaveLength(0);
    // The corrected family rows now read already-correct spirits.
    expect(rerun.correct).toHaveLength(CORRECT_ROWS.length + 26);
  });
});

describe('reclassify-category — emitted SQL', () => {
  let mapper: Awaited<ReturnType<typeof loadMapper>>;

  beforeAll(async () => {
    mapper = await loadMapper();
  });

  it('heals category AND regulatory_classification together, never updated_at', () => {
    const { statements } = runReclassification(
      [{ id: 9001, name: 'Akvavit 41% 0,5 l', category: 'other_fermented', abvRaw: 0.41 }],
      0,
      mapper,
    );
    expect(statements).toEqual([
      "UPDATE product_master SET category = 'spirits', regulatory_classification = 'spirits' WHERE id = 9001;",
    ]);
    expect(statements.join('\n').toLowerCase()).not.toContain('updated_at');
  });

  it('escapes non-integer ids as quoted literals', () => {
    const statement = buildUpdate({
      id: 'weird-id',
      name: 'x',
      stored: 'other_fermented',
      abv: 0.41,
      outcome: 'update',
      derived: 'spirits',
      boundaryApplied: true,
      refusal: null,
    });
    expect(statement).toBe(
      "UPDATE product_master SET category = 'spirits', regulatory_classification = 'spirits' WHERE id = 'weird-id';",
    );
  });
});

describe('reclassify-category — input shapes', () => {
  const rows = fullDump();

  it('reads a bare array', () => {
    const { rows: parsed, skipped } = loadRows(serializeDump(rows));
    expect(parsed).toHaveLength(rows.length);
    expect(skipped).toBe(0);
  });

  it('reads a {"rows": [...]} envelope', () => {
    const { rows: parsed } = loadRows(JSON.stringify({ rows: JSON.parse(serializeDump(rows)) }));
    expect(parsed).toHaveLength(rows.length);
  });

  it('reads a wrangler --json envelope', () => {
    const payload = JSON.stringify([
      { results: JSON.parse(serializeDump(rows)), success: true },
    ]);
    const { rows: parsed } = loadRows(payload);
    expect(parsed).toHaveLength(rows.length);
  });

  it('counts structurally invalid rows as skipped, never decisions', () => {
    const { rows: parsed, skipped } = loadRows(JSON.stringify([
      { id: 1, name: 'ok', category: 'beer', alcohol_by_volume: 0.047 },
      { name: 'no id', category: 'beer', alcohol_by_volume: 0.047 },
      { id: 3, name: 'no category', alcohol_by_volume: 0.047 },
      { id: 4, category: 'beer', alcohol_by_volume: 0.047 },
      'garbage',
    ]));
    expect(parsed).toHaveLength(1);
    expect(skipped).toBe(4);
  });
});

describe('reclassify-category — ABV fraction reader', () => {
  it.each([
    [null, { ok: true, abv: null }],
    [undefined, { ok: true, abv: null }],
    ['', { ok: true, abv: null }],
    [0.41, { ok: true, abv: 0.41 }],
    ['0.41', { ok: true, abv: 0.41 }],
    [0, { ok: true, abv: 0 }],
    [1, { ok: true, abv: 1 }],
  ])('accepts %j', (value, expected) => {
    expect(asAbvFraction(value)).toEqual(expected);
  });

  it.each([
    [41],
    [1.0001],
    [-0.1],
    ['forty-one'],
    [Number.NaN],
  ])('refuses %j with a scale/shape reason', (value) => {
    const result = asAbvFraction(value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('reclassify-category — stored-key projection table', () => {
  it('inverts the six product_master category keys exactly', () => {
    expect(Object.keys(STORED_KEY_TO_CANONICAL).sort()).toEqual([
      'beer',
      'intermediate_products',
      'other_fermented',
      'spirits',
      'wine_sparkling',
      'wine_still',
    ]);
  });
});

describe('reclassify-category — CLI smoke (plain node, --stats writes no SQL)', () => {
  it('runs end-to-end under node --experimental-strip-types via the resolution hooks', { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'reclassify-smoke-'));
    const inputPath = join(dir, 'dump.json');
    writeFileSync(inputPath, serializeDump(fullDump()));
    try {
      const result = spawnSync(
        process.execPath,
        ['--experimental-strip-types', '--no-warnings', SCRIPT_PATH, '--input', inputPath, '--stats'],
        { encoding: 'utf8', cwd: dirname(SCRIPT_PATH) },
      );
      expect(result.status).toBe(0);
      const stdout = result.stdout ?? '';
      expect(stdout).toContain('--stats over 41 rows (0 skipped');
      expect(stdout).toContain('would update (guarded outcome differs — all boundary-attributed): 26');
      expect(stdout).toContain('already correct (guarded outcome equals stored): 11');
      expect(stdout).toContain('kept — no usable ABV, guard cannot key (honest unknown): 2');
      expect(stdout).toContain('refused (unknown stored key / ABV outside 0–1 — never guessed): 2');
      // --stats never emits SQL.
      expect(stdout).not.toContain('UPDATE product_master');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
