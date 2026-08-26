import { describe, it, expect, vi } from 'vitest';
import { OfferChangeRecorderHook } from '../adapters/offer-change-recorder-hook.adapter';
import type { ChangedOfferEvent } from '@rajahinta/data-acquisition';
import type { PriceObservationRecorderService } from '@rajahinta/core-domain';

function event(overrides: Partial<ChangedOfferEvent> = {}): ChangedOfferEvent {
  return {
    productId: 7,
    offerId: 902,
    merchant: 'systembolaget',
    country: 'SE',
    priceCents: 1499,
    reliabilityStatus: 'VERIFIED',
    observedAt: new Date('2026-08-26T10:00:00Z'),
    ...overrides,
  };
}

describe('OfferChangeRecorderHook', () => {
  it('maps the changed-offer event to the recorder input', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const hook = new OfferChangeRecorderHook({ record } as unknown as PriceObservationRecorderService);

    await hook.onOfferChanged(event());

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      productId: 7,
      offer: {
        id: 902,
        priceCents: 1499,
        merchant: 'systembolaget',
        country: 'SE',
        reliabilityStatus: 'VERIFIED',
      },
      observedAt: new Date('2026-08-26T10:00:00Z'),
    });
  });

  it('degrades unknown reliability values to ESTIMATED (never overstated)', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const hook = new OfferChangeRecorderHook({ record } as unknown as PriceObservationRecorderService);

    await hook.onOfferChanged(event({ reliabilityStatus: 'EXACT' }));

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        offer: expect.objectContaining({ reliabilityStatus: 'ESTIMATED' }),
      }),
    );
  });

  it('propagates recorder rejections — isolation belongs to the pipeline caller', async () => {
    const record = vi.fn().mockRejectedValue(new Error('gate rejected'));
    const hook = new OfferChangeRecorderHook({ record } as unknown as PriceObservationRecorderService);

    await expect(hook.onOfferChanged(event())).rejects.toThrow('gate rejected');
  });
});
