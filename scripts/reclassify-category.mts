#!/usr/bin/env node
/**
 * Category reclassification statement generator (task 1.2, change
 * first-impression-pass).
 *
 * Ingestion stored 26 products above the EU intermediate-products
 * boundary (22 % ABV) under the fermented duty key: their source
 * categories were keyword buckets ("Muut juomat" 17, "Juomasekoitus" 2,
 * "Other drinks" 1 in the live audit; the production snapshot counts
 * 26) whose keyword path resolved to `other_fermented` before the
 * ABV guard existed. Task 1.1 gave the guarded mapper the 22 % ceiling;
 * this script re-derives every stored row through that SAME mapper and
 * emits idempotent UPDATEs only where the guarded outcome differs —
 * never a parallel decision path.
 *
 * The dump carries the stored rows, not the original source strings:
 * `product_master` keeps the derived tax key (`category`), so the script
 * maps each stored key to its representative canonical word and feeds
 * THAT through `mapSourceCategory` with the row's ABV fraction. The
 * projection reproduces the ingestion guard exactly at the granularity
 * the stored key retains:
 *
 *   beer                  → 'beer'            → beer            at any ABV
 *   wine_still            → 'wine'            → wine_still      at any ABV
 *   wine_sparkling        → 'sparkling-wine'  → wine_sparkling  at any ABV
 *   intermediate_products → 'fortified-wine'  → intermediate_products at any ABV
 *   spirits               → 'spirits'         → spirits         at any ABV
 *   other_fermented       → 'cider'           → other_fermented at ≤ 22 %,
 *                                             spirits + boundaryApplied above
 *
 * (The fermented bucket is the only one the boundary re-keys; wine,
 * sparkling, fortified and spirits pass through unchanged at any ABV —
 * so already-correct rows produce zero diff at every ABV.) A stored key
 * outside these six is listed as refused and never guessed. Rows with
 * no usable ABV cannot key the guard: `other_fermented` rows among them
 * are counted separately (honest unknown — the live audit's 52 kept
 * unparseable-ABV rows land here) and left untouched.
 *
 * `regulatory_classification` is written together with `category`
 * without being read: ingestion stores the same derived key in both
 * columns (upsert writes `mapping.taxCategory` to each), and a healed
 * row must not keep the stale key in its twin column. `updated_at` is
 * deliberately NOT set — the UPDATE fires the FTS rebuild trigger, but
 * the freshness timestamp must not churn for a backfill. Category is
 * NOT part of the Tier-2 identity compound key, so unlike the
 * unit-volume backfill there is no re-keying hazard; it still runs
 * before the gated deploy so consumers ship with corrected data (the
 * 00:00 UTC cron re-ingests through the wired adapters and cannot
 * re-misclassify).
 *
 * It does NOT touch D1/wrangler — the operator dumps the rows to JSON
 * and applies the emitted SQL (execution instructions printed in
 * real-run mode). Re-running the dump + script after applying yields a
 * byte-identical empty artifact.
 *
 * Input JSON shape — an array of rows, {"rows": [...]}, or a wrangler
 * `--json` envelope ([{ "results": [...], "success": true }]) of
 *   { "id": 123, "name": "Akvavit 41% 0,5 l", "category": "other_fermented",
 *     "alcohol_by_volume": 0.41 }
 * `alcohol_by_volume` is the 0–1 fraction the column stores; it may be
 * a numeric string, and null is meaningful (guard cannot key). A value
 * outside 0–1 is refused per-row — a wrong-scale value would silently
 * re-key every row, so the script never rescales a guessed unit.
 *
 * Usage (Node 24 in PATH — type stripping is native; the script
 * registers module-resolution hooks for the core-domain source chain):
 *
 *   export PATH=/root/.nvm/versions/node/v24.21.0/bin:$PATH
 *   node --experimental-strip-types scripts/reclassify-category.mts \
 *     --input product-master-category.json --stats
 *
 *   wrangler d1 execute DB --remote --env production \
 *     --file /tmp/opencode/reclassify-category.sql   # LEAD only
 *
 * Options:
 *   --input <path>   JSON file to read (default: stdin).
 *   --dry-run        Full SQL to stdout (pipe-safe) AND to the artifact
 *                    file, plus the run summary on stderr. Nothing applied.
 *   --sample <n>     Print the first n would-update rows as
 *                    `id: "name" stored → derived (attribution)`.
 *   --stats          Decision counts only. No SQL.
 *   -h, --help
 *
 * Real run (neither --dry-run nor --stats; --sample may accompany it):
 * writes the SQL artifact to /tmp/opencode/reclassify-category.sql and
 * prints the execution instructions; stdout carries no SQL.
 *
 * Exit codes: 0 = success; 1 = usage or input error.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { SourceCategoryMapping } from '../packages/core-domain/src/normalization/source-category.mapper.ts';

type Mapper = (raw: string, abv?: number | null) => SourceCategoryMapping | null;

const ARTIFACT_DIR = '/tmp/opencode';
const ARTIFACT_PATH = `${ARTIFACT_DIR}/reclassify-category.sql`;

// ---------------------------------------------------------------------------
// Module resolution for the core-domain source chain (CLI runs)
// ---------------------------------------------------------------------------

/**
 * The guarded mapper's import chain uses extensionless relative
 * specifiers (`'../tax/tax-categories'`) and one legacy decorator
 * (`@Injectable()` on NormalizationService) — neither is erasable
 * TypeScript, so plain `node --experimental-strip-types` cannot load
 * the chain unaided. These try-default-first hooks (a) retry relative
 * specifiers with `.ts` appended on ERR_MODULE_NOT_FOUND and (b) strip
 * the exact decorator line, which changes no behavior the script's
 * decision path touches (`normalizeCategory` is a free function; the
 * decorated service is never instantiated here). Under vitest the hooks
 * are inert: vite resolves and transforms those modules itself.
 */
let hooksRegistered = false;
function ensureResolutionHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if ((error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND'
          && !specifier.endsWith('.ts')
          && (specifier.startsWith('./') || specifier.startsWith('../'))) {
          return nextResolve(`${specifier}.ts`, context);
        }
        throw error;
      }
    },
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (url.endsWith('.ts') && String(loaded.source).includes('@Injectable()')) {
        const source = String(loaded.source)
          .split('\n')
          .filter((line) => line.trim() !== '@Injectable()')
          .join('\n');
        return { ...loaded, source, shortCircuit: true };
      }
      return loaded;
    },
  });
}

let mapperPromise: Promise<Mapper> | null = null;

/** Load the guarded mapper through the resolution hooks (once). */
function loadMapper(): Promise<Mapper> {
  ensureResolutionHooks();
  mapperPromise ??= import(
    '../packages/core-domain/src/normalization/source-category.mapper.ts'
  ).then((m) => m.mapSourceCategory as Mapper);
  return mapperPromise;
}

// ---------------------------------------------------------------------------
// Stored-key → representative-canonical projection
// ---------------------------------------------------------------------------

/**
 * Stored `product_master.category` tax keys → the canonical word whose
 * mapper outcome IS that key. Six keys exist (the mapper's own
 * canonical→tax table inverts exactly); any other stored value is
 * refused, never guessed. The fermented bucket has five canonical
 * members below the boundary (cider, long drink, sake, non-alcoholic,
 * other) — any representative that maps into the bucket yields the same
 * decision at every ABV, and 'cider' is used here.
 */
const STORED_KEY_TO_CANONICAL: Readonly<Record<string, string>> = {
  beer: 'beer',
  wine_still: 'wine',
  wine_sparkling: 'sparkling-wine',
  intermediate_products: 'fortified-wine',
  spirits: 'spirits',
  other_fermented: 'cider',
};

/** The only stored key the boundary guard can re-assign. */
const FERMENTED_KEY = 'other_fermented';

// ---------------------------------------------------------------------------
// Input rows
// ---------------------------------------------------------------------------

interface BackfillRow {
  readonly id: number | string;
  readonly name: string;
  readonly category: string;
  readonly abvRaw: unknown;
}

interface CliOptions {
  inputPath: string | null;
  dryRun: boolean;
  sample: number | null;
  stats: boolean;
  help: boolean;
}

/** One row's reclassification decision. */
interface Decision {
  readonly id: number | string;
  readonly name: string;
  readonly stored: string;
  readonly abv: number | null;
  readonly outcome: 'update' | 'correct' | 'cannot-key' | 'refused';
  /** Guarded tax key when the outcome is 'update'. */
  readonly derived: string | null;
  /** True when the EU boundary rule determined the outcome. */
  readonly boundaryApplied: boolean;
  /** Why the row got no decision ('refused' rows only). */
  readonly refusal: string | null;
}

function usage(): string {
  return [
    'Usage: node --experimental-strip-types scripts/reclassify-category.mts [--input <path>] [options]',
    '',
    'Reads product_master rows (id, name, category, alcohol_by_volume) from JSON',
    'and re-derives each category through the guarded source-category mapper',
    '(22 % intermediate-products ceiling). Emits idempotent UPDATEs only where',
    'the guarded outcome differs from the stored key — setting category AND',
    'regulatory_classification together, never updated_at. Unknown stored keys',
    'and wrong-scale ABVs are refused, never guessed; rows without a usable ABV',
    'cannot key the boundary guard and are left untouched.',
    '',
    '  --input <path>   JSON file (default: stdin)',
    '  --dry-run        Full SQL to stdout + artifact file, summary to stderr',
    '  --sample <n>     Show first n would-update rows (stored → derived)',
    '  --stats          Decision counts only, no SQL',
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

/** array of rows / {"rows": [...]} / wrangler --json envelope. */
function loadRows(raw: string): { rows: BackfillRow[]; skipped: number } {
  const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, '').trim());
  let list: readonly unknown[];
  if (Array.isArray(parsed)) {
    const first = parsed[0];
    if (parsed.length > 0 && first !== null && typeof first === 'object'
      && Array.isArray((first as { results?: unknown }).results)) {
      list = (first as { results: unknown[] }).results;
    } else {
      list = parsed;
    }
  } else if (parsed !== null && typeof parsed === 'object'
    && Array.isArray((parsed as { rows?: unknown }).rows)) {
    list = (parsed as { rows: unknown[] }).rows;
  } else {
    throw new Error('input JSON must be an array of rows, {"rows": [...]}, or a wrangler --json envelope');
  }

  const rows: BackfillRow[] = [];
  let skipped = 0;
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') {
      skipped += 1;
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const category = typeof record.category === 'string' ? record.category.trim() : '';
    if (id === undefined || id === null || name === '' || category === '') {
      skipped += 1;
      continue;
    }
    rows.push({ id, name, category, abvRaw: record.alcohol_by_volume });
  }
  return { rows, skipped };
}

/**
 * Column fraction → mapper input. Numbers pass through (wrangler emits
 * REAL as JSON numbers), numeric strings are tolerated; null/absent is
 * meaningful (the guard cannot key); anything else, or a value outside
 * 0–1, is refused — never rescaled, because a guessed unit conversion
 * would silently re-key the row.
 */
function asAbvFraction(value: unknown): { ok: true; abv: number | null } | { ok: false; reason: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, abv: null };
  }
  const n = typeof value === 'number'
    ? value
    : (typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: `alcohol_by_volume "${String(value)}" is not a number` };
  }
  if (n < 0 || n > 1) {
    return { ok: false, reason: `alcohol_by_volume ${n} is outside the 0–1 fraction scale — never rescaled` };
  }
  return { ok: true, abv: n };
}

/**
 * Decide one row through the guarded mapper. Pure: the mapper is
 * injected so tests can pin the decision without the dynamic loader.
 */
function classify(row: BackfillRow, mapSourceCategory: Mapper): Decision {
  const base = { id: row.id, name: row.name, stored: row.category, abv: null as number | null };
  const abv = asAbvFraction(row.abvRaw);
  if (!abv.ok) {
    return { ...base, outcome: 'refused', derived: null, boundaryApplied: false, refusal: abv.reason };
  }
  const canonical = STORED_KEY_TO_CANONICAL[row.category];
  if (canonical === undefined) {
    return {
      ...base,
      outcome: 'refused',
      derived: null,
      boundaryApplied: false,
      refusal: `stored category "${row.category}" is not one of the six product_master category keys`,
    };
  }
  const mapping = mapSourceCategory(canonical, abv.abv);
  if (mapping === null) {
    // Unreachable for the six representatives (all are mapped keywords),
    // but the honest branch if the mapper ever declines one: keep, don't guess.
    return { ...base, abv: abv.abv, outcome: 'cannot-key', derived: null, boundaryApplied: false, refusal: null };
  }
  if (mapping.taxCategory === row.category) {
    // A no-ABV fermented row is NOT "already correct" — the guard had no
    // evidence either way (honest unknown). Identity buckets are correct
    // at every ABV, ABV or not.
    const cannotKey = abv.abv === null && row.category === FERMENTED_KEY;
    return {
      ...base,
      abv: abv.abv,
      outcome: cannotKey ? 'cannot-key' : 'correct',
      derived: null,
      boundaryApplied: false,
      refusal: null,
    };
  }
  return {
    ...base,
    abv: abv.abv,
    outcome: 'update',
    derived: mapping.taxCategory,
    boundaryApplied: mapping.boundaryApplied === true,
    refusal: null,
  };
}

/** Single-quote SQL literal escaping — values come from the mapper's fixed vocabulary, ids from the dump. */
function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function buildUpdate(decision: Decision): string {
  const id = typeof decision.id === 'number' && Number.isInteger(decision.id)
    ? String(decision.id)
    : sqlLiteral(String(decision.id));
  // decision.derived is non-null for every 'update' decision; the twin
  // column is written with it (ingestion stores the same key in both).
  return `UPDATE product_master SET category = ${sqlLiteral(decision.derived as string)}, `
    + `regulatory_classification = ${sqlLiteral(decision.derived as string)} `
    + `WHERE id = ${id};`;
}

interface RunReport {
  readonly totalRows: number;
  readonly skipped: number;
  readonly updates: Decision[];
  readonly correct: Decision[];
  readonly cannotKey: Decision[];
  readonly refused: Decision[];
  readonly statements: string[];
}

function runReclassification(
  rows: readonly BackfillRow[],
  skipped: number,
  mapper: Mapper,
): RunReport {
  const decisions = rows.map((row) => classify(row, mapper));
  return {
    totalRows: rows.length,
    skipped,
    updates: decisions.filter((d) => d.outcome === 'update'),
    correct: decisions.filter((d) => d.outcome === 'correct'),
    cannotKey: decisions.filter((d) => d.outcome === 'cannot-key'),
    refused: decisions.filter((d) => d.outcome === 'refused'),
    statements: decisions.filter((d) => d.outcome === 'update').map(buildUpdate),
  };
}

async function main(): Promise<number> {
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

  let raw: string;
  try {
    raw = options.inputPath !== null
      ? readFileSync(options.inputPath, 'utf8')
      : readFileSync(0, 'utf8'); // stdin
  } catch (error) {
    console.error(`input error: ${(error as Error).message}`);
    return 1;
  }

  let parsed: { rows: BackfillRow[]; skipped: number };
  try {
    parsed = loadRows(raw);
  } catch (error) {
    console.error(`input error: ${(error as Error).message}`);
    return 1;
  }

  const mapper = await loadMapper();
  const report = runReclassification(parsed.rows, parsed.skipped, mapper);

  const dryRun = options.dryRun;
  const realRun = !dryRun && !options.stats;
  // --dry-run puts SQL on stdout (pipe-safe), so its summary uses stderr;
  // --stats and real runs keep stdout free for the human-facing report.
  const reportLine = dryRun
    ? (line: string): void => { console.error(line); }
    : (line: string): void => { console.log(line); };

  if (options.stats) {
    reportLine(`--stats over ${report.totalRows} rows (${report.skipped} skipped: missing id/name/category):`);
    reportLine(`  would update (guarded outcome differs — all boundary-attributed): ${report.updates.length}`);
    reportLine(`  already correct (guarded outcome equals stored): ${report.correct.length}`);
    reportLine(`  kept — no usable ABV, guard cannot key (honest unknown): ${report.cannotKey.length}`);
    reportLine(`  refused (unknown stored key / ABV outside 0–1 — never guessed): ${report.refused.length}`);
  }

  if (dryRun) {
    reportLine(`total rows: ${report.totalRows + report.skipped}`);
    reportLine(`parsed rows: ${report.totalRows} (skipped: ${report.skipped})`);
    reportLine(`would update: ${report.updates.length}; already correct: ${report.correct.length}; cannot key (no ABV): ${report.cannotKey.length}; refused: ${report.refused.length}`);
  }

  if (options.sample !== null && options.sample > 0) {
    reportLine(`sample mappings (first ${Math.min(options.sample, report.updates.length)} of ${report.updates.length} would-update rows):`);
    for (const decision of report.updates.slice(0, options.sample)) {
      const attribution = decision.boundaryApplied ? 'boundary > 22 %' : 'keyword';
      reportLine(`  ${decision.id}: "${decision.name}" ${decision.stored} → ${decision.derived} (${attribution})`);
    }
  }

  if (report.refused.length > 0) {
    reportLine(`refused rows (listed, never guessed): ${report.refused.length}`);
    for (const decision of report.refused) {
      reportLine(`  ${decision.id}: "${decision.name}" — ${decision.refusal}`);
    }
  }

  if (report.cannotKey.length > 0 && !options.stats) {
    reportLine(`kept — no usable ABV, the boundary guard cannot key them (honest unknown, never guessed): ${report.cannotKey.length}`);
    for (const decision of report.cannotKey) {
      reportLine(`  ${decision.id}: "${decision.name}" stored ${decision.stored}`);
    }
  }

  if (dryRun || realRun) {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(ARTIFACT_PATH, report.statements.length > 0 ? `${report.statements.join('\n')}\n` : '');
    if (dryRun) {
      for (const statement of report.statements) {
        console.log(statement);
      }
      reportLine(`dry run: ${report.statements.length} UPDATE statement(s) above and written to ${ARTIFACT_PATH}; nothing applied.`);
    } else {
      reportLine(`SQL artifact written: ${ARTIFACT_PATH} (${report.statements.length} UPDATE statement(s); category + regulatory_classification set, updated_at untouched).`);
      reportLine('Review the artifact, then execute from apps/api-worker (CLOUDFLARE_API_TOKEN from the environment, never echoed):');
      reportLine(`  npx wrangler d1 execute DB --remote --env production --file ${ARTIFACT_PATH}`);
    }
  }

  return 0;
}

/** Run only when invoked directly (tests import the module for its exports). */
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    console.error(`[reclassify] FATAL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export type { BackfillRow, CliOptions, Decision, RunReport };

export {
  ARTIFACT_PATH,
  asAbvFraction,
  buildUpdate,
  classify,
  loadMapper,
  loadRows,
  runReclassification,
  STORED_KEY_TO_CANONICAL,
};
