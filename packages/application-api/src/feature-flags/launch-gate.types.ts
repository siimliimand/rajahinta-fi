/**
 * Launch-gate types — controls whether calculation and price-data
 * endpoints are publicly accessible before legal/regulatory confirmation.
 *
 * All gates default to OFF (safe default). The override env var
 * `LAUNCH_GATES_OVERRIDE=true` forces all gates open for dev/demo.
 */

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
