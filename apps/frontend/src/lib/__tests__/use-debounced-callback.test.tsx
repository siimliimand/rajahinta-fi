/**
 * useDebouncedCallback tests (task 5.2).
 *
 *   1. Rapid calls → exactly one invocation for the settled (last) args
 *      after the delay.
 *   2. Nothing fires before the quiet period has fully elapsed.
 *   3. cancel → the pending invocation never fires.
 *   4. A later burst after a fired debounce starts a fresh cycle.
 *   5. Unmount → the pending invocation never fires.
 *
 * @module UseDebouncedCallbackTest
 */
// @vitest-environment jsdom

import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedCallback } from '../use-debounced-callback';

const DELAY_MS = 300;

/**
 * Minimal harness: buttons that schedule debounced calls with fixed
 * payloads, plus a cancel button. Keep it dumb — the hook is the subject.
 */
function Harness({ onSettled }: { onSettled: (query: string) => void }) {
  const debounced = useDebouncedCallback(onSettled, DELAY_MS);
  return (
    <div>
      <button
        type="button"
        data-testid="type"
        onClick={() => debounced.run('ol')}
      />
      <button
        type="button"
        data-testid="type-more"
        onClick={() => debounced.run('olut')}
      />
      <button type="button" data-testid="cancel" onClick={debounced.cancel} />
    </div>
  );
}

describe('useDebouncedCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires exactly once with the settled arguments after rapid calls', () => {
    const onSettled = vi.fn();
    const { getByTestId } = render(<Harness onSettled={onSettled} />);

    act(() => {
      getByTestId('type').click();
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      getByTestId('type-more').click();
    });
    // One full quiet period after the LAST call.
    act(() => {
      vi.advanceTimersByTime(DELAY_MS);
    });

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith('olut');
  });

  it('does not fire before the quiet period has fully elapsed', () => {
    const onSettled = vi.fn();
    const { getByTestId } = render(<Harness onSettled={onSettled} />);

    act(() => {
      getByTestId('type').click();
    });
    act(() => {
      vi.advanceTimersByTime(DELAY_MS - 1);
    });

    expect(onSettled).not.toHaveBeenCalled();
  });

  it('cancel drops the pending invocation', () => {
    const onSettled = vi.fn();
    const { getByTestId } = render(<Harness onSettled={onSettled} />);

    act(() => {
      getByTestId('type').click();
    });
    act(() => {
      getByTestId('cancel').click();
    });
    act(() => {
      vi.advanceTimersByTime(DELAY_MS * 2);
    });

    expect(onSettled).not.toHaveBeenCalled();
  });

  it('starts a fresh cycle after a fired debounce', () => {
    const onSettled = vi.fn();
    const { getByTestId } = render(<Harness onSettled={onSettled} />);

    act(() => {
      getByTestId('type').click();
    });
    act(() => {
      vi.advanceTimersByTime(DELAY_MS);
    });
    expect(onSettled).toHaveBeenCalledTimes(1);

    act(() => {
      getByTestId('type-more').click();
    });
    act(() => {
      vi.advanceTimersByTime(DELAY_MS);
    });
    expect(onSettled).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenLastCalledWith('olut');
  });

  it('never fires the pending invocation after unmount', () => {
    const onSettled = vi.fn();
    const { getByTestId, unmount } = render(<Harness onSettled={onSettled} />);

    act(() => {
      getByTestId('type').click();
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(DELAY_MS * 2);
    });

    expect(onSettled).not.toHaveBeenCalled();
  });
});
