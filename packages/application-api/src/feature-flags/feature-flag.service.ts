import { Injectable, Logger } from '@nestjs/common';
import { FeatureFlag, FeatureFlagConfig } from './feature-flag.types';

/**
 * Synchronous in-memory feature-flag resolution.
 *
 * Defaults to all flags disabled. Overrides are loaded once at construction
 * from environment variables — no network hop on the request path.
 *
 * For gradual rollout, `isEnabledForEntity` hashes the entity ID against a
 * per-flag rollout percentage from the environment.
 */
@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);
  private readonly flags: FeatureFlagConfig;
  private readonly rolloutPct: Partial<Record<FeatureFlag, number>> = {};

  constructor() {
    this.flags = this.loadFromEnv();
    this.logger.log(`Feature flags initialized: ${JSON.stringify(this.flags)}`);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Check if a feature flag is globally enabled. Synchronous — no I/O. */
  isEnabled(flag: FeatureFlag): boolean {
    return this.flags[flag] ?? false;
  }

  /**
   * Check if a feature flag is enabled for a specific entity (gradual rollout).
   *
   * When the flag is fully enabled (100 %) or disabled (0 %) the global value
   * is returned directly.  For partial rollout the entity ID is hashed to
   * produce a deterministic bucket.
   */
  isEnabledForEntity(flag: FeatureFlag, entityId: string): boolean {
    if (!this.flags[flag]) return false;

    const pct = this.rolloutPct[flag] ?? 100;
    if (pct >= 100) return true;
    if (pct <= 0) return false;

    return this.bucket(entityId) < pct;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /** Load flag values from environment, falling back to all-disabled. */
  private loadFromEnv(): FeatureFlagConfig {
    const env = process.env;
    const cfg = {} as FeatureFlagConfig;

    for (const flag of Object.values(FeatureFlag)) {
      const varName = `FF_${flag}`;
      const raw = env[varName];

      if (raw === undefined || raw === '') {
        cfg[flag] = false;
      } else if (raw === 'true' || raw === '1') {
        cfg[flag] = true;
      } else if (/^\d+$/.test(raw)) {
        // Numeric value — parse as rollout percentage.
        const pct = Math.min(100, Math.max(0, parseInt(raw, 10)));
        this.rolloutPct[flag] = pct;
        cfg[flag] = pct > 0;
      } else {
        cfg[flag] = false;
      }

      // Read explicit rollout override.
      const rolloutVar = `FF_ROLLOUT_${flag}`;
      const rolloutRaw = env[rolloutVar];
      if (rolloutRaw !== undefined && rolloutRaw !== '') {
        this.rolloutPct[flag] = Math.min(100, Math.max(0, parseInt(rolloutRaw, 10)));
      }
    }

    return cfg;
  }

  /** Deterministic bucket [0–100) from an entity ID. */
  private bucket(entityId: string): number {
    let hash = 0;
    for (let i = 0; i < entityId.length; i++) {
      hash = (hash * 31 + entityId.charCodeAt(i)) | 0;
    }
    return ((hash & 0x7fffffff) % 100);
  }
}