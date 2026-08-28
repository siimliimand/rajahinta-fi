'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import type { ContentViolation } from '@/lib/content-lint';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ContentSafetyBadgeProps {
  /**
   * Violations detected by the content linter.
   * When provided and non-empty, the badge renders a warning.
   * When the product is clean (empty array or undefined), nothing is shown.
   */
  readonly violations?: readonly ContentViolation[];
  /**
   * Optional CSS class to merge into the badge's outer container.
   */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LANGUAGE_LABEL: Record<string, string> = {
  fi: 'FI',
  en: 'EN',
  sv: 'SV',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Badge that warns about promotional or subjective product content.
 *
 * - Hides completely when the product has no violations (clean content).
 * - Shows an inline warning badge when violations exist.
 * - Supports a tooltip-style hover detail via the `title` attribute.
 *
 * @example
 * ```tsx
 * <ContentSafetyBadge violations={result.violations} />
 * ```
 */
export default function ContentSafetyBadge({
  violations,
  className = '',
}: ContentSafetyBadgeProps) {
  const t = useTranslations('ContentSafetyBadge');

  if (!violations || violations.length === 0) return null;

  const summary =
    new Set(violations.map((v) => v.pattern)).size === 1
      ? t('promotional', {
          pattern: violations[0].pattern,
          language: LANGUAGE_LABEL[violations[0].language] ?? violations[0].language,
        })
      : t('violations', { count: violations.length });

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200 ${className}`}
      title={violations
        .map(
          (v) =>
            `"${v.matchedText}" (${v.field}, ${LANGUAGE_LABEL[v.language] ?? v.language})`,
        )
        .join('\n')}
    >
      <svg
        className="h-3 w-3 shrink-0 text-amber-500"
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM7 5a1 1 0 012 0v3a1 1 0 01-2 0V5zm1 6a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>
      <span>{summary}</span>
    </span>
  );
}
