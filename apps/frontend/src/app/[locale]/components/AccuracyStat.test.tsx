/**
 * AccuracyStat tests (trust-and-reach-roadmap task 3.3, spec
 * calculation-outcomes "Public accuracy statistic labeled user-reported"
 * + "Empty state honest"; breakdown display task 5.2, change
 * expand-alerts-accuracy-breakdowns).
 *
 * Pins the three hard rendering rules:
 *   1. Empty state: count 0 → the explicit "no outcomes yet" state and
 *      NEVER a percentage (share is null exactly when count is 0).
 *   2. Non-empty: the share, the SAMPLE SIZE, and the API-supplied
 *      user-reported label (fi locale → the Finnish label) all render.
 *   3. Fetch failure → the quiet unavailable note; the statistic never
 *      blocks the page around it.
 *
 * And the breakdown contract (section variant only):
 *   4. The category | carrier selector fetches ?groupBy=… per dimension;
 *      the global figure stays the default view.
 *   5. Cells render by their API-supplied state: share → share + count;
 *      count_only → count WITHOUT any percentage; empty → the honest
 *      empty state (never a fabricated 0 %).
 *   6. The trust-row variant gains no selector.
 *
 * Coverage mode (honest-trust-surfaces task 3.2, design D4):
 *   7. Count 0 WITH a coverage block → the labeled catalog-coverage
 *      rendering (products tracked / observations / last sync), never
 *      the accuracy presentation (no share, no sample size, no
 *      breakdown selector) — in both variants.
 *   8. Count 0 WITHOUT the block (pre-3.1 response) → the honest empty
 *      state, exactly as before.
 *   9. Non-zero count → the user-reported presentation unchanged, even
 *      when a coverage block rides along (the data-driven flip back).
 *  10. lastIngestAt null → coverage renders without the sync row.
 *  11. A watermark not shaped like an ISO-8601 instant renders no sync
 *      row even when Date.parse accepts it (year-only "9194" — the
 *      production incident), in BOTH render variants
 *      (watermark-isolation-history-backfill task 1.2, design D2).
 *
 * @module AccuracyStatTest
 */
// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccuracyStat from './AccuracyStat';
import { getAccuracyBreakdown, getAccuracyStatistic } from '@/lib/api';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type { AccuracyBreakdown, AccuracyCoverage } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    getAccuracyStatistic: vi.fn(),
    getAccuracyBreakdown: vi.fn(),
  };
});

const mockedAccuracy = vi.mocked(getAccuracyStatistic);
const mockedBreakdown = vi.mocked(getAccuracyBreakdown);

beforeEach(() => {
  mockedAccuracy.mockReset();
  mockedBreakdown.mockReset();
});

/** The global statistic the section always loads first. */
function globalStat(count = 12, withinMarginShare: number | null = 0.75) {
  return {
    count,
    withinMarginShare,
    asOf: '2026-09-08T10:00:00.000Z',
    label: {
      fi: 'Perustuu käyttäjien raportoimiin lopputuloksiin',
      en: 'Based on user-reported outcomes',
    },
  };
}

/** A breakdown response with one cell per honesty state. */
function breakdown(dimension: 'category' | 'carrier'): AccuracyBreakdown {
  return {
    dimension,
    cells: [
      { key: 'beer', count: 14, withinMarginShare: 0.8, state: 'share' },
      { key: 'spirits', count: 3, withinMarginShare: null, state: 'count_only' },
      { key: 'wine_still', count: 0, withinMarginShare: null, state: 'empty' },
    ],
    asOf: '2026-09-08T10:00:00.000Z',
    label: {
      fi: 'Perustuu käyttäjien raportoimiin lopputuloksiin',
      en: 'Based on user-reported outcomes',
    },
  };
}

/** The additive catalog-coverage block (honest-trust-surfaces task 3.1). */
function coverage(
  overrides: Partial<AccuracyCoverage> = {},
): AccuracyCoverage {
  return {
    productCount: 1284,
    offerObservations: 45231,
    lastIngestAt: '2026-09-30T00:05:00.000Z',
    ...overrides,
  };
}

/** A statistic with the coverage block attached, as the route returns it. */
function statWithCoverage(
  count = 0,
  block: AccuracyCoverage | undefined = coverage(),
) {
  return { ...globalStat(count, count === 0 ? null : 0.75), coverage: block };
}

describe('AccuracyStat (honest rendering contract)', () => {
  it('renders the empty state, never a percentage, when count is 0', async () => {
    mockedAccuracy.mockResolvedValue(globalStat(0, null));

    renderWithIntl(<AccuracyStat variant="section" />);
    await waitFor(() => expect(screen.getByTestId('accuracy-empty')).toBeDefined());

    // The honest wording renders; no share line or sample size appears.
    expect(screen.getByText('Ei vielä käyttäjien raportoimia lopputuloksia')).toBeDefined();
    expect(screen.queryByTestId('accuracy-statistic')).toBeNull();
    expect(screen.queryByText(/raportoiduista loppusumista/)).toBeNull();
    expect(screen.queryByText(/Otoskoko:/)).toBeNull();
  });

  it('renders the share, the sample size, and the API-supplied fi label', async () => {
    mockedAccuracy.mockResolvedValue(globalStat());

    renderWithIntl(<AccuracyStat variant="section" />);
    await waitFor(() =>
      expect(screen.getByTestId('accuracy-statistic')).toBeDefined(),
    );

    // Share formatted with the Finnish decimal comma.
    expect(screen.getByText(/75 % raportoiduista loppusumista/)).toBeDefined();
    // Sample size is always displayed.
    expect(screen.getByText(/Otoskoko: 12/)).toBeDefined();
    // The label comes from the API, verbatim — never the UI's own wording.
    expect(
      screen.getByText(/Perustuu käyttäjien raportoimiin lopputuloksiin/),
    ).toBeDefined();
  });

  it('degrades to the quiet unavailable note on fetch failure', async () => {
    mockedAccuracy.mockRejectedValue(new Error('backend down'));

    renderWithIntl(<AccuracyStat variant="section" />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(
      screen.getByText('Tarkkuustilasto ei ole juuri nyt saatavilla.'),
    ).toBeDefined();
  });

  it('trust-row variant renders the heading and the honest empty state', async () => {
    mockedAccuracy.mockResolvedValue(globalStat(0, null));

    renderWithIntl(<AccuracyStat variant="trust-row" />);
    await waitFor(() =>
      expect(screen.getByText('Kuinka tarkkoja arviot ovat?')).toBeDefined(),
    );
    expect(
      screen.getByText('Ei vielä käyttäjien raportoimia lopputuloksia.'),
    ).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Breakdown display (task 5.2, section variant only)
// ---------------------------------------------------------------------------

describe('AccuracyStat breakdown (section variant)', () => {
  it('renders the category | carrier selector once the global figure is in, and fetches the chosen dimension', async () => {
    const user = userEvent.setup();
    mockedAccuracy.mockResolvedValue(globalStat());
    mockedBreakdown.mockResolvedValue(breakdown('carrier'));

    renderWithIntl(<AccuracyStat variant="section" />);
    await waitFor(() =>
      expect(screen.getByTestId('accuracy-statistic')).toBeDefined(),
    );

    // The selector is present; nothing is fetched before a choice.
    expect(screen.getByTestId('accuracy-breakdown')).toBeInTheDocument();
    expect(mockedBreakdown).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('accuracy-dimension-carrier'));

    await waitFor(() =>
      expect(mockedBreakdown).toHaveBeenCalledWith('carrier'),
    );
    const cells = await screen.findByTestId('accuracy-breakdown-cells');
    expect(cells).toBeInTheDocument();
  });

  it('switches dimensions: the carrier fetch follows the category fetch', async () => {
    const user = userEvent.setup();
    mockedAccuracy.mockResolvedValue(globalStat());
    mockedBreakdown.mockResolvedValue(breakdown('category'));

    renderWithIntl(<AccuracyStat variant="section" />);
    await screen.findByTestId('accuracy-statistic');

    await user.click(screen.getByTestId('accuracy-dimension-category'));
    await waitFor(() =>
      expect(mockedBreakdown).toHaveBeenLastCalledWith('category'),
    );
    await screen.findByTestId('accuracy-breakdown-cells');

    mockedBreakdown.mockResolvedValue(breakdown('carrier'));
    await user.click(screen.getByTestId('accuracy-dimension-carrier'));
    await waitFor(() =>
      expect(mockedBreakdown).toHaveBeenLastCalledWith('carrier'),
    );
  });

  it('renders a share cell with the share AND the count, labeled by the localized category', async () => {
    const user = userEvent.setup();
    mockedAccuracy.mockResolvedValue(globalStat());
    mockedBreakdown.mockResolvedValue(breakdown('category'));

    renderWithIntl(<AccuracyStat variant="section" />);
    await screen.findByTestId('accuracy-statistic');

    await user.click(screen.getByTestId('accuracy-dimension-category'));
    const cells = await screen.findByTestId('accuracy-breakdown-cells');
    const shareCell = within(cells)
      .getAllByTestId('accuracy-breakdown-cell')
      .find((cell) => cell.getAttribute('data-state') === 'share');
    expect(shareCell).toBeDefined();
    expect(shareCell!).toHaveTextContent('Olut');
    expect(shareCell!).toHaveTextContent('80 % raportoiduista loppusumista');
    expect(shareCell!).toHaveTextContent('Otoskoko: 14');
  });

  it('renders a count-only cell with the count and NO percentage', async () => {
    const user = userEvent.setup();
    mockedAccuracy.mockResolvedValue(globalStat());
    mockedBreakdown.mockResolvedValue(breakdown('category'));

    renderWithIntl(<AccuracyStat variant="section" />);
    await screen.findByTestId('accuracy-statistic');

    await user.click(screen.getByTestId('accuracy-dimension-category'));
    const cells = await screen.findByTestId('accuracy-breakdown-cells');
    const countOnlyCell = within(cells)
      .getAllByTestId('accuracy-breakdown-cell')
      .find((cell) => cell.getAttribute('data-state') === 'count_only');
    expect(countOnlyCell).toBeDefined();
    expect(countOnlyCell!).toHaveTextContent('Väkevät alkoholijuomat');
    expect(countOnlyCell!).toHaveTextContent('Otoskoko: 3');
    // The suppression reason renders; a percentage never does.
    expect(countOnlyCell!).toHaveTextContent(
      'Osuutta ei näytetä, kun lopputuloksia on alle 10.',
    );
    expect(countOnlyCell!).not.toHaveTextContent('%');
  });

  it('renders an empty cell as the honest empty state — no count, no percentage', async () => {
    const user = userEvent.setup();
    mockedAccuracy.mockResolvedValue(globalStat());
    mockedBreakdown.mockResolvedValue(breakdown('category'));

    renderWithIntl(<AccuracyStat variant="section" />);
    await screen.findByTestId('accuracy-statistic');

    await user.click(screen.getByTestId('accuracy-dimension-category'));
    const cells = await screen.findByTestId('accuracy-breakdown-cells');
    const emptyCell = within(cells)
      .getAllByTestId('accuracy-breakdown-cell')
      .find((cell) => cell.getAttribute('data-state') === 'empty');
    expect(emptyCell).toBeDefined();
    expect(emptyCell!).toHaveTextContent('Ei vielä lopputuloksia.');
    // Neither a fabricated 0 % nor a sample-size line.
    expect(emptyCell!).not.toHaveTextContent('%');
    expect(emptyCell!).not.toHaveTextContent('Otoskoko:');
  });

  it('keeps the API-supplied user-reported label on the breakdown block', async () => {
    const user = userEvent.setup();
    mockedAccuracy.mockResolvedValue(globalStat());
    mockedBreakdown.mockResolvedValue(breakdown('category'));

    renderWithIntl(<AccuracyStat variant="section" />);
    await screen.findByTestId('accuracy-statistic');

    await user.click(screen.getByTestId('accuracy-dimension-category'));
    const panel = await screen.findByTestId('accuracy-breakdown');
    await waitFor(() =>
      expect(
        within(panel).getAllByText(/Perustuu käyttäjien raportoimiin lopputuloksiin/),
      ).toBeDefined(),
    );
  });

  it('degrades the breakdown quietly when the split fetch fails, with a retry', async () => {
    const user = userEvent.setup();
    mockedAccuracy.mockResolvedValue(globalStat());
    mockedBreakdown.mockRejectedValue(new Error('backend down'));

    renderWithIntl(<AccuracyStat variant="section" />);
    await screen.findByTestId('accuracy-statistic');

    await user.click(screen.getByTestId('accuracy-dimension-category'));
    const panel = await screen.findByTestId('accuracy-breakdown');
    await waitFor(() =>
      expect(
        within(panel).getByText('Jaottelun lataaminen epäonnistui'),
      ).toBeInTheDocument(),
    );
    // The global figure above stays untouched.
    expect(screen.getByTestId('accuracy-statistic')).toBeInTheDocument();

    mockedBreakdown.mockResolvedValue(breakdown('category'));
    await user.click(within(panel).getByRole('button', { name: 'Yritä uudelleen' }));
    await waitFor(() =>
      expect(screen.getByTestId('accuracy-breakdown-cells')).toBeInTheDocument(),
    );
  });
});

describe('AccuracyStat trust-row (breakdown absence)', () => {
  it('keeps the global figure and renders no selector', async () => {
    mockedAccuracy.mockResolvedValue(globalStat());

    renderWithIntl(<AccuracyStat variant="trust-row" />);
    await waitFor(() =>
      expect(screen.getByTestId('accuracy-trust-row')).toBeDefined(),
    );
    expect(screen.getByText(/75 % raportoiduista loppusumista/)).toBeDefined();
    expect(screen.queryByTestId('accuracy-breakdown')).toBeNull();
    expect(screen.queryByTestId('accuracy-dimension-category')).toBeNull();
    expect(screen.queryByTestId('accuracy-dimension-carrier')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Coverage mode (honest-trust-surfaces task 3.2, design D4)
// ---------------------------------------------------------------------------

describe('AccuracyStat coverage mode (count 0 + coverage block)', () => {
  it('renders the labeled catalog coverage in the section variant — never the accuracy presentation', async () => {
    mockedAccuracy.mockResolvedValue(statWithCoverage());

    renderWithIntl(<AccuracyStat variant="section" />);
    const cov = await screen.findByTestId('accuracy-coverage');

    // The coverage label names the mode (the section heading); the three
    // true values render inside the block.
    expect(cov).toHaveTextContent('Seurattuja tuotteita');
    expect(cov).toHaveTextContent('1284');
    expect(cov).toHaveTextContent('Tallennettuja hintahavaintoja');
    expect(cov).toHaveTextContent('45231');
    const sync = within(cov).getByTestId('accuracy-coverage-last-sync');
    expect(sync).toHaveTextContent('Viimeisin päivitys');
    // The watermark formats with the existing fi numeric date convention.
    expect(sync).toHaveTextContent(/30\.9\.2026/);

    // Visually distinct from the accuracy presentation: the heading is
    // the coverage label, and no share, sample size, or selector renders.
    expect(
      screen.getByRole('heading', { name: 'Seurattu valikoima' }),
    ).toBeDefined();
    expect(screen.queryByTestId('accuracy-empty')).toBeNull();
    expect(screen.queryByTestId('accuracy-statistic')).toBeNull();
    expect(screen.queryByTestId('accuracy-breakdown')).toBeNull();
    expect(cov).not.toHaveTextContent('%');
    expect(cov).not.toHaveTextContent('Otoskoko');
    // The API's user-reported label does not ride along in coverage mode.
    expect(
      screen.queryByText(/Perustuu käyttäjien raportoimiin lopputuloksiin/),
    ).toBeNull();
  });

  it('renders the labeled catalog coverage in the trust-row variant (homepage)', async () => {
    mockedAccuracy.mockResolvedValue(statWithCoverage());

    renderWithIntl(<AccuracyStat variant="trust-row" />);
    await waitFor(() =>
      expect(screen.getByTestId('accuracy-trust-row')).toBeDefined(),
    );
    const cov = await screen.findByTestId('accuracy-coverage');

    expect(
      screen.getByRole('heading', { name: 'Seurattu valikoima' }),
    ).toBeDefined();
    expect(cov).toHaveTextContent('Seurattuja tuotteita');
    expect(cov).toHaveTextContent('1284');
    expect(screen.queryByTestId('accuracy-empty')).toBeNull();
    expect(screen.queryByTestId('accuracy-statistic')).toBeNull();
  });

  it('keeps the honest empty state when the response carries no coverage block (old response)', async () => {
    mockedAccuracy.mockResolvedValue(globalStat(0, null));

    renderWithIntl(<AccuracyStat variant="section" />);
    await waitFor(() => expect(screen.getByTestId('accuracy-empty')).toBeDefined());

    expect(screen.queryByTestId('accuracy-coverage')).toBeNull();
    expect(screen.getByText('Ei vielä käyttäjien raportoimia lopputuloksia')).toBeDefined();
  });

  it('flips back to the user-reported presentation when the count is non-zero, even with coverage present', async () => {
    mockedAccuracy.mockResolvedValue(statWithCoverage(12));

    renderWithIntl(<AccuracyStat variant="section" />);
    await waitFor(() =>
      expect(screen.getByTestId('accuracy-statistic')).toBeDefined(),
    );

    // Byte-for-byte the accuracy presentation; the coverage block and its
    // label stay out.
    expect(screen.getByText(/75 % raportoiduista loppusumista/)).toBeDefined();
    expect(screen.getByText(/Otoskoko: 12/)).toBeDefined();
    expect(screen.queryByTestId('accuracy-coverage')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Seurattu valikoima' })).toBeNull();
    // The breakdown selector returns with the outcomes it splits.
    expect(screen.getByTestId('accuracy-breakdown')).toBeInTheDocument();
  });

  it('renders coverage without the sync row when lastIngestAt is null', async () => {
    mockedAccuracy.mockResolvedValue(
      statWithCoverage(0, coverage({ lastIngestAt: null })),
    );

    renderWithIntl(<AccuracyStat variant="trust-row" />);
    const cov = await screen.findByTestId('accuracy-coverage');

    expect(cov).toHaveTextContent('Seurattuja tuotteita');
    expect(cov).toHaveTextContent('Tallennettuja hintahavaintoja');
    expect(screen.queryByTestId('accuracy-coverage-last-sync')).toBeNull();
    expect(cov).not.toHaveTextContent('Viimeisin päivitys');
  });
});

// ---------------------------------------------------------------------------
// Corrupt watermark gate (watermark-isolation-history-backfill task 1.2,
// design D2)
// ---------------------------------------------------------------------------

describe('AccuracyStat corrupt watermark (no sync row)', () => {
  // A bare year parses as year 9194 — the production incident
  // ("Viimeisin päivitys: 1.1.9194"). It must be treated exactly like an
  // absent watermark: the coverage block still renders, the sync row
  // never does. The spec scenario names both renderings explicitly, so
  // the corrupt state is exercised through each variant's own render
  // path, not just the shared AccuracyCoverageBlock.
  const yearOnly = coverage({ lastIngestAt: '9194' });

  it('section variant: a year-only watermark renders no sync row and no fabricated date', async () => {
    mockedAccuracy.mockResolvedValue(statWithCoverage(0, yearOnly));

    renderWithIntl(<AccuracyStat variant="section" />);
    const cov = await screen.findByTestId('accuracy-coverage');

    // The block itself still renders with its true values…
    expect(cov).toHaveTextContent('Seurattuja tuotteita');
    expect(cov).toHaveTextContent('1284');
    expect(cov).toHaveTextContent('Tallennettuja hintahavaintoja');
    // …but the sync row is gone entirely — no label, no "1.1.9194".
    expect(screen.queryByTestId('accuracy-coverage-last-sync')).toBeNull();
    expect(cov).not.toHaveTextContent('Viimeisin päivitys');
    expect(cov).not.toHaveTextContent('9194');
  });

  it('trust-row variant: a year-only watermark renders no sync row (the home-page incident)', async () => {
    mockedAccuracy.mockResolvedValue(statWithCoverage(0, yearOnly));

    renderWithIntl(<AccuracyStat variant="trust-row" />);
    const cov = await screen.findByTestId('accuracy-coverage');

    expect(cov).toHaveTextContent('Seurattuja tuotteita');
    expect(screen.queryByTestId('accuracy-coverage-last-sync')).toBeNull();
    expect(cov).not.toHaveTextContent('Viimeisin päivitys');
    expect(cov).not.toHaveTextContent('9194');
  });

  it('a date-only watermark is not an instant and renders no sync row either', async () => {
    mockedAccuracy.mockResolvedValue(
      statWithCoverage(0, coverage({ lastIngestAt: '2026-09-30' })),
    );

    renderWithIntl(<AccuracyStat variant="section" />);
    const cov = await screen.findByTestId('accuracy-coverage');

    expect(screen.queryByTestId('accuracy-coverage-last-sync')).toBeNull();
    expect(cov).not.toHaveTextContent('Viimeisin päivitys');
  });
});

