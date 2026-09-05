'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, Button, Card, ReliabilityBadge } from '@/components/ui';
import { routing } from '@/i18n/routing';
import type { WhatIfLine, WhatIfResponse } from '../what-if.types';
import WhatIfDisclaimer from './WhatIfDisclaimer';

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format cents to a euro string — the CalculatorResult/EventPlanResult
 * precedent. Figures are formatted, never re-rounded.
 */
function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/**
 * Signed variant for gap figures — the sign is the payload's convention
 * (positive gap = importing is dearer than the domestic reference), so it
 * stays visible even when a figure is zero or negative.
 */
function formatSignedEur(cents: number): string {
  const sign = cents > 0 ? '+' : cents < 0 ? '-' : '';
  return `${sign}${formatEur(Math.abs(cents))}`;
}

// ---------------------------------------------------------------------------
// Copy-to-clipboard helper
// ---------------------------------------------------------------------------

/**
 * Clipboard write with a legacy fallback. Returns whether the copy
 * succeeded so the button can confirm instead of assuming.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

/** Build the share/embed URLs from the page's current origin and locale. */
export function buildWhatIfUrls(
  origin: string,
  locale: string,
  token: string,
): { shareUrl: string; embedUrl: string } {
  // localePrefix 'as-needed': the default locale serves unprefixed paths.
  const prefix = locale === routing.defaultLocale ? '' : `/${locale}`;
  return {
    shareUrl: `${origin}${prefix}/what-if?token=${token}`,
    embedUrl: `${origin}${prefix}/what-if/embed?token=${token}`,
  };
}

// ---------------------------------------------------------------------------
// One line — baseline vs hypothetical with the gap figures
// ---------------------------------------------------------------------------

function LineCard({ line }: { readonly line: WhatIfLine }) {
  const t = useTranslations('WhatIfPage');
  const tCommon = useTranslations('Common');

  return (
    <Card padding="md" shadow="sm" data-testid={`what-if-line-${line.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900">{line.id}</h3>
        <span className="text-sm text-gray-500">{t(`category.${line.category}`)}</span>
      </div>
      <dl className="mt-3 space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('result.lineImportTotalBaseline')}</dt>
          <dd className="text-sm font-medium text-gray-900">
            {formatEur(line.importTotalBaselineCents)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('result.lineImportTotalHypothetical')}</dt>
          <dd className="text-sm font-semibold text-gray-900">
            {formatEur(line.importTotalHypotheticalCents)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('result.lineGapBaseline')}</dt>
          <dd className="text-sm font-medium text-gray-900">
            {formatSignedEur(line.gapBaselineCents)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('result.lineGapHypothetical')}</dt>
          <dd className="text-sm font-medium text-gray-900">
            {formatSignedEur(line.gapHypotheticalCents)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-gray-100 pt-2">
          <dt className="text-sm font-medium text-gray-700">{t('result.lineGapDelta')}</dt>
          <dd className="text-sm font-semibold text-gray-900">
            {formatSignedEur(line.gapDeltaCents)}
          </dd>
        </div>
      </dl>

      {/* Baseline provenance — the exact rule the engine resolved, named. */}
      <div className="mt-3 rounded-md bg-gray-50 px-3 py-2">
        <p className="text-xs text-gray-500">
          {t('result.baselineVersion', { version: line.baseline.taxDatasetVersion })}
          {' · '}
          {t('result.baselineFormula', { formula: line.baseline.formulaRef })}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          <span>{t('result.baselineRate', { rate: String(line.baseline.rateApplied) })}</span>
          <span className="font-medium text-gray-700">
            {t('result.baselineTax', { amount: formatEur(line.baseline.taxCents) })}
          </span>
          <ReliabilityBadge status={line.baseline.reliability as 'VERIFIED' | 'ESTIMATED'}>
            {tCommon(`reliability.${line.baseline.reliability}`)}
          </ReliabilityBadge>
        </p>
      </div>

      {/* Hypothetical substitution — the substituted rate and its tax. */}
      <div className="mt-2 rounded-md bg-gray-50 px-3 py-2">
        <p className="text-xs text-gray-500">
          {t('result.hypotheticalRate', { rate: String(line.hypothetical.rate) })}
          {' · '}
          {t('result.hypotheticalFormula', { formula: line.hypothetical.formulaRef })}
        </p>
        <p className="mt-1 text-xs font-medium text-gray-700">
          {t('result.hypotheticalTax', { amount: formatEur(line.hypothetical.taxCents) })}
        </p>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface WhatIfResultProps {
  /** The 200 response — lines, totals, structural disclaimer, share token. */
  readonly result: WhatIfResponse;
}

/**
 * What-if output: the prominent structural disclaimer first, then the
 * scenario citation, the totals, the per-product gap cards, and the
 * share/embed actions.
 *
 * The disclaimer is rendered from the response field (never a UI-only
 * string) and has no dismiss affordance. Gap figures keep the payload's
 * sign convention visible: positive gap = import dearer than the domestic
 * reference price; positive delta = the substituted rate widens that gap.
 *
 * @module WhatIfResult
 */
export default function WhatIfResult({ result }: WhatIfResultProps) {
  const t = useTranslations('WhatIfPage');
  const locale = useLocale();
  const [copied, setCopied] = React.useState<'link' | 'embed' | null>(null);
  const copiedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    };
  }, []);

  const markCopied = (which: 'link' | 'embed') => {
    setCopied(which);
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 2000);
  };

  const copyShareLink = async () => {
    const { shareUrl } = buildWhatIfUrls(window.location.origin, locale, result.shareToken);
    if (await copyText(shareUrl)) markCopied('link');
  };

  const copyEmbedCode = async () => {
    const { embedUrl } = buildWhatIfUrls(window.location.origin, locale, result.shareToken);
    const snippet = `<iframe src="${embedUrl}" width="100%" height="480" title="${t(
      'share.embedIframeTitle',
    )}"></iframe>`;
    if (await copyText(snippet)) markCopied('embed');
  };

  return (
    <section aria-labelledby="what-if-result-heading" data-testid="what-if-result">
      <h2 id="what-if-result-heading" className="mb-3 text-lg font-semibold text-gray-900">
        {t('result.heading')}
      </h2>

      {/* Structural HYPOTHETICAL disclaimer — first, prominent, non-dismissible. */}
      <div className="mb-4">
        <WhatIfDisclaimer disclaimer={result.disclaimer} />
      </div>

      {/* Scenario citation: the substituted rate and the fixed baseline version. */}
      <p className="mb-4 text-sm text-gray-700">
        {t('result.scenarioRate', { rate: String(result.hypotheticalRate) })}
        {' · '}
        {t('result.scenarioBaselineVersion', { version: result.baselineTaxDatasetVersion })}
      </p>

      {/* Totals across the scenario. */}
      <Card padding="md" shadow="sm" className="mb-4" data-testid="what-if-totals">
        <h3 className="text-base font-semibold text-gray-900">{t('result.totalsHeading')}</h3>
        <dl className="mt-3 space-y-2">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-gray-500">{t('result.totalsBaselineExcise')}</dt>
            <dd className="text-sm font-medium text-gray-900">
              {formatEur(result.totals.baselineExciseCents)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-gray-500">{t('result.totalsHypotheticalExcise')}</dt>
            <dd className="text-sm font-semibold text-gray-900">
              {formatEur(result.totals.hypotheticalExciseCents)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-gray-500">{t('result.totalsGapBaseline')}</dt>
            <dd className="text-sm font-medium text-gray-900">
              {formatSignedEur(result.totals.gapBaselineCents)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-gray-500">{t('result.totalsGapHypothetical')}</dt>
            <dd className="text-sm font-medium text-gray-900">
              {formatSignedEur(result.totals.gapHypotheticalCents)}
            </dd>
          </div>
        </dl>
      </Card>

      {/* One gap card per product. */}
      <div className="space-y-4">
        {result.lines.map((line) => (
          <LineCard key={line.id} line={line} />
        ))}
      </div>

      {/* Neutral sign legend — what the gap figures mean. */}
      <p className="mt-4 text-xs text-gray-500">{t('result.gapLegend')}</p>

      {/* Share / embed — the token from the response, never client-built state. */}
      <div className="mt-6" data-testid="what-if-share">
        <h3 className="text-sm font-semibold text-gray-900">{t('share.heading')}</h3>
        <p className="mt-1 text-xs text-gray-500">{t('share.body')}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={copyShareLink}>
            {copied === 'link' ? <Badge tone="verified">{t('share.copied')}</Badge> : t('share.copyLink')}
          </Button>
          <Button variant="secondary" size="sm" onClick={copyEmbedCode}>
            {copied === 'embed' ? <Badge tone="verified">{t('share.copied')}</Badge> : t('share.copyEmbed')}
          </Button>
        </div>
      </div>
    </section>
  );
}
