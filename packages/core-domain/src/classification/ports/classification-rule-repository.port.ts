/**
 * Port interface for versioned classification rule set lookup.
 *
 * Core Domain owns this port so the classification rule engine depends on an
 * abstraction, not on a specific repository implementation.  The concrete
 * adapter lives in the composition root (DataPlatform or ApplicationApi) and
 * wires the actual persistence behind this contract at bootstrap time.
 *
 * @module ClassificationRuleRepositoryPort
 */

import type { ClassificationRule } from '../classification-rule.types';

// ---------------------------------------------------------------------------
// Read-model shape
// ---------------------------------------------------------------------------

/**
 * Read-model shape for a versioned classification rule set.
 *
 * Mirrors the persisted record without ORM types.  Rules are stored as a
 * serialisable descriptor array (name + version + description) since the
 * evaluation function itself lives in the domain, not in the database.
 */
export interface ClassificationRuleSetRecord {
  /** Unique version label (e.g. 'v1.0-2024'). */
  readonly versionLabel: string;
  /** Human-readable label (e.g. 'Current Finnish legislation — pre-Sep 2024'). */
  readonly label: string;
  /** Date from which this rule set is effective (inclusive). */
  readonly effectiveFrom: Date;
  /** Date when this rule set expires (inclusive, null = still current). */
  readonly effectiveTo: Date | null;
  /**
   * Rule descriptors: name + version pairs that the engine maps to actual
   * evaluation functions at runtime.
   */
  readonly rules: readonly Pick<ClassificationRule, 'name' | 'version' | 'description'>[];
  /** Timestamp of record creation. */
  readonly createdAt: Date;
}

// ---------------------------------------------------------------------------
// Injection token
// ---------------------------------------------------------------------------

/** Injection token for the classification rule repository. */
export const CLASSIFICATION_RULE_REPOSITORY_PORT =
  'CLASSIFICATION_RULE_REPOSITORY_PORT';

// ---------------------------------------------------------------------------
// Repository contract
// ---------------------------------------------------------------------------

/**
 * Repository contract for versioned classification rule set persistence.
 *
 * Consumers inject this interface.  An adapter in the composition root maps
 * the concrete data-platform repository to this port.
 */
export interface IClassificationRuleRepositoryPort {
  /**
   * Return the rule set that was effective on the given date.
   *
   * Selects the rule set whose `effectiveFrom <= asOf <= effectiveTo`
   * (or `effectiveTo IS NULL` for current rule sets).  Returns null
   * when no rule set covers the requested date.
   */
  findEffective(asOf: Date): Promise<ClassificationRuleSetRecord | null>;

  /**
   * List all known rule set versions, ordered by effectiveFrom ascending.
   */
  listVersions(): Promise<ClassificationRuleSetRecord[]>;

  /**
   * Persist a new rule set version.
   *
   * Implementations should enforce that versionLabel is unique.
   *
   * @param record The rule set record to persist.
   */
  saveRuleSet(record: ClassificationRuleSetRecord): Promise<void>;
}