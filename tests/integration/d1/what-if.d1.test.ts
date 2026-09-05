/**
 * What-if excise simulator integration suite (task 8.4, change
 * product-roadmap-phases-1-4) — the spec: excise-what-if-simulator
 * checklist against the real stack: the FULL worker app composition
 * (createApp() AS-IS — index.ts already wires registerWhatIfRoutes, so
 * no extra registration happens here) over a real migrated D1
 * (node:sqlite through the structural shim) and in-memory DO namespaces.
 *
 * Audit (task 8.4 text → existing coverage → what this file adds):
 *
 * - "unit: token round-trip fidelity (+ tamper)" — ALREADY COVERED by the
 *   task-8.2 route tests (what-if.routes.test.ts: round-trip, encode∘decode
 *   identity, UTF-8 ids, five tamper/corruption vectors, bound-violating
 *   payload, oversize); NOT re-tested here beyond one over-the-wire
 *   round-trip riding the production-wiring proof below.
 * - "unit: disclaimer field present in every result payload" — structure
 *   pinned by 8.2 on the computed result; ADDED here as the integration
 *   sweep: the disclaimer rides EVERY 200 state this suite produces
 *   (fallback baseline, engine-resolved baseline, cap inputs,
 *   multi-product) — the event-calc suite's every-state pattern.
 * - "unit/integration: rate limiting (429 + Retry-After)" — 8.2 covers
 *   10→429 over a composition that re-registers the route on top of
 *   createApp() (inert in Hono — first registration wins — yet the
 *   production wiring was never the asserted subject). ADDED here over
 *   createApp() as-is, plus the profile-identity pin only an integration
 *   run can make: the what-if route draws from the SAME CALCULATOR window
 *   as /api/v1/calculations/excise (RateLimiterDO windows are isolated per
 *   (client DO instance, profile), so a shared 10-admit budget across the
 *   two routes proves the profile IS CALCULATOR).
 * - "integration: flag-off 403" — 8.2 covers lockedEnv; ADDED here as the
 *   composed, data-present version (producer-dupes pattern): flag ON
 *   serves the SAME scenario the OFF case 403s, on the same composition —
 *   the flag is the only variable (rollback semantics).
 * - "no scenario rows written (schema unchanged)" — MISSING entirely;
 *   ADDED here in both layers:
 *   (a) static: the committed migration set and the drizzle schema define
 *       NO what-if/scenario table. Producer-dupes source-scan rigor: a
 *       non-vacuous matcher proof and located extraction (sqliteTable/
 *       CREATE TABLE names), NOT whole-file scans — schema.ts docblocks
 *       discuss the ephemerality decision and would false-positive.
 *       `saved_scenarios` is the phase-1 calculator-inputs table
 *       (account-owned, design Decision 1) — allowlisted by exact name, so
 *       any NEW scenario-named table (what_if_scenarios, …) still fails.
 *   (b) behavioral: a full before/after digest of the migrated D1 —
 *       sqlite_master (schema unchanged) plus every row of every user
 *       table (nothing written; spec R11: "nothing about a what-if run is
 *       persisted", stored rules never mutated) — is byte-identical across
 *       success/validation/flag-off traffic.
 * - "vocabulary lint on the widget copy" — no precedent exists in this
 *   suite for invoking frontend content checks (the content-lint.service
 *   imports elsewhere here are the data-acquisition merchant-content
 *   linter, a different subsystem); the frontend-owned
 *   `pnpm lint:content` (apps/frontend/scripts/lint-content-policy.ts,
 *   which polices src/messages/{fi,en}.json) is run separately and its
 *   result reported as the task's verification evidence. Not asserted
 *   here; apps/frontend/** is out of this task's scope.
 *
 * The route/env helpers are imported from the api-worker route harness
 * (not duplicated): the composition they build IS the code under test.
 *
 * @module WhatIfD1IntegrationTest
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  createApp,
  expectEnvelope,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
  seedProduct,
  seedTaxRule,
} from '../../../apps/api-worker/src/routes/__tests__/harness';
import { decodeWhatIfShareToken } from '../../../apps/api-worker/src/routes/what-if.routes';
import type { Env } from '../../../apps/api-worker/src/env';
import type { D1DatabaseLike } from '../../../packages/data-platform/src/d1/executor';

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const WHAT_IF_PATH = '/api/v1/what-if/excise';

/** The seeded baseline: 36.20 € per centilitre of ethanol, beer, verified. */
function seedBeerRule(db: Parameters<typeof seedTaxRule>[0]): number {
  return seedTaxRule(db, {
    id: 101,
    taxType: 'excise',
    productCategory: 'beer',
    rate: 36.2,
    versionLabel: 'v3.0-2026',
  });
}

const SCENARIO = {
  hypotheticalRate: 18.1,
  products: [
    {
      id: 'beer-05',
      category: 'beer',
      abv: 0.047,
      volumeLitres: 1,
      alkoPriceCents: 1298,
      importPriceCents: 89,
    },
  ],
};

/** A different valid scenario — distinct rate and a second product. */
const OTHER_SCENARIO = {
  hypotheticalRate: 500,
  products: [
    {
      id: 'beer-a-033',
      category: 'beer',
      abv: 0.033,
      volumeLitres: 0.33,
      alkoPriceCents: 350,
      importPriceCents: 40,
    },
    {
      id: 'beer-b-06',
      category: 'beer',
      abv: 0.06,
      volumeLitres: 0.5,
      alkoPriceCents: 489,
      importPriceCents: 62,
    },
  ],
};

function jsonInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** Flag-on env over the given D1 (permissive base leaves the flag unset). */
function whatIfEnv(d1: D1DatabaseLike): Env {
  return permissiveEnv(d1, { FF_EXCISE_WHAT_IF: 'true' });
}

/** Minimal response shape — exact-field pins live in the 8.2 route suite. */
interface WhatIfJson {
  hypotheticalRate: number;
  baselineTaxDatasetVersion: string;
  disclaimer: { text: string; language: string; version: string };
  lines: unknown[];
  totals: { baselineExciseCents: number; hypotheticalExciseCents: number };
  shareToken: string;
}

/**
 * The structural HYPOTHETICAL disclaimer, asserted the same way on every
 * 200 state (spec: disclaimer travels with the result — wording names
 * what the output is NOT).
 */
function expectWhatIfDisclaimer(body: WhatIfJson): void {
  expect(body.disclaimer.language).toBe('en');
  expect(body.disclaimer.version).toBe('1.0');
  expect(body.disclaimer.text).toMatch(/^Hypothetical calculation:/u);
  expect(body.disclaimer.text).toContain('not a forecast');
  expect(body.disclaimer.text).toContain('not an estimate of future prices');
  expect(body.disclaimer.text).toContain('not an official statement');
}

// ---------------------------------------------------------------------------
// 1. Production wiring end-to-end — createApp() as-is, flag the only variable
// ---------------------------------------------------------------------------

describe('POST /api/v1/what-if/excise — production composition (task 8.4)', () => {
  let db: DatabaseSync;
  let d1: D1DatabaseLike;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const opened = openMigratedD1();
    db = opened.db;
    d1 = opened.d1;
    // Deliberately NO registerWhatIfRoutes call — index.ts already wired
    // the route; if the wiring regressed, every case below 404s.
    app = createApp();
  });

  afterEach(() => {
    db.close();
  });

  it('serves the route from the index.ts wiring alone, and the share token round-trips over the wire', async () => {
    seedBeerRule(db);

    const res = await request(app, whatIfEnv(d1), WHAT_IF_PATH, jsonInit(SCENARIO));
    expect(res.status).toBe(200);
    const body = (await res.json()) as WhatIfJson;

    // Hand-vector parity (8.2 pins the full payload): 36.20 × 0.047 × 1 l
    // = 1.7014 € → 170 ¢ baseline excise through the engine-resolved rule.
    expect(body.totals.baselineExciseCents).toBe(170);

    // The token returned over the wire decodes back to the exact request
    // inputs (codec internals are 8.2's; this is the end-to-end leg).
    expect(decodeWhatIfShareToken(body.shareToken)).toEqual(SCENARIO);
  });

  it('flag-off 403 composed: ON serves the same scenario, OFF and fully-locked 403 on the same data', async () => {
    seedBeerRule(db);

    // Flag ON: the scenario serves (non-vacuity — data exists that the
    // OFF cases must refuse to serve).
    const on = await request(app, whatIfEnv(d1), WHAT_IF_PATH, jsonInit(SCENARIO));
    expect(on.status).toBe(200);

    // Flag OFF with all other gates open (the rollback semantics): the
    // SAME request gets the feature-disabled envelope.
    const off = await request(app, permissiveEnv(d1), WHAT_IF_PATH, jsonInit(SCENARIO));
    await expectEnvelope(off, 403, {
      message: 'Feature "EXCISE_WHAT_IF" is not enabled',
      error: 'Forbidden',
    });

    // Fully locked env (the 8.2 route-unit case) — same verdict composed.
    const locked = await request(app, lockedEnv(d1), WHAT_IF_PATH, jsonInit(SCENARIO));
    await expectEnvelope(locked, 403, {
      message: 'Feature "EXCISE_WHAT_IF" is not enabled',
      error: 'Forbidden',
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Rate limiting over the composed app — CALCULATOR profile
// ---------------------------------------------------------------------------

describe('POST /api/v1/what-if/excise — rate limiting over createApp() (task 8.4)', () => {
  let db: DatabaseSync;
  let d1: D1DatabaseLike;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const opened = openMigratedD1();
    db = opened.db;
    d1 = opened.d1;
    seedBeerRule(db);
    app = createApp();
  });

  afterEach(() => {
    db.close();
  });

  it('admits ten per minute per IP (CALCULATOR) and rejects the eleventh with 429 + Retry-After', async () => {
    const env = whatIfEnv(d1); // one shared env = one shared DO limiter bucket

    for (let i = 0; i < 10; i++) {
      const res = await request(app, env, WHAT_IF_PATH, jsonInit(SCENARIO));
      expect(res.status).toBe(200);
    }

    const eleventh = await request(app, env, WHAT_IF_PATH, jsonInit(SCENARIO));
    await expectEnvelope(eleventh, 429, {
      error: 'TooManyRequests',
      message: expect.stringContaining('Rate limit exceeded'),
    });
    const retryAfter = Number(eleventh.headers.get('Retry-After'));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(0);
  });

  it('draws from the SAME CALCULATOR window as /api/v1/calculations/excise — the budgets are one pool', async () => {
    const env = whatIfEnv(d1);

    // Four calculator attempts: the index-level CALCULATOR limiter admits
    // them (consuming budget) BEFORE the handler's DTO validation 400s
    // them — a 400 here is the proof of admission, a 429 would be the
    // proof of exhaustion.
    for (let i = 0; i < 4; i++) {
      const res = await request(app, env, '/api/v1/calculations/excise', jsonInit({}));
      expect(res.status).toBe(400);
    }

    // Six what-if admits: 4 + 6 = 10 — the CALCULATOR budget is spent.
    for (let i = 0; i < 6; i++) {
      const res = await request(app, env, WHAT_IF_PATH, jsonInit(SCENARIO));
      expect(res.status).toBe(200);
    }

    // The seventh what-if crosses the shared pool…
    const seventh = await request(app, env, WHAT_IF_PATH, jsonInit(SCENARIO));
    await expectEnvelope(seventh, 429, { error: 'TooManyRequests' });

    // …and so does the calculator sibling on the same pool.
    const calculator = await request(app, env, '/api/v1/calculations/excise', jsonInit({}));
    await expectEnvelope(calculator, 429, { error: 'TooManyRequests' });
  });
});

// ---------------------------------------------------------------------------
// 3. Disclaimer on EVERY result payload — a sweep over all 200 states
// ---------------------------------------------------------------------------

describe('POST /api/v1/what-if/excise — disclaimer on every 200 result (task 8.4)', () => {
  it('carries the structural HYPOTHETICAL disclaimer on every state: fallback baseline, resolved baseline, cap inputs, multi-product', async () => {
    const opened = openMigratedD1();
    const { db, d1 } = opened;
    try {
      const app = createApp();
      const env = whatIfEnv(d1);

      // State 1 — no tax rules at all: engine zero-rate FALLBACK baseline.
      const fallback = await request(app, env, WHAT_IF_PATH, jsonInit(SCENARIO));
      expect(fallback.status).toBe(200);
      const fallbackBody = (await fallback.json()) as WhatIfJson;
      expect(fallbackBody.baselineTaxDatasetVersion).toBe('FALLBACK');
      expectWhatIfDisclaimer(fallbackBody);

      // State 2 — the seeded rule resolves: engine-resolved v3.0-2026 baseline.
      seedBeerRule(db);
      const resolved = await request(app, env, WHAT_IF_PATH, jsonInit(SCENARIO));
      expect(resolved.status).toBe(200);
      const resolvedBody = (await resolved.json()) as WhatIfJson;
      expect(resolvedBody.baselineTaxDatasetVersion).toBe('v3.0-2026');
      expectWhatIfDisclaimer(resolvedBody);

      // State 3 — the exact input caps (rate 1000, 10 000 l, 10 000 000 ¢).
      const capped = await request(app, env, WHAT_IF_PATH, jsonInit({
        hypotheticalRate: 1000,
        products: [
          {
            id: 'max-case',
            category: 'beer',
            abv: 1,
            volumeLitres: 10_000,
            alkoPriceCents: 10_000_000,
            importPriceCents: 10_000_000,
          },
        ],
      }));
      expect(capped.status).toBe(200);
      expectWhatIfDisclaimer((await capped.json()) as WhatIfJson);

      // State 4 — a multi-product scenario.
      const multi = await request(app, env, WHAT_IF_PATH, jsonInit(OTHER_SCENARIO));
      expect(multi.status).toBe(200);
      const multiBody = (await multi.json()) as WhatIfJson;
      expect(multiBody.lines).toHaveLength(2);
      expectWhatIfDisclaimer(multiBody);
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Ephemerality, static layer — no what-if/scenario table exists in the
//    committed schema (spec: no scenario row SHALL be written, schema
//    unchanged). Source-scan rigor per the producer-dupes precedent:
//    non-vacuous matcher, located extraction — NOT whole-file scans, since
//    schema.ts docblocks deliberately discuss the ephemerality decision.
// ---------------------------------------------------------------------------

const DATA_PLATFORM_SRC = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'data-platform',
  'src',
);
const MIGRATIONS_DIR = path.join(DATA_PLATFORM_SRC, 'd1', 'migrations');
const SCHEMA_TS = path.join(DATA_PLATFORM_SRC, 'd1', 'schema.ts');

/** Banned table-name vocabulary: any what-if or hypothetical store. */
const WHATIF_TABLE_VOCABULARY = /what[_-]?if|hypothetical/i;
/** The scenario-named intersection, checked against a closed allowlist. */
const SCENARIO_TABLE_VOCABULARY = /scenario/i;
/**
 * The ONLY scenario-named table the schema may carry: the phase-1
 * calculator-inputs feature (account-owned, upsert-by-name — design
 * Decision 1). Exact names, so a new what_if_scenarios-style table fails
 * both this allowlist and the banned-vocabulary scan.
 */
const LEGITIMATE_SCENARIO_TABLES = ['saved_scenarios'];

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** Every CREATE TABLE / CREATE VIRTUAL TABLE name in one migration file. */
function createTableNames(sql: string): string[] {
  return [...sql.matchAll(/\bCREATE (?:VIRTUAL )?TABLE `([^`]+)`/g)].map(
    (m) => m[1]!,
  );
}

/** Every drizzle-declared table name in schema.ts (the located symbol). */
function schemaTableNames(): string[] {
  const source = readFileSync(SCHEMA_TS, 'utf8');
  return [...source.matchAll(/\bsqliteTable\(\s*'([^']+)'/g)].map((m) => m[1]!);
}

describe('no what-if/scenario table in the committed schema (task 8.4)', () => {
  it('the vocabulary matchers themselves can fire — the scans cannot pass vacuously', () => {
    const mustFire = [
      'what_if_scenarios',
      'whatif_runs',
      'WHATIF_RESULTS',
      'what-if-scenarios',
      'hypothetical_rate_log',
    ];
    for (const sample of mustFire) {
      expect(WHATIF_TABLE_VOCABULARY.test(sample), JSON.stringify(sample)).toBe(
        true,
      );
    }
    // And they must NOT fire on the schema's own legitimate vocabulary.
    for (const legit of ['retail_offers', 'tax_rules', 'product_master_fts']) {
      expect(WHATIF_TABLE_VOCABULARY.test(legit), legit).toBe(false);
    }
    expect(SCENARIO_TABLE_VOCABULARY.test('saved_scenarios')).toBe(true);
    expect(SCENARIO_TABLE_VOCABULARY.test('scenario_results')).toBe(true);
    expect(SCENARIO_TABLE_VOCABULARY.test('retail_offers')).toBe(false);
  });

  it('the migration set defines no what-if/scenario table — and the scan provably sees the tables that exist', () => {
    const files = migrationFiles();
    // Non-vacuity: the full committed set is scanned (a landmark from the
    // middle of the sequence proves the listing is the real directory).
    expect(files.length).toBeGreaterThanOrEqual(12);
    expect(files).toContain('0010_producer_links.sql');

    let seenTables = 0;
    const scenarioNamed: string[] = [];
    for (const file of files) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      // No what-if migration ever lands under this name…
      expect(file, file).not.toMatch(WHATIF_TABLE_VOCABULARY);
      // …and no what-if table ever lands inside a migration.
      const names = createTableNames(sql);
      expect(names.length, `${file} yields CREATE TABLE names`).toBeGreaterThan(0);
      seenTables += names.length;
      for (const name of names) {
        expect(name, `${file} defines "${name}"`).not.toMatch(
          WHATIF_TABLE_VOCABULARY,
        );
        if (SCENARIO_TABLE_VOCABULARY.test(name)) scenarioNamed.push(name);
      }
    }
    expect(seenTables).toBeGreaterThanOrEqual(30);
    // The allowlist is exercised on real data: the phase-1 table IS seen.
    expect(scenarioNamed).toEqual(LEGITIMATE_SCENARIO_TABLES);
  });

  it('the drizzle schema declares no what-if/scenario table', () => {
    const names = schemaTableNames();
    // Non-vacuity: the extraction located the real schema surface.
    expect(names.length).toBeGreaterThanOrEqual(30);
    expect(names).toContain('saved_scenarios');

    const scenarioNamed = names.filter((n) => SCENARIO_TABLE_VOCABULARY.test(n));
    expect(scenarioNamed).toEqual(LEGITIMATE_SCENARIO_TABLES);
    for (const name of names) {
      expect(name, `schema.ts declares "${name}"`).not.toMatch(
        WHATIF_TABLE_VOCABULARY,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Ephemerality, behavioral layer — what-if traffic leaves the migrated
//    D1 byte-identical (spec R11: nothing about a what-if run is persisted;
//    stored rules never mutated; schema unchanged)
// ---------------------------------------------------------------------------

/**
 * Full-database digest: sqlite_master (objects AND their SQL — the schema
 * cannot change shape) plus every row of every user table in name order,
 * rows in rowid order. Any insert, update, delete, or DDL shows up as a
 * byte difference.
 */
function d1Digest(db: DatabaseSync): string {
  const objects = db
    .prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name')
    .all();
  const tables = (
    db
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
  const rows = tables.map((table) => {
    const quoted = `"${table}"`;
    let dumped: Record<string, unknown>[];
    try {
      dumped = db.prepare(`SELECT * FROM ${quoted} ORDER BY rowid`).all() as Array<
        Record<string, unknown>
      >;
    } catch {
      // WITHOUT ROWID tables (the FTS5 shadow tables) have no rowid —
      // natural storage order, stable across the two digest calls since
      // the traffic under test writes nothing.
      dumped = db.prepare(`SELECT * FROM ${quoted}`).all() as Array<
        Record<string, unknown>
      >;
    }
    return { table, rows: dumped };
  });
  return JSON.stringify({ objects, rows });
}

describe('what-if traffic leaves the migrated D1 byte-identical (task 8.4)', () => {
  it('fires success, validation, and flag-off traffic — the full-database digest does not move', async () => {
    const opened = openMigratedD1();
    const { db, d1 } = opened;
    try {
      // Non-empty user data: a mutation or stray insert must be visible.
      seedBeerRule(db);
      seedProduct(db, { id: 1, name: 'Karhu III' });
      const before = d1Digest(db);

      const app = createApp();
      const env = whatIfEnv(d1);

      // 200 — the full happy path: engine baseline resolution, the pure
      // module, the share token. None of it may touch D1.
      const ok1 = await request(app, env, WHAT_IF_PATH, jsonInit(SCENARIO));
      expect(ok1.status).toBe(200);
      const ok1Body = (await ok1.json()) as WhatIfJson;
      expectWhatIfDisclaimer(ok1Body);

      // 200 — a different scenario shape.
      const ok2 = await request(app, env, WHAT_IF_PATH, jsonInit(OTHER_SCENARIO));
      expect(ok2.status).toBe(200);

      // 400 — the validation rejection path.
      const bad = await request(
        app,
        env,
        WHAT_IF_PATH,
        jsonInit({ hypotheticalRate: -1, products: [] }),
      );
      expect(bad.status).toBe(400);

      // 403 — the flag-off gate, fresh env over the SAME D1.
      const off = await request(app, permissiveEnv(d1), WHAT_IF_PATH, jsonInit(SCENARIO));
      await expectEnvelope(off, 403, {
        message: 'Feature "EXCISE_WHAT_IF" is not enabled',
      });

      // Nothing moved — no scenario row, no tax-rule mutation, no new table.
      expect(d1Digest(db)).toBe(before);

      // Runtime tie-in to the static layer: the live migrated database
      // carries no what-if-named table, and the only scenario-named table
      // is the phase-1 calculator-inputs one.
      const tables = (
        db
          .prepare(
            `SELECT name FROM sqlite_master
              WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
              ORDER BY name`,
          )
          .all() as Array<{ name: string }>
      ).map((row) => row.name);
      for (const name of tables) {
        expect(name, name).not.toMatch(WHATIF_TABLE_VOCABULARY);
      }
      expect(tables.filter((n) => SCENARIO_TABLE_VOCABULARY.test(n))).toEqual(
        LEGITIMATE_SCENARIO_TABLES,
      );
    } finally {
      db.close();
    }
  });
});
