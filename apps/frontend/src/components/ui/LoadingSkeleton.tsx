import type { HTMLAttributes } from 'react';

/**
 * LoadingSkeleton primitive (OpenSpec: design-system-foundation, task 5.1).
 *
 * Reusable placeholder blocks for in-flight content, pulsing via the stock
 * Tailwind `animate-pulse` (element opacity — safe on the var-based token
 * colors, unlike color-alpha modifiers). Blocks use solid `bg-gray-200`
 * from the neutral ramp; no error/status hues are involved.
 *
 * Decorative by design: the root is `aria-hidden="true"`. The consuming
 * view owns the announcement — it must render its own live region (e.g.
 * a `role="status"` "calculating…" label) while the skeleton is shown.
 * Task 5.3 wires this contract into the real flows.
 *
 * Variants:
 *   text — `count` full-width lines (the last one shorter when count > 1)
 *   box  — `count` rectangular blocks for media/chart areas
 *   card — a composed card-like placeholder (title line, content box,
 *          two text lines) inside a Card-shaped surface, `count` times
 *
 * `data-variant` is the test hook (tasks 2.4/5.x); `className` sizes and
 * spaces the root (width, margins, grid placement) without touching the
 * inner rhythm.
 */

export type SkeletonVariant = 'text' | 'box' | 'card';

export interface LoadingSkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Block composition; defaults to plain text lines. */
  variant?: SkeletonVariant;
  /** How many blocks to render; defaults to 1, clamped to >= 1. */
  count?: number;
}

const LINE_CLASSES = 'h-4 w-full animate-pulse rounded-sm bg-gray-200';
const BOX_CLASSES = 'h-24 w-full animate-pulse rounded-md bg-gray-200';

function TextLines({ count }: { count: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className={count > 1 && index === count - 1 ? `${LINE_CLASSES} w-5/6` : LINE_CLASSES}
        />
      ))}
    </div>
  );
}

function Boxes({ count }: { count: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={BOX_CLASSES} />
      ))}
    </div>
  );
}

function CardBlock() {
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="h-4 w-1/2 animate-pulse rounded-sm bg-gray-200" />
      <div className="h-20 w-full animate-pulse rounded-md bg-gray-200" />
      <div className="h-3 w-full animate-pulse rounded-sm bg-gray-200" />
      <div className="h-3 w-2/3 animate-pulse rounded-sm bg-gray-200" />
    </div>
  );
}

function Cards({ count }: { count: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }, (_, index) => (
        <CardBlock key={index} />
      ))}
    </div>
  );
}

export function LoadingSkeleton({
  variant = 'text',
  count = 1,
  className = '',
  ...rest
}: LoadingSkeletonProps) {
  const blocks = Math.max(1, count);
  return (
    <div
      aria-hidden="true"
      data-variant={variant}
      className={['w-full', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {variant === 'text' ? <TextLines count={blocks} /> : null}
      {variant === 'box' ? <Boxes count={blocks} /> : null}
      {variant === 'card' ? <Cards count={blocks} /> : null}
    </div>
  );
}
