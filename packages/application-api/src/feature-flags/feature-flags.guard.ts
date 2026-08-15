import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlag } from './feature-flag.types';
import { FeatureFlagService } from './feature-flag.service';

/** Metadata key for the @FeatureFlag decorator. */
export const FEATURE_FLAG_KEY = 'feature_flag';

/**
 * Decorator that gates a controller method behind a feature flag.
 *
 * @example
 * ```typescript
 * @FeatureFlag(FeatureFlag.NEW_TAX_RULESET)
 * @Post('new-endpoint')
 * async newFeature() { … }
 * ```
 */
export const FeatureFlagDec = (flag: FeatureFlag) =>
  SetMetadata(FEATURE_FLAG_KEY, flag);

/**
 * NestJS guard that checks the feature flag set via @FeatureFlag.
 *
 * Register it globally or per-controller.  When the flag is disabled
 * the guard throws ForbiddenException (HTTP 403).
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const flag = this.reflector.getAllAndOverride<FeatureFlag>(
      FEATURE_FLAG_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (flag === undefined || flag === null) {
      return true; // no flag set → allow
    }

    if (this.featureFlags.isEnabled(flag)) {
      return true;
    }

    throw new ForbiddenException(`Feature "${flag}" is not enabled`);
  }
}