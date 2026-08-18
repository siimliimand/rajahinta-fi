import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    root: __dirname,
    passWithNoTests: true,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@rajahinta/core-domain': path.resolve(__dirname, 'packages/core-domain/src'),
      '@rajahinta/frontend': path.resolve(__dirname, 'apps/frontend/src'),
    },
  },
});
