/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach } from 'vitest';
import { AgeGate } from './AgeGate';
import { renderWithIntl } from '@/lib/testing/test-intl';

const STORAGE_KEY = 'age_confirmed';

describe('AgeGate', () => {
  beforeEach(() => {
    localStorage.clear();
    // Clear any cookies set by previous tests
    document.cookie = `${STORAGE_KEY}=; max-age=0`;
  });

  it('sets localStorage key "age_confirmed" to "true" on confirm', async () => {
    const user = userEvent.setup();
    renderWithIntl(<AgeGate><div>content</div></AgeGate>);

    await user.click(screen.getByText('Olen 18 vuotta täyttänyt'));

    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('sets cookie "age_confirmed" on confirm', async () => {
    const user = userEvent.setup();
    renderWithIntl(<AgeGate><div>content</div></AgeGate>);

    await user.click(screen.getByText('Olen 18 vuotta täyttänyt'));

    expect(document.cookie).toContain(`${STORAGE_KEY}=true`);
  });

  it('uses the same key "age_confirmed" for both localStorage and cookie', async () => {
    // This validates the design invariant from DESIGN.md:
    // "One canonical storage key so the UI gate and the API token cannot diverge."
    const user = userEvent.setup();
    renderWithIntl(<AgeGate><div>content</div></AgeGate>);

    await user.click(screen.getByText('Olen 18 vuotta täyttänyt'));

    // Both storage mechanisms must use the identical key
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    expect(document.cookie).toContain(`${STORAGE_KEY}=true`);
  });
});
