import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Config is at tests/load/vitest.config.ts; repo root is two levels up
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    root: REPO_ROOT,
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      '@rajahinta/core-domain': path.resolve(REPO_ROOT, 'packages/core-domain/src'),
    },
  },
});