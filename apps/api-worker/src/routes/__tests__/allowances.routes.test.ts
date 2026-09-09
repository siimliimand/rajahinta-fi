/**
 * Traveller-allowance reference route tests (task 4.1, change
 * insight-surfaces) over the FULL app composition (createApp() +
 * registerAllowancesRoutes — the exact composition index.ts wires,
 * age gate + rate limit on the routes themselves) on the fake-D1
 * harness.
 *
 * Pinning here: cross-version date resolution (two PUBLISHED versions
 * with different windows, a date in each resolves that version), the
 * PENDING_CONFIRMATION invisibility, the explicit 404 when no published
 * version covers the date (never a guessed version), the no-date
 * default (today), strict ISO date validation (400), verbatim citation
 * pass-through (dataset-level AND per-limit, byte for byte), the
 * /versions history shape (superseded included, pending excluded,
 * deterministic order), the age gate (403 without confirmation) — and
 * the READ-ONLY guarantee: both GETs leave every dataset row's status
 * and confirmation stamps untouched.
 *
 * @module AllowancesRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  openMigratedD1,
  permissiveEnv,
  request,
} from './harness';
import { registerAllowancesRoutes } from '../allowances.routes';
import { D1TravellerAllowancesRepository } from '../../../../../packages/data-platform/src/repositories/d1/traveller-allowances.repository';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/**
 * index.ts registers both handlers behind their per-route age gate and
 * DEFAULT limiter (same slot as the other route ports); the test
 * composition mirrors that exactly.
 */
function allowancesApp(): ReturnType<typeof buildApp> {
  const app = buildApp();
  registerAllowancesRoutes(app);
  return app;
}

function allowancesEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, overrides);
}

const AGE_OK = { 'x-age-confirmed': 'confirmed-test-token' };

const CITATION_V1 =
  'Commission Directive 2007/74/EC, Annex (https://eur-lex.europa.example/32007L0074)';
const CITATION_V2 =
  'Commission Directive 2007/74/EC, Annex, amended by Regulation (EU) 2026/512 (https://eur-lex.europa.example/2026/512)';

interface SeedVersion {
  versionLabel: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  datasetCitation: string;
  limitCitation: string;
  beerCapLitres: number;
}

/** Append one allowance version and publish it — the only PUBLISHED path. */
async function seedPublishedVersion(
  d1: D1DatabaseLike,
  seed: SeedVersion,
): Promise<number> {
  const repo = new D1TravellerAllowancesRepository(d1);
  const version = await repo.createPendingVersion(
    {
      versionLabel: seed.versionLabel,
      sourceCitation: seed.datasetCitation,
      effectiveFrom: seed.effectiveFrom,
      effectiveTo: seed.effectiveTo,
    },
    [
      {
        category: 'beer',
        volumeCapLitres: seed.beerCapLitres,
        quantityCap: null,
        sourceCitation: seed.limitCitation,
        effectiveFrom: seed.effectiveFrom,
        effectiveTo: seed.effectiveTo,
      },
      {
        category: 'spirits',
        volumeCapLitres: 10,
        quantityCap: null,
        sourceCitation: seed.datasetCitation,
        effectiveFrom: seed.effectiveFrom,
        effectiveTo: seed.effectiveTo,
      },
    ],
  );
  const published = await repo.publish(version.dataset.id, 'ops-test');
  expect(published).not.toBeNull();
  return version.dataset.id;
}

async function seedPendingVersion(
  d1: D1DatabaseLike,
  versionLabel: string,
  effectiveFrom: string,
): Promise<void> {
  const repo = new D1TravellerAllowancesRepository(d1);
  await repo.createPendingVersion(
    {
      versionLabel,
      sourceCitation: CITATION_V1,
      effectiveFrom,
      effectiveTo: null,
    },
    [
      {
        category: 'beer',
        volumeCapLitres: 999,
        quantityCap: null,
        sourceCitation: CITATION_V1,
        effectiveFrom,
        effectiveTo: null,
      },
    ],
  );
}

interface AllowanceLimitJson {
  category: string;
  volumeCapLitres: number | null;
  quantityCap: number | null;
  sourceCitation: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

interface AllowancesJson {
  date: string;
  dataset: {
    versionLabel: string;
    sourceCitation: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  };
  limits: AllowanceLimitJson[];
}

interface VersionsJson {
  versions: {
    versionLabel: string;
    sourceCitation: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    limits: AllowanceLimitJson[];
  }[];
}

async function getAllowances(
  app: ReturnType<typeof buildApp>,
  env: Env,
  query = '',
  headers: Record<string, string> = AGE_OK,
): Promise<Response> {
  return request(app, env, `/api/v1/allowances${query}`, { headers });
}

async function getVersions(
  app: ReturnType<typeof buildApp>,
  env: Env,
  headers: Record<string, string> = AGE_OK,
): Promise<Response> {
  return request(app, env, '/api/v1/allowances/versions', { headers });
}

/** Seed the two-version calendar: v1 covers Jan–Jun 2026, v2 from July, open-ended. */
async function seedTwoPublishedVersions(d1: D1DatabaseLike): Promise<void> {
  await seedPublishedVersion(d1, {
    versionLabel: 'allowances-api-2026.1',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-07-01',
    datasetCitation: CITATION_V1,
    limitCitation: CITATION_V1,
    beerCapLitres: 110,
  });
  await seedPublishedVersion(d1, {
    versionLabel: 'allowances-api-2026.2',
    effectiveFrom: '2026-07-01',
    effectiveTo: null,
    datasetCitation: CITATION_V2,
    limitCitation: CITATION_V2,
    beerCapLitres: 108,
  });
}

// ---------------------------------------------------------------------------
// GET /api/v1/allowances — cross-version date resolution
// ---------------------------------------------------------------------------

describe('GET /api/v1/allowances', () => {
  it('resolves a date inside the first window to v1 and a later date to v2 (cross-version resolution)', async () => {
    const { d1 } = openMigratedD1();
    await seedTwoPublishedVersions(d1);
    const app = allowancesApp();
    const env = allowancesEnv(d1);

    const march = (await (
      await getAllowances(app, env, '?date=2026-03-15')
    ).json()) as AllowancesJson;
    expect(march.date).toBe('2026-03-15');
    expect(march.dataset.versionLabel).toBe('allowances-api-2026.1');
    expect(march.dataset.effectiveFrom).toBe('2026-01-01');
    expect(march.dataset.effectiveTo).toBe('2026-07-01');
    expect(march.limits.find((l) => l.category === 'beer')!.volumeCapLitres).toBe(
      110,
    );

    const august = (await (
      await getAllowances(app, env, '?date=2026-08-01')
    ).json()) as AllowancesJson;
    expect(august.dataset.versionLabel).toBe('allowances-api-2026.2');
    expect(august.dataset.effectiveFrom).toBe('2026-07-01');
    expect(august.dataset.effectiveTo).toBeNull();
    expect(august.limits.find((l) => l.category === 'beer')!.volumeCapLitres).toBe(
      108,
    );
  });

  it('treats PENDING_CONFIRMATION versions as invisible when resolving a date', async () => {
    const { d1 } = openMigratedD1();
    // A pending version covering all of 2026 — resolution must skip it.
    await seedPendingVersion(d1, 'allowances-api-pending', '2026-01-01');
    await seedPublishedVersion(d1, {
      versionLabel: 'allowances-api-2026.2',
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      datasetCitation: CITATION_V2,
      limitCitation: CITATION_V2,
      beerCapLitres: 108,
    });
    const app = allowancesApp();
    const env = allowancesEnv(d1);

    // Before the published window: only the pending version could cover
    // the date — it is invisible, so the answer is an explicit 404.
    await expectEnvelope(
      await getAllowances(app, env, '?date=2026-03-15'),
      404,
      { error: 'Not Found' },
    );

    // Inside the published version's window it resolves normally.
    const july = (await (
      await getAllowances(app, env, '?date=2026-07-15')
    ).json()) as AllowancesJson;
    expect(july.dataset.versionLabel).toBe('allowances-api-2026.2');
  });

  it('defaults to today when the date query is absent', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedVersion(d1, {
      versionLabel: 'allowances-api-open',
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
      datasetCitation: CITATION_V1,
      limitCitation: CITATION_V1,
      beerCapLitres: 110,
    });
    const app = allowancesApp();
    const env = allowancesEnv(d1);

    const body = (await (await getAllowances(app, env)).json()) as AllowancesJson;
    expect(body.date).toBe(new Date().toISOString().slice(0, 10));
    expect(body.dataset.versionLabel).toBe('allowances-api-open');
  });

  it.each([
    '2026/06/01',
    '15-06-2026',
    '2026-13-01',
    '2026-02-30',
    'not-a-date',
    '20260601',
  ])('rejects date=%s with 400', async (badDate) => {
    const { d1 } = openMigratedD1();
    await seedTwoPublishedVersions(d1);
    const app = allowancesApp();
    await expectEnvelope(
      await getAllowances(app, allowancesEnv(d1), `?date=${badDate}`),
      400,
      { error: 'ValidationError' },
    );
  });

  it('answers 404 when no published version covers the date (before every effective-from)', async () => {
    const { d1 } = openMigratedD1();
    await seedTwoPublishedVersions(d1);
    const app = allowancesApp();
    const body = await expectEnvelope(
      await getAllowances(app, allowancesEnv(d1), '?date=2025-12-31'),
      404,
      { error: 'Not Found' },
    );
    expect(String(body.message)).toMatch(/no published traveller allowance/i);
  });

  it('passes dataset and per-limit citations through verbatim', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedVersion(d1, {
      versionLabel: 'allowances-api-cite',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      datasetCitation: CITATION_V1,
      limitCitation: CITATION_V2,
      beerCapLitres: 110,
    });
    const app = allowancesApp();

    const body = (await (
      await getAllowances(app, allowancesEnv(d1), '?date=2026-06-01')
    ).json()) as AllowancesJson;

    expect(body.dataset.sourceCitation).toBe(CITATION_V1);
    const beer = body.limits.find((l) => l.category === 'beer')!;
    expect(beer.sourceCitation).toBe(CITATION_V2);
    const spirits = body.limits.find((l) => l.category === 'spirits')!;
    expect(spirits.sourceCitation).toBe(CITATION_V1);
  });

  it('is read-only — resolution never touches dataset rows', async () => {
    const { d1 } = openMigratedD1();
    await seedTwoPublishedVersions(d1);
    await seedPendingVersion(d1, 'allowances-api-pending', '2026-01-01');
    const app = allowancesApp();
    const env = allowancesEnv(d1);

    await getAllowances(app, env, '?date=2026-03-15');
    await getAllowances(app, env);
    await getAllowances(app, env, '?date=2026-08-01');

    const before = (
      await d1
        .prepare(
          `SELECT version_label, status, confirmed_by FROM traveller_allowance_datasets
            WHERE version_label IN ('allowances-api-2026.1', 'allowances-api-2026.2', 'allowances-api-pending')
            ORDER BY version_label ASC`,
        )
        .all<{ version_label: string; status: string; confirmed_by: string | null }>()
    ).results;
    expect(before).toHaveLength(3);
    expect(
      before.find((r) => r.version_label === 'allowances-api-2026.1'),
    ).toMatchObject({ status: 'PUBLISHED', confirmed_by: 'ops-test' });
    expect(
      before.find((r) => r.version_label === 'allowances-api-2026.2'),
    ).toMatchObject({ status: 'PUBLISHED', confirmed_by: 'ops-test' });
    expect(
      before.find((r) => r.version_label === 'allowances-api-pending'),
    ).toMatchObject({ status: 'PENDING_CONFIRMATION', confirmed_by: null });
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/allowances/versions — the published history
// ---------------------------------------------------------------------------

describe('GET /api/v1/allowances/versions', () => {
  it('lists published versions with windows — superseded included, pending excluded, newest first', async () => {
    const { d1 } = openMigratedD1();
    await seedTwoPublishedVersions(d1);
    await seedPendingVersion(d1, 'allowances-api-pending', '2026-01-01');
    const app = allowancesApp();
    const env = allowancesEnv(d1);

    const res = await getVersions(app, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as VersionsJson;

    const labels = body.versions.map((v) => v.versionLabel);
    expect(labels).toContain('allowances-api-2026.1');
    expect(labels).toContain('allowances-api-2026.2');
    expect(labels).not.toContain('allowances-api-pending');

    // Deterministic order: the superseded version trails the newer one.
    expect(labels.indexOf('allowances-api-2026.2')).toBeLessThan(
      labels.indexOf('allowances-api-2026.1'),
    );

    const superseded = body.versions.find(
      (v) => v.versionLabel === 'allowances-api-2026.1',
    )!;
    expect(superseded.effectiveFrom).toBe('2026-01-01');
    expect(superseded.effectiveTo).toBe('2026-07-01');
    expect(superseded.sourceCitation).toBe(CITATION_V1);
    expect(superseded.limits.find((l) => l.category === 'beer')!.volumeCapLitres).toBe(
      110,
    );

    const current = body.versions.find(
      (v) => v.versionLabel === 'allowances-api-2026.2',
    )!;
    expect(current.effectiveFrom).toBe('2026-07-01');
    expect(current.effectiveTo).toBeNull();
  });

  it('answers 200 with an empty list when nothing was ever published', async () => {
    const { d1 } = openMigratedD1();
    const app = allowancesApp();
    const res = await getVersions(app, allowancesEnv(d1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as VersionsJson;
    expect(body.versions).toEqual([]);
  });

  it('is read-only — the listing never touches dataset rows', async () => {
    const { d1 } = openMigratedD1();
    await seedTwoPublishedVersions(d1);
    await seedPendingVersion(d1, 'allowances-api-pending', '2026-01-01');
    const app = allowancesApp();
    const env = allowancesEnv(d1);

    await getVersions(app, env);

    const rows = (
      await d1
        .prepare(
          `SELECT status, confirmed_by FROM traveller_allowance_datasets
            WHERE version_label LIKE 'allowances-api-%'
            ORDER BY version_label ASC`,
        )
        .all<{ status: string; confirmed_by: string | null }>()
    ).results;
    expect(rows).toHaveLength(3);
    const published = rows.filter((r) => r.status === 'PUBLISHED');
    expect(published).toHaveLength(2);
    for (const row of published) {
      expect(row.confirmed_by).toBe('ops-test');
    }
    expect(rows.find((r) => r.status === 'PENDING_CONFIRMATION')).toMatchObject({
      confirmed_by: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Guards — age gate precedes both handlers
// ---------------------------------------------------------------------------

describe('GET /api/v1/allowances[... — age gate', () => {
  it('rejects an unconfirmed caller with 403 AGE_GATE_REQUIRED on both endpoints', async () => {
    const { d1 } = openMigratedD1();
    await seedTwoPublishedVersions(d1);
    const app = allowancesApp();
    const env = allowancesEnv(d1);

    await expectEnvelope(await getAllowances(app, env, '', {}), 403, {
      error: 'Forbidden',
      code: 'AGE_GATE_REQUIRED',
    });
    await expectEnvelope(await getVersions(app, env, {}), 403, {
      error: 'Forbidden',
      code: 'AGE_GATE_REQUIRED',
    });
  });

  it('admits a confirmed caller on both endpoints', async () => {
    const { d1 } = openMigratedD1();
    await seedTwoPublishedVersions(d1);
    const app = allowancesApp();
    const env = allowancesEnv(d1);

    expect((await getAllowances(app, env, '?date=2026-08-01')).status).toBe(200);
    expect((await getVersions(app, env)).status).toBe(200);
  });
});
