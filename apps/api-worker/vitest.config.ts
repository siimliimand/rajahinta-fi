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
    },
  },
  test: {
    ...baseConfig.test,
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
  },
});
