#!/usr/bin/env node
/**
 * Unit-volume backfill statement generator (change honest-trust-surfaces,
 * task 1.2).
 *
 * Live multipack feeds corrupt `product_master.unit_volume` with the PACK
 * total ("Karhu Olut 5.3% 24×33 l" stored as 33) or a zero. This script
 * reads a LEAD-dumped JSON of `product_master (id, name, unit_volume)`
 * rows and emits idempotent UPDATE statements setting the per-unit volume
 * the pack-notation parser derives from the name — the SAME pure function
 * the ingestion normalizer maps through
 * (packages/data-acquisition pack-notation.ts), so every proposed value is
 * byte-identical to what re-ingestion would store (spec scenario).
 *
 * Candidate set — a row is considered only when its name carries pack
 * notation the parser can decisively read, OR its stored volume is zero,
 * OR its stored volume is absurd (outside the 0–100 l domain window:
 * negative, or over 5 l for a single beverage unit). Rows inside the
 * candidate set whose name admits no decisive parse are SKIPPED and listed
 * in the report — never guessed. Already-correct rows (stored equals the
 * parsed value; both land on the same IEEE double) produce no statement,
 * so re-running the dump + script yields byte-identical SQL.
 *
 * It does NOT touch D1/wrangler — the LEAD dumps the rows to JSON and
 * applies the emitted SQL (execution instructions printed in real-run
 * mode). `updated_at` is deliberately NOT set: any UPDATE fires the FTS
 * rebuild trigger, but the freshness timestamp must not churn for a
 * backfill.
 *
 * Input JSON shape — an array of rows, {"rows": [...]}, or a wrangler
 * `--json` envelope ([{ "results": [...], "success": true }]) of
 *   { "id": 2900, "name": "Karhu Olut 5.3% 24×33 l", "unit_volume": 33 }
 * `unit_volume` may be a number or a numeric string; rows missing
 * `id`/`name`/`unit_volume` are counted and skipped with a stderr warning.
 *
 * Usage (Node 24 in PATH — type stripping is native):
 *
 *   export PATH=/root/.nvm/versions/node/v24.21.0/bin:$PATH
 *   node --experimental-strip-types scripts/backfill-unit-volume.mts \
 *     --input product-master-dump.json --stats
 *
 *   wrangler d1 execute DB --remote --env production \
 *     --file /tmp/opencode/backfill-unit-volume.sql   # LEAD only
 *
 * Options:
 *   --input <path>   JSON file to read (default: stdin).
 *   --dry-run        Full SQL to stdout (pipe-safe) AND to the artifact
 *                    file, plus the run summary on stderr. Nothing applied.
 *   --sample <n>     Print the first n would-update rows as
 *                    `id: "name" stored → parsed` (head of the update set).
 *   --stats          Candidate counts by category (pack-notation name /
 *                    zero volume / absurd volume), would-update,
 *                    already-correct, refused. No SQL.
 *   -h, --help
 *
 * Real run (neither --dry-run nor --stats; --sample may accompany it):
 * writes the SQL artifact to /tmp/opencode/backfill-unit-volume.sql and
 * prints the execution instructions; stdout carries no SQL.
 *
 * Exit codes: 0 = success; 1 = usage or input error.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parsePackUnitVolumeLitres } from '../packages/data-acquisition/src/services/pack-notation.ts';

const ARTIFACT_DIR = '/tmp/opencode';
const ARTIFACT_PATH = `${ARTIFACT_DIR}/backfill-unit-volume.sql`;

/** Domain window every `unit_volume` write must land in (real column, litres). */
const VOLUME_WINDOW_MAX = 100;
/** A single beverage unit over 5 l is treated as absurd in the candidate sweep. */
const ABSURD_VOLUME_MIN = 5;

interface BackfillRow {
  readonly id: number | string;
  readonly name?: unknown;
  readonly unit_volume?: unknown;
}

interface ParsedRow {
  readonly id: number | string;
  readonly name: string;
  readonly stored: number;
}

interface ClassifiedRow extends ParsedRow {
  readonly derived: number | null;
  /** Candidate category, null when the row is outside the candidate set. */
  readonly category: 'pack-notation' | 'zero-volume' | 'absurd-volume' | null;
  /** Why a candidate row gets no UPDATE (never guessed values). */
  readonly refusal: string | null;
}

interface CliOptions {
  inputPath: string | null;
  dryRun: boolean;
  sample: number | null;
  stats: boolean;
  help: boolean;
}

function usage(): string {
  return [
    'Usage: node --experimental-strip-types scripts/backfill-unit-volume.mts [--input <path>] [options]',
    '',
    'Reads product_master rows (id, name, unit_volume) from JSON and emits',
    'idempotent UPDATE statements setting the per-unit litre volume the',
    'pack-notation parser derives from the name. Candidates: pack-notation',
    'names, stored zero, or stored absurd volumes. Undecidable rows are',
    'skipped, never guessed. updated_at is never set.',
    '',
    '  --input <path>   JSON file (default: stdin)',
    '  --dry-run        Full SQL to stdout + artifact file, summary to stderr',
    '  --sample <n>     Show first n would-update rows (stored → parsed)',
    '  --stats          Candidate counts by category, no SQL',
    '  -h, --help',
  ].join('\n');
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    inputPath: null,
    dryRun: false,
    sample: null,
    stats: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') {
      options.inputPath = argv[++i] ?? '';
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--sample') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`--sample expects a non-negative integer, got "${argv[i]}"`);
      }
      options.sample = n;
    } else if (arg === '--stats') {
      options.stats = true;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else {
      throw new Error(`unknown option "${arg}"`);
    }
  }
  if (options.inputPath === '') {
    throw new Error('--input requires a file path');
  }
  return options;
}

function loadRows(options: CliOptions): BackfillRow[] {
  const raw = options.inputPath !== null
    ? readFileSync(options.inputPath, 'utf8')
    : readFileSync(0, 'utf8'); // stdin
  const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, '').trim());
  if (Array.isArray(parsed)) {
    const first = parsed[0];
    // wrangler d1 execute --json envelope: [{ results: [...], success: true }]
    if (parsed.length > 0 && first !== null && typeof first === 'object'
      && Array.isArray((first as { results?: unknown }).results)) {
      return (first as { results: unknown[] }).results as BackfillRow[];
    }
    return parsed as BackfillRow[];
  }
  if (parsed !== null && typeof parsed === 'object'
    && Array.isArray((parsed as { rows?: unknown }).rows)) {
    return (parsed as { rows: unknown[] }).rows as BackfillRow[];
  }
  throw new Error('input JSON must be an array of rows, {"rows": [...]}, or a wrangler --json envelope');
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** REAL column → wrangler emits JSON numbers; tolerate numeric strings. */
function asVolume(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** Single-quote SQL literal escaping — the only injection surface (id fallback). */
function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function buildUpdate(row: ClassifiedRow): string {
  const id = typeof row.id === 'number' && Number.isInteger(row.id)
    ? String(row.id)
    : sqlLiteral(String(row.id));
  // row.derived is a finite number here (guarded by classify), so plain
  // interpolation is safe; String() matches the normalizer's storage form
  // and SQLite renders the same shortest round-trip double.
  return `UPDATE product_master SET unit_volume = ${row.derived} WHERE id = ${id};`;
}

/**
 * Classify one parsed row. First match wins so every candidate lands in
 * exactly one category: a decisive pack-notation parse outranks the
 * zero/absurd volume buckets (the parse is the correction either way).
 */
function classify(row: ParsedRow): ClassifiedRow {
  const derived = parsePackUnitVolumeLitres(row.name);
  if (derived !== null) {
    if (!Number.isFinite(derived) || derived <= 0 || derived >= VOLUME_WINDOW_MAX) {
      return { ...row, derived, category: 'pack-notation', refusal: `parsed value ${derived} outside the 0–${VOLUME_WINDOW_MAX} l window` };
    }
    return { ...row, derived, category: 'pack-notation', refusal: null };
  }
  // Absurd covers the whole window violation, not just the over-5 sweep:
  // a negative volume is equally impossible and must surface in the report.
  if (row.stored === 0) {
    return { ...row, derived, category: 'zero-volume', refusal: 'stored volume 0, no decisive pack notation in name' };
  }
  if (row.stored < 0 || row.stored > ABSURD_VOLUME_MIN) {
    return { ...row, derived, category: 'absurd-volume', refusal: `stored volume ${row.stored} outside the sane window, no decisive pack notation in name` };
  }
  return { ...row, derived, category: null, refusal: null };
}

function main(): number {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    console.error(usage());
    return 1;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }

  let rawRows: BackfillRow[];
  try {
    rawRows = loadRows(options);
  } catch (error) {
    console.error(`input error: ${(error as Error).message}`);
    return 1;
  }

  const skipped: number[] = [];
  const parsed: ParsedRow[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const id = row?.id;
    const name = asString(row?.name).trim();
    const stored = asVolume(row?.unit_volume);
    if (id === undefined || id === null || name === '' || stored === null) {
      skipped.push(i);
      continue;
    }
    parsed.push({ id, name, stored });
  }

  const classified = parsed.map(classify);
  const candidates = classified.filter((r) => r.category !== null);
  const wouldUpdate = classified.filter((r) => r.category === 'pack-notation' && r.refusal === null && r.derived !== r.stored);
  const alreadyCorrect = classified.filter((r) => r.category === 'pack-notation' && r.refusal === null && r.derived === r.stored);
  const refused = classified.filter((r) => r.refusal !== null);

  const dryRun = options.dryRun;
  const realRun = !dryRun && !options.stats;
  // --dry-run puts SQL on stdout (pipe-safe), so its summary uses stderr;
  // --stats and real runs keep stdout free for the human-facing report.
  const report = dryRun
    ? (line: string): void => { console.error(line); }
    : (line: string): void => { console.log(line); };

  if (options.stats) {
    const byCategory = { 'pack-notation': 0, 'zero-volume': 0, 'absurd-volume': 0 };
    for (const row of candidates) {
      byCategory[row.category as keyof typeof byCategory] += 1;
    }
    report(`--stats over ${parsed.length} rows (${skipped.length} skipped: missing id/name/unit_volume):`);
    for (const key of ['pack-notation', 'zero-volume', 'absurd-volume'] as const) {
      const count = byCategory[key];
      const pct = parsed.length === 0 ? '0.0' : ((count / parsed.length) * 100).toFixed(1);
      report(`  candidate ${key}: ${count} (${pct}%)`);
    }
    report(`  would update (decisive notation, stored differs): ${wouldUpdate.length}`);
    report(`  already correct (decisive notation, stored matches): ${alreadyCorrect.length}`);
    report(`  refused (candidate, no decisive value — never guessed): ${refused.length}`);
  }

  if (dryRun) {
    report(`total rows: ${rawRows.length}`);
    report(`parsed rows: ${parsed.length} (skipped: ${skipped.length})`);
    report(`candidates: ${candidates.length}; would update: ${wouldUpdate.length}; already correct: ${alreadyCorrect.length}; refused: ${refused.length}`);
  }

  if (options.sample !== null && options.sample > 0) {
    report(`sample mappings (first ${Math.min(options.sample, wouldUpdate.length)} of ${wouldUpdate.length} would-update rows):`);
    for (const row of wouldUpdate.slice(0, options.sample)) {
      report(`  ${row.id}: "${row.name}" ${row.stored} → ${row.derived}`);
    }
  }

  if (refused.length > 0) {
    report(`refused candidates (listed, never guessed): ${refused.length}`);
    for (const row of refused) {
      report(`  ${row.id}: "${row.name}" stored ${row.stored} — ${row.refusal}`);
    }
  }

  if (dryRun || realRun) {
    const statements = wouldUpdate.map(buildUpdate);
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(ARTIFACT_PATH, statements.length > 0 ? `${statements.join('\n')}\n` : '');
    if (dryRun) {
      for (const statement of statements) {
        console.log(statement);
      }
      report(`dry run: ${statements.length} UPDATE statement(s) above and written to ${ARTIFACT_PATH}; nothing applied.`);
    } else {
      report(`SQL artifact written: ${ARTIFACT_PATH} (${statements.length} UPDATE statement(s); updated_at untouched).`);
      report('Review the artifact, then execute from apps/api-worker (CLOUDFLARE_API_TOKEN from the environment, never echoed):');
      report(`  npx wrangler d1 execute DB --remote --env production --file ${ARTIFACT_PATH}`);
    }
  }

  return 0;
}

process.exitCode = main();
