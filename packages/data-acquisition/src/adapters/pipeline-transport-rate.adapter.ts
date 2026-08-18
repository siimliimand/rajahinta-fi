/**
 * Pipeline-backed transport-rate refresh service.
 *
 * Concrete implementation of the legacy {@link TransportRateService}
 * abstract class.
 *
 * Transport-rate ingestion is NOT YET IMPLEMENTED in Phase 1 (the
 * platform ingests retail prices only).  This adapter returns empty
 * results and logs a warning so the worker framework stays wired but
 * does no work.  A future iteration will add carrier-rate ingestion
 * and delegate to the pipeline.
 *
 * @module PipelineTransportRateAdapter
 */

import { Injectable, Logger } from '@nestjs/common';
import { TransportRateService } from '../abstract/transport-rate.service';

@Injectable()
export class PipelineTransportRateAdapter extends TransportRateService {
  private readonly logger = new Logger(PipelineTransportRateAdapter.name);

  /**
   * Refresh carrier transport rates.
   *
   * Phase 1 no-op: transport-rate data sources are not yet implemented.
   * Logs a warning and returns zero updated rates.
   */
  async refreshCarrierRates(
    carrierId: string,
  ): Promise<{ ratesUpdated: number }> {
    this.logger.warn(
      `refreshCarrierRates("${carrierId}") called but transport-rate ` +
        `ingestion is not yet implemented in Phase 1.  Returning 0.`,
    );
    return { ratesUpdated: 0 };
  }

  /**
   * Schedule periodic transport-rate refreshes.
   *
   * Phase 1 no-op — scheduling is managed externally via BullMQ.
   */
  schedulePeriodicRefresh(_intervalMs: number): void {
    this.logger.warn(
      `schedulePeriodicRefresh is a no-op in Phase 1; ` +
        `scheduling is managed externally via BullMQ.`,
    );
  }
}