/**
 * /audit barrel — public exports for the audit subdomain.
 *
 * @module AuditIndex
 */

export { AuditModule } from './audit.module';
export { AuditService } from './audit.service';
export { AUDIT_REPOSITORY_PORT } from './audit-repository.port';
export type { IAuditRepository } from './audit-repository.port';
export type { AuditEntry, AuditAction, AuditQuery } from './audit.types';