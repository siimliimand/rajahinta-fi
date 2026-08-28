import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  CalculationRecordRetentionService,
} from '@rajahinta/data-platform';

/**
 * Daily cron worker enforcing calculation-record retention (task 8.1,
 * change technical-assessment-remediation).
 *
 * Runs after the account-retention sweep (03:00) in the same morning
 * window. Direct cron consumer — like account retention, the sweep is
 * light and idempotent, so no Bull queue orchestration is needed; a
 * missed run is simply covered by the next one.
 */
@Injectable()
export class CalculationRecordRetentionWorker {
  private readonly logger = new Logger(CalculationRecordRetentionWorker.name);

  constructor(
    private readonly retention: CalculationRecordRetentionService,
  ) {}

  /** Ensure monthly partitions, prune anonymous rows, drop expired anonymous-only partitions. */
  @Cron('30 3 * * *', { timeZone: 'Europe/Helsinki' })
  async handleRetention(): Promise<void> {
    this.logger.log('Starting daily calculation-record retention sweep');

    const result = await this.retention.runRetention();

    this.logger.log(
      `Retention sweep finished: created [${result.createdPartitions.join(', ')}], ` +
        `pruned ${Object.entries(result.prunedAnonymous)
          .map(([table, count]) => `${table}=${count}`)
          .join(' ')}, ` +
        `dropped [${result.droppedPartitions.join(', ')}]`,
    );
  }
}
