import { defineConfig } from 'vitest/config';
import baseConfig from '../../vitest.config';

/**
 * E2E config (task 3.9) — same module graph as the unit config (core-domain
 * TypeScript sources, cloudflare:* stubs) but pointing at tests/e2e/, which
 * drives the FULL createApp() over HTTP-level requests against the fake-D1
 * harness and in-memory DO namespaces (the established route-port pattern).
 *
 * Run with: pnpm --filter @rajahinta/api-worker test:e2e
 */
export default defineConfig({
  ...baseConfig,
  resolve: {
    alias: {
      '@rajahinta/core-domain': new URL(
        '../../packages/core-domain/src/index.ts',
        import.meta.url,
      ).pathname,
      'cloudflare:workers': new URL(
        './src/testing/cloudflare-modules-stub.ts',
        import.meta.url,
      ).pathname,
      'cloudflare:workflows': new URL(
        './src/testing/cloudflare-modules-stub.ts',
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    ...baseConfig.test,
    root: import.meta.dirname,
    include: ['tests/**/*.test.ts'],
  },
});
