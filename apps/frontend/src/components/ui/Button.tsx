import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

/**
 * Button primitive (OpenSpec: design-system-foundation, D5).
 *
 * Hand-rolled: plain React + Tailwind classes extracted from the de-facto
 * button strings that existed across the app before this primitive. No
 * shadcn/ui, no class-variance-authority.
 *
 * Focus: the global `:focus-visible` floor in globals.css applies, but
 * component utilities win — this carries its own visible ring for keyboard
 * users only (`focus-visible:`, not `focus:`), matching the floor's intent.
 *
 * Destructive uses the `error` token group: per D1, red is reserved for
 * errors and destructive affordances, so a red button always means "this
 * action is dangerous", never a status.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to fill the parent (basket/calculator submit rows). */
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-primary-600 text-white hover:bg-primary-700 focus-visible:ring-primary-500',
  secondary:
    'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus-visible:ring-primary-500',
  ghost: 'text-gray-700 hover:bg-gray-100 focus-visible:ring-gray-400',
  destructive:
    'bg-error text-white hover:bg-error-fg focus-visible:ring-error',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'primary',
      size = 'md',
      fullWidth = false,
      // Default to type="button" so a Button inside a form never submits
      // unless the caller explicitly opts in with type="submit".
      type = 'button',
      className = '',
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        data-variant={variant}
        data-size={size}
        className={[
          'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          fullWidth ? 'w-full' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      />
    );
  },
);
