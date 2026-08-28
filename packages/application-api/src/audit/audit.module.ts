/**
 * Audit Module (Application API layer).
 *
 * Binds the durable PostgreSQL audit repository (task 4.2, change
 * technical-assessment-remediation) to the domain
 * AUDIT_REPOSITORY_PORT — audit events now survive restarts and are
 * visible across replicas. The in-memory repository remains exported
 * for tests only.
 *
 * Also hosts the durable click-analytics pair (task 4.3): Redis-backed
 * counters plus the periodic snapshot service archiving them to
 * PostgreSQL. Adopting the Redis service on the redirect path is the
 * controllers' migration (out of this task's scope).
 *
 * @module AuditModule
 */

import { Module, Global } from '@nestjs/common';
import {
  AuditService,
  AUDIT_REPOSITORY_PORT,
} from '@rajahinta/core-domain';
import {
  DataPlatformModule,
  DrizzleAuditEventRepository,
  ClickCounterSnapshotRepository,
  DrizzleClickCounterSnapshotRepository,
} from '@rajahinta/data-platform';
import { RedisClickAnalyticsService } from './redis-click-analytics.service';
import { ClickAnalyticsSnapshotService } from './click-analytics-snapshot.service';

@Global()
@Module({
  imports: [DataPlatformModule],
  providers: [
    AuditService,
    { provide: AUDIT_REPOSITORY_PORT, useClass: DrizzleAuditEventRepository },
    RedisClickAnalyticsService,
    {
      provide: ClickCounterSnapshotRepository,
      useClass: DrizzleClickCounterSnapshotRepository,
    },
    ClickAnalyticsSnapshotService,
  ],
  exports: [
    AuditService,
    RedisClickAnalyticsService,
    ClickAnalyticsSnapshotService,
  ],
})
export class AuditModule {}
