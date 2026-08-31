// @ts-check

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // *.d.ts at any depth is generated (e.g. next-env.d.ts, which Next 15
  // regenerates with a path triple-slash reference to .next/types).
  // .wrangler/.open-next are wrangler build/dev artifact dirs — their
  // bundled JS is minified workerd output, never hand-written code, and
  // local `wrangler dev` runs recreate them (absent in CI checkouts).
  { ignores: ['**/dist/', '**/.next/', '**/node_modules/', '**/*.d.ts', '**/.wrangler/', '**/.open-next/', '*.config.*', '.opencode/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
  },
  {
    rules: {
      // Allow underscore-prefixed unused variables (common pattern for destructured args)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Allow `any` for now — can be tightened incrementally
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);