/**
 * Pure function for evaluating Finnish deposit-return system (palautuspullojärjestelmä)
 * status and determining container duty exemption.
 *
 * Where deposit status cannot be determined, the result is flagged as ESTIMATED
 * (never silently assume either way).
 *
 * @module DepositChecker
 */

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface DepositCheckResult {
  /** True if container duty should be exempted (€0.00). */
  readonly exempted: boolean;
  /** Human-readable explanation of the decision. */
  readonly reason: string;
  /**
   * Reliability of this decision.
   * - `'VERIFIED'` when depositSystemStatus is true or false
   * - `'ESTIMATED'` when depositSystemStatus is null (unknown)
   */
  readonly reliability: 'VERIFIED' | 'ESTIMATED';
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a container qualifies for deposit-system exemption.
 *
 * @param depositSystemStatus - `true` if packaging participates in the Finnish
 *   deposit-return system, `false` if it does not, `null` if unknown.
 * @returns A {@link DepositCheckResult} with the exemption decision and reason.
 */
export function checkDepositExemption(
  depositSystemStatus: boolean | null,
): DepositCheckResult {
  if (depositSystemStatus === true) {
    return {
      exempted: true,
      reason:
        'exempted — packaging participates in Finnish deposit-return system',
      reliability: 'VERIFIED',
    };
  }

  if (depositSystemStatus === false) {
    return {
      exempted: false,
      reason:
        'applied — packaging does not participate in Finnish deposit-return system',
      reliability: 'VERIFIED',
    };
  }

  // depositSystemStatus === null
  return {
    exempted: false,
    reason:
      'estimated — deposit status could not be determined, assuming standard rate',
    reliability: 'ESTIMATED',
  };
}