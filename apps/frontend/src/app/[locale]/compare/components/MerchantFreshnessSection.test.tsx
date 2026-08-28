/**
 * MerchantFreshnessSection tests (task 4.3).
 *
 * Verifies the flag-gated, informational-only contract:
 *   1. Flag off in the inlined payload → the section renders nothing on
 *      the FIRST render and NEVER fires the reliability request.
 *   2. Flag on → renders the factual per-merchant summary (offer count,
 *      per-status shares as percentages, freshest observation, governance
 *      status) with identical rows per merchant.
 *   3. A merchant without a score in the response is omitted.
 *   4. Fetch failure → the display degrades to hidden (informational).
 *
 * @module MerchantFreshnessSectionTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MerchantFreshnessSection from './MerchantFreshnessSection';
import { ALL_FLAGS_OFF, renderWithIntl } from '@/lib/testing/test-intl';
import { getMerchantReliability } from '@/lib/api';
import type { MerchantReliabilityScore } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    getMerchantReliability: vi.fn(),
  };
});

const mockedGetMerchantReliability = vi.mocked(getMerchantReliability);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function score(
  merchant: string,
  overrides: Partial<MerchantReliabilityScore> = {},
): MerchantReliabilityScore {
  return {
    merchant,
    offerCount: 12,
    statusCounts: { VERIFIED: 9, ESTIMATED: 3, STALE: 0, UNAVAILABLE: 0 },
    statusShares: {
      VERIFIED: 0.75,
      ESTIMATED: 0.25,
      STALE: 0,
      UNAVAILABLE: 0,
    },
    strictestStatus: 'ESTIMATED',
    freshestObservedAt: '2026-08-25T06:00:00.000Z',
    governancePermissionStatus: 'GRANTED',
    computedAt: '2026-08-27T10:15:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetMerchantReliability.mockResolvedValue({
    merchants: [score('merchant-a'), score('merchant-b')],
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MerchantFreshnessSection', () => {
  it('hides the display on the first render and never fetches reliability when the flag is off', () => {
    const { container } = renderWithIntl(
      <MerchantFreshnessSection merchants={['merchant-a']} />,
      { featureFlags: ALL_FLAGS_OFF },
    );

    // Synchronous first-render assertion: the inlined flag state hides the
    // section with no client-side flag round-trip (task 9.4).
    expect(container.firstChild).toBeNull();

    expect(mockedGetMerchantReliability).not.toHaveBeenCalled();
    expect(screen.queryByTestId('merchant-freshness')).not.toBeInTheDocument();
  });

  it('renders the factual summary per merchant when the flag is on', async () => {
    renderWithIntl(
      <MerchantFreshnessSection merchants={['merchant-a', 'merchant-b']} />,
    );

    const rows = await screen.findAllByTestId('merchant-freshness-row');
    expect(rows).toHaveLength(2);

    // Every row carries the same factual fields (identical styling per
    // merchant is structural — one <li> per merchant, no per-merchant
    // emphasis classes exist in the component).
    for (const row of rows) {
      expect(row).toHaveTextContent('12 tarjousta');
      expect(row).toHaveTextContent('Vahvistettu 75%');
      expect(row).toHaveTextContent('Arvioitu 25%');
      // Zero-count statuses are not listed.
      expect(row).not.toHaveTextContent('Vanhentunut');
      // Freshest observation timestamp uses the fi-FI date conventions.
      expect(row).toHaveTextContent('Tuorein havainto 25.8.2026');
      expect(row).toHaveTextContent('Hallintatila: Myönnetty');
      expect(row).toHaveTextContent('Laskettu 27.8.2026');
    }
    expect(rows[0]).toHaveTextContent('merchant-a');
    expect(rows[1]).toHaveTextContent('merchant-b');
  });

  it('omits merchants that have no score in the response', async () => {
    renderWithIntl(
      <MerchantFreshnessSection merchants={['merchant-a', 'merchant-z']} />,
    );

    const rows = await screen.findAllByTestId('merchant-freshness-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('merchant-a');
    expect(rows[0]).not.toHaveTextContent('merchant-z');
  });

  it('renders nothing when the merchant list is empty (even with the flag on)', () => {
    const { container } = renderWithIntl(
      <MerchantFreshnessSection merchants={[]} />,
    );

    expect(container.firstChild).toBeNull();
    expect(mockedGetMerchantReliability).not.toHaveBeenCalled();
  });

  it('degrades to hidden when the reliability fetch fails', async () => {
    mockedGetMerchantReliability.mockRejectedValue(new Error('network down'));

    const { container } = renderWithIntl(
      <MerchantFreshnessSection merchants={['merchant-a']} />,
    );

    await waitFor(() =>
      expect(mockedGetMerchantReliability).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('handles a pending governance status without presenting the merchant as granted', async () => {
    mockedGetMerchantReliability.mockResolvedValue({
      merchants: [
        score('merchant-a', {
          governancePermissionStatus: 'PENDING',
          freshestObservedAt: null,
        }),
      ],
    });

    renderWithIntl(<MerchantFreshnessSection merchants={['merchant-a']} />);

    const row = await screen.findByTestId('merchant-freshness-row');
    expect(row).toHaveTextContent('Hallintatila: Vireillä');
    // No observations → no freshest-observation claim.
    expect(row).not.toHaveTextContent('Tuorein havainto');
  });
});
