/**
 * Trip route presets — view-level behaviour (price-intelligence-roadmap
 * task 4.3).
 *
 * Pins the preset guardrails at the view level:
 *   1. Applying a preset fills the expected editable inputs (passengers,
 *      vehicle, ticket, fuel) and labels the examples clearly.
 *   2. The prefilled fields stay editable: changing an input afterwards
 *      changes the submitted estimate — the request body carries the
 *      edited value, so the estimate always derives from the current
 *      editable inputs, never from the preset alone.
 *   3. Re-applying a preset re-fills fields the visitor edited since.
 *
 * @module TripPresetsTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TripView from './trip-view';
import { TRIP_ROUTE_PRESETS } from './presets';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { request } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
    // TripFillForm imports searchProducts directly; stubbed like the
    // page test so the module graph stays intact.
    searchProducts: vi.fn(),
  };
});

const mockedRequest = vi.mocked(request);

const CAR_PRESET = TRIP_ROUTE_PRESETS[0]!;

/** Type a fully priced beer row so the form validates for submission. */
async function priceBeerRow(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
): Promise<void> {
  const scope = within(container);
  await user.type(scope.getByLabelText('Olut — Suomi (€/l)'), '5,00');
  await user.type(
    container.querySelector('#trip-price-foreign-beer') as HTMLElement,
    '2,50',
  );
}

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('TripView route presets (task 4.3)', () => {
  it('labels the presets as clearly-marked editable examples', () => {
    const { container } = renderWithIntl(<TripView />);
    const scope = within(container);

    expect(scope.getByTestId('trip-presets')).toHaveTextContent('Valmiit reitit');
    expect(scope.getByTestId('trip-presets')).toHaveTextContent(
      'kaikkia kenttiä voi muokata vapaasti',
    );
    for (const preset of TRIP_ROUTE_PRESETS) {
      expect(
        scope.getByTestId(`trip-preset-${preset.id}`),
      ).toBeInTheDocument();
    }
  });

  it('applying a preset fills the expected editable inputs', async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(<TripView />);
    const scope = within(container);

    await user.click(scope.getByTestId(`trip-preset-${CAR_PRESET.id}`));

    const prefill = CAR_PRESET.prefill;
    expect(
      (scope.getByLabelText('Matkustajat (kpl)') as HTMLInputElement).value,
    ).toBe(prefill.passengers);
    expect(
      (scope.getByLabelText('Matkaliput yhteensä (€)') as HTMLInputElement)
        .value,
    ).toBe(prefill.ticketEur);
    expect(
      (scope.getByLabelText('Polttoaine yhteensä (€)') as HTMLInputElement)
        .value,
    ).toBe(prefill.fuelEur);
    expect(
      (container.querySelector('#trip-vehicle') as HTMLSelectElement).value,
    ).toBe(prefill.vehicleType);
  });

  it('keeps the prefilled inputs editable: the estimate derives from the edited values', async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(<TripView />);
    const scope = within(container);

    await user.click(scope.getByTestId(`trip-preset-${CAR_PRESET.id}`));

    // The preset must not lock anything: edit the prefilled fuel cost.
    const fuel = scope.getByLabelText('Polttoaine yhteensä (€)');
    await user.clear(fuel);
    await user.type(fuel, '40,00');

    await priceBeerRow(user, container);
    await user.click(
      scope.getByRole('button', { name: 'Laske kannattava tuontimäärä' }),
    );

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    const body = JSON.parse(
      (mockedRequest.mock.calls[0]![1] as { body: string }).body,
    ) as { fuelCostCents: number; ticketCostCents: number; passengers: number; vehicleType: string };
    // The edited fuel value drives the estimate…
    expect(body.fuelCostCents).toBe(4000);
    // …while untouched preset values pass through unchanged.
    expect(body.ticketCostCents).toBe(12000);
    expect(body.passengers).toBe(2);
    expect(body.vehicleType).toBe(CAR_PRESET.prefill.vehicleType);
  });

  it('re-applying a preset re-fills fields edited since the last application', async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(<TripView />);
    const scope = within(container);

    await user.click(scope.getByTestId(`trip-preset-${CAR_PRESET.id}`));
    const ticket = scope.getByLabelText('Matkaliput yhteensä (€)');
    await user.clear(ticket);
    await user.type(ticket, '99,00');
    expect(ticket).toHaveValue('99,00');

    // Same preset again — the chip must refill, not no-op.
    await user.click(scope.getByTestId(`trip-preset-${CAR_PRESET.id}`));
    expect(
      (scope.getByLabelText('Matkaliput yhteensä (€)') as HTMLInputElement)
        .value,
    ).toBe(CAR_PRESET.prefill.ticketEur);
  });
});
