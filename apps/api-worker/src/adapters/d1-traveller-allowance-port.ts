/**
 * D1 adapter for the optimizer's traveller-allowance port (task 8.2,
 * change trust-and-reach-roadmap) — the composition-root binding the
 * port doc names: `ITravellerAllowancePort` is owned by core-domain so
 * the allowance-fill objective never depends on data-platform; this
 * adapter maps the task-5.1 D1TravellerAllowancesRepository's
 * effective-date resolution behind the contract at the Worker's
 * composition root.
 *
 * The mapping is 1:1 onto the port's narrow projection
 * ({@link TripResolvedAllowances} — the tripcalc shape the port
 * re-declares): the dataset `versionLabel` for provenance plus the
 * window-filtered per-category cap rows. The explicit mapping keeps the
 * API layer honest about which fields cross the boundary — the
 * repository's citation/effective-window/audit fields stop here.
 *
 * Null resolution semantics are the repository's own: no PUBLISHED
 * version whose half-open window covers the travel date ⇒ null — the
 * fill engine refuses to run unbounded rather than inventing caps.
 *
 * @module D1TravellerAllowancePort
 */

import type { ITravellerAllowancePort } from '../../../../packages/core-domain/src/optimizer/ports/traveller-allowance.port';
import type { TripResolvedAllowances } from '../../../../packages/core-domain/src/tripcalc/tripcalc.types';
import { D1TravellerAllowancesRepository } from '../../../../packages/data-platform/src/repositories/d1/traveller-allowances.repository';

/** Traveller-allowance reads over the D1 allowances repository. */
export class D1TravellerAllowancePort implements ITravellerAllowancePort {
  constructor(private readonly repo: D1TravellerAllowancesRepository) {}

  /** @inheritdoc */
  async resolveForTravelDate(
    travelDate: string,
  ): Promise<TripResolvedAllowances | null> {
    const resolved = await this.repo.findPublishedEffectiveOn(travelDate);
    if (resolved === null) {
      return null;
    }
    return {
      dataset: { versionLabel: resolved.dataset.versionLabel },
      limits: resolved.limits.map((limit) => ({
        category: limit.category,
        volumeCapLitres: limit.volumeCapLitres,
        quantityCap: limit.quantityCap,
      })),
    };
  }
}
