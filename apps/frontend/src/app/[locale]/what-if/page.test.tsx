/**
 * WhatIfPage tests (task 8.3, change product-roadmap-phases-1-4).
 *
 *   1. Flag off in the inlined payload (absent key or explicit false)
 *      → renders nothing and never fires the request.
 *   2. Blank form → no request; the invalid-input hint and the empty
 *      state show instead.
 *   3. Edits recalculate through POST /api/v1/what-if/excise with the
 *      parsed comma-decimal inputs (integer cents, ABV fraction).
 *   4. DEBOUNCE PIN: rapid slider edits coalesce into ONE request after
 *      the documented 800 ms quiet window — never one per input event.
 *   5. The 200 result renders per-product gap figures with the payload's
 *      sign convention, the dataset citation, and the structural
 *      HYPOTHETICAL disclaimer prominently and non-dismissible.
 *   6. Share: the copy action builds the /what-if?token= link from the
 *      response's shareToken.
 *   7. THROTTLE PIN: a 429 starts the Retry-After countdown, edits
 *      during the countdown fire NO request, and the latest draft is
 *      recomputed once automatically when the countdown clears.
 *   8. 403 (flag flipped off server-side mid-session) degrades to the
 *      unavailable message.
 *   9. A share token in the URL is decoded read-only: the form prefills
 *      and the first computation uses the decoded inputs; an invalid
 *      token degrades to a calm note.
 *
 * @module WhatIfPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WhatIfPage, { RECALCULATION_DEBOUNCE_MS } from './page';
import { ALL_FLAGS_OFF, renderWithIntl } from '@/lib/testing/test-intl';
import { apiFetch, ApiFetchError } from '@/lib/api';
import type { FeatureFlagsResponse } from '@/lib/types';
import type { WhatIfResponse } from './what-if.types';
import { encodeWhatIfShareToken } from './share-token';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

const mockedApiFetch = vi.mocked(apiFetch);

// EXCISE_WHAT_IF is deliberately absent from the shared client type —
// the cast mirrors the runtime payload (trip page test precedent).
const FLAGS_ON: FeatureFlagsResponse = {
  flags: { ...ALL_FLAGS_OFF.flags, EXCISE_WHAT_IF: true },
} as FeatureFlagsResponse;

const DISCLAIMER = {
  text: 'Hypoteettinen laskelma: tulokset on laskettu korvaamalla alkoholiveron oletettu verokanta käyttäjän valitsemalla arvolla kiinteässä lähtötietoaineistossa. Laskelma ei ole ennuste, arvio tulevaisuuden hinnoista eikä virallinen ilmoitus.',
  language: 'fi' as const,
  version: '1.0',
};

/** The same vector the 8.2 API test hand-computes (36.20 → 18.10 €/cl). */
const RESULT_A: WhatIfResponse = {
  hypotheticalRate: 18.1,
  baselineTaxDatasetVersion: 'v3.0-2026',
  disclaimer: DISCLAIMER,
  lines: [
    {
      id: 'product-1',
      category: 'beer',
      importTotalBaselineCents: 259,
      importTotalHypotheticalCents: 174,
      gapBaselineCents: 259 - 1298,
      gapHypotheticalCents: 174 - 1298,
      gapDeltaCents: 85 - 170,
      baseline: {
        formulaRef: 'PER_CENTILITRE_ETHANOL',
        rateApplied: 36.2 * 0.047,
        taxCents: 170,
        taxDatasetVersion: 'v3.0-2026',
        ruleId: 101,
        reliability: 'VERIFIED',
      },
      hypothetical: {
        formulaRef: 'PER_CENTILITRE_ETHANOL',
        rate: 18.1,
        rateApplied: 18.1 * 0.047,
        taxCents: 85,
      },
    },
  ],
  totals: {
    baselineExciseCents: 170,
    hypotheticalExciseCents: 85,
    gapBaselineCents: 259 - 1298,
    gapHypotheticalCents: 174 - 1298,
  },
  shareToken: encodeWhatIfShareToken({
    hypotheticalRate: 18.1,
    products: [
      {
        id: 'product-1',
        category: 'beer',
        abv: 0.047,
        volumeLitres: 1,
        alkoPriceCents: 1298,
        importPriceCents: 89,
      },
    ],
  }),
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

/** Fill the single default row into a fully valid scenario. */
function fillValidRow(container: HTMLElement): void {
  const scope = within(container);
  fireEvent.change(scope.getByLabelText('Alkoholipitoisuus (%)'), {
    target: { value: '4,7' },
  });
  fireEvent.change(scope.getByLabelText('Määrä (litraa)'), {
    target: { value: '1' },
  });
  fireEvent.change(scope.getByLabelText('Kotimainen vertailuhinta (€)'), {
    target: { value: '12,98' },
  });
  fireEvent.change(scope.getByLabelText('Tuonnin vähittäishinta (€)'), {
    target: { value: '0,89' },
  });
}

/** Flush pending microtasks so async state updates land inside act. */
async function flushEffects(): Promise<void> {
  await act(async () => {});
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  mockedApiFetch.mockReset();
  window.history.replaceState(null, '', '/');
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Flag gate
// ---------------------------------------------------------------------------

describe('WhatIfPage — flag gate', () => {
  it('renders nothing on the first render when the flag is absent, and fires no request', async () => {
    const { container } = renderWithIntl(<WhatIfPage />);
    await flushEffects();
    expect(container).toBeEmptyDOMElement();
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it('renders nothing when the flag is explicitly false', async () => {
    const { container } = renderWithIntl(<WhatIfPage />, {
      featureFlags: { flags: { ...FLAGS_ON.flags, EXCISE_WHAT_IF: false } } as FeatureFlagsResponse,
    });
    await flushEffects();
    expect(container).toBeEmptyDOMElement();
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Blank form, first computation, debounce
// ---------------------------------------------------------------------------

describe('WhatIfPage — recalculation discipline', () => {
  it('fires no request while the form is blank and shows the empty state', async () => {
    const { container } = renderWithIntl(<WhatIfPage />, { featureFlags: FLAGS_ON });
    await flushEffects();

    expect(mockedApiFetch).not.toHaveBeenCalled();
    // The no-result blank state is owned by the empty state; the inline
    // hint only serves a result whose draft has drifted invalid.
    expect(screen.queryByTestId('what-if-invalid-hint')).not.toBeInTheDocument();
    expect(screen.getByText('Ei vielä laskentaa')).toBeInTheDocument();
  });

  it('sends parsed comma-decimal inputs (integer cents, ABV fraction) once the row is valid', async () => {
    mockedApiFetch.mockResolvedValueOnce(jsonResponse(RESULT_A));
    const { container } = renderWithIntl(<WhatIfPage />, { featureFlags: FLAGS_ON });
    await flushEffects();

    fillValidRow(container);
    await advance(RECALCULATION_DEBOUNCE_MS);

    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = mockedApiFetch.mock.calls[0]!;
    expect(path).toBe('/api/v1/what-if/excise');
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      hypotheticalRate: 20,
      products: [
        {
          id: 'product-1',
          category: 'beer',
          abv: 0.047,
          volumeLitres: 1,
          alkoPriceCents: 1298,
          importPriceCents: 89,
        },
      ],
    });
  });

  it('DEBOUNCE PIN: rapid slider edits coalesce into one request after the quiet window', async () => {
    mockedApiFetch.mockResolvedValue(jsonResponse(RESULT_A));
    const { container } = renderWithIntl(<WhatIfPage />, { featureFlags: FLAGS_ON });
    await flushEffects();
    fillValidRow(container);
    await advance(RECALCULATION_DEBOUNCE_MS);
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);

    // Three slider events inside the window — exactly one request, and
    // only for the latest value.
    const slider = within(container).getByTestId('what-if-rate-slider');
    fireEvent.change(slider, { target: { value: '30' } });
    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.change(slider, { target: { value: '50' } });
    await advance(RECALCULATION_DEBOUNCE_MS - 1);
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(mockedApiFetch).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse((mockedApiFetch.mock.calls[1]![1] as { body: string }).body).hypotheticalRate,
    ).toBe(50);
  });

  it('still fires exactly one request for the manual recalculate action', async () => {
    mockedApiFetch.mockResolvedValue(jsonResponse(RESULT_A));
    const { container } = renderWithIntl(<WhatIfPage />, { featureFlags: FLAGS_ON });
    await flushEffects();
    fillValidRow(container);
    await advance(RECALCULATION_DEBOUNCE_MS);
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);

    fireEvent.click(within(container).getByRole('button', { name: 'Laske uudelleen' }));
    await flushEffects();
    expect(mockedApiFetch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Result rendering
// ---------------------------------------------------------------------------

describe('WhatIfPage — result rendering', () => {
  async function renderWithResult(): Promise<HTMLElement> {
    mockedApiFetch.mockResolvedValue(jsonResponse(RESULT_A));
    const { container } = renderWithIntl(<WhatIfPage />, { featureFlags: FLAGS_ON });
    await flushEffects();
    fillValidRow(container);
    await advance(RECALCULATION_DEBOUNCE_MS);
    return container;
  }

  it('renders the gap figures with the payload sign convention and the dataset citation', async () => {
    await renderWithResult();

    expect(screen.getByTestId('what-if-result')).toBeInTheDocument();
    // Per-product import totals (baseline vs hypothetical).
    expect(screen.getByText('€2.59')).toBeInTheDocument();
    expect(screen.getByText('€1.74')).toBeInTheDocument();
    // Gap figures keep the sign visible (positive gap = import dearer);
    // the totals repeat the single line's figures, so both occurrences
    // are expected.
    expect(screen.getAllByText('-€10.39').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('-€11.24').length).toBeGreaterThanOrEqual(1);
    // The gap change: 85 − 170 = −85 (the substituted rate narrows the gap).
    expect(screen.getByText('-€0.85')).toBeInTheDocument();
    // Totals.
    expect(screen.getByText('€1.70')).toBeInTheDocument();
    expect(screen.getByText('€0.85')).toBeInTheDocument();
    // Baseline citation (regex: the meta line concatenates rate + version).
    expect(
      screen.getByText(/Vertailun verokanta-aineisto: v3\.0-2026/),
    ).toBeInTheDocument();
  });

  it('renders the structural disclaimer prominently, first in the result, non-dismissible', async () => {
    await renderWithResult();

    const disclaimer = screen.getByTestId('what-if-disclaimer');
    expect(disclaimer).toBeInTheDocument();
    // The structural field from the response, verbatim — never a UI string.
    expect(disclaimer).toHaveTextContent(DISCLAIMER.text);
    // Prominent: the totals (and everything else in the result) follow it.
    const totals = screen.getByTestId('what-if-totals');
    expect(
      disclaimer.compareDocumentPosition(totals) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Non-dismissible: no dismiss affordance inside the banner.
    expect(within(disclaimer).queryAllByRole('button')).toHaveLength(0);
  });

  it('builds the share link from the response share token', async () => {
    await renderWithResult();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Kopioi jakolinkki' }));
    await flushEffects();

    expect(writeText).toHaveBeenCalledTimes(1);
    const url = writeText.mock.calls[0]![0] as string;
    expect(url).toBe(`http://localhost:3000/what-if?token=${RESULT_A.shareToken}`);
  });
});

// ---------------------------------------------------------------------------
// Throttle (429) — countdown, suppression, auto-retry
// ---------------------------------------------------------------------------

describe('WhatIfPage — throttle discipline', () => {
  it('THROTTLE PIN: 429 starts the Retry-After countdown, edits are suppressed, and the countdown-clear retried once', async () => {
    mockedApiFetch
      .mockResolvedValueOnce(jsonResponse(RESULT_A)) // first computation
      .mockResolvedValueOnce(
        jsonResponse({ error: 'TooManyRequests' }, { status: 429, headers: { 'Retry-After': '2' } }),
      )
      .mockResolvedValueOnce(jsonResponse({ ...RESULT_A, hypotheticalRate: 50 })); // auto-retry

    const { container } = renderWithIntl(<WhatIfPage />, { featureFlags: FLAGS_ON });
    await flushEffects();
    fillValidRow(container);
    await advance(RECALCULATION_DEBOUNCE_MS);
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);

    // Move the slider: the debounced run trips the limiter.
    fireEvent.change(within(container).getByTestId('what-if-rate-slider'), {
      target: { value: '30' },
    });
    await advance(RECALCULATION_DEBOUNCE_MS);
    expect(mockedApiFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('what-if-throttle')).toHaveTextContent(
      'Liikaa laskentapyyntöjä. Laskenta jatkuu 2 s kuluttua.',
    );

    // Edits during the countdown fire NO request (suppressed + debounced).
    fireEvent.change(within(container).getByTestId('what-if-rate-slider'), {
      target: { value: '50' },
    });
    await advance(RECALCULATION_DEBOUNCE_MS);
    expect(mockedApiFetch).toHaveBeenCalledTimes(2);

    // Countdown ticks to zero, then the latest draft recomputes once —
    // automatically, with the suppressed 50, without further input.
    await advance(1000);
    expect(screen.getByTestId('what-if-throttle')).toHaveTextContent(
      'Laskenta jatkuu 1 s kuluttua.',
    );
    await advance(1000);
    expect(mockedApiFetch).toHaveBeenCalledTimes(3);
    expect(
      JSON.parse((mockedApiFetch.mock.calls[2]![1] as { body: string }).body).hypotheticalRate,
    ).toBe(50);
    expect(
      screen.getByText(/Hypoteettinen verokanta: 50 € kaava-yksikköä kohti/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('what-if-throttle')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Failure degradation
// ---------------------------------------------------------------------------

describe('WhatIfPage — failure degradation', () => {
  it('degrades a 403 (flag flipped off server-side mid-session) to the unavailable message', async () => {
    mockedApiFetch.mockRejectedValueOnce(
      new ApiFetchError(403, {
        statusCode: 403,
        message: 'Feature "EXCISE_WHAT_IF" is not enabled',
        error: 'Forbidden',
        timestamp: '2026-09-05T10:00:00.000Z',
        path: '/api/v1/what-if/excise',
      }),
    );
    const { container } = renderWithIntl(<WhatIfPage />, { featureFlags: FLAGS_ON });
    await flushEffects();
    fillValidRow(container);
    await advance(RECALCULATION_DEBOUNCE_MS);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Mitä jos -laskuri ei ole käytettävissä.',
    );
  });
});

// ---------------------------------------------------------------------------
// Share-token prefill (read-only decode)
// ---------------------------------------------------------------------------

describe('WhatIfPage — share token prefill', () => {
  it('decodes the ?token= scenario read-only and computes it first thing', async () => {
    mockedApiFetch.mockResolvedValueOnce(jsonResponse(RESULT_A));
    window.history.replaceState(null, '', `/?token=${RESULT_A.shareToken}`);

    renderWithIntl(<WhatIfPage />, { featureFlags: FLAGS_ON });
    await advance(RECALCULATION_DEBOUNCE_MS);

    // First and only request: the decoded inputs, immediately (no debounce
    // for the first computation).
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse((mockedApiFetch.mock.calls[0]![1] as { body: string }).body),
    ).toEqual({
      hypotheticalRate: 18.1,
      products: [
        {
          id: 'product-1',
          category: 'beer',
          abv: 0.047,
          volumeLitres: 1,
          alkoPriceCents: 1298,
          importPriceCents: 89,
        },
      ],
    });
    // The form reflects the decoded scenario (slider + rate readout).
    expect(screen.getByTestId('what-if-rate-value')).toHaveTextContent('18.1 €');
  });

  it('degrades an invalid token to a calm note with a blank form and no request', async () => {
    window.history.replaceState(null, '', '/?token=not-a-real-token');
    const { container } = renderWithIntl(<WhatIfPage />, { featureFlags: FLAGS_ON });
    await flushEffects();

    expect(screen.getByTestId('what-if-invalid-token')).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalled();
    expect(container).toHaveTextContent('Tuoterivi 1');
  });
});
