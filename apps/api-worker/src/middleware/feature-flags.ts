/**
 * Feature-flag service — Hono-era port of FeatureFlagService +
 * FeatureFlagGuard (packages/application-api/src/feature-flags/*, Worker
 * port task 3.2).
 *
 * Synchronous in-memory resolution, defaults to all flags disabled.
 * Overrides load from the Worker environment (the `env` record replaces
 * `process.env`; vars are static per isolate, so resolution matches the
 * Nest service's construction-time stability).
 *
 * For gradual rollout, `isEnabledForEntity` hashes the entity ID against a
 * per-flag rollout percentage from the environment. `resolveFlagMap`
 * exposes the resolved boolean map for the frontend bootstrap parity
 * contract (booleans only — rollout percentages are never exposed, same
 * exposure rule as GET /api/v1/feature-flags); frontend consumption is
 * task 5.x.
 *
 * @module feature-flags
 */

import type { MiddlewareHandler } from 'hono';
import { ApiHttpError } from '../errors';
import type { AppEnv } from '../env';

/**
 * Feature flag identifiers — single source of truth for all gated
 * features. Values match the Nest `FeatureFlag` enum exactly.
 */
export const FeatureFlag = {
  /** Gate new merchant data sources (scrapers, APIs, partner feeds). */
  NEW_MERCHANT_SOURCE: 'NEW_MERCHANT_SOURCE',
  /** Gate new tax rule versions before legal confirmation. */
  NEW_TAX_RULESET: 'NEW_TAX_RULESET',
  /** Gate new UI ranking/sorting behavior. */
  UI_RANKING_V2: 'UI_RANKING_V2',
  /**
   * Gate historical price intelligence (price-history API + UI charts).
   * Spec/design slug: `enable_historical_price_intelligence`.
   * Default OFF until product review — instant rollback for the
   * user-facing historical data presentation.
   */
  HISTORICAL_PRICE_INTELLIGENCE: 'HISTORICAL_PRICE_INTELLIGENCE',
  /**
   * Gate basket optimization API and UI (multi-store split, tiered shipping).
   * Spec slug: `enable_basket_optimization`.
   * Default OFF during active development — enabled once integration tests pass.
   */
  BASKET_OPTIMIZATION: 'BASKET_OPTIMIZATION',
  /**
   * Gate advanced Phase 2 surfaces: scenario (endpoints + UI), report
   * (endpoint + export buttons), reliability (endpoint + embedded scores),
   * and declaration guidance (field + panel).
   * Spec/design slug: `enable_advanced_features`.
   * Default OFF for instant rollback of all four surfaces together.
   */
  ADVANCED_FEATURES: 'ADVANCED_FEATURES',
  /**
   * Gate the operator console — the authenticated UI + API at
   * `/ops/console/**`. Default OFF per the compliance rule (new UI ships
   * flag-off); the bearer+allowlist guard stays on regardless of the flag.
   */
  OPERATOR_CONSOLE: 'OPERATOR_CONSOLE',
  /**
   * Gate the €/g unit-price metric on product/offer read responses
   * (search items + per-offer embeds; derived at read time, never
   * persisted — spec unit-price-metrics). Spec/design slug:
   * `enable_unit_price_eur_per_gram`.
   * Default OFF — the embed key stays absent so payloads remain
   * byte-compatible with the flag-less shape.
   */
  UNIT_PRICE_EUR_PER_GRAM: 'UNIT_PRICE_EUR_PER_GRAM',
  /**
   * Gate the price-alert watchlist API + UI (task 2.3, change
   * product-roadmap-phases-1-4). Spec/design slug: `enable_price_alerts`.
   * Default OFF — the CRUD surface (and the frontend bootstrap key) stay
   * absent until the alert evaluation cron + email delivery path are live.
   */
  PRICE_ALERTS: 'PRICE_ALERTS',
  /**
   * Gate the packing-optimizer SECTION of the basket optimize response
   * (task 3.3, change product-roadmap-phases-1-4). Spec/design slug:
   * `enable_packing_optimizer`. Default OFF — a response-section gate,
   * not an endpoint gate: while off, POST /api/v1/basket/optimize keeps
   * its exact flag-less shape (no `packing` key); while on, the advisory
   * packing suggestion rides along on both cache MISS and HIT payloads.
   */
  PACKING_OPTIMIZER: 'PACKING_OPTIMIZER',
} as const;

export type FeatureFlag = (typeof FeatureFlag)[keyof typeof FeatureFlag];

/** Runtime feature-flag configuration shape used by the service. */
export type FeatureFlagConfig = Record<FeatureFlag, boolean>;

/** All known flags, in declaration order (enum member order parity). */
const ALL_FLAGS = Object.values(FeatureFlag) as FeatureFlag[];

/**
 * Environment the service reads states from. `object` keeps the Worker
 * `Env` interface assignable (interfaces carry no index signature); the
 * internal view below narrows to the string vars the parsing reads.
 */
export type FlagEnvSource = object;

/** The string-var view the parsing logic reads. */
type FlagEnv = Record<string, string | undefined>;

/** Resolved per-flag rollout percentages (never exposed externally). */
type RolloutPercentages = Partial<Record<FeatureFlag, number>>;

/**
 * Synchronous in-memory feature-flag resolution — same names, defaults,
 * and parsing rules as the Nest FeatureFlagService.
 */
export class FeatureFlagService {
  private readonly flags: FeatureFlagConfig;
  private readonly rolloutPct: RolloutPercentages = {};

  constructor(env: FlagEnvSource) {
    this.flags = this.loadFromEnv(env as FlagEnv);
  }

  /** Check if a feature flag is globally enabled. Synchronous — no I/O. */
  isEnabled(flag: FeatureFlag): boolean {
    return this.flags[flag] ?? false;
  }

  /**
   * Check if a feature flag is enabled for a specific entity (gradual rollout).
   *
   * When the flag is fully enabled (100 %) or disabled (0 %) the global value
   * is returned directly. For partial rollout the entity ID is hashed to
   * produce a deterministic bucket.
   */
  isEnabledForEntity(flag: FeatureFlag, entityId: string): boolean {
    if (!this.flags[flag]) return false;

    const pct = this.rolloutPct[flag] ?? 100;
    if (pct >= 100) return true;
    if (pct <= 0) return false;

    return this.bucket(entityId) < pct;
  }

  /**
   * The resolved boolean map — the bootstrap parity contract. Booleans
   * only; rollout percentages are not exposed.
   */
  resolveFlagMap(): FeatureFlagConfig {
    return { ...this.flags };
  }

  /** Load flag values from the environment, falling back to all-disabled. */
  private loadFromEnv(env: FlagEnv): FeatureFlagConfig {    const cfg = {} as FeatureFlagConfig;

    for (const flag of ALL_FLAGS) {
      const raw = env[`FF_${flag}`];

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
      const rolloutRaw = env[`FF_ROLLOUT_${flag}`];
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
    return (hash & 0x7fffffff) % 100;
  }
}

/** Convenience: resolve the full flag map from an environment record. */
export function resolveFlagMap(env: FlagEnvSource): FeatureFlagConfig {
  return new FeatureFlagService(env).resolveFlagMap();
}

/**
 * FeatureFlagGuard port: gates a route behind one flag. The disabled
 * rejection is a plain-message 403, byte-identical to the Nest guard's
 * `ForbiddenException(`Feature "${flag}" is not enabled`)` body.
 */
export function requireFeatureFlag(flag: FeatureFlag): MiddlewareHandler<AppEnv> {
  return (c, next) => {
    const featureFlags = new FeatureFlagService(c.env);
    if (featureFlags.isEnabled(flag)) {
      return next();
    }
    throw new ApiHttpError(403, `Feature "${flag}" is not enabled`);
  };
}
