/**
 * Audit Module — immutable audit log for high-liability changes.
 *
 * Registers AuditService and declares AUDIT_REPOSITORY_PORT as a
 * dependency token.  The consuming layer provides the concrete repository
 * implementation.
 *
 * ## Wiring from the app composition root
 *
 * ```typescript
 * @Module({
 *   imports: [AuditModule],
 *   providers: [
 *     { provide: AUDIT_REPOSITORY_PORT, useClass: MyAuditRepositoryAdapter },
 *   ],
 * })
 * export class MyAppModule {}
 * ```
 *
 * When a repository is not provided, NullAuditRepository is used as a safe
 * default (entries silently discarded — suitable for test environments).
 *
 * @module AuditModule
 */
import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}