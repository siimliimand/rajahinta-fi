'use client';

/**
 * Trailing debounce hook (task 5.2).
 *
 * Rapid keystrokes reschedule one shared timer, so the callback fires
 * exactly once for the settled input after `delayMs` of quiet — instead
 * of queuing one request per keystroke. Callers keep an immediate path
 * (the raw callback) for explicit submits, and `cancel` drops a pending
 * invocation entirely.
 *
 * @module useDebouncedCallback
 */

import { useCallback, useEffect, useRef } from 'react';

export interface DebouncedCallback<A extends unknown[]> {
  /** Schedule the callback for the settled arguments, resetting the timer. */
  readonly run: (...args: A) => void;
  /** Drop the pending invocation, if any. */
  readonly cancel: () => void;
}

export function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void,
  delayMs: number,
): DebouncedCallback<A> {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the latest callback without making `run` identity unstable.
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const run = useCallback(
    (...args: A) => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        callbackRef.current(...args);
      }, delayMs);
    },
    [delayMs],
  );

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // A late callback must not fire after the caller unmounted.
  useEffect(() => cancel, [cancel]);

  return { run, cancel };
}
