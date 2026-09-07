import { defineConfig } from 'vitest/config';
import baseConfig from '../../vitest.config';

export default defineConfig({
  ...baseConfig,
  // Core-domain resolves to its TypeScript SOURCES for the Worker's test
  // graph (tsconfig paths parity — see apps/api-worker/tsconfig.json);
  // the wrangler bundle re-points the same specifier at the source-subset
  // bridge (wrangler.jsonc alias → src/adapters/core-domain-bridge.ts).
  resolve: {
    alias: {
      '@rajahinta/core-domain': new URL(
        '../../packages/core-domain/src/index.ts',
        import.meta.url,
      ).pathname,
      // workerd built-ins (task 4.2): the entry script re-exports
      // IngestionWorkflow for runtime registration, and the Node vitest
      // pool cannot resolve `cloudflare:*` — the alias lands on the
      // collection-time stub (src/testing/cloudflare-modules-stub.ts).
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
    include: ['src/**/*.test.ts'],
    // The auth routes run real 600k-iteration PBKDF2 derivations per
    // request (hashPassword/verifyPassword + the login timing-parity
    // envelope); the AUTH-burst and reset tests issue ~11 such requests
    // and exceed the 5s vitest default whenever packages run in parallel.
    // Matches the 30s convention in vitest.config.d1.ts and the e2e
    // configs. No assertion is affected — this only lifts the ceiling.
    testTimeout: 30_000,
  },
});
