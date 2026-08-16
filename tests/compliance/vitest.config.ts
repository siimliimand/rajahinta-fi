import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Config is at tests/compliance/vitest.config.ts; repo root is two levels up
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Path to core-domain's node_modules for NestJS decorator support.
// In pnpm workspaces, @nestjs/common is only available in the package
// that declares it as a dependency (core-domain), not at the root.
const CORE_DOMAIN_NM = path.resolve(REPO_ROOT, 'packages/core-domain/node_modules');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/compliance/**/*.test.ts'],
    root: REPO_ROOT,
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      '@rajahinta/core-domain': path.resolve(REPO_ROOT, 'packages/core-domain/src'),
      '@rajahinta/frontend': path.resolve(REPO_ROOT, 'apps/frontend/src'),
    },
    // Include core-domain's node_modules for NestJS decorator support
    modules: [CORE_DOMAIN_NM, 'node_modules'],
  },
});