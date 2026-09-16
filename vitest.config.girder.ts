/**
 * Root vitest config for the girder offline baseline run.
 *
 * SINGLE vitest invocation over the offline-capable suites, producing ONE
 * junit report (girder passes --reporter=junit --outputFile=/workspace/{report_xml}).
 *
 * - apps/* and packages/* reuse each workspace's existing vitest.config.ts
 *   through project globs (each has its own config extending the root base).
 * - apps/backend and packages/data-platform are expanded inline ONLY to add
 *   per-file excludes: those test files read source paths relative to
 *   process.cwd(), which is the package dir when run standalone but the repo
 *   root in any merged multi-project run (repo-code assumption, not an
 *   offline problem).
 * - tests/compliance, tests/golden and the node:sqlite D1 harness
 *   (vitest.config.d1.ts) are imported and wrapped as named projects so
 *   their alias/plugin/module setups are reused verbatim.
 *
 * Deliberately NOT included (need network / external services / browser):
 * - tests/integration (real PostgreSQL; files self-skip without DATABASE_URL)
 * - tests/load (artillery), tests/e2e-browser (playwright)
 *
 * @module GirderVitestConfig
 */
import { configDefaults, defineConfig } from 'vitest/config';
import backendConfig from './apps/backend/vitest.config';
import dataPlatformConfig from './packages/data-platform/vitest.config';
import complianceConfig from './tests/compliance/vitest.config';
import goldenConfig from './tests/golden/vitest.config';
import d1Config from './vitest.config.d1';

export default defineConfig({
  test: {
    projects: [
      'apps/api-worker',
      'apps/email-worker',
      'apps/frontend',
      'packages/core-domain',
      'packages/application-api',
      'packages/data-acquisition',
      {
        ...backendConfig,
        test: {
          ...backendConfig.test,
          name: 'backend',
          exclude: [
            ...configDefaults.exclude,
            // reads resolve('src/history-recording.module.ts') from cwd —
            // only valid when backend runs standalone (see file header).
            'src/__tests__/history-recording-wiring.test.ts',
          ],
        },
      },
      {
        ...dataPlatformConfig,
        test: {
          ...dataPlatformConfig.test,
          name: 'data-platform',
          exclude: [
            ...configDefaults.exclude,
            // scan/read src/d1/migrations relative to cwd — only valid when
            // data-platform runs standalone (see file headers).
            'src/repositories/d1/__tests__/migration-container-type.test.ts',
            'src/repositories/d1/__tests__/migration-email-auth.test.ts',
            'src/seed/d1/__tests__/d1-seed.test.ts',
          ],
        },
      },
      { ...complianceConfig, test: { ...complianceConfig.test, name: 'compliance' } },
      { ...goldenConfig, test: { ...goldenConfig.test, name: 'golden' } },
      { ...d1Config, test: { ...d1Config.test, name: 'd1' } },
    ],
  },
});
