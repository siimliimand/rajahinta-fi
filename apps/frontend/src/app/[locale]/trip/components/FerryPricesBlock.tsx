'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { TripFerryPriceRow } from '../trip.types';
import { formatDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';

// ---------------------------------------------------------------------------
// Citation rendering — the allowances page's EvidenceCitation house
// pattern, re-declared to keep the trip scope self-contained: the visible
// text is the stored citation, unmodified — never paraphrased, never cut —
// and the extracted URL is only the href. A citation without a URL stays
// verbatim as plain text (nothing is invented to make it a link).
// ---------------------------------------------------------------------------

/** First http(s) URL inside a stored citation — the evidence link target. */
const URL_IN_TEXT_PATTERN = /https?:\/\/[^\s)]+/;

function EvidenceCitation({ citation }: { readonly citation: string }) {
  const url = URL_IN_TEXT_PATTERN.exec(citation)?.[0];
  if (url === undefined) {
    return (
      <span className="break-words text-sm text-gray-600">{citation}</span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="break-words text-sm text-primary-700 underline decoration-primary-300 underline-offset-2 hover:decoration-primary-600"
    >
      {citation}
    </a>
  );
}

// ---------------------------------------------------------------------------
// One observed-price row — provenance, never an offer
// ---------------------------------------------------------------------------

function FerryPriceRowItem({ row }: { readonly row: TripFerryPriceRow }) {
  const t = useTranslations('TripPage');
  const locale = useLocale();

  return (
    <div data-testid="trip-ferry-price-row">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {row.operator} · {row.route}
      </dt>
      <dd className="mt-1 text-sm text-gray-900">
        {row.label} — {formatMoney(row.priceCents, locale)}
        {/* The observation date rides the shared date formatter: a
            YYYY-MM-DD calendar date renders as a calendar date, never
            raw ISO inside prose (fi-locale-surface-hardening 2.4). */}
        <span className="mt-0.5 block text-xs text-gray-500">
          {t('ferryPrices.observedOn', {
            date: formatDate(row.observedAt, locale),
          })}
        </span>
        <span className="mt-1 block">
          <EvidenceCitation citation={row.citation} />
        </span>
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block — collapsed observed-facts evidence beside the partner block
// ---------------------------------------------------------------------------

/**
 * "Laivaston havaitut hinnat" (change ferry-onboard-prices, task 4.1):
 * the response's `ferryPrices` rows rendered as observed catalog facts —
 * operator, route, label, price, observation date, and the verbatim
 * source citation behind a collapsed evidence disclosure. The one-line
 * disclaimer states the facts framing: these are observations, not
 * purchasable offers, and they never enter the calculations (no buy
 * CTA anywhere in the block — the only links are evidence citations).
 *
 * Honest empty state: an empty array — or an absent key from an older
 * cached response — renders NO block at all, no placeholder figures,
 * no stale data. The container sits outside the results section as a
 * sibling of the partner block, so the results markup never depends on
 * it (the design R8 separation).
 *
 * The native `<details>` toggle has no motion, so reduced-motion
 * preferences need no extra handling (the sibling blocks' convention).
 *
 * @module FerryPricesBlock
 */
export default function FerryPricesBlock({
  rows,
}: {
  readonly rows?: readonly TripFerryPriceRow[];
}) {
  const t = useTranslations('TripPage');

  if (!rows || rows.length === 0) return null;

  return (
    <aside
      aria-label={t('ferryPrices.label')}
      data-testid="trip-ferry-prices"
      className="mt-8 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-4"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {t('ferryPrices.label')}
      </p>

      {/* Observed facts, not offers — the one-line framing disclaimer. */}
      <p className="mt-1 text-xs text-gray-500">
        {t('ferryPrices.disclaimer')}
      </p>

      {/* Collapsed evidence disclosure — the allowances page's house
          pattern: the rows and their verbatim citations one click away. */}
      <details
        className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3"
        data-testid="trip-ferry-prices-disclosure"
      >
        <summary className="cursor-pointer select-none text-sm font-medium text-gray-700">
          {t('ferryPrices.disclosureSummary')}
        </summary>
        <dl className="mt-3 space-y-3">
          {rows.map((row) => (
            <FerryPriceRowItem
              key={`${row.operator}|${row.route}|${row.label}`}
              row={row}
            />
          ))}
        </dl>
      </details>
    </aside>
  );
}
