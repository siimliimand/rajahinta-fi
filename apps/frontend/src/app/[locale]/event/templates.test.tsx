/**
 * Event occasion templates — view-level behaviour
 * (price-intelligence-roadmap task 4.3).
 *
 * Pins the template guardrails at the view level:
 *   1. Applying a template fills the expected editable inputs (guests,
 *      duration, event profile — the profile carries the drink mix via
 *      the published consumption norms).
 *   2. The prefilled fields stay editable: changing an input afterwards
 *      changes the submitted estimate — the request body carries the
 *      edited value, so the estimate always derives from the current
 *      editable inputs, never from the template alone.
 *
 * @module EventTemplatesTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EventView from './event-view';
import { EVENT_OCCASION_TEMPLATES } from './templates';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { request } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
  };
});

const mockedRequest = vi.mocked(request);

const WEDDING = EVENT_OCCASION_TEMPLATES.find((t) => t.id === 'wedding')!;

/** Today in the user's local calendar — what the view sends as eventDate. */
function expectedTodayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('EventView occasion templates (task 4.3)', () => {
  it('labels the templates as clearly-marked editable examples', () => {
    const { container } = renderWithIntl(<EventView />);
    const scope = within(container);

    expect(scope.getByTestId('event-templates')).toHaveTextContent(
      'Valmiit tilaisuudet',
    );
    expect(scope.getByTestId('event-templates')).toHaveTextContent(
      'jäävät vapaasti muokattaviksi',
    );
    for (const template of EVENT_OCCASION_TEMPLATES) {
      expect(
        scope.getByTestId(`event-template-${template.id}`),
      ).toBeInTheDocument();
    }
  });

  it('applying a template fills guests, duration, and the profile (drink mix)', async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(<EventView />);
    const scope = within(container);

    await user.click(scope.getByTestId(`event-template-${WEDDING.id}`));

    const prefill = WEDDING.prefill;
    expect(
      (scope.getByLabelText('Vieraiden määrä (kpl)') as HTMLInputElement).value,
    ).toBe(prefill.guests);
    expect(
      (scope.getByLabelText('Kesto (tuntia)') as HTMLInputElement).value,
    ).toBe(prefill.durationHours);
    expect(
      (container.querySelector('#event-profile') as HTMLSelectElement).value,
    ).toBe(prefill.eventProfile);
  });

  it('keeps the prefilled inputs editable: the estimate derives from the edited values', async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(<EventView />);
    const scope = within(container);

    await user.click(scope.getByTestId(`event-template-${WEDDING.id}`));

    // The template must not lock anything: edit the prefilled guest count.
    const guests = scope.getByLabelText('Vieraiden määrä (kpl)');
    await user.clear(guests);
    await user.type(guests, '80');

    await user.click(scope.getByRole('button', { name: 'Laske ostoslista' }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(mockedRequest.mock.calls[0]![0]).toBe('/api/v1/event-calc');
    const body = JSON.parse(
      (mockedRequest.mock.calls[0]![1] as { body: string }).body,
    ) as {
      guests: number;
      durationHours: number;
      eventProfile: string;
      eventDate: string;
    };
    // The edited guest count drives the estimate…
    expect(body.guests).toBe(80);
    // …while untouched template values pass through unchanged.
    expect(body.durationHours).toBe(8);
    expect(body.eventProfile).toBe(WEDDING.prefill.eventProfile);
    expect(body.eventDate).toBe(expectedTodayIso());
  });
});
