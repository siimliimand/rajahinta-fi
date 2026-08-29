// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { Button } from './Button';

/**
 * ErrorState primitive (OpenSpec: design-system-foundation, task 5.1).
 *
 * Designed error state: explain what happened and what to do, no drama.
 * Severity is carried by the `error` token group only — red is reserved
 * for errors and destructive affordances (D1), so this component never
 * reaches for the status ladder (UNAVAILABLE is gray, not red).
 *
 * Accessibility: the root is `role="alert"` — errors appear asynchronously
 * (a failed calculation, a 429) and must be announced assertively. The
 * exclamation icon is aria-hidden decoration that keeps the state legible
 * in grayscale; the text carries the meaning. `data-state="error"` is the
 * test hook (tasks 2.4/5.x).
 *
 * Retry: `onRetry` renders a secondary `Button` (white on the tinted panel
 * reads calmer than a red or primary fill) and requires `retryLabel` —
 * copy is never baked in. Anything else (e.g. the 429 `Retry-After` wait,
 * a link) goes through `children` in the same row; see task 5.3.
 */

// HTMLAttributes carries the native `title` tooltip (string); our visible
// `title` prop is a ReactNode heading, so it shadows the attribute.
interface ErrorStateBaseProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Primary line, e.g. localized "Calculation failed". */
  title: React.ReactNode;
  /** What happened and what to do next, in plain language. */
  description?: React.ReactNode;
}

/** `retryLabel` is required exactly when `onRetry` is provided. */
type ErrorStateRetryProps =
  | { onRetry: () => void; retryLabel: string }
  | { onRetry?: undefined; retryLabel?: undefined };

export type ErrorStateProps = ErrorStateBaseProps & ErrorStateRetryProps;

/** Circled exclamation mark — the shape must identify "error" without hue. */
function ErrorIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="h-5 w-5 shrink-0 text-error"
    >
      <circle cx="10" cy="10" r="7.75" />
      <path d="M10 6.2v4.3" />
      <path d="M10 13.4h.01" />
    </svg>
  );
}

export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel,
  className = '',
  children,
  ...rest
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      data-state="error"
      className={[
        'flex w-full gap-3 rounded-lg border border-error-border bg-error-bg px-4 py-4',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      <ErrorIcon />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-error-fg">{title}</p>
        {description ? (
          <p className="mt-1 text-sm leading-relaxed text-gray-700">{description}</p>
        ) : null}
        {onRetry || children ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {onRetry ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                {retryLabel}
              </Button>
            ) : null}
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
