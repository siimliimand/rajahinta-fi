// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState, ErrorState } from '@/components/ui';
import { formatDate } from '@/lib/format/date';
import {
  getServerAllowanceVersions,
  getServerAllowances,
  resolveRequestedDate,
  type AllowanceLimit,
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
 * Static per-category container sizes behind the container-equivalent
 * helper (D5): a cap converts into a count of the category's most common
 * container, rounded to the nearest whole unit. Display-only arithmetic —
 * the line states the conversion with "≈", never advice. A category
 * without a fixed container, or with a quantity-only cap, renders no
 * helper line.
 */
const CONTAINER_LITRES: Readonly<Record<string, number>> = {
  beer: 0.5,
  wine_still: 0.75,
  wine_sparkling: 0.75,
  intermediate_products: 0.75,
  other_fermented: 0.5,
  spirits: 0.5,
};

/** The locale-worded helper message per category (fixed container sizes). */
const CONTAINER_MESSAGE_KEY: Readonly<Record<string, string>> = {
  beer: 'containerEquivalentBeer',
  wine_still: 'containerEquivalentWineStill',
  wine_sparkling: 'containerEquivalentWineSparkling',
  intermediate_products: 'containerEquivalentIntermediateProducts',
  other_fermented: 'containerEquivalentOtherFermented',
  spirits: 'containerEquivalentSpirits',
};

/**
 * Traveller-allowance reference page (insight-surfaces task 4.2;
 * consumer-clarity-and-discovery 5.1 + 5.2).
 *
 * Pure display over the task-4.1 read endpoints: the published per-category
 * allowances effective on the chosen date, with the dataset version and its
 * effective window beside the caps. Each category row reads as a concise
 * summary line (category + cap) with a static container-equivalent helper;
 * the per-category stored citations stay verbatim, evidence-linked, inside
 * one collapsed evidence disclosure per dataset block, and the dataset-level
 * citation remains verbatim and inline. The guidance-not-legal-advice
 * framing is standing copy; the content-policy lint polices the vocabulary.
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
  // Dates ride the shared localized formatters (fi-locale-surface-
  // hardening 2.4): the effective-window bounds and the caps date are
  // date-only ISO strings and render as calendar dates ("1.1.2026
  // alkaen"), never raw ISO inside Finnish prose.
  const windowText = (from: string, to: string | null) =>
    to === null
      ? t('effectiveWindowOpen', { from: formatDate(from, locale) })
      : t('effectiveWindow', {
          from: formatDate(from, locale),
          to: formatDate(to, locale),
        });

  // Locale-shaped numbers for cap figures (products page precedent);
  // container sizes are baked into the locale-worded helper messages.
  const numberFormat = new Intl.NumberFormat(
    locale === 'fi' ? 'fi-FI' : 'en-IE',
    { maximumFractionDigits: 2 },
  );

  /** Localized category name; unknown keys render as stored — nothing invented. */
  const categoryName = (category: string): string =>
    t.has(`category.${category}`) ? t(`category.${category}`) : category;

  /** Concise summary line stating the category's cap as a bound. */
  const capSummary = (limit: AllowanceLimit): string | null => {
    const volume =
      limit.volumeCapLitres === null
        ? null
        : numberFormat.format(limit.volumeCapLitres);
    const quantity =
      limit.quantityCap === null
        ? null
        : numberFormat.format(limit.quantityCap);
    if (volume !== null && quantity !== null) {
      return t('summaryBoth', { volume, quantity });
    }
    if (volume !== null) return t('summaryVolume', { volume });
    if (quantity !== null) return t('summaryQuantity', { quantity });
    return null;
  };

  /** Display-only cap → common-container conversion, when one is defined. */
  const containerEquivalent = (limit: AllowanceLimit): string | null => {
    const litres = CONTAINER_LITRES[limit.category];
    const key = CONTAINER_MESSAGE_KEY[limit.category];
    if (
      limit.volumeCapLitres === null ||
      litres === undefined ||
      key === undefined ||
      !t.has(key)
    ) {
      return null;
    }
    return t(key, {
      count: numberFormat.format(Math.round(limit.volumeCapLitres / litres)),
    });
  };

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
            {t('capsTitle', { date: formatDate(outcome.payload.date, locale) })}
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
              {t('capsTableCaption', {
                date: formatDate(outcome.payload.date, locale),
              })}
            </caption>
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th scope="col" className="pb-2 pr-4 font-medium">
                  {t('columnCategory')}
                </th>
                <th scope="col" className="pb-2 pr-4 font-medium">
                  {t('columnCap')}
                </th>
                <th scope="col" className="pb-2 font-medium">
                  {t('columnWindow')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {outcome.payload.limits.map((limit) => {
                const summary = capSummary(limit);
                const helper = containerEquivalent(limit);
                return (
                  <tr
                    key={limit.category}
                    data-testid={`allowances-limit-${limit.category}`}
                  >
                    <td className="py-2 pr-4 font-medium text-gray-900">
                      {categoryName(limit.category)}
                    </td>
                    <td className="py-2 pr-4">
                      {summary !== null && (
                        <p className="tabular-nums text-gray-900">{summary}</p>
                      )}
                      {helper !== null && (
                        <p className="mt-0.5 text-xs tabular-nums text-gray-500">
                          {helper}
                        </p>
                      )}
                    </td>
                    <td className="py-2 text-gray-600">
                      {windowText(limit.effectiveFrom, limit.effectiveTo)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* ── Evidence disclosure (D5): the per-category stored citations,
              verbatim and evidence-linked, one click away — never repeated
              inline per row, never paraphrased. ── */}
          <details
            className="mt-5 rounded-md border border-gray-200 bg-gray-50 px-4 py-3"
            data-testid="allowances-evidence-disclosure"
          >
            <summary className="cursor-pointer select-none text-sm font-medium text-gray-700">
              {t('evidenceDisclosureSummary')}
            </summary>
            <dl className="mt-3 space-y-3">
              {outcome.payload.limits.map((limit) => (
                <div
                  key={limit.category}
                  data-testid={`allowances-evidence-${limit.category}`}
                >
                  <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    {categoryName(limit.category)}
                  </dt>
                  <dd className="mt-1">
                    <EvidenceCitation citation={limit.sourceCitation} />
                  </dd>
                </div>
              ))}
            </dl>
          </details>
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
