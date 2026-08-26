/**
 * Port interface for price-observation persistence.
 *
 * Core Domain owns this port so the recorder depends on an abstraction,
 * not on a specific storage implementation. The concrete Drizzle adapter
 * over the `price_observations` table lives in the data-platform layer and
 * is wired by the composition root (see change
 * 2026-08-26-phase2-historical-price-intelligence tasks 1.3 / 2.2).
 *
 * The log is append-only: the port deliberately exposes no update or
 * delete operations, and application code must never mutate an observation
 * row after it is appended.
 *
 * @module PriceObservationPort
 */

import type { PriceObservation } from './price-observation.types';

/** Injection token for IPriceObservationPort. */
export const PRICE_OBSERVATION_PORT = 'PRICE_OBSERVATION_PORT';

/**
 * Repository contract for the append-only observation log.
 *
 * Consumers inject this interface. An adapter in the composition root maps
 * the concrete `price_observations` table to this port.
 */
export interface IPriceObservationPort {
  /**
   * Append one observation row.
   *
   * Implementations MUST insert only — never update or delete existing
   * rows. Returns the assigned row ID.
   */
  append(observation: PriceObservation): Promise<{ id: number }>;
}
