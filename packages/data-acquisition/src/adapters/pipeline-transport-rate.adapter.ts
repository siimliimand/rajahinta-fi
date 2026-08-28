/**
 * Pipeline-backed transport-rate refresh service (task 7.4, design D6).
 *
 * Replaces the Phase 1 no-op: carrier rates are fetched from real
 * carrier sources (Posti first) through the same governance-gated
 * pattern the price pipeline uses — a carrier without GRANTED source
 * permission is skipped before any fetch or write. Validated rates are
 * appended through the transport-offer write port with a reliability
 * status and the carrier's own observation timestamp, and the result
 * carries the newest offer timestamp so the transport-rate-refresh
 * worker can raise the 7-day freshness alert.
 *
 * @module PipelineTransportRateAdapter
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SourceGovernanceService,
  type PermissionCheckResult,
} from '@rajahinta/core-domain';
import { TransportRateService } from '../abstract/transport-rate.service';
import type { TransportRateRefreshResult } from '../abstract/transport-rate.service';
import {
  CARRIER_RATE_SOURCES_TOKEN,
  type CarrierRateOffer,
  type ICarrierRateSource,
} from '../interfaces/carrier-rate-source.port';
import {
  TRANSPORT_OFFER_WRITE_PORT,
  type ITransportOfferWritePort,
} from '../interfaces/transport-offer-write.port';

/** All-governed-carriers wildcard used by the scheduled refresh job. */
const ALL_CARRIERS = '*';

@Injectable()
export class PipelineTransportRateAdapter extends TransportRateService {
  private readonly logger = new Logger(PipelineTransportRateAdapter.name);

  constructor(
    private readonly governanceService: SourceGovernanceService,
    @Inject(CARRIER_RATE_SOURCES_TOKEN)
    private readonly rateSources: Map<string, ICarrierRateSource>,
    @Inject(TRANSPORT_OFFER_WRITE_PORT)
    private readonly offerWritePort: ITransportOfferWritePort,
  ) {
    super();
  }

  /**
   * Refresh transport rates for one carrier (or all registered carriers
   * with the `*` wildcard).
   *
   * Governance gate first, per carrier: no permission records, a
   * governance outage, or any status other than GRANTED skips the
   * carrier — default-off, exactly like merchant ingestion.
   */
  async refreshCarrierRates(
    carrierId: string,
  ): Promise<TransportRateRefreshResult> {
    const carriers =
      carrierId === ALL_CARRIERS
        ? [...this.rateSources.keys()]
        : [carrierId];

    const known = carriers.filter((id) => {
      if (this.rateSources.has(id)) return true;
      this.logger.warn(`No rate source registered for carrier "${id}" — skipping`);
      return false;
    });

    let ratesUpdated = 0;
    for (const carrier of known) {
      ratesUpdated += await this.refreshSingleCarrier(carrier);
    }

    // Newest observation across ALL offers — the refresh's value to the
    // freshness invariant, also when this run appended nothing (e.g. an
    // unchanged feed or a governance-skipped carrier).
    const newestOfferObservedAt = await this.offerWritePort.findNewestObservedAt();

    return { ratesUpdated, newestOfferObservedAt };
  }

  /**
   * Schedule periodic transport-rate refreshes.
   *
   * Still a no-op — scheduling is owned by the BullMQ
   * transport-rate-refresh job (see jobs-scheduler.service.ts).
   */
  schedulePeriodicRefresh(_intervalMs: number): void {
    this.logger.log(
      'schedulePeriodicRefresh: scheduling is managed by BullMQ (transport-refresh queue)',
    );
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async refreshSingleCarrier(carrierId: string): Promise<number> {
    const permitted = await this.checkCarrierPermission(carrierId);
    if (!permitted) {
      // A governance skip is not an error — the run continues with the
      // remaining carriers and the freshness gauge still gets evaluated.
      return 0;
    }

    const source = this.rateSources.get(carrierId)!;
    const { rates, errors } = await source.fetchRates();

    if (errors.length > 0) {
      this.logger.warn(
        `Carrier "${carrierId}" rate fetch reported ${errors.length} error(s): ${errors.join('; ')}`,
      );
    }

    if (rates.length === 0) {
      this.logger.warn(`Carrier "${carrierId}" returned no valid rates — nothing appended`);
      return 0;
    }

    const { inserted } = await this.offerWritePort.insertOffers(
      rates.map((rate: CarrierRateOffer) => ({ rate, reliabilityStatus: 'VERIFIED' })),
    );

    this.logger.log(
      `Appended ${inserted} transport offers for carrier "${carrierId}" ` +
        `(observed ${rates[0].observedAt.toISOString()})`,
    );
    return inserted;
  }

  /**
   * Governance gate for a carrier — mirrors the price pipeline's
   * checkMerchantPermission: no records or a governance error default
   * to PENDING (off), never to granted.
   */
  private async checkCarrierPermission(carrierId: string): Promise<boolean> {
    let result: PermissionCheckResult;
    try {
      result = await this.governanceService.checkPermission(carrierId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown governance error';
      this.logger.error(
        `Governance check failed for carrier "${carrierId}": ${message} — defaulting to PENDING`,
      );
      return false;
    }

    if (result.sources.length === 0) {
      this.logger.warn(
        `Skipping carrier "${carrierId}": no governance records found — defaulting to PENDING`,
      );
      return false;
    }

    if (result.permissionStatus !== 'GRANTED') {
      this.logger.warn(
        `Skipping carrier "${carrierId}": permission status is ${result.permissionStatus}`,
      );
      return false;
    }

    return true;
  }
}
