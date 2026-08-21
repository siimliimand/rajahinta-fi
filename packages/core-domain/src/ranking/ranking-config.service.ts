/**
 * RankingConfigService — auditable changes to ranking configuration.
 *
 * Tracks versioned changes to ranking methodology, enabled sort orders, and
 * future configuration such as comparator weights.  Every config change is
 * recorded in the immutable audit log with before/after snapshots.
 *
 * ## High-liability audit contract
 *
 * - Entity type: `ranking_logic`
 * - Action: `updated` on config changes
 * - Actor: operator identifier (or 'system' for automated jobs)
 *
 * ## Phase 1 scope
 *
 * Phase 1 stores config in memory with no persistence.  The audit log is the
 * sole record of config changes.  Persistence (database-backed config) is
 * deferred to when an admin UI exists.
 *
 * @module RankingConfigService
 */

import { Injectable, Optional, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';

// ---------------------------------------------------------------------------
// Ranking config shape
// ---------------------------------------------------------------------------

/**
 * Serializable ranking configuration.
 *
 * Add fields here as ranking becomes configurable.  Phase 1 tracks the
 * concept version and a set of enabled sort orders.
 */
export interface RankingConfig {
  /** Semantic version of the ranking methodology in use. */
  readonly methodologyVersion: string;
  /** Sort orders currently enabled for users. */
  readonly enabledSortOrders: readonly string[];
}

/** Default Phase 1 ranking configuration. */
export const DEFAULT_RANKING_CONFIG: RankingConfig = {
  methodologyVersion: '1.0',
  enabledSortOrders: [
    'LOWEST_LANDED_COST',
    'LOWEST_PER_LITRE',
    'LOWEST_PER_UNIT',
    'ALPHABETICAL',
    'ALCOHOL_PERCENTAGE',
    'PRODUCT_CATEGORY',
  ],
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class RankingConfigService {
  private readonly logger = new Logger(RankingConfigService.name);

  /** Current configuration — starts with the Phase 1 default. */
  private currentConfig: RankingConfig = { ...DEFAULT_RANKING_CONFIG };

  constructor(
    @Optional() private readonly auditService?: AuditService,
  ) {}

  /**
   * Return the current ranking configuration.
   */
  getConfig(): RankingConfig {
    return { ...this.currentConfig };
  }

  /**
   * Update the ranking configuration.
   *
   * Records a before/after snapshot in the audit log for every change.
   * Accepts partial updates — only the provided fields are replaced.
   *
   * @param updates  Partial config fields to apply.
   * @param actor    Identifier of the person/system making the change.
   * @param reason   Free-text reason for the config change.
   * @returns        The updated full configuration.
   */
  async updateConfig(
    updates: Partial<RankingConfig>,
    actor: string,
    reason: string,
  ): Promise<RankingConfig> {
    const previousValue: RankingConfig = { ...this.currentConfig };

    this.currentConfig = {
      ...this.currentConfig,
      ...updates,
    };

    this.logger.log(
      `Ranking config updated by ${actor}: ${reason}`,
    );

    // Record audit entry.
    if (this.auditService) {
      await this.auditService.logChange({
        entityType: 'ranking_logic',
        entityId: 'ranking-config',
        action: 'updated',
        author: actor,
        reason,
        previousValue,
        newValue: { ...this.currentConfig },
      });
    }

    return { ...this.currentConfig };
  }

  /**
   * Reset config to Phase 1 defaults.
   *
   * @param actor  Identifier of the person/system performing the reset.
   * @param reason Free-text reason for the reset.
   */
  async resetToDefaults(
    actor: string,
    reason: string,
  ): Promise<RankingConfig> {
    return this.updateConfig(
      { ...DEFAULT_RANKING_CONFIG },
      actor,
      reason,
    );
  }
}