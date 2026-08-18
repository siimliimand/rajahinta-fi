import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LaunchGateService } from './launch-gate.service';

/** Metadata key for the launch-gate decorator. */
export const LAUNCH_GATE_KEY = 'launch_gate';

/** Gate types that can be applied to endpoints. */
export enum LaunchGateType {
  /** Requires all three gates — for calculation endpoints. */
  CALCULATION = 'CALCULATION',
  /** Requires all three gates — for price-data endpoints. */
  PRICE_DATA = 'PRICE_DATA',
}

/**
 * Decorator that gates a controller method behind a launch gate.
 *
 * @example
 * ```typescript
 * @LaunchGate(LaunchGateType.CALCULATION)
 * @Post()
 * async calculate() { … }
 * ```
 */
export const LaunchGate = (gateType: LaunchGateType) =>
  SetMetadata(LAUNCH_GATE_KEY, gateType);

/**
 * NestJS guard that checks launch-readiness gates.
 *
 * Register per-controller or per-method. When the required gate is not
 * satisfied the guard throws ForbiddenException (HTTP 403) with a
 * descriptive message explaining which gate is blocking access.
 */
@Injectable()
export class LaunchGateGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly launchGate: LaunchGateService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const gateType = this.reflector.getAllAndOverride<LaunchGateType>(
      LAUNCH_GATE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (gateType === undefined || gateType === null) {
      return true; // no gate set → allow
    }

    switch (gateType) {
      case LaunchGateType.CALCULATION:
        if (this.launchGate.isCalculationEnabled()) {
          return true;
        }
        throw new ForbiddenException(
          'Landed-cost calculations are not yet publicly available. ' +
            'All launch gates (legal opinion, tax-source mapping, correction mechanism) must be confirmed.',
        );

      case LaunchGateType.PRICE_DATA:
        if (this.launchGate.isPriceDataVisible()) {
          return true;
        }
        throw new ForbiddenException(
          'Price data is not yet publicly available. ' +
            'All launch gates (legal opinion, tax-source mapping, correction mechanism) must be confirmed.',
        );

      default:
        return true;
    }
  }
}
