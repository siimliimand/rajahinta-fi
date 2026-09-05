import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Config is at tests/compliance/vitest.config.ts; repo root is two levels up
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Path to core-domain's node_modules for NestJS decorator support.
// In pnpm workspaces, @nestjs/common is only available in the package
// that declares it as a dependency (core-domain), not at the root.
const CORE_DOMAIN_NM = path.resolve(REPO_ROOT, 'packages/core-domain/node_modules');
// Task 5.5 (trip affiliate neutrality) imports the api-worker route-test
// harness — the same graph tests/integration/d1 drives — so data-platform
// and api-worker dependencies resolve here too.
const DATA_PLATFORM_NM = path.resolve(REPO_ROOT, 'packages/data-platform/node_modules');
const API_WORKER_NM = path.resolve(REPO_ROOT, 'apps/api-worker/node_modules');

/**
 * Workspace sources needing decorator-metadata transpilation — mirrors the
 * block in vitest.config.d1.ts verbatim (esbuild emits no design:paramtypes,
 * which breaks NestJS constructor injection).
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
    include: ['tests/compliance/**/*.test.ts'],
    root: REPO_ROOT,
    passWithNoTests: false,
  },
  // Same plugin + alias support vitest.config.d1.ts gives the api-worker
  // route-harness graph (documented per-alias there); nothing here affects
  // the pre-existing compliance tests' imports beyond decorator-metadata
  // transpilation of workspace package sources.
  plugins: [tsTranspilePlugin],
  resolve: {
    alias: {
      '@rajahinta/core-domain': path.resolve(REPO_ROOT, 'packages/core-domain/src'),
      '@rajahinta/frontend': path.resolve(REPO_ROOT, 'apps/frontend/src'),
      '@rajahinta/data-platform': path.resolve(REPO_ROOT, 'packages/data-platform/src'),
      // pnpm instantiates @nestjs/core twice (two peer-set variants), giving
      // two Reflector/classes and breaking DI across packages. Pin every
      // resolution to one physical instance (ARCHITECTURE.md §15).
      '@nestjs/core': path.dirname(
        createRequire(import.meta.url).resolve('@nestjs/core/package.json'),
      ),
      // @nestjs/common — runtime imports of guards/exceptions in the worker
      // app graph; pinned to one physical instance like @nestjs/core.
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
      // The api-worker app graph (createApp) imports `cloudflare:workers`/
      // `cloudflare:workflows` through src/workflows, which the Node vitest
      // pool cannot resolve — collection-time stub, same as the d1 config.
      'cloudflare:workers': path.resolve(
        REPO_ROOT,
        'apps/api-worker/src/testing/cloudflare-modules-stub.ts',
      ),
      'cloudflare:workflows': path.resolve(
        REPO_ROOT,
        'apps/api-worker/src/testing/cloudflare-modules-stub.ts',
      ),
    },
    // Include data-platform's and api-worker's node_modules so drizzle /
    // hono / zod / reflect-metadata resolve for the worker app graph the
    // 5.5 compliance test composes. Same reason as CORE_DOMAIN_NM above.
    modules: [CORE_DOMAIN_NM, DATA_PLATFORM_NM, API_WORKER_NM, 'node_modules'],
  },
});
