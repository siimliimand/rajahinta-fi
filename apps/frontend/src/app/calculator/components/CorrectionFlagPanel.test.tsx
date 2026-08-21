/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import CorrectionFlagPanel from './CorrectionFlagPanel';

// ---------------------------------------------------------------------------
// Mock the API module
// ---------------------------------------------------------------------------

vi.mock('@/lib/api', () => ({
  createCorrectionFlag: vi.fn(),
}));

import { createCorrectionFlag } from '@/lib/api';

const mockCreate = createCorrectionFlag as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROPS = {
  recordId: 42,
  productName: 'Test Beer 5% 0.5L',
};

describe('CorrectionFlagPanel', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  // ── Collapsed state ──
  it('renders the trigger link in collapsed state', () => {
    render(<CorrectionFlagPanel {...PROPS} />);

    expect(
      screen.getByText('Ilmoita virheestä / Flag a problem'),
    ).toBeInTheDocument();
  });

  it('does not show the form when collapsed', () => {
    render(<CorrectionFlagPanel {...PROPS} />);

    expect(
      screen.queryByText('Describe the issue'),
    ).not.toBeInTheDocument();
  });

  // ── Open state ──
  it('opens the form when the trigger link is clicked', async () => {
    const user = userEvent.setup();
    render(<CorrectionFlagPanel {...PROPS} />);

    await user.click(
      screen.getByText('Ilmoita virheestä / Flag a problem'),
    );

    expect(screen.getByText('Ilmoita virheestä / Flag a problem')).toBeInTheDocument();
    expect(screen.getByText('Describe the issue')).toBeInTheDocument();
  });

  it('shows the calculation context read-only', async () => {
    const user = userEvent.setup();
    render(<CorrectionFlagPanel {...PROPS} />);

    await user.click(
      screen.getByText('Ilmoita virheestä / Flag a problem'),
    );

    expect(screen.getByText(/Calculation/)).toBeInTheDocument();
    expect(screen.getByText(/#42/)).toBeInTheDocument();
    expect(screen.getByText(/Test Beer 5% 0\.5L/)).toBeInTheDocument();
  });

  it('has a disabled Submit button when reason is empty', async () => {
    const user = userEvent.setup();
    render(<CorrectionFlagPanel {...PROPS} />);

    await user.click(
      screen.getByText('Ilmoita virheestä / Flag a problem'),
    );

    expect(screen.getByText('Submit')).toBeDisabled();
  });

  it('enables Submit when reason is filled', async () => {
    const user = userEvent.setup();
    render(<CorrectionFlagPanel {...PROPS} />);

    await user.click(
      screen.getByText('Ilmoita virheestä / Flag a problem'),
    );

    const textarea = screen.getByPlaceholderText(
      /E\.g\. the alcohol tax rate/,
    );
    await user.type(textarea, 'Tax rate looks wrong for this ABV');

    expect(screen.getByText('Submit')).not.toBeDisabled();
  });

  it('closes the form when Cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<CorrectionFlagPanel {...PROPS} />);

    await user.click(
      screen.getByText('Ilmoita virheestä / Flag a problem'),
    );

    await user.click(screen.getByText('Cancel'));

    expect(
      screen.queryByText('Describe the issue'),
    ).not.toBeInTheDocument();
  });

  // ── Submit ──
  it('POSTs the correct payload on submit', async () => {
    mockCreate.mockResolvedValue({
      id: 1,
      targetType: 'calculation',
      targetId: 42,
      reason: 'Tax rate looks wrong',
      status: 'open',
      createdAt: '2026-01-01T00:00:00Z',
      resolvedAt: null,
      resolution: null,
    });

    const user = userEvent.setup();
    render(<CorrectionFlagPanel {...PROPS} />);

    await user.click(
      screen.getByText('Ilmoita virheestä / Flag a problem'),
    );

    const textarea = screen.getByPlaceholderText(
      /E\.g\. the alcohol tax rate/,
    );
    await user.type(textarea, 'Tax rate looks wrong');
    await user.click(screen.getByText('Submit'));

    expect(mockCreate).toHaveBeenCalledWith('calculation', 42, 'Tax rate looks wrong');
  });

  it('shows success state after successful submission', async () => {
    mockCreate.mockResolvedValue({
      id: 1,
      targetType: 'calculation',
      targetId: 42,
      reason: 'Tax rate looks wrong',
      status: 'open',
      createdAt: '2026-01-01T00:00:00Z',
      resolvedAt: null,
      resolution: null,
    });

    const user = userEvent.setup();
    render(<CorrectionFlagPanel {...PROPS} />);

    await user.click(
      screen.getByText('Ilmoita virheestä / Flag a problem'),
    );

    const textarea = screen.getByPlaceholderText(
      /E\.g\. the alcohol tax rate/,
    );
    await user.type(textarea, 'Tax rate looks wrong');
    await user.click(screen.getByText('Submit'));

    await waitFor(() => {
      expect(
        screen.getByText('Kiitos palautteestasi / Thank you for your feedback'),
      ).toBeInTheDocument();
    });
  });

  it('shows error state with retry when submission fails', async () => {
    mockCreate.mockRejectedValue(new Error('Network failure'));

    const user = userEvent.setup();
    render(<CorrectionFlagPanel {...PROPS} />);

    await user.click(
      screen.getByText('Ilmoita virheestä / Flag a problem'),
    );

    const textarea = screen.getByPlaceholderText(
      /E\.g\. the alcohol tax rate/,
    );
    await user.type(textarea, 'Tax rate looks wrong');
    await user.click(screen.getByText('Submit'));

    await waitFor(() => {
      expect(screen.getByText('Virhe / Error')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });

  // ── Cancel from error state ──
  it('returns to collapsed state after dismiss from success', async () => {
    mockCreate.mockResolvedValue({
      id: 1,
      targetType: 'calculation',
      targetId: 42,
      reason: 'Test',
      status: 'open',
      createdAt: '2026-01-01T00:00:00Z',
      resolvedAt: null,
      resolution: null,
    });

    const user = userEvent.setup();
    render(<CorrectionFlagPanel {...PROPS} />);

    await user.click(
      screen.getByText('Ilmoita virheestä / Flag a problem'),
    );

    await user.type(
      screen.getByPlaceholderText(/E\.g\. the alcohol tax rate/),
      'Test',
    );
    await user.click(screen.getByText('Submit'));

    await waitFor(() => {
      expect(
        screen.getByText('Kiitos palautteestasi / Thank you for your feedback'),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByText('Dismiss'));

    // Should show the trigger link again
    expect(
      screen.getByText('Ilmoita virheestä / Flag a problem'),
    ).toBeInTheDocument();
  });
});