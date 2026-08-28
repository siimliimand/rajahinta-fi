import type { HTMLAttributes, ReactNode } from 'react';

/**
 * EmptyState primitive (OpenSpec: design-system-foundation, task 5.1).
 *
 * One of the designed non-happy states: calm and explanatory, not apologetic
 * — a tax tool explaining that there is nothing to show and what to do next.
 * All copy arrives via props from the message catalogs; nothing is baked in.
 *
 * Accessibility: the root is `role="status"` (a polite live region). Empty
 * states most often appear asynchronously — a search that returned nothing,
 * a basket that just emptied — and role="status" gets the new content
 * announced by screen readers without stealing focus. The visible
 * title/description are the announced content, so no separate accessible
 * name is needed. `data-state="empty"` is the test hook (tasks 2.4/5.x).
 *
 * Actions render via the `action` prop, `children`, or both; both land in
 * the same action row (e.g. a primary Button plus a ghost "clear filters"
 * link). The `icon` slot is decorative and rendered aria-hidden, so it must
 * never be the only carrier of meaning — size it via the passed element
 * (e.g. `className="h-10 w-10"` on an svg).
 */

// HTMLAttributes carries the native `title` tooltip (string); our visible
// `title` prop is a ReactNode heading, so it shadows the attribute.
export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Decorative icon/illustration slot; muted gray, hidden from AT. */
  icon?: ReactNode;
  /** Primary line, e.g. localized "No results". */
  title: ReactNode;
  /** Secondary explanation: what this means and what to do. */
  description?: ReactNode;
  /** Action row content, typically a `Button`. */
  action?: ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
  children,
  ...rest
}: EmptyStateProps) {
  return (
    <div
      role="status"
      data-state="empty"
      className={[
        'flex w-full flex-col items-center gap-3 px-6 py-12 text-center',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex text-gray-400">
          {icon}
        </span>
      ) : null}
      <div className="max-w-md">
        <p className="text-base font-medium text-gray-900">{title}</p>
        {description ? (
          <p className="mt-1 text-sm leading-relaxed text-gray-500">{description}</p>
        ) : null}
      </div>
      {action || children ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {action}
          {children}
        </div>
      ) : null}
    </div>
  );
}
