/**
 * Vitest config for the real-stack integration test suite.
 *
 * Runs from the repository root so workspace package aliases resolve through
 * pnpm workspace symlinks.  Pattern follows compliance/golden config.
 *
 * Includes data-platform's node_modules path for drizzle-orm and pg
 * resolution (dependencies of the data-platform package, not the root).
 *
 * @module IntegrationVitestConfig
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';

const __dirname = import.meta.dirname;
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DATA_PLATFORM_NM = path.resolve(REPO_ROOT, 'packages/data-platform/node_modules');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    root: REPO_ROOT,
    passWithNoTests: false,
    testTimeout: 30_000, // includes DB migration overhead
  },
  resolve: {
    alias: {
      '@rajahinta/core-domain': path.resolve(REPO_ROOT, 'packages/core-domain/src'),
      '@rajahinta/data-platform': path.resolve(REPO_ROOT, 'packages/data-platform/src'),
    },
    // Include data-platform's node_modules so `pg`, `drizzle-orm`, etc.
    // (which are data-platform dependencies, not root dependencies) are
    // resolvable by Vitest.
    modules: [DATA_PLATFORM_NM, 'node_modules'],
  },
});