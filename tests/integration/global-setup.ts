/**
 * Global setup for the real-stack integration suite.
 *
 * Applies the Drizzle migrations ONCE before any test file runs.
 *
 * Why this exists (Vitest 3 fallout, task 12.3): under Vitest 2 the file
 * scheduler happened to run `excise-engine.test.ts` — the only file that
 * applied migrations in its `beforeAll` — before `data-lifecycle` and
 * `durability-restart`, which assume the schema exists. Vitest 3 changed
 * the scheduling order deterministically, exposing the coupling: on a
 * cold database those two files now start first and fail with
 * `relation "…" does not exist`. Migrating here makes every file
 * order-independent; `excise-engine.test.ts` keeps its own migrate call
 * (drizzle-kit is journal-idempotent, and the run prints
 * "No migrations to run" there).
 *
 * Mirrors the skip semantics of the test files: when no database is
 * reachable (TEST_DATABASE_URL/DATABASE_URL unset or Postgres down), the
 * setup exits without error so the files skip themselves as before.
 *
 * @module IntegrationGlobalSetup
 */
import { execSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? null;

/** TCP reachability probe — no pg dependency at the root. */
function probeDatabase(url: URL): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(
      { host: url.hostname, port: Number(url.port || 5432) },
      () => {
        socket.destroy();
        resolve(true);
      },
    );
    socket.setTimeout(2000);
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

export default async function globalSetup(): Promise<void> {
  if (!DATABASE_URL) {
    console.log('⏭️  Integration global setup SKIPPED — no DATABASE_URL.');
    return;
  }

  const url = new URL(DATABASE_URL);
  if (!(await probeDatabase(url))) {
    console.log(
      `⏭️  Integration global setup SKIPPED — no PostgreSQL at ${url.host}.`,
    );
    return;
  }

  // Same invocation excise-engine.test.ts uses: the data-platform package
  // owns drizzle-kit and the committed migrations.
  const migrateCmd = [
    'pnpm',
    '--filter', '@rajahinta/data-platform',
    'exec', 'drizzle-kit', 'migrate',
  ].join(' ');

  try {
    execSync(migrateCmd, {
      env: { ...process.env, DATABASE_URL },
      cwd: path.resolve(import.meta.dirname, '..', '..'),
      stdio: 'pipe',
      timeout: 60_000,
    });
    console.log('✅ Integration schema applied (drizzle-kit migrate).');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Journal-idempotent: an up-to-date database makes drizzle-kit exit
    // non-zero with a message that is success for our purposes.
    if (!msg.includes('No migrations to run') && !msg.includes('already applied')) {
      throw new Error(`drizzle-kit migrate failed in global setup: ${msg}`);
    }
    console.log('✅ Integration schema already up to date.');
  }
}
