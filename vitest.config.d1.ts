/**
 * Vitest config for the D1 integration suites (task 2.7, change
 * migrate-to-cloudflare).
 *
 * Runs the ports of the real-Postgres suites in tests/integration/d1/ on
 * the node:sqlite D1 harness (committed migrations applied per suite) —
 * plain vitest, NOT vitest-pool-workers: these suites compose NestJS
 * testing modules, supertest, and the workspace TypeScript import graph,
 * and the D1 behavior under test needs no workerd semantics.
 *
 * The plugin + alias block mirrors tests/integration/vitest.config.ts
 * (kept separate on purpose: that config gates on TEST_DATABASE_URL and
 * runs the pg stack; this one is self-contained). Suite files carry the
 * same mitigations rationale as the integration config's header:
 * decorator-metadata transpilation for workspace sources and single-
 * instance @nestjs pins (ARCHITECTURE.md §15).
 *
 * Wired as `pnpm test:d1` — separate from the default unit run, matching
 * the test:integration / test:golden script convention.
 *
 * @module D1VitestConfig
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const __dirname = import.meta.dirname;
const REPO_ROOT = path.resolve(__dirname);
const DATA_PLATFORM_NM = path.resolve(REPO_ROOT, 'packages/data-platform/node_modules');
const API_WORKER_NM = path.resolve(REPO_ROOT, 'apps/api-worker/node_modules');

/**
 * Workspace sources needing decorator-metadata transpilation — mirrors the
 * integration config's plugin (esbuild emits no design:paramtypes, which
 * breaks NestJS constructor injection).
 */
const WORKSPACE_SRC =
  /[\\/](packages)[\\/](core-domain|application-api|data-platform|data-acquisition)[\\/].*\.ts$/;

const tsTranspilePlugin = {
  name: 'ts-transpile-workspace',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (id.includes('node_modules') || id.endsWith('.d.ts')) return null;
    if (!WORKSPACE_SRC.test(id)) return null;
    const out = ts.transpileModule(code, {
      fileName: id,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        verbatimModuleSyntax: false,
        sourceMap: true,
        inlineSources: false,
      },
    });
    return {
      code: out.outputText,
      map: out.sourceMapText ?? null,
    };
  },
};

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/d1/**/*.test.ts'],
    root: REPO_ROOT,
    passWithNoTests: false,
    testTimeout: 30_000,
  },
  plugins: [tsTranspilePlugin],
  resolve: {
    alias: {
      '@rajahinta/core-domain': path.resolve(REPO_ROOT, 'packages/core-domain/src'),
      '@rajahinta/data-platform': path.resolve(REPO_ROOT, 'packages/data-platform/src'),
      '@rajahinta/application-api': path.resolve(REPO_ROOT, 'packages/application-api/src'),
      '@rajahinta/data-acquisition': path.resolve(REPO_ROOT, 'packages/data-acquisition/src'),
      // pnpm instantiates @nestjs/core twice (two peer-set variants), giving
      // two Reflector/classes and breaking DI across packages. Pin every
      // resolution to one physical instance (ARCHITECTURE.md §15).
      '@nestjs/core': path.dirname(
        createRequire(import.meta.url).resolve('@nestjs/core/package.json'),
      ),
      // supertest is an apps/backend devDependency; this suite lives at the
      // repo root where pnpm does not symlink it. Pin to the backend copy.
      supertest: path.dirname(
        createRequire(import.meta.url).resolve('supertest/package.json', {
          paths: [path.resolve(REPO_ROOT, 'apps/backend')],
        }),
      ),
      // @nestjs/testing likewise — same reason as supertest.
      '@nestjs/testing': path.dirname(
        createRequire(import.meta.url).resolve('@nestjs/testing/package.json', {
          paths: [path.resolve(REPO_ROOT, 'apps/backend')],
        }),
      ),
      // @nestjs/common — needed for runtime imports of guards and
      // exceptions when tests import from application-api directly.
      '@nestjs/common': path.dirname(
        createRequire(import.meta.url).resolve('@nestjs/common/package.json', {
          paths: [path.resolve(REPO_ROOT, 'apps/backend')],
        }),
      ),
      // drizzle-orm is a data-platform dependency, not a root one — pin to
      // the data-platform copy, the same instance its repositories use.
      'drizzle-orm': path.resolve(
        REPO_ROOT,
        'packages/data-platform/node_modules/drizzle-orm',
      ),
      // The api-worker app graph (createApp, cron handlers — price-alerts
      // d1 suite) imports `cloudflare:workers`/`cloudflare:workflows`
      // through src/workflows, which the Node vitest pool cannot resolve.
      // Mirrors tests/integration/vitest.config.ts (this file mirrors that
      // config by design): same collection-time stub the api-worker's own
      // vitest config uses.
      'cloudflare:workers': path.resolve(
        REPO_ROOT,
        'apps/api-worker/src/testing/cloudflare-modules-stub.ts',
      ),
      'cloudflare:workflows': path.resolve(
        REPO_ROOT,
        'apps/api-worker/src/testing/cloudflare-modules-stub.ts',
      ),
    },
    // Include apps/api-worker's node_modules so hono/zod/reflect-metadata
    // (api-worker dependencies, not root ones) resolve for the worker app
    // graph the price-alerts d1 suite composes. Same reason as
    // DATA_PLATFORM_NM above.
    modules: [DATA_PLATFORM_NM, API_WORKER_NM, 'node_modules'],
  },
});
