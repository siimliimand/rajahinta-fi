/**
 * Seed: merchant registry — the initial merchant set migrated from the
 * static merchants.config.ts (task 7.2, change
 * technical-assessment-remediation).
 *
 * Mirrors DEFAULT_MERCHANTS so the registry is populated with the same
 * onboarding state the static config carried: registry rows make the
 * feed known, permission still comes from governance records (absent
 * until granted). Idempotent: upserts by merchantId, so re-running
 * after an operator edits a row through the registry API would
 * overwrite local tweaks — run it for bootstrap only.
 *
 * @module Seed
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { merchantRegistry } from '../index';
import type { DrizzleDatabase } from '../db/drizzle.provider';

export interface MerchantRegistrySeedRow {
  readonly merchantId: string;
  readonly name: string;
  readonly country: string;
  readonly feedUrl: string;
  readonly feedFormat: 'json' | 'xml' | 'csv';
  readonly pollingIntervalMs: number;
}

/** The initial merchant set — same values as the retired static config. */
export const MERCHANT_REGISTRY_SEED: readonly MerchantRegistrySeedRow[] = [
  {
    merchantId: 'alko',
    name: 'Alko',
    country: 'FI',
    // Adapter pending (task 7.5) — empty feed URL is skipped by the
    // pipeline, matching the static config's convention.
    feedUrl: '',
    feedFormat: 'json',
    pollingIntervalMs: 3_600_000,
  },
  {
    merchantId: 'systembolaget',
    name: 'Systembolaget',
    country: 'SE',
    feedUrl: 'https://www.systembolaget.se/api/assortment',
    feedFormat: 'json',
    pollingIntervalMs: 3_600_000,
  },
];

/**
 * Upsert the seed rows into the merchant registry.
 *
 * Accepts the Drizzle database instance so staging tooling and the
 * application module can both run it against their connection.
 */
export async function seedMerchantRegistry(
  db: NodePgDatabase | DrizzleDatabase,
): Promise<void> {
  for (const row of MERCHANT_REGISTRY_SEED) {
    await db
      .insert(merchantRegistry)
      .values({ ...row })
      .onConflictDoUpdate({
        target: merchantRegistry.merchantId,
        set: {
          name: row.name,
          country: row.country,
          feedUrl: row.feedUrl,
          feedFormat: row.feedFormat,
          pollingIntervalMs: row.pollingIntervalMs,
          updatedAt: new Date(),
        },
      });
  }
}
