/**
 * Vitest config for the composition smoke test.
 *
 * Runs from the repository root so workspace package aliases resolve through
 * pnpm workspace symlinks.  Pattern follows e2e config.
 *
 * @module CompositionVitestConfig
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';

const __dirname = import.meta.dirname;
// Config is at apps/backend/tests/composition/vitest.config.ts;
// repo root is four levels up (composition → tests → backend → apps → repo)
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/backend/tests/composition/**/*.test.ts'],
    root: REPO_ROOT,
    passWithNoTests: false,
    testTimeout: 15_000,
  },
});