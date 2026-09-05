#!/usr/bin/env node
/**
 * Curated producer-links seed import (task 6.2, change
 * product-roadmap-phases-1-4; spec: producer-matching, design R9).
 *
 * A thin CLI over packages/data-platform/src/seed/producer-links-import.ts
 * (all validation/normalization/idempotency logic lives there, tested).
 * Reads a documented JSON file (see
 * packages/data-platform/src/seed/producer-links/README.md), validates
 * EVERY field with a strict schema, checks source URLs reachable
 * (unless --offline), resolves the product references against
 * product_master, and inserts through the ProducerLinksRepository write
 * path. Rows land DRAFT — the audited operator console publishes.
 *
 * Idempotent: a re-run skips (alkoProductId, siblingProductId) pairs
 * that already exist, DRAFT or PUBLISHED; published evidence is never
 * rewritten (6.1 lifecycle — no update call exists on this path).
 *
 * Usage (run via data-platform's tsx, mirroring seed-d1.ts):
 *
 *   pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/import-producer-links.ts \
 *     ../../packages/data-platform/src/seed/producer-links/producer-links-bootstrap.json \
 *     --db-file <path-to-d1-sqlite> [options]
 *
 * Options:
 *   --db-file <path>  SQLite file of the target D1 database (wrangler
 *                     local state or any file with the committed schema
 *                     applied). Required unless --dry-run.
 *   --dry-run         Validate (+ reachability + resolution when a
 *                     --db-file is given) and report, writing nothing.
 *   --offline         Skip source-URL reachability checks. Documented
 *                     for tests and CI, which run without network.
 *   --timeout-ms <n>  Per-URL reachability budget (default 10000).
 *   -h, --help
 *
 * Exit codes: 0 = success (skips are reported, not fatal);
 * 1 = invalid file, unreachable source URLs (online mode), or DB error.
 */
import { readFileSync } from 'node:fs';
import {
  checkSourceUrlReachable,
  dryRunProducerLinkImport,
  importProducerLinkCases,
  openD1SqliteDatabase,
  parseProducerLinksImportFile,
  resolveCaseProducts,
  SOURCE_URL_DEFAULT_TIMEOUT_MS,
} from '../packages/data-platform/src/seed/producer-links-import';
import { D1ProducerLinksRepository } from '../packages/data-platform/src/repositories/d1/producer-links.repository';

interface CliOptions {
  file: string | null;
  dbFile: string | null;
  dryRun: boolean;
  offline: boolean;
  timeoutMs: number;
  help: boolean;
}

function usage(): string {
  return [
    'Usage: tsx scripts/import-producer-links.ts <data.json> [--db-file <sqlite path>] [options]',
    '',
    'Options:',
    '  --db-file <path>   target D1 SQLite file (schema applied); required unless --dry-run',
    '  --dry-run          validate and report without writing',
    '  --offline          skip source-URL reachability checks (tests/CI)',
    '  --timeout-ms <n>   per-URL reachability budget (default 10000)',
    '  -h, --help',
  ].join('\n');
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    file: null,
    dbFile: null,
    dryRun: false,
    offline: false,
    timeoutMs: SOURCE_URL_DEFAULT_TIMEOUT_MS,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--db-file') {
      options.dbFile = argv[++i] ?? null;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--offline') {
      options.offline = true;
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[++i]);
      if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
        console.error('FATAL: --timeout-ms must be a positive number');
        process.exit(1);
      }
    } else if (arg.startsWith('--')) {
      console.error(`FATAL: unknown option ${arg}`);
      console.error(usage());
      process.exit(1);
    } else if (options.file === null) {
      options.file = arg;
    } else {
      console.error('FATAL: exactly one data file argument is expected');
      console.error(usage());
      process.exit(1);
    }
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.file) {
    console.error('FATAL: a data file argument is required');
    console.error(usage());
    process.exit(1);
  }
  if (!options.dryRun && !options.dbFile) {
    console.error('FATAL: --db-file is required unless --dry-run');
    process.exit(1);
  }

  // ---- 1. Parse + schema-strict validation ------------------------------
  const raw = readFileSync(options.file, 'utf8');
  const { file, errors } = parseProducerLinksImportFile(raw);
  if (!file) {
    console.error(`FATAL: ${options.file} failed validation:`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }
  console.error(
    `Parsed ${file.cases.length} case(s) — reviewer "${file.reviewer}", reviewedAt ${file.reviewedAt}` +
      (file.bootstrap ? ' (bootstrap load)' : ''),
  );

  // ---- 2. Source URL reachability (online mode) --------------------------
  if (!options.offline) {
    console.error(`Checking ${file.cases.length} source URL(s) (timeout ${options.timeoutMs}ms each)…`);
    const failures: string[] = [];
    for (const entry of file.cases) {
      const check = await checkSourceUrlReachable(entry.sourceUrl, { timeoutMs: options.timeoutMs });
      if (check.ok) {
        console.error(`  ok    ${entry.sourceUrl} (${check.status})`);
      } else {
        const detail = check.status !== undefined ? `HTTP ${check.status}` : check.reason;
        console.error(`  FAIL  ${entry.sourceUrl} (${detail})`);
        failures.push(`${entry.sourceUrl}: ${detail}`);
      }
    }
    if (failures.length > 0) {
      console.error(`FATAL: ${failures.length} source URL(s) unreachable — evidence must be verifiable:`);
      for (const failure of failures) {
        console.error(`  - ${failure}`);
      }
      process.exit(1);
    }
  } else {
    console.error('Offline mode: source-URL reachability checks SKIPPED (--offline).');
  }

  // ---- 3. Dry-run without a database: validation-only report -------------
  if (!options.dbFile) {
    console.error('Dry-run without --db-file: product resolution and writes skipped.');
    console.log(JSON.stringify({ cases: file.cases.length, validation: 'passed' }, null, 2));
    return;
  }

  // ---- 4. Resolve product references against product_master --------------
  const { d1 } = openD1SqliteDatabase(options.dbFile);
  const repo = new D1ProducerLinksRepository(d1);
  const resolutions = await resolveCaseProducts(d1, file.cases);

  // ---- 5. Import (or simulate) through the repository write path ---------
  const run = options.dryRun
    ? await dryRunProducerLinkImport(repo, resolutions)
    : await importProducerLinkCases(repo, file, resolutions);

  for (const result of run.results) {
    const c = result.case;
    const label = `${c.producerKey}: alko ${c.alkoProductId} -> ${c.siblingMerchant} ${c.siblingProductId}`;
    console.error(`  ${result.outcome.kind.padEnd(26)} ${label}`);
  }
  console.log(
    JSON.stringify(
      {
        file: options.file,
        dryRun: options.dryRun,
        offline: options.offline,
        reviewer: file.reviewer,
        reviewedAt: file.reviewedAt,
        counts: run.counts,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error('Producer-links import failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
