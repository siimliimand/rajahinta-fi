import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Test config for the cutover scripts (task 6.6, change
 * migrate-to-cloudflare): scripts/etl-pg-to-d1.ts transform/validation
 * fixtures and scripts/dual-run-parity.ts normalization/stub cases.
 * Run: pnpm vitest run --config scripts/__tests__/vitest.config.ts
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    dir: fileURLToPath(new URL('.', import.meta.url)),
    include: ['**/*.test.ts'],
  },
});
