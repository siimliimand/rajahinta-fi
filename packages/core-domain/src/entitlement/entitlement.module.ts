/**
 * EntitlementModule — feature-access entitlement checking.
 *
 * Provides {@link EntitlementService} for dependency injection.
 * Registered in the core-domain layer so any consuming layer
 * (application-api, backend) can inject it.
 *
 * @module EntitlementModule
 */

import { Module, Global } from '@nestjs/common';
import { EntitlementService } from './entitlement.service';

@Global()
@Module({
  providers: [EntitlementService],
  exports: [EntitlementService],
})
export class EntitlementModule {}

export { EntitlementService } from './entitlement.service';
export {
  FEATURE_TIER_MAP,
  isTierSufficient,
  isTierTransitionWellFormed,
} from './entitlement.types';
export type {
  AccountContext,
  Entitlement,
  EntitlementTier,
  FeatureId,
  TierTransition,
  TierTransitionSource,
} from './entitlement.types';
export type { Entitlement as EntitlementResult } from './entitlement.types';