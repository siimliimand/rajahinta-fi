/**
 * Route-port parity tests for GET /api/v1/feature-flags (Nest
 * FeatureFlagsController port). Regression guard for the migration gap
 * where the Worker never served this endpoint and every frontend flag
 * bootstrap fell back to all-off.
 *
 * @module FeatureFlagsRoutesTest
 */

import { describe, expect, it } from 'vitest';
import { ALL_FLAGS } from '../../middleware/feature-flags';
import { buildApp, openMigratedD1, permissiveEnv, request } from './harness';

describe('GET /api/v1/feature-flags', () => {
  it('answers 200 with the full boolean map — no auth, no age gate', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/feature-flags');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { flags: Record<string, unknown> };
    expect(Object.keys(body.flags).sort()).toEqual([...ALL_FLAGS].sort());
    expect(Object.values(body.flags).every((v) => typeof v === 'boolean')).toBe(true);
  });

  it('reflects the env vars — on flag true, absent flag false', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1, { FF_EVENT_CALCULATOR: 'true' }),
      '/api/v1/feature-flags',
    );
    const body = (await res.json()) as {
      flags: Record<string, boolean>;
    };
    expect(body.flags.EVENT_CALCULATOR).toBe(true);
    expect(body.flags.GROUP_ORDER_LEDGER).toBe(false);
  });

  it('exposes booleans only — rollout percentages never leak', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1, {
        FF_CURATED_LISTS: '25',
        FF_ROLLOUT_CURATED_LISTS: '50',
      }),
      '/api/v1/feature-flags',
    );
    const body = (await res.json()) as {
      flags: Record<string, boolean>;
    };
    expect(body.flags.CURATED_LISTS).toBe(true);
    expect(JSON.stringify(body)).not.toContain('ollout');
    expect(Object.values(body.flags).every((v) => typeof v === 'boolean')).toBe(true);
  });
});
