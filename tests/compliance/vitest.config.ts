import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Config is at tests/compliance/vitest.config.ts; repo root is two levels up
const REPO_ROOT = path.resolve(__dirname, '..', '..');
// Task 5.1 (hedge-dedup-confidence-meter) renders the REAL frontend result
// views server-side (react-dom/server, node environment — no jsdom), so
// react / react-dom / next-intl must resolve to the frontend package's
// physical copies: pnpm only places them in apps/frontend/node_modules, and
// pinning the alias also guarantees ONE react instance across the test file
// and the component graph (dual-react breaks hooks).
const FRONTEND_NM = path.resolve(REPO_ROOT, 'apps/frontend/node_modules');

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
    // .test.tsx joined for the hedge-dedup-confidence-meter 5.1 view
    // suites (JSX elements rendered through react-dom/server).
    include: ['tests/compliance/**/*.test.ts', 'tests/compliance/**/*.test.tsx'],
    root: REPO_ROOT,
    passWithNoTests: false,
  },
  // Same plugin + alias support vitest.config.d1.ts gives the api-worker
  // route-harness graph (documented per-alias there); nothing here affects
  // the pre-existing compliance tests' imports beyond decorator-metadata
  // transpilation of workspace package sources.
  plugins: [tsTranspilePlugin],
  resolve: {
    // Array form (required to mix plain-string aliases with regex finds).
    alias: [
      { find: '@rajahinta/core-domain', replacement: path.resolve(REPO_ROOT, 'packages/core-domain/src') },
      { find: '@rajahinta/frontend', replacement: path.resolve(REPO_ROOT, 'apps/frontend/src') },
      { find: '@rajahinta/data-platform', replacement: path.resolve(REPO_ROOT, 'packages/data-platform/src') },
      // Frontend source imports resolve through the same '@' → src mapping
      // apps/frontend/vitest.config.ts gives the component tests.
      { find: '@', replacement: path.resolve(REPO_ROOT, 'apps/frontend/src') },
      // The 5.1 view suites import react / react-dom / next-intl directly
      // from tests/compliance — resolve them (and dedupe them for the whole
      // component graph) to the frontend package's physical copies. The
      // next-intl subpath exports don't resolve through a bare directory
      // alias, so each specifier maps to its production ESM file.
      { find: /^react$/, replacement: path.join(FRONTEND_NM, 'react') },
      {
        find: /^react-dom(\/.*)?$/,
        replacement: path.join(FRONTEND_NM, 'react-dom') + '$1',
      },
      {
        find: /^next-intl$/,
        replacement: path.join(
          FRONTEND_NM,
          'next-intl/dist/esm/production/index.react-client.js',
        ),
      },
      {
        find: /^next-intl\/navigation$/,
        replacement: path.join(
          FRONTEND_NM,
          'next-intl/dist/esm/production/navigation.react-client.js',
        ),
      },
      {
        find: /^next-intl\/server$/,
        replacement: path.join(
          FRONTEND_NM,
          'next-intl/dist/esm/production/server.react-server.js',
        ),
      },
      {
        find: /^next-intl\/routing$/,
        replacement: path.join(
          FRONTEND_NM,
          'next-intl/dist/esm/production/routing.js',
        ),
      },
      // pnpm instantiates @nestjs/core twice (two peer-set variants), giving
      // two Reflector/classes and breaking DI across packages. Pin every
      // resolution to one physical instance (ARCHITECTURE.md §15).
      {
        find: '@nestjs/core',
        replacement: path.dirname(
          createRequire(import.meta.url).resolve('@nestjs/core/package.json'),
        ),
      },
      // @nestjs/common — runtime imports of guards/exceptions in the worker
      // app graph; pinned to one physical instance like @nestjs/core.
      {
        find: '@nestjs/common',
        replacement: path.dirname(
          createRequire(import.meta.url).resolve('@nestjs/common/package.json', {
            paths: [path.resolve(REPO_ROOT, 'apps/backend')],
          }),
        ),
      },
      // drizzle-orm is a data-platform dependency, not a root one — pin to
      // the data-platform copy, the same instance its repositories use.
      {
        find: 'drizzle-orm',
        replacement: path.resolve(
          REPO_ROOT,
          'packages/data-platform/node_modules/drizzle-orm',
        ),
      },
      // The api-worker app graph (createApp) imports `cloudflare:workers`/
      // `cloudflare:workflows` through src/workflows, which the Node vitest
      // pool cannot resolve — collection-time stub, same as the d1 config.
      {
        find: 'cloudflare:workers',
        replacement: path.resolve(
          REPO_ROOT,
          'apps/api-worker/src/testing/cloudflare-modules-stub.ts',
        ),
      },
      {
        find: 'cloudflare:workflows',
        replacement: path.resolve(
          REPO_ROOT,
          'apps/api-worker/src/testing/cloudflare-modules-stub.ts',
        ),
      },
    ],
    // Include data-platform's and api-worker's node_modules so drizzle /
    // hono / zod / reflect-metadata resolve for the worker app graph the
    // 5.5 compliance test composes. Same reason as CORE_DOMAIN_NM above.
    modules: [CORE_DOMAIN_NM, DATA_PLATFORM_NM, API_WORKER_NM, 'node_modules'],
  },
});
