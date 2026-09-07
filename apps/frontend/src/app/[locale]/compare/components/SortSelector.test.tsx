/**
 * @vitest-environment jsdom
 */
/**
 * SortSelector — offering of the €/g sort option.
 *
 * Every neutral order plus the €/g option is offered with equal visual
 * weight.
 *
 * @module SortSelectorTest
 */
import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SortSelector from './SortSelector';
import { renderWithIntl } from '@/lib/testing/test-intl';

function optionLabels(): string[] {
  return screen
    .getAllByRole('option')
    .map((option) => option.textContent);
}

describe('SortSelector', () => {
  it('offers every neutral order plus €/g with equal weight', () => {
    renderWithIntl(
      <SortSelector value="LOWEST_LANDED_COST" onChange={() => undefined} />,
    );

    const labels = optionLabels();
    expect(labels).toHaveLength(7);
    expect(labels).toContain('Etanoli-€/g (matalin ensin)');
  });

  it('reports the selected order through onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithIntl(
      <SortSelector value="LOWEST_LANDED_COST" onChange={onChange} />,
    );

    await user.selectOptions(screen.getByRole('combobox'), 'EUR_PER_GRAM');
    expect(onChange).toHaveBeenCalledWith('EUR_PER_GRAM');
  });
});
