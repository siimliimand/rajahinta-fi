/**
 * Vitest config for the real-stack integration test suite.
 *
 * Runs from the repository root so workspace package aliases resolve through
 * pnpm workspace symlinks.  Pattern follows compliance/golden config.
 *
 * Includes data-platform's node_modules path for drizzle-orm and pg
 * resolution (dependencies of the data-platform package, not the root).
 *
 * Suite 2 (historical-price-flow) boots a NestJS HTTP app, so this config
 * carries the two ARCHITECTURE.md §15 mitigations proven by
 * vitest.config.e2e.ts: (1) decorator-metadata transpilation for workspace
 * sources — esbuild emits no design:paramtypes, which breaks NestJS
 * constructor injection — and (2) a single-instance @nestjs/core pin, since
 * pnpm instantiates @nestjs/core twice (two peer-set variants), giving two
 * Reflector/class identities that break DI across packages.
 *
 * @module IntegrationVitestConfig
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const __dirname = import.meta.dirname;
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DATA_PLATFORM_NM = path.resolve(REPO_ROOT, 'packages/data-platform/node_modules');

/**
 * Workspace sources needing decorator-metadata transpilation — mirrors the
 * e2e config's plugin, extended with apps/backend (the offer-change hook
 * adapter composed by the historical-flow test lives there).
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
    include: ['tests/integration/**/*.test.ts'],
    // Schema once, before any file — see tests/integration/global-setup.ts
    // (Vitest 3 schedules data-lifecycle/durability-restart ahead of the
    // file that used to migrate in beforeAll).
    globalSetup: [path.resolve(__dirname, 'global-setup.ts')],
    root: REPO_ROOT,
    passWithNoTests: false,
    testTimeout: 30_000, // includes DB migration overhead
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
      // repo root where pnpm does not symlink it. Pin to the backend copy
      // (the same instance the e2e suite resolves through its own location).
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
      // @nestjs/common — needed for runtime imports of guards and exceptions
      // when tests import from this package directly (not through application-api).
      '@nestjs/common': path.dirname(
        createRequire(import.meta.url).resolve('@nestjs/common/package.json', {
          paths: [path.resolve(REPO_ROOT, 'apps/backend')],
        }),
      ),
      // drizzle-orm is a data-platform dependency, not a root one — tests
      // under tests/integration import it directly (sql/eq helpers) and
      // pnpm does not hoist it to the root node_modules. Pin to the
      // data-platform copy, the same instance its repositories use.
      // (Direct path: drizzle-orm's exports map blocks ./package.json
      // subpath resolution.)
      'drizzle-orm': path.resolve(
        REPO_ROOT,
        'packages/data-platform/node_modules/drizzle-orm',
      ),
    },
    // Include data-platform's node_modules so `pg`, `drizzle-orm`, etc.
    // (which are data-platform dependencies, not root dependencies) are
    // resolvable by Vitest.
    modules: [DATA_PLATFORM_NM, 'node_modules'],
  },
});
