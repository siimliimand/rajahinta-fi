// @ts-check

// Frontend lint — flat config (ESLint 9). Replaces `next lint`, which
// Next 16 removed. The next/core-web-vitals + next/typescript flat
// configs carry their own plugin dependencies transitively, so this
// file needs nothing beyond eslint + eslint-config-next. Repo-wide
// gating still runs from the root eslint.config.mjs (`pnpm run lint`
// at the root); this config adds the Next-specific rules for
// workspace-scoped `pnpm --filter @rajahinta/frontend lint` runs.

import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default [
  // Generated/artifact output — mirrors the root eslint.config.mjs
  // ignores: .next/.open-next/.wrangler are build output (bundled CJS
  // lints as thousands of no-require-imports errors), *.d.ts is
  // generated (next-env.d.ts), *.config.* is tool config.
  {
    ignores: [
      '**/dist/',
      '**/.next/',
      '**/node_modules/',
      '**/*.d.ts',
      '**/.wrangler/',
      '**/.open-next/',
      '**/playwright-report*/',
      '*.config.*',
    ],
  },
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React Hooks v6 compiler-era rules (new in the Next 16 preset —
      // they did not exist in the 15.5-era `next lint` and gate nowhere
      // today: CI lints from the root config, which has no react-hooks
      // plugin). They flag the codebase's dominant effect idiom
      // (set-state-in-effect data fetching) en masse. Adopted as
      // warnings for incremental tightening — same posture as the root
      // config's `no-explicit-any: warn` — NOT silently weakened: the
      // classic rules-of-hooks / exhaustive-deps stay at preset error
      // severity above.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  {
    // Test renders: <a> is deliberate (Link would need a router mock the
    // UI tests intentionally avoid), and the lib/testing mock components
    // are anonymous by construction — neither is product surface, so the
    // two rules that only fire there are off for test scopes.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**', 'src/lib/testing/**'],
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
      'react/display-name': 'off',
    },
  },
];
