export { EntitlementModule } from './entitlement.module';
export { EntitlementService } from './entitlement.service';
export type {
  AccountContext,
  Entitlement,
  EntitlementTier,
  FeatureId,
  TierTransition,
  TierTransitionSource,
} from './entitlement.types';
export {
  FEATURE_TIER_MAP,
  isTierSufficient,
  isTierTransitionWellFormed,
} from './entitlement.types';