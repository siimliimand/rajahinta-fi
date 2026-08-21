#!/usr/bin/env node
/**
 * CLI runner for the staging seed — invoked as a Kubernetes Job.
 *
 * Usage (standalone):
 *   DATABASE_URL=postgresql://... node dist/seed/seed-runner.js
 *
 * Idempotent: the underlying seedStagingDatabase function checks for
 * existing rows before each insert (by EAN, versionLabel, etc.).
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { seedStagingDatabase } from './staging-seed';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('FATAL: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  try {
    const result = await seedStagingDatabase(db);

    const totalInserted =
      result.products.inserted +
      result.taxRules.inserted +
      result.transportOffers.inserted +
      result.retailOffers.inserted;

    if (totalInserted === 0) {
      console.log('Staging seed: no new rows inserted (already seeded — idempotent).');
    } else {
      console.log(`Staging seed complete — inserted ${totalInserted} new rows.`);
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Staging seed failed:', err);
  process.exit(1);
});