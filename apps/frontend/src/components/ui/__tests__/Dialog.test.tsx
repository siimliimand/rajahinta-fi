/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '../Dialog';

// Focus-management assertions ported from the AgeGate suite, which is the
// reference implementation this primitive extracts.

function queryOverlay(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-dialog-overlay]');
}

/** Dispatch a keydown from a DOM node (default: the current
    activeElement; jsdom has no default tab navigation, so the trap's
    wrap is what moves focus). */
function pressKey(
  key: string,
  shift = false,
  from?: Element,
): void {
  (from ?? document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Dialog open={false} onClose={() => {}}>
        <p>body</p>
      </Dialog>,
    );

    expect(container).toBeEmptyDOMElement();
    expect(queryOverlay()).toBeNull();
  });

  it('renders a fixed overlay with role="dialog" and aria-modal="true" when open', () => {
    render(
      <Dialog open onClose={() => {}} labelledBy="d-title">
        <h2 id="d-title">Title</h2>
        <p>body</p>
      </Dialog>,
    );

    const overlay = queryOverlay();
    expect(overlay).not.toBeNull();
    expect(overlay?.className).toContain('fixed');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'd-title');
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('names the dialog via aria-label when there is no visible heading', () => {
    render(
      <Dialog open onClose={() => {}} aria-label="Confirm">
        <p>body</p>
      </Dialog>,
    );

    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeTruthy();
  });

  it('moves focus into the dialog when it opens', () => {
    render(
      <Dialog open onClose={() => {}}>
        <button>first</button>
        <button>last</button>
      </Dialog>,
    );

    expect(document.activeElement).toBe(screen.getByText('first'));
  });

  it('traps Tab focus inside the dialog while it is open', () => {
    render(
      <Dialog open onClose={() => {}}>
        <button>first</button>
        <button>last</button>
      </Dialog>,
    );
    const first = screen.getByText('first');
    const last = screen.getByText('last');
    expect(document.activeElement).toBe(first);

    // Tab on the last control wraps to the first.
    last.focus();
    pressKey('Tab');
    expect(document.activeElement).toBe(first);

    // Shift+Tab on the first control wraps to the last.
    pressKey('Tab', true);
    expect(document.activeElement).toBe(last);
  });

  it('pulls escaped focus back into the dialog', () => {
    render(
      <>
        <button>outside</button>
        <Dialog open onClose={() => {}}>
          <button>first</button>
          <button>last</button>
        </Dialog>
      </>,
    );

    // Focus escaped the dialog (e.g. moved programmatically); the next
    // Tab — even from a node inside the overlay — pulls it back in.
    screen.getByText('outside').focus();
    pressKey('Tab', false, screen.getByRole('dialog'));

    expect(document.activeElement).toBe(screen.getByText('first'));
  });

  it('returns focus to the triggering element after close', () => {
    const triggerTree = (open: boolean) => (
      <>
        <button>trigger</button>
        <Dialog open={open} onClose={() => {}}>
          <button>first</button>
        </Dialog>
      </>
    );
    const { rerender } = render(triggerTree(false));
    const trigger = screen.getByText('trigger');
    trigger.focus();

    // Opening hands focus to the dialog; closing hands it back.
    rerender(triggerTree(true));
    expect(document.activeElement).toBe(screen.getByText('first'));

    rerender(triggerTree(false));

    expect(queryOverlay()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose}>
        <button>first</button>
      </Dialog>,
    );

    pressKey('Escape');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a backdrop click but not on clicks inside the panel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose}>
        <button>inside</button>
      </Dialog>,
    );

    // A click that starts on a panel control bubbles to the overlay —
    // only a click on the backdrop itself may dismiss.
    await user.click(screen.getByText('inside'));
    expect(onClose).not.toHaveBeenCalled();

    queryOverlay()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
