/**
 * Merchants route port (task 3.6) — Hono re-host of
 * MerchantReliabilityController (packages/application-api/src/merchants/).
 *
 * Guard composition (Nest class-guard order preserved):
 *   GET /api/v1/merchants/reliability
 *     LaunchGate(PRICE_DATA) → AgeGate → FeatureFlag(ADVANCED_FEATURES)
 *
 * Scoring is factual only — see src/services/merchant-reliability.ts for
 * the governance fail-closed policy (no D1 source-governance store yet).
 *
 * @module MerchantsRoutes
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ageGate } from '../middleware/age-gate';
import { requireFeatureFlag, FeatureFlag } from '../middleware/feature-flags';
import { requireLaunchGate } from '../middleware/launch-gate';
import { getReliabilityScores } from '../services/merchant-reliability';

async function getReliability(c: import('hono').Context<AppEnv>): Promise<Response> {
  return c.json({ merchants: await getReliabilityScores(c.env.DB) });
}

/** Register the merchants handler with its Nest class-guard stack. */
export function registerMerchantsRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.on(
    'GET',
    '/api/v1/merchants/reliability',
    requireLaunchGate('PRICE_DATA'),
    ageGate(),
    requireFeatureFlag(FeatureFlag.ADVANCED_FEATURES),
  );
  app.get('/api/v1/merchants/reliability', getReliability);
  return app;
}
