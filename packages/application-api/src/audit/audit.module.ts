/**
 * Audit Module (Application API layer).
 *
 * Registers AuditService and wires the in-memory audit repository as the
 * concrete implementation of IAuditRepository.  Both are registered in
 * the same module so NestJS resolves AUDIT_REPOSITORY_PORT for AuditService.
 *
 * @module AuditModule
 */

import { Module, Global } from '@nestjs/common';
import { AuditService, AUDIT_REPOSITORY_PORT } from '@rajahinta/core-domain';
import { InMemoryAuditRepository } from './in-memory-audit.repository';

@Global()
@Module({
  providers: [
    AuditService,
    { provide: AUDIT_REPOSITORY_PORT, useClass: InMemoryAuditRepository },
  ],
  exports: [AuditService],
})
export class AuditModule {}