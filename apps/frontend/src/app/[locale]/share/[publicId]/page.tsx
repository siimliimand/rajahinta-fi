// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import DisclaimerBanner from '../../calculator/components/DisclaimerBanner';
import { getServerShareSnapshot } from '../share.server';
import type { Disclaimer } from '@/lib/types';

interface SharePageProps {
  params: Promise<{ locale: string; publicId: string }>;
}

// ---------------------------------------------------------------------------
// Snapshot-field helpers (defensive — the snapshot is stored JSON)
// ---------------------------------------------------------------------------

/** The four canonical cost categories (core-domain CostCategory). */
const COST_CATEGORIES: ReadonlySet<string> = new Set([
  'foreignRetailPrice',
  'transportCost',
  'alcoholExciseEstimate',
  'containerDutyEstimate',
]);

interface BreakdownLine {
  readonly category: string | null;
  readonly label: string | null;
  readonly cents: number;
}

/**
 * Validate the frozen breakdown into display lines. Only objects with a
 * numeric `cents` render; labels prefer the canonical category key
 * (localized by the caller's translator), falling back to the stored
 * label. Anything else is skipped — a corrupt or unexpected snapshot
 * renders a shorter table, never fabricated rows.
 */
function parseBreakdown(breakdown: unknown): readonly BreakdownLine[] {
  if (!Array.isArray(breakdown)) return [];
  const lines: BreakdownLine[] = [];
  for (const raw of breakdown) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.cents !== 'number' || !Number.isFinite(entry.cents)) {
      continue;
    }
    lines.push({
      category:
        typeof entry.category === 'string' && COST_CATEGORIES.has(entry.category)
          ? entry.category
          : null,
      label: typeof entry.label === 'string' ? entry.label : null,
      cents: entry.cents,
    });
  }
  return lines;
}

/** The disclaimer is a frozen JSON copy — validate before the banner. */
function parseDisclaimer(disclaimer: unknown): Disclaimer | null {
  if (typeof disclaimer !== 'object' || disclaimer === null) return null;
  const d = disclaimer as Record<string, unknown>;
  if (
    typeof d.text !== 'string' ||
    (d.language !== 'fi' && d.language !== 'en') ||
    typeof d.version !== 'string'
  ) {
    return null;
  }
  return { text: d.text, language: d.language, version: d.version };
}

function formatEuro(cents: number, locale: string): string {
  if (!Number.isFinite(cents)) return '–';
  const value = (cents / 100).toFixed(2);
  return locale === 'fi' ? `${value.replace('.', ',')} €` : `€${value}`;
}

function formatDate(iso: string, locale: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(locale === 'fi' ? 'fi-FI' : 'en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Metadata — the OG card derives from the snapshot fields alone
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: SharePageProps): Promise<Metadata> {
  const { locale, publicId } = await params;
  const t = await getTranslations({ locale, namespace: 'SharePage' });

  const outcome = await getServerShareSnapshot(publicId);
  if (outcome.kind !== 'ok') {
    // Generic fallback for unknown/unavailable — never an identifier
    // echo, never an existence hint beyond "no card here".
    return {
      title: t('metaTitleFallback'),
      description: t('metaDescriptionFallback'),
    };
  }

  const { snapshot } = outcome.snapshot;
  const total = formatEuro(snapshot.totalCents, locale);

  const title = t('metaTitle', { name: snapshot.product.name });
  const description = t('metaDescription', {
    quantity: snapshot.quantity,
    name: snapshot.product.name,
    destination: snapshot.destination,
    total,
  });

  return {
    title,
    description,
    // The OG card mirrors the page copy. No account fields exist on the
    // snapshot (the API asserts the strip), so nothing personal can
    // leak through metadata by construction.
    openGraph: {
      title,
      description,
      type: 'website',
    },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SharePage({ params }: SharePageProps) {
  const { locale, publicId } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'SharePage' });
  const tCommon = await getTranslations({ locale, namespace: 'Common' });
  const outcome = await getServerShareSnapshot(publicId);

  // Unknown AND malformed ids are the same 404 (the API's contract);
  // the generic locale not-found page renders — no identifier echo, no
  // existence signal beyond "nothing published here".
  if (outcome.kind === 'not-found') {
    notFound();
  }

  if (outcome.kind === 'unavailable') {
    return (
      <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <section
          data-testid="share-unavailable"
          className="rounded-lg border border-gray-200 bg-gray-50 p-6"
        >
          <h1 className="text-sm font-semibold text-gray-700">
            {t('metaTitleFallback')}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('metaDescriptionFallback')}
          </p>
        </section>
      </main>
    );
  }

  const { snapshot: response } = outcome;
  const { snapshot } = response;
  const calculated = formatDate(snapshot.calculatedAt, locale);
  const created = formatDate(response.createdAt, locale);

  const confidenceKey = snapshot.confidence;
  const confidenceLabel =
    confidenceKey === 'HIGH' || confidenceKey === 'MEDIUM' || confidenceKey === 'LOW'
      ? tCommon(`confidence.${confidenceKey}`)
      : confidenceKey;

  // Resolve breakdown labels here, where the awaited translator is in
  // scope: canonical categories localize through the result catalog,
  // stored labels are the fallback, unresolvable lines keep no name.
  const tResult = await getTranslations({ locale, namespace: 'CalculatorResult' });
  const lines = parseBreakdown(snapshot.breakdown).map((line) => ({
    ...line,
    displayLabel:
      line.category !== null
        ? tResult(`category.${line.category}`)
        : line.label,
  }));
  const disclaimer = parseDisclaimer(snapshot.disclaimer);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {t('eyebrow')}
      </p>
      <h1 className="mb-1 text-2xl font-bold text-primary-700">
        {snapshot.product.name}
      </h1>
      {snapshot.product.brand !== null && snapshot.product.brand !== '' && (
        <p className="mb-1 text-sm text-gray-500">{snapshot.product.brand}</p>
      )}
      <p className="mb-6 text-sm text-gray-500">
        {t('snapshotOfLabel', {
          quantity: snapshot.quantity,
          name: snapshot.product.name,
          destination: snapshot.destination,
        })}
      </p>

      {/* ── Structural disclaimer — the frozen copy carries its own ── */}
      <div className="mb-8">
        {disclaimer !== null ? (
          <DisclaimerBanner disclaimer={disclaimer} />
        ) : (
          <div className="rounded-md border border-status-stale-border bg-status-stale-bg px-4 py-3">
            <p className="text-xs leading-relaxed text-status-stale-fg">
              {t('disclaimerFallback')}
            </p>
          </div>
        )}
      </div>

      {/* ── Estimated total ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">
          {t('totalLabel')}
        </h2>
        <p
          data-testid="share-total"
          className="text-3xl font-bold tabular-nums tabular-money text-gray-900"
        >
          {formatEuro(snapshot.totalCents, locale)}
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {snapshot.currency} · {calculated !== null ? t('calculatedLabel', { date: calculated }) : ''}
        </p>
      </section>

      {/* ── Itemized estimate (frozen lines; absent → honest note) ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          {t('breakdownTitle')}
        </h2>
        {lines.length === 0 ? (
          <p className="text-sm text-gray-500">{t('breakdownUnavailable')}</p>
        ) : (
          <dl className="space-y-2">
            {lines.map((line, index) => (
              <div
                key={index}
                className="flex justify-between border-b border-gray-100 pb-2 last:border-b-0"
              >
                <dt className="text-sm font-medium text-gray-700">
                  {line.displayLabel ?? ''}
                </dt>
                <dd className="text-sm tabular-nums tabular-money text-gray-500">
                  {formatEuro(line.cents, locale)}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-3 text-xs text-gray-400">
          {t('confidenceLabel')}: {confidenceLabel}
        </p>
      </section>

      {/* ── Frozen-copy note ── */}
      <p className="mb-8 text-xs leading-relaxed text-gray-400">
        {t('frozenNote')}
        {created !== null ? ` ${t('createdLabel', { date: created })}` : ''}
      </p>

      {/* ── Accuracy-stat cross-link (task 6.2) — the methodology page
          hosts the user-reported accuracy statistic (task 3.3). ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-5">
        <h2 className="mb-1 text-sm font-semibold text-gray-700">
          {t('accuracyLinkTitle')}
        </h2>
        <p className="text-sm leading-relaxed text-gray-600">
          {t.rich('accuracyLinkBody', {
            link: (chunks) => (
              <Link
                key="accuracy-link"
                href="/ranking#accuracy"
                className="font-medium text-primary-700 underline hover:text-primary-800"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </section>
    </main>
  );
}
