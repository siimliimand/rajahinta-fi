/**
 * Compliance test: allowance-explorer read-only (task 6.1, change
 * insight-surfaces).
 *
 * GET /api/v1/allowances?date= and GET /api/v1/allowances/versions are
 * strictly read-side over the traveller-allowance dataset tables: no
 * sequence of calls through these endpoints may create, modify, or
 * unpublish any PUBLISHED dataset row (the append/publish lifecycle
 * stays in the operator console). Proven two ways:
 *
 * - **Dynamic**: a full exercise matrix — effective dates on both sides
 *   of the version boundary, an uncovered date (404), a malformed date
 *   (400), the query-less today default, the versions listing, and
 *   abusive methods (POST/PUT/DELETE on the GET-only paths) — leaves
 *   EVERY traveller_allowance_datasets and traveller_allowance_limits
 *   row byte-identical (full-row snapshot before/after, the D1
 *   integration suites' seed-and-read discipline). A PENDING_CONFIRMATION
 *   version seeded beside the published ones must still be PENDING and
 *   invisible afterwards — read paths never publish.
 * - **Static**: the route module's non-comment source contains no
 *   append/publish/SQL-write call surface at all.
 *
 * Non-vacuity: the seeded state (2 PUBLISHED + 1 PENDING datasets with
 * limit rows) is asserted before the exercise, and the scan matcher is
 * proven able to fire on synthetic write-path source.
 *
 * @module AllowanceExplorerReadOnlyComplianceTest
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  buildApp,
  openMigratedD1,
  permissiveEnv,
  request,
} from '../../apps/api-worker/src/routes/__tests__/harness';
import { registerAllowancesRoutes } from '../../apps/api-worker/src/routes/allowances.routes';
import { D1TravellerAllowancesRepository } from '../../packages/data-platform/src/repositories/d1/traveller-allowances.repository';
import type { D1DatabaseLike } from '../../packages/data-platform/src/d1/executor';
import type { DatabaseSync } from 'node:sqlite';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const ALLOWANCES_ROUTES = path.resolve(
  REPO_ROOT,
  'apps/api-worker/src/routes/allowances.routes.ts',
);

// ---------------------------------------------------------------------------
// Fixtures — the two-version calendar plus a pending version
// ---------------------------------------------------------------------------

const AGE_OK = { 'x-age-confirmed': 'confirmed-test-token' };

const CITATION_V1 =
  'Commission Directive 2007/74/EC, Annex (https://eur-lex.europa.example/32007L0074)';
const CITATION_V2 =
  'Commission Directive 2007/74/EC, Annex, amended by Regulation (EU) 2026/512 (https://eur-lex.europa.example/2026/512)';

/** Append one allowance version and publish it — the only PUBLISHED path
 * (operator-console parity; seeding here happens OUTSIDE the endpoints). */
async function seedPublishedVersion(
  d1: D1DatabaseLike,
  seed: {
    versionLabel: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    datasetCitation: string;
    beerCapLitres: number;
  },
): Promise<void> {
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
        sourceCitation: seed.datasetCitation,
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
  const published = await repo.publish(version.dataset.id, 'ops-compliance');
  expect(published).not.toBeNull();
}

/** Append a version that is NEVER published — must stay invisible. */
async function seedPendingVersion(d1: D1DatabaseLike): Promise<void> {
  const repo = new D1TravellerAllowancesRepository(d1);
  await repo.createPendingVersion(
    {
      versionLabel: 'allowances-pending-2027.1',
      sourceCitation: CITATION_V1,
      effectiveFrom: '2027-01-01',
      effectiveTo: null,
    },
    [
      {
        category: 'beer',
        volumeCapLitres: 999,
        quantityCap: null,
        sourceCitation: CITATION_V1,
        effectiveFrom: '2027-01-01',
        effectiveTo: null,
      },
    ],
  );
}

/** v1 covers Jan–Jun 2026 (half-open), v2 from July, open-ended. */
async function seedAllowanceCalendar(d1: D1DatabaseLike): Promise<void> {
  await seedPublishedVersion(d1, {
    versionLabel: 'allowances-2026.1',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-07-01',
    datasetCitation: CITATION_V1,
    beerCapLitres: 110,
  });
  await seedPublishedVersion(d1, {
    versionLabel: 'allowances-2026.2',
    effectiveFrom: '2026-07-01',
    effectiveTo: null,
    datasetCitation: CITATION_V2,
    beerCapLitres: 108,
  });
  await seedPendingVersion(d1);
}

/** Full-row byte snapshot of both allowance tables, ids fixed. */
function allowanceRowsJson(db: DatabaseSync): string {
  const datasets = db
    .prepare('SELECT * FROM traveller_allowance_datasets ORDER BY id')
    .all();
  const limits = db
    .prepare('SELECT * FROM traveller_allowance_limits ORDER BY id')
    .all();
  return JSON.stringify({ datasets, limits });
}

// ---------------------------------------------------------------------------
// The exercise matrix — every reachable path through the explorer
// ---------------------------------------------------------------------------

interface AllowancesJson {
  date: string;
  dataset: { versionLabel: string };
}

function allowancesApp(): ReturnType<typeof buildApp> {
  return registerAllowancesRoutes(buildApp());
}

async function fireExplorer(
  app: ReturnType<typeof buildApp>,
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<void> {
  const env = permissiveEnv(d1);

  // Age gate first — an unconfirmed caller reaches nothing.
  const noAge = await request(app, env, '/api/v1/allowances?date=2026-03-15');
  expect(noAge.status).toBe(403);
  const noAgeVersions = await request(app, env, '/api/v1/allowances/versions');
  expect(noAgeVersions.status).toBe(403);

  // Cross-version resolution incl. the exact half-open boundary day.
  const march = await request(app, env, '/api/v1/allowances?date=2026-03-15', {
    headers: AGE_OK,
  });
  expect(march.status).toBe(200);
  expect(((await march.json()) as AllowancesJson).dataset.versionLabel).toBe(
    'allowances-2026.1',
  );
  const boundary = await request(app, env, '/api/v1/allowances?date=2026-07-01', {
    headers: AGE_OK,
  });
  expect(boundary.status).toBe(200);
  expect(((await boundary.json()) as AllowancesJson).dataset.versionLabel).toBe(
    'allowances-2026.2',
  );
  const june = await request(app, env, '/api/v1/allowances?date=2026-06-30', {
    headers: AGE_OK,
  });
  expect(june.status).toBe(200);
  expect(((await june.json()) as AllowancesJson).dataset.versionLabel).toBe(
    'allowances-2026.1',
  );

  // Uncovered date — explicit 404, never a guessed version.
  const uncovered = await request(app, env, '/api/v1/allowances?date=2025-12-31', {
    headers: AGE_OK,
  });
  expect(uncovered.status).toBe(404);

  // Malformed date — 400.
  const malformed = await request(app, env, '/api/v1/allowances?date=2026-13-45', {
    headers: AGE_OK,
  });
  expect(malformed.status).toBe(400);

  // Query-less default (today) — open-ended v2.
  const today = await request(app, env, '/api/v1/allowances', { headers: AGE_OK });
  expect(today.status).toBe(200);
  expect(((await today.json()) as AllowancesJson).dataset.versionLabel).toBe(
    'allowances-2026.2',
  );

  // A date the PENDING version also covers — resolution returns the
  // published open-ended v2, never the pending version (pending is
  // invisible to resolution even where it overlaps).
  const pendingOverlap = await request(app, env, '/api/v1/allowances?date=2027-06-01', {
    headers: AGE_OK,
  });
  expect(pendingOverlap.status).toBe(200);
  expect(((await pendingOverlap.json()) as AllowancesJson).dataset.versionLabel).toBe(
    'allowances-2026.2',
  );

  // Versions listing — published history only, newest window first.
  const versions = await request(app, env, '/api/v1/allowances/versions', {
    headers: AGE_OK,
  });
  expect(versions.status).toBe(200);
  const versionsJson = (await versions.json()) as {
    versions: { versionLabel: string }[];
  };
  expect(versionsJson.versions.map((v) => v.versionLabel)).toEqual([
    'allowances-2026.2',
    'allowances-2026.1',
  ]);

  // Abusive methods on the GET-only paths — unreachable, then rows compared.
  for (const [method, path] of [
    ['POST', '/api/v1/allowances'],
    ['PUT', '/api/v1/allowances?date=2026-03-15'],
    ['DELETE', '/api/v1/allowances?date=2026-03-15'],
    ['POST', '/api/v1/allowances/versions'],
    ['DELETE', '/api/v1/allowances/versions'],
  ] as const) {
    const res = await request(app, env, path, { method, headers: AGE_OK });
    expect(res.status, `${method} ${path}`).toBe(404);
  }
}

// ===========================================================================
// 1. Dynamic: the full exercise matrix moves no row
// ===========================================================================

describe('allowance-explorer exercise leaves every dataset row untouched', () => {
  it('the seeded state is the asserted non-empty baseline', async () => {
    const { db, d1 } = openMigratedD1();
    await seedAllowanceCalendar(d1);

    const datasets = db
      .prepare(
        `SELECT version_label, status, confirmed_by FROM traveller_allowance_datasets ORDER BY id`,
      )
      .all() as { version_label: string; status: string; confirmed_by: string | null }[];

    const published = datasets.filter((row) => row.status === 'PUBLISHED');
    const pending = datasets.filter((row) => row.status === 'PENDING_CONFIRMATION');
    expect(published.map((row) => row.version_label)).toEqual([
      'allowances-2026.1',
      'allowances-2026.2',
    ]);
    expect(published.every((row) => row.confirmed_by === 'ops-compliance')).toBe(true);
    expect(pending.map((row) => row.version_label)).toEqual([
      'allowances-pending-2027.1',
    ]);
    expect(pending.every((row) => row.confirmed_by === null)).toBe(true);

    const limitCount = (
      db.prepare('SELECT COUNT(*) AS n FROM traveller_allowance_limits').all() as {
        n: number;
      }[]
    )[0]!.n;
    expect(limitCount).toBe(5); // 2 limits per published version + 1 pending
  });

  it('explorer reads + abusive methods cannot create, modify, or unpublish any row', async () => {
    const { db, d1 } = openMigratedD1();
    await seedAllowanceCalendar(d1);

    const before = allowanceRowsJson(db);
    await fireExplorer(allowancesApp(), d1);
    const after = allowanceRowsJson(db);

    expect(after).toBe(before);
    // Explicit status/stamp re-check on top of the byte compare.
    const statuses = db
      .prepare(
        `SELECT status, confirmed_by, confirmed_at FROM traveller_allowance_datasets ORDER BY id`,
      )
      .all() as { status: string; confirmed_by: string | null; confirmed_at: string | null }[];
    expect(statuses.map((row) => row.status)).toEqual([
      'PUBLISHED',
      'PUBLISHED',
      'PENDING_CONFIRMATION',
    ]);
    expect(statuses[2]!.confirmed_by).toBeNull();
    expect(statuses[2]!.confirmed_at).toBeNull();
  });
});

// ===========================================================================
// 2. Static: the route module has no write surface at all
// ===========================================================================

/** Every write-path construct the explorer must never contain. */
const WRITE_SURFACE_PATTERN =
  /createPendingVersion|\.publish\s*\(|INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM/g;

describe('allowances route source contains no write path', () => {
  it('the scanner itself can fire — it cannot pass vacuously', () => {
    expect(
      [...`await repo.publish(id, 'ops')`.matchAll(WRITE_SURFACE_PATTERN)].length,
    ).toBeGreaterThan(0);
    expect(
      [...`repo.createPendingVersion(dataset, limits)`.matchAll(WRITE_SURFACE_PATTERN)]
        .length,
    ).toBeGreaterThan(0);
  });

  it('the non-comment source of allowances.routes.ts has no append/publish/SQL-write call', () => {
    const clean = readFileSync(ALLOWANCES_ROUTES, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(
      [...clean.matchAll(WRITE_SURFACE_PATTERN)].map((m) => m[0]),
    ).toEqual([]);
  });
});
