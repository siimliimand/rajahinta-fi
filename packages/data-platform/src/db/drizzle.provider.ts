/**
 * Drizzle connection provider — Pool + Drizzle instance factory.
 *
 * Reads `DATABASE_URL` from the environment, creates a `pg.Pool`, and
 * returns a fully-typed Drizzle ORM instance that references the canonical
 * schema tables defined in `packages/data-platform/src/index.ts`.
 *
 * ## Usage
 *
 * ```typescript
 * import { Inject } from '@nestjs/common';
 * import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
 *
 * @Injectable()
 * class MyService {
 *   constructor(@Inject(DRIZZLE) private readonly db: DrizzleDatabase) {}
 * }
 * ```
 *
 * @module DrizzleProvider
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../index';

/** NestJS injection token for the Drizzle database instance. */
export const DRIZZLE = Symbol('DRIZZLE');

/**
 * Fully-typed Drizzle database instance.
 *
 * Carries the complete schema type so queries are checked against the
 * real table definitions (productMaster, retailOffers, taxRules, etc.).
 */
export type DrizzleDatabase = NodePgDatabase<typeof schema>;

/**
 * NestJS factory provider that creates a pg.Pool from DATABASE_URL and
 * returns a Drizzle ORM instance bound to the canonical schema.
 *
 * Throws at provider-instantiation time when DATABASE_URL is unset so
 * the application fails fast rather than at the first query.
 */
export const DrizzleProvider = {
  provide: DRIZZLE,
  useFactory: (): DrizzleDatabase => {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL environment variable is not set. ' +
          'Please provide a PostgreSQL connection string ' +
          '(e.g. postgres://user:password@host:5432/rajahinta)',
      );
    }

    const pool = new Pool({ connectionString: databaseUrl });
    return drizzle(pool, { schema }) as DrizzleDatabase;
  },
};