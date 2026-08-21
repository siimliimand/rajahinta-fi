import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Workspace packages whose TS sources need decorator-metadata transpilation.
 * esbuild (vitest's default) emits NO design:paramtypes, so NestJS
 * constructor injection breaks for any class imported from these packages.
 * This plugin re-transpiles them through the real TypeScript compiler with
 * `emitDecoratorMetadata: true`.
 */
const WORKSPACE_SRC =
  /[\\/](packages)[\\/](core-domain|application-api|data-platform)[\\/].*\.ts$/;

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
    include: ['apps/backend/tests/e2e/**/*.test.ts'],
    setupFiles: [path.resolve(__dirname, 'apps/backend/tests/e2e/setup.ts')],
    root: __dirname,
    passWithNoTests: true,
    testTimeout: 30_000,
  },
  plugins: [tsTranspilePlugin],
  resolve: {
    alias: {
      '@rajahinta/core-domain': path.resolve(__dirname, 'packages/core-domain/src'),
      '@rajahinta/frontend': path.resolve(__dirname, 'apps/frontend/src'),
      '@rajahinta/application-api': path.resolve(__dirname, 'packages/application-api/src'),
      '@rajahinta/data-platform': path.resolve(__dirname, 'packages/data-platform/src'),
      // pnpm instantiates @nestjs/core twice (two peer-set variants), giving
      // two Reflector/classes and breaking DI across packages. Pin every
      // resolution to one physical instance for the e2e run.
      '@nestjs/core': path.dirname(
        createRequire(import.meta.url).resolve('@nestjs/core/package.json'),
      ),
    },
  },
});
