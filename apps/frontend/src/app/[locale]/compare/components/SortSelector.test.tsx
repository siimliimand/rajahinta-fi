/**
 * @vitest-environment jsdom
 */
/**
 * SortSelector — flag gating of the €/g sort option.
 *
 * enable_unit_price_eur_per_gram on → the €/g option is offered with
 * equal visual weight; off → the option is not rendered at all
 * (ranking-sorting spec: flag off removes the option from the UI).
 *
 * @module SortSelectorTest
 */
import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SortSelector from './SortSelector';
import {
  ALL_FLAGS_OFF,
  ALL_FLAGS_ON,
  renderWithIntl,
} from '@/lib/testing/test-intl';

function optionLabels(): string[] {
  return screen
    .getAllByRole('option')
    .map((option) => option.textContent);
}

describe('SortSelector', () => {
  it('offers every neutral order plus €/g when the unit-price flag is on', () => {
    renderWithIntl(
      <SortSelector value="LOWEST_LANDED_COST" onChange={() => undefined} />,
      { featureFlags: ALL_FLAGS_ON },
    );

    const labels = optionLabels();
    expect(labels).toHaveLength(7);
    expect(labels).toContain('Etanoli-€/g (matalin ensin)');
  });

  it('removes the €/g option when the unit-price flag is off', () => {
    renderWithIntl(
      <SortSelector value="LOWEST_LANDED_COST" onChange={() => undefined} />,
      { featureFlags: ALL_FLAGS_OFF },
    );

    const labels = optionLabels();
    expect(labels).toHaveLength(6);
    expect(labels).not.toContain('Etanoli-€/g (matalin ensin)');
  });

  it('reports the selected order through onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithIntl(
      <SortSelector value="LOWEST_LANDED_COST" onChange={onChange} />,
      { featureFlags: ALL_FLAGS_ON },
    );

    await user.selectOptions(screen.getByRole('combobox'), 'EUR_PER_GRAM');
    expect(onChange).toHaveBeenCalledWith('EUR_PER_GRAM');
  });
});
