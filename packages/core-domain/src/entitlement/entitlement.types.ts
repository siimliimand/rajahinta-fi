/**
 * Entitlement types — feature-access tiers and entitlement result.
 *
 * @module EntitlementTypes
 */

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

/**
 * Access tiers for the rajahinta.fi platform.
 *
 * - `FREE`:         Basic product browsing and landed-cost calculations.
 * - `PREMIUM`:      Detailed cost breakdowns, calculation history, CSV export.
 * - `PROFESSIONAL`: API access, batch calculations, priority support.
 */
export type EntitlementTier = 'FREE' | 'PREMIUM' | 'PROFESSIONAL';

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/**
 * Outcome of an entitlement check.
 */
export interface Entitlement {
  /** Whether access to the feature is allowed. */
  readonly allowed: boolean;
  /** The user's current tier. */
  readonly tier: EntitlementTier;
  /** Human-readable reason when access is denied. */
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Feature definitions
// ---------------------------------------------------------------------------

/**
 * Known features that require entitlement checks.
 *
 * Extend this union as new premium features are added.
 */
export type FeatureId =
  | 'product:browse'           // FREE  — browse products and search
  | 'calculation:basic'        // FREE  — run a landed-cost calculation
  | 'calculation:detail'       // PREMIUM — detailed breakdown with per-line confidence
  | 'calculation:history'      // PREMIUM — access to past calculation records
  | 'calculation:export'       // PREMIUM — CSV/PDF export of calculations
  | 'declaration:summary'      // PREMIUM — excise declaration assistant
  | 'api:batch'                // PROFESSIONAL — batch calculation API
  | 'api:access';              // PROFESSIONAL — API key-based access

// ---------------------------------------------------------------------------
// Tier-to-feature mapping
// ---------------------------------------------------------------------------

/**
 * Minimum tier required for each feature.
 */
export const FEATURE_TIER_MAP: Record<FeatureId, EntitlementTier> = {
  'product:browse': 'FREE',
  'calculation:basic': 'FREE',
  'calculation:detail': 'PREMIUM',
  'calculation:history': 'PREMIUM',
  'calculation:export': 'PREMIUM',
  'declaration:summary': 'PREMIUM',
  'api:batch': 'PROFESSIONAL',
  'api:access': 'PROFESSIONAL',
};

// ---------------------------------------------------------------------------
// Tier ordering (higher index = more privileged)
// ---------------------------------------------------------------------------

const TIER_ORDER: EntitlementTier[] = ['FREE', 'PREMIUM', 'PROFESSIONAL'];

/**
 * True when `userTier` is sufficient for the tier required by a feature.
 */
export function isTierSufficient(
  userTier: EntitlementTier,
  requiredTier: EntitlementTier,
): boolean {
  return TIER_ORDER.indexOf(userTier) >= TIER_ORDER.indexOf(requiredTier);
}