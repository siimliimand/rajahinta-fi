/**
 * ScenarioControls tests (task 4.1).
 *
 * Verifies the flag-gated contract:
 *   1. Flag off in the inlined payload → the section renders nothing on
 *      the FIRST render and NEVER fires the scenario list request.
 *   2. Flag on → the section is visible on the first render, loads the
 *      list, and renders the picker options.
 *   3. Saving → delegates to onSaveScenario, shows a saved status, and
 *      refreshes the list.
 *   4. Save failure → controlled error message.
 *   5. Picking a scenario → delegates to onLoadScenario with the row.
 *
 * @module ScenarioControlsTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ScenarioControls from './ScenarioControls';
import {
  ALL_FLAGS_OFF,
  ALL_FLAGS_ON,
  renderWithIntl,
} from '@/lib/testing/test-intl';
import { listScenarios } from '@/lib/api';
import type { SavedScenario } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    listScenarios: vi.fn(),
  };
});

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

beforeEach(() => {
  vi.clearAllMocks();
  mockedListScenarios.mockResolvedValue([scenarioRow()]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScenarioControls', () => {
  it('hides the section on the first render and never fetches scenarios when the flag is off', () => {
    const { container } = renderWithIntl(
      <ScenarioControls
        canSave
        onSaveScenario={vi.fn()}
        onLoadScenario={vi.fn()}
      />,
      { featureFlags: { ...ALL_FLAGS_OFF } },
    );

    // Synchronous first-render assertion: the inlined flag state hides the
    // section with no client-side fetch round-trip (task 9.4).
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('scenario-controls')).not.toBeInTheDocument();
    expect(mockedListScenarios).not.toHaveBeenCalled();
  });

  it('shows the section on the first render when the flag is on in the inlined payload', () => {
    // The list request never settles: visibility must not depend on it.
    mockedListScenarios.mockReturnValue(new Promise(() => {}));

    const { container } = renderWithIntl(
      <ScenarioControls
        canSave
        onSaveScenario={vi.fn()}
        onLoadScenario={vi.fn()}
      />,
      { featureFlags: ALL_FLAGS_ON },
    );

    // No flag round-trip to wait for — visibility matches the inlined
    // state immediately (task 9.4: no late gated-UI appearance).
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByTestId('scenario-controls')).toBeInTheDocument();
  });

  it('loads the scenario list and renders the picker when the flag is on', async () => {
    renderWithIntl(
      <ScenarioControls
        canSave
        onSaveScenario={vi.fn()}
        onLoadScenario={vi.fn()}
      />,
    );

    const picker = await screen.findByTestId('scenario-picker');
    // The list loads asynchronously after mount — waitFor, or the
    // sync assertion can observe the pre-fetch "No saved scenarios" render
    // under full-suite load (flaky otherwise).
    await waitFor(() => expect(picker).toHaveTextContent('Summer trip'));
    expect(mockedListScenarios).toHaveBeenCalledTimes(1);
  });

  it('delegates saving, shows a status, and refreshes the list', async () => {
    const user = userEvent.setup();
    const onSaveScenario = vi.fn().mockResolvedValue(undefined);
    renderWithIntl(
      <ScenarioControls
        canSave
        onSaveScenario={onSaveScenario}
        onLoadScenario={vi.fn()}
      />,
    );

    await screen.findByTestId('scenario-picker');

    await user.type(screen.getByLabelText('Skenaarion nimi'), 'Winter trip');
    await user.click(screen.getByTestId('scenario-save'));

    await waitFor(() =>
      expect(screen.getByTestId('scenario-status')).toHaveTextContent(
        'Skenaario "Winter trip" tallennettu.',
      ),
    );
    expect(onSaveScenario).toHaveBeenCalledWith('Winter trip');
    // The picker list was refreshed after the save.
    await waitFor(() => expect(mockedListScenarios).toHaveBeenCalledTimes(2));
  });

  it('shows a controlled error message when saving fails', async () => {
    const user = userEvent.setup();
    const onSaveScenario = vi.fn().mockRejectedValue(new Error('boom'));
    renderWithIntl(
      <ScenarioControls
        canSave
        onSaveScenario={onSaveScenario}
        onLoadScenario={vi.fn()}
      />,
    );

    await screen.findByTestId('scenario-picker');

    await user.type(screen.getByLabelText('Skenaarion nimi'), 'Failing');
    await user.click(screen.getByTestId('scenario-save'));

    expect(
      await screen.findByTestId('scenario-error'),
    ).toHaveTextContent('Skenaarion tallentaminen epäonnistui. Yritä uudelleen.');
  });

  it('delegates loading to onLoadScenario with the picked scenario', async () => {
    const user = userEvent.setup();
    const onLoadScenario = vi.fn();
    renderWithIntl(
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
    ).toHaveTextContent('Skenaario "Summer trip" ladattu');
  });
});
