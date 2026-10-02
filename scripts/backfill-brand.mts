#!/usr/bin/env node
/**
 * Brand backfill statement generator (change derive-product-brand).
 *
 * production `product_master.brand` is empty on every row (no live feed
 * carries a brand). This script reads a LEAD-dumped JSON of
 * `product_master (id, name, brand)` rows and emits the idempotent
 * UPDATE statements that populate `brand` with the conservative
 * derivation from the row's display name (the same pure function
 * ingestion maps through — packages/data-acquisition derive-brand.ts).
 *
 * It does NOT touch D1/wrangler — the LEAD dumps the rows to JSON and
 * applies the emitted SQL. Only rows whose stored brand is empty AND
 * whose derivation is non-empty produce a statement, so re-running the
 * dump + script yields byte-identical SQL (deriveBrand is pure and
 * deterministic). `updated_at` is deliberately NOT set: any UPDATE
 * fires the FTS rebuild trigger, but the freshness timestamp must not
 * churn for a backfill.
 *
 * Input JSON shape — an array (or {"rows": [...]}) of
 *   { "id": 123, "name": "Koskenkorva Vodka 40% 0.5 l", "brand": "" }
 * `brand` may be omitted; rows missing `id`/`name` are counted and
 * skipped with a stderr warning.
 *
 * Usage (Node 24 in PATH — type stripping is native):
 *
 *   export PATH=/root/.nvm/versions/node/v24.21.0/bin:$PATH
 *   node --experimental-strip-types scripts/backfill-brand.mts \
 *     --input product-master-dump.json > backfill-brand.sql
 *
 *   wrangler d1 execute DB --remote --file backfill-brand.sql   # LEAD only
 *
 * Options:
 *   --input <path>   JSON file to read (default: stdin).
 *   --dry-run        No SQL emitted; print total rows, would-update
 *                    count, still-empty count.
 *   --sample <n>     Print n sample `name → brand` mappings (head of
 *                    the would-update set) alongside the run summary.
 *   --stats          Stats mode: consider ALL rows regardless of stored
 *                    brand; print the derived-brand token-count
 *                    distribution (1/2/3 tokens / empty). No SQL.
 *   -h, --help
 *
 * Output discipline: in emit mode stdout carries ONLY SQL statements
 * (pipe-safe); summaries and samples go to stderr. In --dry-run and
 * --stats mode nothing is emitted, so summaries/samples use stdout.
 *
 * Exit codes: 0 = success; 1 = usage or input error.
 */
import { readFileSync } from 'node:fs';
import { deriveBrand } from '../packages/data-acquisition/src/services/derive-brand.ts';

interface BackfillRow {
  readonly id: number | string;
  readonly name?: unknown;
  readonly brand?: unknown;
}

interface ParsedRow {
  readonly id: number | string;
  readonly name: string;
  readonly storedBrand: string;
  readonly derived: string;
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
    'Usage: node --experimental-strip-types scripts/backfill-brand.mts [--input <path>] [options]',
    '',
    'Reads product_master rows (id, name, brand) from JSON and emits',
    'idempotent UPDATE statements for rows with an empty stored brand and',
    'a non-empty derived brand. updated_at is never set.',
    '',
    '  --input <path>   JSON file (default: stdin)',
    '  --dry-run        Summary only (total / would-update / still-empty)',
    '  --sample <n>     Show n sample name → brand mappings',
    '  --stats          Token-count distribution (1/2/3/empty) over ALL rows',
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
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as { rows?: unknown }).rows)
      ? (parsed as { rows: unknown[] }).rows
      : null;
  if (rows === null) {
    throw new Error('input JSON must be an array of rows (or {"rows": [...]})');
  }
  return rows as BackfillRow[];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Single-quote SQL literal escaping — the only injection surface. */
function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function buildUpdate(row: ParsedRow): string {
  const id = typeof row.id === 'number' && Number.isInteger(row.id)
    ? String(row.id)
    : sqlLiteral(String(row.id));
  return `UPDATE product_master SET brand = ${sqlLiteral(row.derived)} WHERE id = ${id};`;
}

function tokenBucket(derived: string): 'empty' | '1' | '2' | '3' {
  if (derived === '') {
    return 'empty';
  }
  const tokens = derived.split(' ').length;
  return tokens >= 3 ? '3' : String(tokens) as '1' | '2';
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
    if (id === undefined || id === null || name === '') {
      skipped.push(i);
      continue;
    }
    const storedBrand = asString(row?.brand).trim();
    parsed.push({ id, name, storedBrand, derived: deriveBrand(name) });
  }

  const emitting = !options.dryRun && !options.stats;
  // Emit mode keeps stdout pipe-safe for SQL: human output uses stderr.
  const report = emitting
    ? (line: string): void => { console.error(line); }
    : (line: string): void => { console.log(line); };

  const wouldUpdate = parsed.filter((r) => r.storedBrand === '' && r.derived !== '');
  const stillEmpty = parsed.filter((r) => r.storedBrand === '' && r.derived === '');

  if (options.stats) {
    const buckets = { '1': 0, '2': 0, '3': 0, empty: 0 };
    for (const row of parsed) {
      buckets[tokenBucket(row.derived)] += 1;
    }
    const total = parsed.length;
    report(`--stats over ${total} rows (all rows regardless of stored brand):`);
    for (const key of ['1', '2', '3', 'empty'] as const) {
      const count = buckets[key];
      const pct = total === 0 ? '0.0' : ((count / total) * 100).toFixed(1);
      report(`  ${key === 'empty' ? 'empty' : `${key} token(s)`}: ${count} (${pct}%)`);
    }
    report(`  skipped rows (missing id/name): ${skipped.length}`);
  }

  if (options.dryRun) {
    report(`total rows: ${rawRows.length}`);
    report(`parsed rows: ${parsed.length} (skipped: ${skipped.length})`);
    report(`would update (stored brand empty, derivation non-empty): ${wouldUpdate.length}`);
    report(`still empty after derivation: ${stillEmpty.length}`);
  }

  if (options.sample !== null && options.sample > 0) {
    report(`sample mappings (first ${Math.min(options.sample, wouldUpdate.length)} of ${wouldUpdate.length} would-update rows):`);
    for (const row of wouldUpdate.slice(0, options.sample)) {
      report(`  ${row.name} → ${row.derived}`);
    }
  }

  if (emitting) {
    for (const row of wouldUpdate) {
      console.log(buildUpdate(row));
    }
    report(`emitted ${wouldUpdate.length} UPDATE statement(s); updated_at untouched.`);
  }

  return 0;
}

process.exitCode = main();
