/**
 * Playwright config for the browser-level E2E suite (task 12.2,
 * change technical-assessment-remediation).
 *
 * Covers the user journeys the HTTP-level suite cannot: age gate,
 * calculator flow, compare sorting, and account export — against the
 * real composed stack (frontend :3001, backend :3000, Postgres, Redis,
 * migrations + staging seed). The stack is booted externally —
 * `scripts/dev-up.sh` locally and identically in CI — so this config
 * only drives the browser, never the services.
 *
 * @module BrowserE2EPlaywrightConfig
 */
import { defineConfig } from '@playwright/test';

/**
 * Frontend origin. The dev stack serves Next.js on :3001 with
 * NEXT_PUBLIC_API_URL pointing at the backend on :3000; overridable for
 * runs against a differently-placed stack.
 */
const FRONTEND_BASE_URL =
  process.env.FRONTEND_BASE_URL ?? 'http://localhost:3001';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,

  // Next.js dev-mode first-compiles can take tens of seconds per route;
  // the journeys themselves are fast once the page is compiled.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  // Deterministic journeys — a retry must never mask a real flake.
  retries: 0,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  outputDir: 'test-results',

  use: {
    baseURL: FRONTEND_BASE_URL,
    headless: true,
    locale: 'fi-FI',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
