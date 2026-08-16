import { Injectable } from '@nestjs/common';

/**
 * Refreshes carrier transport rates periodically.
 */
@Injectable()
export abstract class TransportRateService {
  abstract refreshCarrierRates(
    carrierId: string,
  ): Promise<{ ratesUpdated: number }>;

  abstract schedulePeriodicRefresh(intervalMs: number): void;
}