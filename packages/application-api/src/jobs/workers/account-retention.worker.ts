import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AccountRetentionService } from '../../accounts/account-retention.service';

/**
 * Daily cron worker that enforces account-data retention policies.
 *
 * Runs every morning at 03:00 Finnish time.  This is a direct cron
 * consumer (not a Bull queue processor) because both operations are
 * light, idempotent, and require no retry orchestration — the job
 * simply runs and logs what it did.
 */
@Injectable()
export class AccountRetentionWorker {
  private readonly logger = new Logger(AccountRetentionWorker.name);

  constructor(
    private readonly accountRetention: AccountRetentionService,
  ) {}

  /**
   * Daily maintenance window — purge fully-expired accounts then
   * anonymise accounts that have crossed the inactivity threshold.
   */
  @Cron('0 3 * * *', { timeZone: 'Europe/Helsinki' })
  async handleRetention(): Promise<void> {
    this.logger.log('Starting daily account-retention sweep');

    const purgeResult = await this.accountRetention.purgeExpiredAccounts();
    this.logger.log(`Purge complete: ${purgeResult.deletedCount} account(s) deleted`);

    const anonymizeResult =
      await this.accountRetention.anonymizeInactiveAccounts();
    this.logger.log(
      `Anonymization complete: ${anonymizeResult.anonymizedCount} account(s) anonymized`,
    );

    this.logger.log('Account-retention sweep finished');
  }
}