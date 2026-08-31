import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration — Cloudflare D1 (SQLite dialect).
 *
 * SQLite counterpart of `drizzle.config.ts`: generates committed SQL
 * migrations from the D1 schema (`src/d1/schema.ts`) into
 * `src/d1/migrations/`, the directory applied by `wrangler d1 migrations`
 * in the deploy pipeline (staging automatic, production gated — design
 * D2). drizzle-kit's output layout (`0000_*.sql` plus `meta/_journal.json`
 * and snapshots) is consumed by wrangler as an ordered list of `.sql`
 * files, which is a compatible migrations directory.
 *
 * This file is excluded from the package build (tsconfig.json includes
 * only `src/**`) and from eslint (`*.config.*`), and is consumed directly
 * by drizzle-kit at generation time:
 *
 *   pnpm --filter @rajahinta/data-platform exec drizzle-kit generate --config=drizzle.d1.config.ts
 *
 * The `dbCredentials` field is only read by `drizzle-kit push|migrate|studio`
 * against a local SQLite file; `generate` (the committed-migration flow)
 * does not touch it. No secrets — a local dev file path only.
 */
export default defineConfig({
  dialect: 'sqlite',
  out: './src/d1/migrations',
  schema: './src/d1/schema.ts',
  dbCredentials: {
    url: process.env.D1_SQLITE_PATH ?? './src/d1/migrations/local-dev.sqlite',
  },
});
