/**
 * AccuracyStat tests (trust-and-reach-roadmap task 3.3, spec
 * calculation-outcomes "Public accuracy statistic labeled user-reported"
 * + "Empty state honest").
 *
 * Pins the three hard rendering rules:
 *   1. Empty state: count 0 → the explicit "no outcomes yet" state and
 *      NEVER a percentage (share is null exactly when count is 0).
 *   2. Non-empty: the share, the SAMPLE SIZE, and the API-supplied
 *      user-reported label (fi locale → the Finnish label) all render.
 *   3. Fetch failure → the quiet unavailable note; the statistic never
 *      blocks the page around it.
 *
 * @module AccuracyStatTest
 */
// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AccuracyStat from './AccuracyStat';
import { getAccuracyStatistic } from '@/lib/api';
import { renderWithIntl } from '@/lib/testing/test-intl';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    getAccuracyStatistic: vi.fn(),
  };
});

const mockedAccuracy = vi.mocked(getAccuracyStatistic);

beforeEach(() => {
  mockedAccuracy.mockReset();
});

describe('AccuracyStat (honest rendering contract)', () => {
  it('renders the empty state, never a percentage, when count is 0', async () => {
    mockedAccuracy.mockResolvedValue({
      count: 0,
      withinMarginShare: null,
      asOf: '2026-09-08T10:00:00.000Z',
      label: { fi: 'Perustuu käyttäjien raportoimiin lopputuloksiin', en: 'Based on user-reported outcomes' },
    });

    renderWithIntl(<AccuracyStat variant="section" />);
    await waitFor(() => expect(screen.getByTestId('accuracy-empty')).toBeDefined());

    // The honest wording renders; no share line or sample size appears.
    expect(screen.getByText('Ei vielä käyttäjien raportoimia lopputuloksia')).toBeDefined();
    expect(screen.queryByTestId('accuracy-statistic')).toBeNull();
    expect(screen.queryByText(/raportoiduista loppusumista/)).toBeNull();
    expect(screen.queryByText(/Otoskoko:/)).toBeNull();
  });

  it('renders the share, the sample size, and the API-supplied fi label', async () => {
    mockedAccuracy.mockResolvedValue({
      count: 12,
      withinMarginShare: 0.75,
      asOf: '2026-09-08T10:00:00.000Z',
      label: { fi: 'Perustuu käyttäjien raportoimiin lopputuloksiin', en: 'Based on user-reported outcomes' },
    });

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
    mockedAccuracy.mockResolvedValue({
      count: 0,
      withinMarginShare: null,
      asOf: '2026-09-08T10:00:00.000Z',
      label: { fi: 'x', en: 'y' },
    });

    renderWithIntl(<AccuracyStat variant="trust-row" />);
    await waitFor(() =>
      expect(screen.getByText('Kuinka tarkkoja arviot ovat?')).toBeDefined(),
    );
    expect(
      screen.getByText('Ei vielä käyttäjien raportoimia lopputuloksia.'),
    ).toBeDefined();
  });
});
