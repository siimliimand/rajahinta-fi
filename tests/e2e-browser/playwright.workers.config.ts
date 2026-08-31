/**
 * Playwright config for the browser-level E2E suite against the
 * Cloudflare Workers stack (task 5.4, change migrate-to-cloudflare).
 *
 * The journeys (age gate, calculator, compare sorting, account export)
 * are the SAME spec files the legacy config
 * (playwright.config.ts — docker-compose stack, kept until decommission
 * 6.7) drives: identical assertions and selectors, a different stack
 * harness. What changes is only what backs the pages:
 *
 *   - API Worker (apps/api-worker, Hono on Workers) via `wrangler dev`
 *     on :8788, against local D1 migrated + seeded by the task-2.6
 *     scripts plus the journey fixtures (seed-journeys.d1.sql);
 *   - frontend (apps/frontend, OpenNext) via `wrangler dev` on :8787,
 *     built with NEXT_PUBLIC_API_URL=http://localhost:8788 inlined at
 *     build time (apps/frontend/OPENNEXT.md, task 5.2 same-zone routing).
 *
 * The webServer array boots both: entry order is sequential and each
 * entry is awaited before the next starts, so the API Worker is ready
 * (GET /api/v1/health/ready stops answering 503) before the frontend
 * entry builds against it. The frontend Worker origin is the API's
 * CORS_ORIGIN var — the genuine cross-origin CORS + httpOnly-cookie
 * flow, on Workers this time.
 *
 * Deployed targets (staging / per-PR preview): set E2E_BASE_URL to the
 * deployed frontend origin and NO local web servers are started — the
 * API base is already inlined into that deployment's build (the task-6.5
 * deploy-workflow pattern; see README.md).
 *
 * @module BrowserE2EWorkersPlaywrightConfig
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

/**
 * Frontend origin of a DEPLOYED stack (preview or staging). When set,
 * the suite drives that deployment directly and boots nothing locally.
 */
const EXTERNAL_BASE_URL = process.env.E2E_BASE_URL;

/** Frontend Worker port — apps/frontend owns 8787 (OPENNEXT.md). */
const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 8787);
/** API Worker port — :8788 for concurrent local Workers (OPENNEXT.md). */
const API_PORT = Number(process.env.E2E_API_PORT ?? 8788);

const FRONTEND_BASE_URL =
  EXTERNAL_BASE_URL ?? `http://localhost:${FRONTEND_PORT}`;

/** Boot commands run with the config directory as cwd (Playwright default). */
const localWebServers = EXTERNAL_BASE_URL
  ? undefined
  : ([
      {
        name: 'api-worker',
        command: 'bash boot-workers-stack.sh api',
        url: `http://localhost:${API_PORT}/api/v1/health/ready`,
        // Migrate + seed + journey fixtures + wrangler boot — fast, but
        // give the first cold run room (workerd binary, D1 state).
        timeout: 300_000,
        reuseExistingServer: !process.env.CI,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
        env: {
          E2E_API_PORT: String(API_PORT),
          E2E_FRONTEND_PORT: String(FRONTEND_PORT),
        },
      },
      {
        name: 'frontend-worker',
        command: 'bash boot-workers-stack.sh frontend',
        url: `http://localhost:${FRONTEND_PORT}`,
        // `next build` + OpenNext bundling takes minutes on a cold cache.
        timeout: 900_000,
        reuseExistingServer: !process.env.CI,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
        env: {
          E2E_API_PORT: String(API_PORT),
          E2E_FRONTEND_PORT: String(FRONTEND_PORT),
        },
      },
    ] as const);

const config: PlaywrightTestConfig = {
  testDir: '.',
  fullyParallel: false,
  workers: 1,

  // Same budgets as the legacy config — the journeys are unchanged.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  // Deterministic journeys — a retry must never mask a real flake.
  retries: 0,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-workers', open: 'never' }],
  ],

  outputDir: 'test-results-workers',

  use: {
    baseURL: FRONTEND_BASE_URL,
    headless: true,
    locale: 'fi-FI',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  ...(localWebServers ? { webServer: [...localWebServers] } : {}),

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
};

export default defineConfig(config);
