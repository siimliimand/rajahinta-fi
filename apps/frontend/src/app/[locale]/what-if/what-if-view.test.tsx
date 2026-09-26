/**
 * What-if view form pass — view-level behaviour (price-intelligence-roadmap
 * task 4.7).
 *
 * Pins the form-pass guardrails at the view level:
 *   1. Units render beside the numeric fields (ABV, volume, prices).
 *   2. The numeric fields carry inputMode for decimal keyboards.
 *   3. A started-but-invalid field shows a SPECIFIC inline validation
 *      message — which field, what range/format — not a generic "invalid".
 *   4. The reset affordance restores the draft to its defaults (default
 *      rate, one empty row).
 *
 * The scenarios here keep the draft invalid on purpose, so no API
 * request ever fires and no debounce bookkeeping is asserted.
 *
 * @module WhatIfViewFormPassTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WhatIfView from './what-if-view';
import { renderWithIntl } from '@/lib/testing/test-intl';

// Fake timers keep the debounced recalculation deterministic: the
// pending timers are discarded at the end of each test instead of
// leaking into the next one.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WhatIfView form pass (task 4.7)', () => {
  it('renders the units beside the numeric fields', () => {
    renderWithIntl(<WhatIfView />);

    expect(screen.getByLabelText('Alkoholipitoisuus (%)')).toBeInTheDocument();
    expect(screen.getByLabelText('Määrä (litraa)')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Kotimainen vertailuhinta (€)'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Tuonnin vähittäishinta (€)'),
    ).toBeInTheDocument();
  });

  it('carries inputMode on the numeric fields for decimal keyboards', () => {
    renderWithIntl(<WhatIfView />);

    expect(
      (
        screen.getByLabelText('Alkoholipitoisuus (%)') as HTMLInputElement
      ).inputMode,
    ).toBe('decimal');
    expect(
      (screen.getByLabelText('Määrä (litraa)') as HTMLInputElement).inputMode,
    ).toBe('decimal');
    expect(
      (
        screen.getByLabelText('Tuonnin vähittäishinta (€)') as HTMLInputElement
      ).inputMode,
    ).toBe('decimal');
  });

  it('shows a specific inline validation message for a bad ABV value', () => {
    renderWithIntl(<WhatIfView />);

    // 150 % is outside the field's window — the message must name the
    // field and its range, not just say "invalid".
    fireEvent.change(screen.getByLabelText('Alkoholipitoisuus (%)'), {
      target: { value: '150' },
    });

    const abv = screen.getByLabelText(
      'Alkoholipitoisuus (%)',
    ) as HTMLInputElement;
    expect(abv.getAttribute('aria-invalid')).toBe('true');
    expect(abv.getAttribute('aria-describedby')).toBe(
      'what-if-abv-product-1-error',
    );
    expect(
      screen.getByText('Alkoholipitoisuuden on oltava luku välillä 0–100 (%).'),
    ).toBeInTheDocument();
  });

  it('shows the price format message for a malformed price value', () => {
    renderWithIntl(<WhatIfView />);

    fireEvent.change(screen.getByLabelText('Kotimainen vertailuhinta (€)'), {
      target: { value: '12,345' },
    });

    expect(
      screen.getByText(
        'Hinnan on oltava summa välillä 0–100 000 € ja enintään kahdella desimaalilla.',
      ),
    ).toBeInTheDocument();
  });

  it('the reset affordance restores the draft to its defaults', () => {
    renderWithIntl(<WhatIfView />);

    // Drive the draft away from its defaults.
    fireEvent.change(screen.getByTestId('what-if-rate-slider'), {
      target: { value: '500' },
    });
    fireEvent.change(screen.getByLabelText('Alkoholipitoisuus (%)'), {
      target: { value: '150' },
    });
    fireEvent.change(screen.getByLabelText('Määrä (litraa)'), {
      target: { value: '5' },
    });
    expect(screen.getByTestId('what-if-rate-value')).toHaveTextContent('500 €');

    fireEvent.click(screen.getByTestId('what-if-reset'));

    // Defaults: the slider's default rate and one empty product row.
    expect(screen.getByTestId('what-if-rate-value')).toHaveTextContent('20 €');
    expect(
      (screen.getByLabelText('Alkoholipitoisuus (%)') as HTMLInputElement)
        .value,
    ).toBe('');
    expect(
      (screen.getByLabelText('Määrä (litraa)') as HTMLInputElement).value,
    ).toBe('');
    // The validation message for the old draft is gone with it.
    expect(
      screen.queryByText(
        'Alkoholipitoisuuden on oltava luku välillä 0–100 (%).',
      ),
    ).toBeNull();
  });
});
