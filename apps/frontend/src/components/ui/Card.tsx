// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';

/**
 * Card primitive (OpenSpec: design-system-foundation, D5).
 *
 * Quiet surface extracted from the de-facto card string used across
 * result/compare/basket views: `rounded-lg border border-gray-200 bg-white
 * <padding> shadow-sm`. Radii and shadows come from the token layer in
 * globals.css (D4); deeper shadows are deliberately not part of the tone.
 */

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';
export type CardShadow = 'none' | 'sm' | 'md';
export type CardElement = 'div' | 'section' | 'article' | 'aside';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** none removes padding for cards that manage their own inner layout. */
  padding?: CardPadding;
  shadow?: CardShadow;
  /** Gray surface for meta/secondary panels (token gray ramp). */
  muted?: boolean;
  /** Semantic wrapper element; defaults to div. */
  as?: CardElement;
}

const PADDING_CLASSES: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

const SHADOW_CLASSES: Record<CardShadow, string> = {
  none: '',
  sm: 'shadow-sm',
  md: 'shadow-md',
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    padding = 'md',
    shadow = 'sm',
    muted = false,
    as = 'div',
    className = '',
    ...rest
  },
  ref,
) {
  // All allowed elements share the same props shape as div for our purposes;
  // the cast keeps the union from widening the ref type.
  const Tag = as as 'div';
  return (
    <Tag
      ref={ref}
      className={[
        'rounded-lg border border-gray-200',
        muted ? 'bg-gray-50' : 'bg-white',
        PADDING_CLASSES[padding],
        SHADOW_CLASSES[shadow],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
});
