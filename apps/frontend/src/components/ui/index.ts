/**
 * UI primitives (OpenSpec: design-system-foundation, task 2.1).
 *
 * Plain, hook-free React components over Tailwind utilities — usable from
 * both server and client components (D5). No component framework
 * dependency; see the change's design.md.
 */

export { Button } from './Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button';

export { Badge, ConfidenceBadge, ReliabilityBadge } from './Badge';
export type {
  BadgeProps,
  BadgeSize,
  BadgeTone,
  ConfidenceBadgeProps,
  ReliabilityBadgeProps,
} from './Badge';

export { Card } from './Card';
export type { CardElement, CardPadding, CardProps, CardShadow } from './Card';

export { Input } from './Input';
export type { InputProps } from './Input';
