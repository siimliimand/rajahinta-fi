/**
 * /audit barrel — public exports for the application-api audit layer.
 *
 * @module ApiAuditIndex
 */

export { AuditModule } from './audit.module';
export { InMemoryAuditRepository } from './in-memory-audit.repository';
export { RedisClickAnalyticsService } from './redis-click-analytics.service';
export { ClickAnalyticsSnapshotService } from './click-analytics-snapshot.service';
