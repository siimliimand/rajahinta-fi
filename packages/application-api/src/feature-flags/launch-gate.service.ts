import { Injectable, Logger } from '@nestjs/common';
import { GateStatus, GATE_ENV_KEYS } from './launch-gate.types';

/**
 * Launch-gating service — controls whether calculation and price-data
 * endpoints are publicly accessible before legal/regulatory confirmation.
 *
 * All gates default to OFF (safe default). The `LAUNCH_GATES_OVERRIDE=true`
 * env var forces all gates open for dev/demo environments.
 *
 * Individual gates can be toggled via env vars:
 *   - `LAUNCH_GATE_LEGAL_OPINION=true`
 *   - `LAUNCH_GATE_TAX_SOURCE_MAPPING=true`
 *   - `LAUNCH_GATE_CORRECTION_MECHANISM=true`
 */
@Injectable()
export class LaunchGateService {
  private readonly logger = new Logger(LaunchGateService.name);
  private readonly gates: GateStatus;

  constructor() {
    this.gates = this.loadFromEnv();
    this.logger.log(`Launch gates initialized: ${JSON.stringify(this.gates)}`);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Whether landed-cost calculations are enabled.
   * Returns true only when ALL three gates (legal, tax, correction) are confirmed.
   */
  isCalculationEnabled(): boolean {
    return this.gates.launchReady;
  }

  /**
   * Whether price data is visible to end users.
   * Returns true when the legal opinion gate is confirmed.
   * The other gates are not required for read-only price display.
   */
  isPriceDataVisible(): boolean {
    return this.gates.legalOpinionConfirmed;
  }

  /** Return the full gate status snapshot. */
  getGateStatus(): GateStatus {
    return { ...this.gates };
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /** Load gate values from environment, falling back to defaults. */
  private loadFromEnv(): GateStatus {
    const env = process.env;
    const override = env[GATE_ENV_KEYS.override] === 'true';

    if (override) {
      this.logger.log(
        'LAUNCH_GATES_OVERRIDE=true — all launch gates forced OPEN',
      );
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
