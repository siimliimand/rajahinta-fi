/**
 * Drizzle Module — NestJS Global module for the Drizzle ORM connection.
 *
 * Registers the Drizzle provider (pg.Pool + Drizzle instance) as a singleton
 * available across the entire application without each consumer needing to
 * import this module individually.
 *
 * ## Usage
 *
 * ```typescript
 * import { DrizzleModule } from '@rajahinta/data-platform/db/drizzle.module';
 *
 * @Module({ imports: [DrizzleModule] })
 * export class SomeModule {}
 * ```
 *
 * With the `@Global()` decorator the Drizzle instance can also be injected
 * directly:
 *
 * ```typescript
 * constructor(@Inject(DRIZZLE) private readonly db: DrizzleDatabase) {}
 * ```
 *
 * @module DrizzleModule
 */
import { Global, Module } from '@nestjs/common';
import { DrizzleProvider, DRIZZLE } from './drizzle.provider';

@Global()
@Module({
  providers: [DrizzleProvider],
  exports: [DRIZZLE],
})
export class DrizzleModule {}