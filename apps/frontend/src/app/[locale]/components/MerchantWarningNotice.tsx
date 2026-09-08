'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { MerchantWarning } from '@/lib/types';

// ---------------------------------------------------------------------------
// Basis labels
// ---------------------------------------------------------------------------

/**
 * The published-standard bases an entry can carry (core-domain blacklist).
 * An unknown stored value falls back to the generic basis line — a schema
 * extension must never crash a product page.
 */
const STANDARD_MET_KEYS: ReadonlyMap<string, string> = new Map([
  ['CONFIRMED_NON_DELIVERY_REPORTS', 'basisNonDelivery'],
  ['CONFIRMED_INVALID_BUSINESS_REGISTRATION', 'basisRegistration'],
]);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MerchantWarningNoticeProps {
  /** The joined warnings for this surface's merchants. */
  warnings: readonly MerchantWarning[];
  /**
   * Compact presentation for compare columns and search results, where
   * several notices can stack. Full presentation for the product page.
   */
  compact?: boolean;
}

/**
 * Public merchant-warning notice (trust-and-reach-roadmap task 2.4,
 * spec merchant-blacklist "Display-only warnings").
 *
 * Renders wherever a warned merchant appears — product, compare, and
 * search surfaces. Strictly display-only: it annotates a surface, it
 * never removes, reorders, or restyles the underlying offers, totals,
 * or rankings.
 *
 * Visual tokens: the error token group is the one place the design
 * system allows "something is wrong" (design.md D1 — amber belongs to
 * staleness alone, so a warning cannot borrow it). The triangle icon is
 * an aria-hidden shape affordance; the visible text carries the meaning,
 * so the notice survives grayscale and color-blindness. Copy stays
 * neutral and factual: what was published, against which merchant, and
 * where the methodology explains it.
 *
 * Renders nothing when the list is empty or the block was omitted by
 * the API (fail-open join) — absence is the quiet case.
 */
export default function MerchantWarningNotice({
  warnings,
  compact = false,
}: MerchantWarningNoticeProps) {
  const t = useTranslations('MerchantWarning');

  if (warnings.length === 0) return null;

  return (
    <aside
      data-testid="merchant-warning-notice"
      aria-label={t('noticeLabel')}
      className={[
        'rounded-md border border-error-border bg-error-bg',
        compact ? 'px-3 py-2' : 'px-4 py-3',
      ].join(' ')}
    >
      <p
        className={[
          'flex items-start gap-1.5 font-medium text-error-fg',
          compact ? 'text-xs' : 'text-sm',
        ].join(' ')}
      >
        {/* Shape affordance — decorative; the text is the accessible name. */}
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 12 12"
          className="mt-0.5 h-3 w-3 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 1.5 11 10.5H1L6 1.5z" />
          <path d="M6 4.8v2.4" />
          <path d="M6 9.1v.01" />
        </svg>
        {t('noticeTitle')}
      </p>
      <ul className={compact ? 'mt-1 space-y-1' : 'mt-1.5 space-y-1.5'}>
        {warnings.map((warning) => (
          <li key={`${warning.merchantDomain}-${warning.merchantName}`}>
            <p
              className={[
                'leading-relaxed text-error-fg',
                compact ? 'text-xs' : 'text-sm',
              ].join(' ')}
            >
              {t('warnedMerchant', { name: warning.merchantName })}{' '}
              {t.rich('noticeBody', {
                basis: STANDARD_MET_KEYS.get(warning.standardMet)
                  ? t(STANDARD_MET_KEYS.get(warning.standardMet)!)
                  : t('basisGeneric'),
                link: (chunks) => (
                  <Link
                    href={warning.methodologyUrl}
                    className="font-medium text-error-fg underline hover:text-error"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </li>
        ))}
      </ul>
    </aside>
  );
}
