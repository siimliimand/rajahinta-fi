/**
 * Event view form pass — view-level behaviour (price-intelligence-roadmap
 * task 4.7).
 *
 * Pins the form-pass guardrails at the view level:
 *   1. Units render beside the numeric fields (guests, duration).
 *   2. The numeric fields carry inputMode for numeric keyboards.
 *   3. A started-but-invalid field shows a SPECIFIC inline validation
 *      message — which field, what range — not a generic "invalid".
 *   4. The reset affordance restores every input to its default,
 *      including after an occasion template has been applied.
 *
 * @module EventViewFormPassTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EventView from './event-view';
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

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('EventView form pass (task 4.7)', () => {
  it('renders the units beside the numeric fields', () => {
    const { container } = renderWithIntl(<EventView />);
    const scope = within(container);

    expect(scope.getByLabelText('Vieraiden määrä (kpl)')).toBeInTheDocument();
    expect(scope.getByLabelText('Kesto (tuntia)')).toBeInTheDocument();
  });

  it('carries inputMode on the numeric fields for numeric keyboards', () => {
    const { container } = renderWithIntl(<EventView />);

    expect(
      (container.querySelector('#event-guests') as HTMLInputElement)
        .inputMode,
    ).toBe('numeric');
    expect(
      (container.querySelector('#event-duration') as HTMLInputElement)
        .inputMode,
    ).toBe('numeric');
  });

  it('shows a specific inline validation message for a bad duration value', async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(<EventView />);
    const scope = within(container);

    // Duration 0 is below the form's window — the message must name the
    // field and its range, not just say "invalid". The field starts
    // filled with its default, so clear it before typing the bad value.
    const duration = scope.getByLabelText('Kesto (tuntia)');
    await user.clear(duration);
    await user.type(duration, '0');

    expect(
      scope.getByText('Keston on oltava kokonaisluku tunteja väliltä 1–72.'),
    ).toBeInTheDocument();
    expect(
      (
        scope.getByLabelText('Kesto (tuntia)') as HTMLInputElement
      ).getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('the reset affordance restores every input to its default, also after a template', async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(<EventView />);
    const scope = within(container);

    // The wedding template drives the fields away from their defaults.
    await user.click(scope.getByTestId('event-template-wedding'));
    expect(
      (scope.getByLabelText('Vieraiden määrä (kpl)') as HTMLInputElement)
        .value,
    ).toBe('60');
    expect(
      (scope.getByLabelText('Kesto (tuntia)') as HTMLInputElement).value,
    ).toBe('8');

    await user.click(scope.getByTestId('event-reset'));

    // Defaults: the form's own initial values — the template is gone.
    expect(
      (scope.getByLabelText('Vieraiden määrä (kpl)') as HTMLInputElement)
        .value,
    ).toBe('10');
    expect(
      (scope.getByLabelText('Kesto (tuntia)') as HTMLInputElement).value,
    ).toBe('4');
    expect(
      (
        container.querySelector('#event-profile') as HTMLSelectElement
      ).value,
    ).toBe('casual_gathering');
  });
});
