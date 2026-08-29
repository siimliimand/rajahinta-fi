// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { InputHTMLAttributes } from 'react';

/**
 * Input primitive (OpenSpec: design-system-foundation, D5).
 *
 * Label-friendly text input extracted from the de-facto form control string
 * (ProductSearch, ScenarioControls, BasketBuilder). The error state uses the
 * error red token group, which is reserved for errors (D1) — never for
 * UNAVAILABLE or other statuses.
 *
 * Labels must reference the control, so `label` requires `id`. The union
 * below makes omitting the id a compile error when a label is given.
 */

interface InputExtras {
  /** Visible, associated label. Requires `id`. */
  label?: React.ReactNode;
  /** Secondary explanation text, announced via aria-describedby. */
  hint?: string;
  /** Error message; its presence switches the control into the error state. */
  error?: string;
}

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> &
  InputExtras &
  ({ id: string; label?: React.ReactNode } | { id?: string; label?: undefined });

const BASE_CLASSES = [
  'block w-full rounded-md border bg-white px-3 py-2 text-sm text-gray-700 shadow-sm',
  'placeholder:text-gray-400 focus:outline-none focus:ring-1',
  'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400',
].join(' ');

const STATE_CLASSES = {
  normal: 'border-gray-300 focus:border-primary-500 focus:ring-primary-500',
  error: 'border-error focus:border-error focus:ring-error',
} as const;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { id, label, hint, error, className = '', ...rest },
  ref,
) {
  const state = error ? STATE_CLASSES.error : STATE_CLASSES.normal;

  const describedBy = [
    hint && id ? `${id}-hint` : null,
    error && id ? `${id}-error` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="block">
      {label ? (
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy || undefined}
        className={`${BASE_CLASSES} ${state} ${className}`.trim()}
        {...rest}
      />
      {hint ? (
        <p id={id ? `${id}-hint` : undefined} className="mt-1 text-xs text-gray-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={id ? `${id}-error` : undefined}
          className="mt-1 text-xs font-medium text-error"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
});
