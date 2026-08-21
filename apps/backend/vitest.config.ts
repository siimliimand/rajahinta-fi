import { defineConfig } from 'vitest/config';
import baseConfig from '../../vitest.config';

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    root: import.meta.dirname,
    include: [
      'src/**/*.test.ts',
      // e2e has its own dedicated config (vitest.config.e2e.ts: workspace src
      // aliases + decorator-metadata transform) and runs via `pnpm test:e2e`.
    ],
  },
});