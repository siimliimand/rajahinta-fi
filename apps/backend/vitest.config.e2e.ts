/**
 * Vitest configuration for backend e2e tests.
 *
 * Runs from the repository root so workspace packages resolve through the
 * pnpm workspace symlinks in node_modules.
 *
 * @module VitestE2EConfig
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';

const __dirname = import.meta.dirname;
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/backend/tests/e2e/**/*.test.ts'],
    root: REPO_ROOT,
    passWithNoTests: false,
    testTimeout: 15_000,
  },
});