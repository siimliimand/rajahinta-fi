/**
 * ScenarioControls tests (task 4.1).
 *
 * Verifies the flag-gated contract:
 *   1. Flag off → the section renders nothing and NEVER fires the
 *      scenario list request.
 *   2. Flag on → loads the list and renders the picker options.
 *   3. Saving → delegates to onSaveScenario, shows a saved status, and
 *      refreshes the list.
 *   4. Save failure → controlled error message.
 *   5. Picking a scenario → delegates to onLoadScenario with the row.
 *
 * @module ScenarioControlsTest
 */
// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ScenarioControls from './ScenarioControls';
import { getFeatureFlags, listScenarios } from '@/lib/api';
import type { SavedScenario } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    getFeatureFlags: vi.fn(),
    listScenarios: vi.fn(),
  };
});

const mockedGetFeatureFlags = vi.mocked(getFeatureFlags);
const mockedListScenarios = vi.mocked(listScenarios);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function scenarioRow(overrides: Partial<SavedScenario> = {}): SavedScenario {
  return {
    id: 7,
    name: 'Summer trip',
    inputs: { productId: 42, quantity: 6, destination: 'FI' },
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    ...overrides,
  };
}

const FLAG_ON = {
  flags: {
    HISTORICAL_PRICE_INTELLIGENCE: false,
    BASKET_OPTIMIZATION: false,
    ADVANCED_FEATURES: true,
  },
};

const FLAG_OFF = {
  flags: {
    HISTORICAL_PRICE_INTELLIGENCE: false,
    BASKET_OPTIMIZATION: false,
    ADVANCED_FEATURES: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetFeatureFlags.mockResolvedValue(FLAG_ON);
  mockedListScenarios.mockResolvedValue([scenarioRow()]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScenarioControls', () => {
  it('hides the section and never fetches scenarios when the flag is off', async () => {
    mockedGetFeatureFlags.mockResolvedValue(FLAG_OFF);

    const { container } = render(
      <ScenarioControls
        canSave
        onSaveScenario={vi.fn()}
        onLoadScenario={vi.fn()}
      />,
    );

    await waitFor(() => expect(mockedGetFeatureFlags).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.firstChild).toBeNull());

    expect(mockedListScenarios).not.toHaveBeenCalled();
    expect(screen.queryByTestId('scenario-controls')).not.toBeInTheDocument();
  });

  it('treats an unreachable flag endpoint as disabled (no list fetch)', async () => {
    mockedGetFeatureFlags.mockRejectedValue(new Error('network down'));

    const { container } = render(
      <ScenarioControls
        canSave
        onSaveScenario={vi.fn()}
        onLoadScenario={vi.fn()}
      />,
    );

    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(mockedListScenarios).not.toHaveBeenCalled();
  });

  it('loads the scenario list and renders the picker when the flag is on', async () => {
    render(
      <ScenarioControls
        canSave
        onSaveScenario={vi.fn()}
        onLoadScenario={vi.fn()}
      />,
    );

    const picker = await screen.findByTestId('scenario-picker');
    // The list loads asynchronously after the flag flips — waitFor, or the
    // sync assertion can observe the pre-fetch "No saved scenarios" render
    // under full-suite load (flaky otherwise).
    await waitFor(() => expect(picker).toHaveTextContent('Summer trip'));
    expect(mockedListScenarios).toHaveBeenCalledTimes(1);
  });

  it('delegates saving, shows a status, and refreshes the list', async () => {
    const user = userEvent.setup();
    const onSaveScenario = vi.fn().mockResolvedValue(undefined);
    render(
      <ScenarioControls
        canSave
        onSaveScenario={onSaveScenario}
        onLoadScenario={vi.fn()}
      />,
    );

    await screen.findByTestId('scenario-picker');

    await user.type(screen.getByLabelText('Scenario name'), 'Winter trip');
    await user.click(screen.getByTestId('scenario-save'));

    await waitFor(() =>
      expect(screen.getByTestId('scenario-status')).toHaveTextContent(
        'Scenario "Winter trip" saved.',
      ),
    );
    expect(onSaveScenario).toHaveBeenCalledWith('Winter trip');
    // The picker list was refreshed after the save.
    await waitFor(() => expect(mockedListScenarios).toHaveBeenCalledTimes(2));
  });

  it('shows a controlled error message when saving fails', async () => {
    const user = userEvent.setup();
    const onSaveScenario = vi.fn().mockRejectedValue(new Error('boom'));
    render(
      <ScenarioControls
        canSave
        onSaveScenario={onSaveScenario}
        onLoadScenario={vi.fn()}
      />,
    );

    await screen.findByTestId('scenario-picker');

    await user.type(screen.getByLabelText('Scenario name'), 'Failing');
    await user.click(screen.getByTestId('scenario-save'));

    expect(
      await screen.findByTestId('scenario-error'),
    ).toHaveTextContent('Saving the scenario failed. Please try again.');
  });

  it('delegates loading to onLoadScenario with the picked scenario', async () => {
    const user = userEvent.setup();
    const onLoadScenario = vi.fn();
    render(
      <ScenarioControls
        canSave
        onSaveScenario={vi.fn()}
        onLoadScenario={onLoadScenario}
      />,
    );

    const picker = await screen.findByTestId('scenario-picker');
    await user.selectOptions(picker, '7');

    expect(onLoadScenario).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, name: 'Summer trip' }),
    );
    // The picker resets to the placeholder so the same scenario can be
    // re-picked.
    expect(
      (picker as HTMLSelectElement).value === '' ||
        screen.getByTestId('scenario-picker'),
    ).toBe(true);
    expect(
      await screen.findByTestId('scenario-status'),
    ).toHaveTextContent('Scenario "Summer trip" loaded');
  });
});
