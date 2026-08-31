/**
 * Launch-gating service + middleware — Hono-era port of LaunchGateService +
 * LaunchGateGuard (packages/application-api/src/feature-flags/launch-gate.*,
 * Worker port task 3.2).
 *
 * Controls whether calculation and price-data endpoints are publicly
 * accessible before legal/regulatory confirmation. All gates default to
 * OFF (safe default). `LAUNCH_GATES_OVERRIDE=true` forces all gates open
 * for dev/demo environments; individual gates read strictly `=== 'true'`.
 *
 * @module launch-gate
 */

import type { MiddlewareHandler } from 'hono';
import { ApiHttpError } from '../errors';
import type { AppEnv } from '../env';

/** Status of each launch-readiness gate. */
export interface GateStatus {
  /** Legal opinion on calculator accuracy has been confirmed. */
  legalOpinionConfirmed: boolean;
  /** Tax-source mapping (excise rates, container duty) has been validated. */
  taxSourceMappingConfirmed: boolean;
  /** User-facing correction mechanism is in place and tested. */
  correctionMechanismConfirmed: boolean;
  /** Computed: true only when all three gates above are true. */
  launchReady: boolean;
}

/** Default gate configuration — all gates OFF (safe default). */
export const DEFAULT_GATE_STATUS: GateStatus = {
  legalOpinionConfirmed: false,
  taxSourceMappingConfirmed: false,
  correctionMechanismConfirmed: false,
  launchReady: false,
};

/** Environment variable names for individual gate overrides. */
export const GATE_ENV_KEYS = {
  legalOpinion: 'LAUNCH_GATE_LEGAL_OPINION',
  taxSourceMapping: 'LAUNCH_GATE_TAX_SOURCE_MAPPING',
  correctionMechanism: 'LAUNCH_GATE_CORRECTION_MECHANISM',
  override: 'LAUNCH_GATES_OVERRIDE',
} as const;

/**
 * Gate types that can be applied to endpoints — matches the Nest
 * `LaunchGateType` enum (`@LaunchGate(CALCULATION | PRICE_DATA)`).
 */
export type LaunchGateType = 'CALCULATION' | 'PRICE_DATA';

/**
 * Launch-gating service — same names, defaults, and env keys as the Nest
 * LaunchGateService. The env source is `object` so the Worker `Env`
 * interface is assignable (interfaces carry no index signature); the
 * lookup view below narrows to the string vars the gates read.
 */
export class LaunchGateService {
  private readonly gates: GateStatus;

  constructor(env: object) {
    this.gates = LaunchGateService.loadFromEnv(
      env as Record<string, string | undefined>,
    );
  }

  /**
   * Whether landed-cost calculations are enabled.
   * True only when ALL three gates (legal, tax, correction) are confirmed.
   */
  isCalculationEnabled(): boolean {
    return this.gates.launchReady;
  }

  /**
   * Whether price data is visible to end users.
   * True only when ALL three gates (legal, tax, correction) are confirmed.
   */
  isPriceDataVisible(): boolean {
    return this.gates.launchReady;
  }

  /** Return the full gate status snapshot (defensive copy). */
  getGateStatus(): GateStatus {
    return { ...this.gates };
  }

  /** Load gate values from the environment, falling back to defaults. */
  private static loadFromEnv(env: Record<string, string | undefined>): GateStatus {
    const override = env[GATE_ENV_KEYS.override] === 'true';

    if (override) {
      return {
        legalOpinionConfirmed: true,
        taxSourceMappingConfirmed: true,
        correctionMechanismConfirmed: true,
        launchReady: true,
      };
    }

    const legalOpinionConfirmed = env[GATE_ENV_KEYS.legalOpinion] === 'true';
    const taxSourceMappingConfirmed =
      env[GATE_ENV_KEYS.taxSourceMapping] === 'true';
    const correctionMechanismConfirmed =
      env[GATE_ENV_KEYS.correctionMechanism] === 'true';
    const launchReady =
      legalOpinionConfirmed &&
      taxSourceMappingConfirmed &&
      correctionMechanismConfirmed;

    return {
      legalOpinionConfirmed,
      taxSourceMappingConfirmed,
      correctionMechanismConfirmed,
      launchReady,
    };
  }
}

/**
 * LaunchGateGuard port: checks launch-readiness gates for one gate type.
 * When the required gate is not satisfied the request is rejected with a
 * 403 whose message explains which gate is blocking access (byte-identical
 * to the Nest guard's ForbiddenException bodies).
 */
export function requireLaunchGate(gateType: LaunchGateType): MiddlewareHandler<AppEnv> {
  return (c, next) => {
    const launchGate = new LaunchGateService(c.env);

    switch (gateType) {
      case 'CALCULATION':
        if (launchGate.isCalculationEnabled()) {
          return next();
        }
        throw new ApiHttpError(
          403,
          'Landed-cost calculations are not yet publicly available. ' +
            'All launch gates (legal opinion, tax-source mapping, correction mechanism) must be confirmed.',
        );

      case 'PRICE_DATA':
        if (launchGate.isPriceDataVisible()) {
          return next();
        }
        throw new ApiHttpError(
          403,
          'Price data is not yet publicly available. ' +
            'All launch gates (legal opinion, tax-source mapping, correction mechanism) must be confirmed.',
        );
    }
  };
}
