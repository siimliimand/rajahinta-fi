// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState, ErrorState } from '@/components/ui';
import {
  getServerAllowanceVersions,
  getServerAllowances,
  resolveRequestedDate,
} from './allowances.server';

interface AllowancesPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'AllowancesPage' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

/** First http(s) URL inside a stored citation — the evidence link target. */
const URL_IN_TEXT_PATTERN = /https?:\/\/[^\s)]+/;

/**
 * One source citation, rendered VERBATIM as an evidence link: the visible
 * text is the stored string, unmodified — never paraphrased, never cut —
 * and the extracted URL is only the href. A citation without a URL stays
 * verbatim as plain text (nothing is invented to make it a link).
 */
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

/**
 * Traveller-allowance reference page (insight-surfaces task 4.2).
 *
 * Pure display over the task-4.1 read endpoints: the published per-category
 * allowances effective on the chosen date, with the dataset version and its
 * effective window beside the caps, every stored citation rendered verbatim
 * as an evidence link, and the version history below. The guidance-not-legal-
 * advice framing is standing copy; the content-policy lint polices the
 * vocabulary.
 */
export default async function AllowancesPage({
  params,
  searchParams,
}: AllowancesPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const query = await searchParams;
  const raw = Array.isArray(query.date) ? query.date[0] : query.date;
  const date = resolveRequestedDate(raw);

  const t = await getTranslations('AllowancesPage');
  const windowText = (from: string, to: string | null) =>
    to === null
      ? t('effectiveWindowOpen', { from })
      : t('effectiveWindow', { from, to });

  // Both reads are independent — fetch together (the caps outcome drives
  // the main state; the history renders below in every covered/uncovered
  // case because it shows the actual published coverage).
  const [outcome, versionsOutcome] = await Promise.all([
    getServerAllowances(date),
    getServerAllowanceVersions(),
  ]);

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-2 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-6 text-sm leading-relaxed text-gray-500">
        {t('subtitle')}
      </p>

      {/* ── Standing framing: guidance, not legal advice ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-5">
        <p className="text-sm leading-relaxed text-gray-600">
          {t('informationalNote')}
        </p>
      </section>

      {/* ── Date picker — plain GET form, no JS needed ── */}
      <form method="get" className="mb-8 flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="allowance-date"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            {t('datePickerLabel')}
          </label>
          <input
            id="allowance-date"
            type="date"
            name="date"
            defaultValue={date}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
        >
          {t('dateSubmit')}
        </button>
      </form>

      {outcome.kind === 'unavailable' ? (
        <div className="mb-8" data-testid="allowances-unavailable">
          <ErrorState
            title={t('unavailableTitle')}
            description={t('unavailableBody')}
          />
        </div>
      ) : outcome.kind === 'not-found' ? (
        <div className="mb-8" data-testid="allowances-not-found">
          <EmptyState
            title={t('notFoundTitle')}
            description={t('notFoundBody')}
          />
        </div>
      ) : (
        <section
          className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
          data-testid="allowances-caps"
        >
          <h2 className="mb-1 text-lg font-semibold text-gray-900">
            {t('capsTitle', { date: outcome.payload.date })}
          </h2>
          {/* Version label + effective window sit with the caps (spec). */}
          <p className="text-sm text-gray-600">
            {t('datasetVersionLabel', {
              label: outcome.payload.dataset.versionLabel,
            })}
            {' · '}
            {windowText(
              outcome.payload.dataset.effectiveFrom,
              outcome.payload.dataset.effectiveTo,
            )}
          </p>
          <div className="mt-3 border-t border-gray-100 pt-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
              {t('datasetCitationLabel')}
            </p>
            <EvidenceCitation
              citation={outcome.payload.dataset.sourceCitation}
            />
          </div>

          <table className="mt-5 w-full text-sm">
            <caption className="sr-only">
              {t('capsTableCaption', { date: outcome.payload.date })}
            </caption>
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th scope="col" className="pb-2 pr-4 font-medium">
                  {t('columnCategory')}
                </th>
                <th scope="col" className="pb-2 pr-4 font-medium">
                  {t('columnVolume')}
                </th>
                <th scope="col" className="pb-2 pr-4 font-medium">
                  {t('columnQuantity')}
                </th>
                <th scope="col" className="pb-2 pr-4 font-medium">
                  {t('columnWindow')}
                </th>
                <th scope="col" className="pb-2 font-medium">
                  {t('columnCitation')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {outcome.payload.limits.map((limit) => (
                <tr key={limit.category}>
                  <td className="py-2 pr-4 font-medium text-gray-900">
                    {/* Unknown category keys render as stored — nothing invented. */}
                    {t.has(`category.${limit.category}`)
                      ? t(`category.${limit.category}`)
                      : limit.category}
                  </td>
                  <td className="py-2 pr-4 tabular-nums text-gray-700">
                    {limit.volumeCapLitres ?? '—'}
                  </td>
                  <td className="py-2 pr-4 tabular-nums text-gray-700">
                    {limit.quantityCap ?? '—'}
                  </td>
                  <td className="py-2 pr-4 text-gray-600">
                    {windowText(limit.effectiveFrom, limit.effectiveTo)}
                  </td>
                  <td className="py-2">
                    <EvidenceCitation citation={limit.sourceCitation} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Version history — served order, superseded included ── */}
      <section className="mb-8" data-testid="allowances-versions">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">
          {t('versionsTitle')}
        </h2>
        <p className="mb-4 text-sm leading-relaxed text-gray-500">
          {t('versionsIntro')}
        </p>

        {versionsOutcome.kind === 'unavailable' ? (
          <p className="text-sm text-gray-500">{t('versionsUnavailable')}</p>
        ) : versionsOutcome.versions.length === 0 ? (
          <p className="text-sm text-gray-500">{t('versionsEmpty')}</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {versionsOutcome.versions.map((version) => (
              <li key={version.versionLabel} className="px-5 py-4">
                <p className="text-sm font-medium text-gray-900">
                  {version.versionLabel}
                  <span className="ml-2 font-normal text-gray-500">
                    {windowText(version.effectiveFrom, version.effectiveTo)}
                  </span>
                </p>
                <div className="mt-1">
                  <EvidenceCitation citation={version.sourceCitation} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
