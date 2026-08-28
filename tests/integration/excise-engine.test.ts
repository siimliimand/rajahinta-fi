/**
 * Real-stack integration test — "masking-class killer" (D2).
 *
 * Applies Drizzle migrations to a throwaway Postgres, seeds official tax
 * rules via seedTaxRules(), then calculates through AlcoholExciseService
 * backed by the real DrizzleTaxRateRepository.
 *
 * This is the only test where the engine vocabulary (TAX_TYPES.excise) and
 * the seed vocabulary must agree through the real query path — fixture
 * consensus can no longer mask a split.
 *
 * ## Local execution
 *
 * Requires a running PostgreSQL instance.  Default connection string:
 *
 *   DATABASE_URL=postgresql://rajahinta:rajahinta@localhost:5432/rajahinta_test
 *
 * Start one with Docker:
 *
 *   docker run -d --name rajahinta-test \
 *     -e POSTGRES_USER=rajahinta \
 *     -e POSTGRES_PASSWORD=rajahinta \
 *     -e POSTGRES_DB=rajahinta_test \
 *     -p 5432:5432 postgres:16
 *
 * Then run:
 *
 *   DATABASE_URL=postgresql://rajahinta:rajahinta@localhost:5432/rajahinta_test \
 *     pnpm vitest run --config tests/integration/vitest.config.ts
 *
 * ## CI execution
 *
 * The `integration` CI job (see .github/workflows/ci.yml) runs a Postgres
 * service container and sets DATABASE_URL automatically.
 *
 * @module ExciseEngineIntegrationTest
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { AlcoholExciseService } from '@rajahinta/core-domain';
import { seedTaxRules, TaxRuleRepositoryAdapter } from '@rajahinta/data-platform';

// ---------------------------------------------------------------------------
// Database connection — dynamically resolved from data-platform's
// node_modules (these packages are NOT root dependencies).
// ---------------------------------------------------------------------------

/** Resolve a package module from data-platform's node_modules. */
function dpResolve(name: string): string {
  return require.resolve(name, {
    paths: [path.resolve(__dirname, '..', '..', 'packages/data-platform/node_modules')],
  });
}

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { Pool } = require(dpResolve('pg')) as typeof import('pg');
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { drizzle } = require(dpResolve('drizzle-orm/node-postgres')) as typeof import('drizzle-orm/node-postgres');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Same gate as every other integration file and global-setup: TEST_DATABASE_URL
// first, plain DATABASE_URL as fallback. Gating on DATABASE_URL alone made this
// suite pass vacuously when the harness was wired via TEST_DATABASE_URL only.
const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://rajahinta:rajahinta@localhost:5432/rajahinta_test';

/** Path to the Drizzle migrations folder. */
const _MIGRATIONS_FOLDER = path.resolve(
  __dirname,
  '..',
  '..',
  'packages/data-platform/drizzle',
);

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('Real-stack: AlcoholExciseService through DrizzleTaxRateRepository', () => {
  let pool: InstanceType<typeof Pool>;
  let repo: TaxRuleRepositoryAdapter;
  let excise: AlcoholExciseService;
  let dbAvailable = false;

  beforeAll(async () => {
    // ---- 0. Connection check — skip when no Postgres is available ---------
    const url = new URL(DATABASE_URL);
    const probePool = new Pool({ connectionString: DATABASE_URL, max: 1, connectionTimeoutMillis: 2000 });
    try {
      const client = await probePool.connect();
      client.release();
      dbAvailable = true;
    } catch {
      await probePool.end().catch(() => {});
      console.log(`⏭️  Integration tests SKIPPED — no PostgreSQL at ${url.host}:${url.port}.`);
      console.log('   Start one: docker run -d --name rajahinta-test \\');
      console.log(`     -e POSTGRES_USER=${url.username} -e POSTGRES_PASSWORD=${url.password} \\`);
      console.log(`     -e POSTGRES_DB=${url.pathname.slice(1)} -p ${url.port}:5432 postgres:16`);
      return; // All tests will skip
    }
    await probePool.end().catch(() => {});

    pool = new Pool({ connectionString: DATABASE_URL });

    // ---- 1. Apply Drizzle migrations via drizzle-kit CLI ----------------
    // Using execSync since drizzle-orm's migrate function can't be imported
    // in Vitest without adding pg/drizzle-orm as root dependencies.
    const migrateCmd = [
      'pnpm',
      '--filter', '@rajahinta/data-platform',
      'exec', 'drizzle-kit', 'migrate',
    ].join(' ');

    try {
      execSync(migrateCmd, {
        env: { ...process.env, DATABASE_URL },
        cwd: path.resolve(__dirname, '..', '..'),
        stdio: 'pipe',
        timeout: 30_000,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // If migrations table already exists and is up-to-date, drizzle-kit
      // exits with a non-zero code and a message we can safely ignore.
      if (!msg.includes('No migrations to run') && !msg.includes('already applied')) {
        throw new Error(`drizzle-kit migrate failed: ${msg}`);
      }
    }

    // ---- 2. Seed official tax rules (idempotent) ------------------------
    const db = drizzle(pool);
    const seedResult = await seedTaxRules(db);
    console.log(
      `Integration test: seeded ${seedResult.inserted} tax rules ` +
        `(skipped ${seedResult.skipped} already-seeded).`,
    );

    // ---- 3. Construct real TaxRuleRepositoryAdapter without NestJS ------
    repo = new TaxRuleRepositoryAdapter(db as any);

    // ---- 4. Construct AlcoholExciseService without NestJS --------------
    excise = new AlcoholExciseService(repo);
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    // Clean schema — drop all seeded tables
    try {
      await pool.query('TRUNCATE TABLE tax_rules CASCADE');
    } catch {
      // Ignore cleanup errors
    }
    await pool.end();
  });

  // =======================================================================
  // (a) 2024 beer 5 % ABV, 0.5 L → 91 snt total excise
  // =======================================================================

  describe('2024 beer 5 % ABV, 0.5 L', () => {
    it('returns 91 snt total excise (2024 vintage)', async ({ skip }) => {
      if (!dbAvailable) skip(); // honest skip — a bare return would pass vacuously
      const result = await excise.calculate('beer', 0.05, 0.5, new Date('2024-06-15'));

      // PER_CENTILITRE_ETHANOL formula:
      //   rate 36.20 × abv 0.05 × volume 0.5 = 0.905
      //   Math.round(0.905 × 100) = 91
      expect(result.taxCents).toBe(91);
      expect(result.taxDatasetVersion).toBe('v1.0-2024');
      expect(result.reliability).toBe('VERIFIED');
      expect(result.ruleId).not.toBeNull();
    });

    it('returns VERIFIED with a real rule reference, not FALLBACK', async ({ skip }) => {
      if (!dbAvailable) skip();
      const result = await excise.calculate('beer', 0.05, 0.5, new Date('2024-06-15'));

      // Must not be the FALLBACK fallback — proves the seed is queried
      expect(result.taxDatasetVersion).not.toBe('FALLBACK');
      expect(result.reliability).toBe('VERIFIED');
    });
  });

  // =======================================================================
  // (b) Wine >1.2–2.8 %ABV → 36 snt/l before 1.4.2026, 50 snt/l after
  // =======================================================================

  describe('wine still >1.2–2.8 % ABV — intra-year split 1.4.2026', () => {
    it('resolves 36 snt/l before 1.4.2026', async ({ skip }) => {
      if (!dbAvailable) skip();
      const result = await excise.calculate(
        'wine_still',
        0.02, // 2 % ABV (inside >1.2–2.8 band)
        1.0,  // 1 litre
        new Date('2026-03-01'),
      );

      // PER_LITRE_OF_PRODUCT formula:
      //   rate 0.36 €/l × volume 1.0 l = 0.36 → Math.round(0.36 × 100) = 36
      expect(result.taxCents).toBe(36);
      expect(result.taxDatasetVersion).toBe('v3.0-2026');
      expect(result.reliability).toBe('VERIFIED');
    });

    it('resolves 50 snt/l on or after 1.4.2026', async ({ skip }) => {
      if (!dbAvailable) skip();
      const result = await excise.calculate(
        'wine_still',
        0.02,
        1.0,
        new Date('2026-04-01'),
      );

      // rate 0.50 €/l × volume 1.0 l = 0.50 → Math.round(0.50 × 100) = 50
      expect(result.taxCents).toBe(50);
      expect(result.taxDatasetVersion).toBe('v3.0-2026');
      expect(result.reliability).toBe('VERIFIED');
    });
  });

  // =======================================================================
  // (c) Spirits 2026 >10 % ABV → 56.28 snt/cl ethanol
  // =======================================================================

  describe('2026 spirits >10 % ABV', () => {
    it('returns 56.28 snt/cl rate via correct taxCents for 40% ABV / 0.7 L', async ({ skip }) => {
      if (!dbAvailable) skip();
      const result = await excise.calculate(
        'spirits',
        0.40,
        0.7,
        new Date('2026-06-15'),
      );

      // PER_LITRE_OF_ALCOHOL formula:
      //   rate 56.28 (€/l pure alcohol = snt/cl ethanol)
      //   pure alcohol = 0.40 × 0.7 = 0.28 L
      //   amount = 56.28 × 0.28 = 15.7584
      //   Math.round(15.7584 × 100) = Math.round(1575.84) = 1576
      expect(result.taxCents).toBe(1576);
      expect(result.taxDatasetVersion).toBe('v3.0-2026');
      expect(result.rateApplied).toBeCloseTo(22.512, 2);
      expect(result.reliability).toBe('VERIFIED');
      expect(result.ruleId).not.toBeNull();
    });

    it('uses the >10 % ABV tier (not the 2.8–10 tier)', async ({ skip }) => {
      if (!dbAvailable) skip();
      const result = await excise.calculate(
        'spirits',
        0.11, // 11 % ABV — clearly above 10 %, unambiguous >10 tier match
        0.7,
        new Date('2026-06-15'),
      );

      // Rate 56.28 €/l pure alcohol × 0.11 ABV = 6.1908 effective per litre
      expect(result.taxDatasetVersion).toBe('v3.0-2026');
      expect(result.rateApplied).toBeCloseTo(6.1908, 4);
    });
  });
});