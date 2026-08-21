import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration — single source of truth for database schema.
 *
 * Generates committed SQL migrations from `src/schema.ts` into `drizzle/`.
 * This file is excluded from the package build (tsconfig.json includes only
 * `src/**`) and is consumed directly by drizzle-kit at generation time.
 *
 * Usage:
 *   pnpm --filter @rajahinta/data-platform exec drizzle-kit generate
 *   pnpm --filter @rajahinta/data-platform exec drizzle-kit migrate
 *
 * The `dbCredentials` field is used only by `drizzle-kit migrate` (applying
 * migrations at deploy/CI time).  It is safe to leave with a default because
 * `generate` does not read it, and `migrate` fails with a clear connection
 * error when DATABASE_URL is not set.
 *
 * @see ARCHITECTURE.md §15.1 — schema.ts is the single source of truth.
 */
export default defineConfig({
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/schema.ts',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});