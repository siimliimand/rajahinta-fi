'use client';

/**
 * OpsConsoleNav — the index of the operator console's standalone
 * sub-pages (2026-10-26 ops-surface audit). The main OperatorConsole
 * at /ops renders four inline sections (governance, tax confirmations,
 * corrections, audit) but every other console lives on its own route —
 * previously reachable only by typing the URL, which is why the
 * calendar candidate review queue read as API-only. This nav is the
 * single discoverability surface: one card, one link per console, both
 * locales, no state.
 *
 * @module OpsConsoleNav
 */

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

/** The standalone console routes under /[locale]/ops — keep in sync
 * with the page directories beside this file. */
const CONSOLES = [
  { slug: 'calendar-candidates', labelKey: 'consolesCandidatesLabel', descKey: 'consolesCandidatesDesc' },
  { slug: 'calendar-events', labelKey: 'consolesEventsLabel', descKey: 'consolesEventsDesc' },
  { slug: 'reports', labelKey: 'consolesReportsLabel', descKey: 'consolesReportsDesc' },
  { slug: 'appeals', labelKey: 'consolesAppealsLabel', descKey: 'consolesAppealsDesc' },
  { slug: 'newsletter', labelKey: 'consolesNewsletterLabel', descKey: 'consolesNewsletterDesc' },
  { slug: 'guides', labelKey: 'consolesGuidesLabel', descKey: 'consolesGuidesDesc' },
  { slug: 'name-quality', labelKey: 'consolesNameQualityLabel', descKey: 'consolesNameQualityDesc' },
] as const;

export default function OpsConsoleNav({ locale }: { locale: string }) {
  const t = useTranslations('OperatorConsole');
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-1 text-lg font-semibold">{t('consolesTitle')}</h2>
      <p className="mb-4 text-sm text-gray-600">{t('consolesIntro')}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {CONSOLES.map(({ slug, labelKey, descKey }) => (
          <li key={slug} className="rounded border border-gray-100 p-3">
            <Link
              href={`/${locale}/ops/${slug}`}
              className="font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
            >
              {t(labelKey)}
            </Link>
            <p className="mt-1 text-sm text-gray-600">{t(descKey)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
