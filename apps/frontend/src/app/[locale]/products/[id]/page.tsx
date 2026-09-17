/**
 * Per-product page (task 9.5).
 *
 * A server component so crawlers receive product-specific title and
 * description metadata in the initial HTML — drawn from the product data
 * via the same API client the rest of the app uses. The catalog endpoints
 * are age-gated, so the server-side read presents the fixed first-party
 * prerender token (see getServerProductDetail); a crawler cannot click
 * a gate, and the gate itself is explicit self-attestation in Phase 1.
 *
 * generateMetadata and the page body share one fetch per render — Next
 * dedupes identical server fetches within a render pass.
 *
 * @module ProductPage
 */

// Namespace import: vitest's esbuild transform emits classic JSX
// (products/page.tsx precedent), so the component scope needs React.
import * as React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  BASE_URL,
  SERVER_AGE_CONFIRMATION_TOKEN,
  getServerProductDetail,
} from '@/lib/api';
import type { PriceHistoryResponse, ProductDetailResponse } from '@/lib/types';
import MerchantWarningNotice from '../../components/MerchantWarningNotice';
import ProductAlertAction from './components/ProductAlertAction';
import ProductDupesPanel from './components/ProductDupesPanel';
import ProductPriceContextLine from './components/ProductPriceContextLine';
import PriceHistoryChart from './components/PriceHistoryChart';

interface ProductPageProps {
  params: Promise<{ locale: string; id: string }>;
}

const DAY_MS = 86_400_000;

/** The widest window the price-history endpoint accepts (365 days). */
const HISTORY_RANGE_DAYS = 365;

/** Format a Date as an ISO date 'YYYY-MM-DD' (UTC). */
function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Server-side price-history read (task 5.1): the endpoint is age-gated,
 * so the server presents the fixed first-party prerender token — the
 * getServerProductDetail precedent, expressed with a direct fetch here
 * because the shared getPriceHistory client is the browser-side helper
 * (cookie-based confirmation, no revalidate). Any failure or unexpected
 * shape degrades to null and the page renders without the section.
 */
async function getServerPriceHistory(
  productId: number,
): Promise<PriceHistoryResponse | null> {
  const todayMs = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  const params = new URLSearchParams({
    metric: 'price',
    granularity: 'day',
    from: toIsoDate(todayMs - (HISTORY_RANGE_DAYS - 1) * DAY_MS),
    to: toIsoDate(todayMs),
  });
  try {
    const res = await fetch(
      `${BASE_URL}/api/v1/products/${productId}/price-history?${params}`,
      {
        headers: { 'x-age-confirmed': SERVER_AGE_CONFIRMATION_TOKEN },
        next: { revalidate: 900 },
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as PriceHistoryResponse | null;
    if (
      body === null ||
      typeof body !== 'object' ||
      !Array.isArray(body.series) ||
      typeof body.to !== 'string'
    ) {
      return null;
    }
    return body;
  } catch {
    return null;
  }
}

/** Locale-appropriate date formatting for observation timestamps. */
function formatObserved(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale === 'fi' ? 'fi-FI' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Locale-appropriate country name for an ISO code — data formatting (same
 * category as date formatting), not catalog copy. Falls back to the raw
 * code where Intl.DisplayNames is unavailable or rejects the input.
 */
function countryName(code: string, locale: string): string {
  try {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Factual detail string (brand, category, volume, ABV) for metadata. */
function detailParts(
  detail: ProductDetailResponse,
  abvLabel: (value: number) => string,
): string {
  return [
    detail.product.brand,
    detail.product.category,
    detail.product.unitVolume,
    detail.product.alcoholByVolume !== null
      ? abvLabel(detail.product.alcoholByVolume)
      : null,
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');
}

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: 'ProductPage' });
  const tCommon = await getTranslations({ locale, namespace: 'Common' });

  const productId = Number.parseInt(id, 10);
  const detail =
    Number.isInteger(productId) && productId > 0
      ? await getServerProductDetail(productId)
      : null;

  // Unavailable product data (unknown id, closed launch gates, backend
  // down) degrades to generic metadata instead of erroring the response.
  if (detail === null) {
    return {
      title: t('notFoundTitle'),
      description: t('metaDescriptionFallback'),
    };
  }

  return {
    title: t('metaTitle', { name: detail.product.name }),
    description: t('metaDescription', {
      name: detail.product.name,
      details: detailParts(detail, (value) => tCommon('abvValue', { value })),
    }),
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: 'ProductPage' });
  const tCommon = await getTranslations({ locale, namespace: 'Common' });

  const productId = Number.parseInt(id, 10);
  if (!Number.isInteger(productId) || productId <= 0) {
    notFound();
  }

  const detail = await getServerProductDetail(productId);
  if (detail === null) {
    notFound();
  }

  // Price history (task 5.1) — fetched once, widest window; null on any
  // failure, and the chart component itself renders nothing for an
  // empty series, so the section is absent exactly when there is no
  // history to show.
  const priceHistory = await getServerPriceHistory(productId);

  const { product, offers } = detail;
  const masterRows: Array<{ label: string; value: string }> = [
    { label: t('brandLabel'), value: product.brand },
    ...(product.category ? [{ label: t('categoryLabel'), value: product.category }] : []),
    ...(product.unitVolume ? [{ label: t('volumeLabel'), value: product.unitVolume }] : []),
    ...(product.containerType
      ? [{ label: t('containerLabel'), value: product.containerType }]
      : []),
    ...(product.alcoholByVolume !== null
      ? [
          {
            label: tCommon('abvLabel'),
            value: tCommon('abvValue', { value: product.alcoholByVolume }),
          },
        ]
      : []),
    ...(product.ean ? [{ label: t('eanLabel'), value: product.ean }] : []),
  ];

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-1 text-2xl font-bold text-primary-700">
        {product.name}
      </h1>
      <p className="mb-8 text-sm text-gray-500">
        {detailParts(detail, (value) => tCommon('abvValue', { value }))}
      </p>

      {/* ── Master data ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          {t('masterTitle')}
        </h2>
        <dl className="space-y-2">
          {masterRows.map((row) => (
            <div
              key={row.label}
              className="flex justify-between border-b border-gray-100 pb-2 last:border-b-0"
            >
              <dt className="text-sm font-medium text-gray-700">
                {row.label}
              </dt>
              <dd className="text-sm text-gray-500">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── Merchant warnings (task 2.4) — display-only notice above the
          offers when any of this product's merchants carries a PUBLISHED
          blacklist entry; renders nothing when the block is absent. ── */}
      <div className="mb-8">
        <MerchantWarningNotice warnings={detail.merchantWarnings ?? []} />
      </div>

      {/* ── Observed offers ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">
          {t('offersTitle')}
        </h2>
        <p className="mb-4 text-xs text-gray-400">
          {tCommon('offerCount', { count: offers.length })} ·{' '}
          {t('dataNote')}
        </p>

        {offers.length === 0 ? (
          <p className="text-sm text-gray-500">{t('noOffers')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="pb-2 pr-4 font-medium">{t('merchantHeader')}</th>
                <th className="pb-2 pr-4 font-medium">{t('priceHeader')}</th>
                <th className="pb-2 pr-4 font-medium">{t('countryHeader')}</th>
                <th className="pb-2 font-medium">{t('observedHeader')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {offers.map((offer) => (
                <tr key={offer.id}>
                  <td className="py-2 pr-4 font-medium text-gray-900">
                    {offer.merchant}
                  </td>
                  <td className="py-2 pr-4 text-gray-700">
                    {(offer.priceCents / 100).toFixed(2)}{' '}
                    {offer.currency === 'EUR' ? '€' : offer.currency}
                  </td>
                  <td className="py-2 pr-4 text-gray-500">
                    {countryName(offer.country, locale)}
                  </td>
                  <td className="py-2 text-gray-500">
                    {formatObserved(offer.observedAt, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Price-context line (insight-surfaces 3.3) — derives from the
          API's same current-best-price selection as the offers above, so
          the sentence and the panel cannot contradict each other; absent
          from the HTML when the context is unavailable ── */}
      <ProductPriceContextLine productId={productId} />

      {/* ── Price history (task 5.1) — server-fetched series, client
          range views; renders NOTHING when there is no history ── */}
      {priceHistory !== null && <PriceHistoryChart history={priceHistory} />}

      {/* ── Producer dupe panel — absent from the HTML when no curated
          links exist (design R9) ── */}
      <ProductDupesPanel productId={productId} />

      {/* ── Price-alert action ── */}
      <ProductAlertAction productId={productId} />

      <p className="text-xs text-gray-400">{t('landingNote')}</p>
    </main>
  );
}
