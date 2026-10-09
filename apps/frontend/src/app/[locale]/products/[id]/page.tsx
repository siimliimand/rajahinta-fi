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
import { localizedAlternates } from '@/lib/i18n/localized-paths';
import { formatAbv, formatVolume } from '@/lib/format/product-attributes';
import { formatMoney } from '@/lib/format/money';
import type { PriceHistoryResponse, ProductDetailResponse } from '@/lib/types';
import { Badge, type BadgeTone } from '@/components/ui';
import MerchantWarningNotice from '../../components/MerchantWarningNotice';
import { MerchantLink } from '../../compare/components/MerchantLink';
import { SellingDistanceBadge } from '../../compare/components/SellingDistanceBadge';
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

/**
 * Enum value sets rendered through localized catalog labels (task 4.2).
 * Both mirror a database CHECK one-to-one — CATEGORY_KEYS the
 * `PRODUCT_CATEGORIES` constant behind `product_master_category_check`,
 * CONTAINER_TYPE_KEYS the `product_master_container_type_check` value set
 * — so an unknown storage key can never reach the catalog lookup and
 * surface as raw text.
 */
const CATEGORY_KEYS = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'intermediate_products',
  'other_fermented',
  'spirits',
] as const;

const CONTAINER_TYPE_KEYS = [
  'glass',
  'plastic',
  'metal',
  'carton',
  'can',
  'bottle',
  'other',
] as const;

function isCategoryKey(value: string): value is (typeof CATEGORY_KEYS)[number] {
  return (CATEGORY_KEYS as readonly string[]).includes(value);
}

function isContainerTypeKey(
  value: string,
): value is (typeof CONTAINER_TYPE_KEYS)[number] {
  return (CONTAINER_TYPE_KEYS as readonly string[]).includes(value);
}

// ── Stock availability display (task 4.1, change
//    client-experience-improvement) ──

/**
 * Stock states the availability badge renders — exactly the
 * `retail_offers.availability` states the feeds write. Any other value
 * ('unknown' or an unrecognized state) renders NO badge: honest absence,
 * never a guessed stock state (the design ladder's absence principle).
 */
const AVAILABILITY_STATES = ['in_stock', 'low_stock', 'out_of_stock'] as const;

type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

function isAvailabilityState(value: string): value is AvailabilityState {
  return (AVAILABILITY_STATES as readonly string[]).includes(value);
}

/**
 * Badge tone per stock state — the canonical ladder: observed-in-stock is
 * VERIFIED green, low stock is STALE amber, and out-of-stock is
 * UNAVAILABLE gray (absence, not danger — red stays reserved for errors).
 */
const AVAILABILITY_TONES = {
  in_stock: 'verified',
  low_stock: 'stale',
  out_of_stock: 'unavailable',
} as const satisfies Record<AvailabilityState, BadgeTone>;

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

/**
 * Factual detail string (brand, category, volume, ABV) for metadata. The
 * attributes render through the shared formatters (task 4.1) and the
 * category through its localized catalog label (task 4.2) — never a raw
 * storage key. The caller pre-resolves the label (it owns the
 * translator); an unknown or absent category contributes no part.
 */
function detailParts(
  detail: ProductDetailResponse,
  categoryLabel: string | null,
): string {
  return [
    detail.product.brand,
    categoryLabel,
    formatVolume(detail.product.unitVolume),
    formatAbv(detail.product.alcoholByVolume),
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');
}

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const { locale: rawLocale, id } = await params;
  // Routing serves fi and en only (localePrefix 'as-needed'); anything
  // else can only arrive through a hand-crafted request, which renders
  // as Finnish — the products-page precedent.
  const locale = rawLocale === 'en' ? 'en' : 'fi';
  const t = await getTranslations({ locale, namespace: 'ProductPage' });

  const productId = Number.parseInt(id, 10);
  const detail =
    Number.isInteger(productId) && productId > 0
      ? await getServerProductDetail(productId)
      : null;

  // Canonical + hreflang pair (design D6, change
  // localize-fi-route-pathnames): the URL is in hand regardless of the
  // product fetch, so both metadata branches emit it — the degraded
  // (unavailable) state still serves this URL.
  const alternates = localizedAlternates(locale, {
    pathname: '/products/[id]',
    params: { id },
  });

  // Unavailable product data (unknown id, closed launch gates, backend
  // down) degrades to generic metadata instead of erroring the response.
  if (detail === null) {
    return {
      title: t('notFoundTitle'),
      description: t('metaDescriptionFallback'),
      alternates,
    };
  }

  const categoryLabel = isCategoryKey(detail.product.category)
    ? t(`category.${detail.product.category}`)
    : null;

  return {
    title: t('metaTitle', { name: detail.product.name }),
    description: t('metaDescription', {
      name: detail.product.name,
      details: detailParts(detail, categoryLabel),
    }),
    alternates,
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
  // Shared attribute formatters (task 4.1): labelled volume ("50 cl")
  // and percentage ABV ("4.7 %"); a corrupt value renders no row, never
  // a placeholder.
  const volume = formatVolume(product.unitVolume);
  const abv = formatAbv(product.alcoholByVolume);
  // Enum values render through localized catalog labels (task 4.2);
  // unknown or absent values drop the row — never a raw storage key.
  const category = isCategoryKey(product.category)
    ? t(`category.${product.category}`)
    : null;
  const container = isContainerTypeKey(product.containerType)
    ? t(`containerType.${product.containerType}`)
    : null;
  const masterRows: Array<{ label: string; value: string }> = [
    { label: t('brandLabel'), value: product.brand },
    ...(category ? [{ label: t('categoryLabel'), value: category }] : []),
    ...(volume ? [{ label: t('volumeLabel'), value: volume }] : []),
    ...(container
      ? [{ label: t('containerLabel'), value: container }]
      : []),
    ...(abv ? [{ label: tCommon('abvLabel'), value: abv }] : []),
    ...(product.ean ? [{ label: t('eanLabel'), value: product.ean }] : []),
  ];

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-1 text-2xl font-bold text-primary-700">
        {product.name}
      </h1>
      <p className="mb-8 text-sm text-gray-500">
        {detailParts(detail, category)}
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
          // Wide-table containment: five columns exceed a phone viewport,
          // so the table scrolls inside its own container instead of
          // widening the document (the mobile journeys pin the
          // no-sideways-scroll invariant on this surface).
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="pb-2 pr-4 font-medium">{t('merchantHeader')}</th>
                <th className="pb-2 pr-4 font-medium">{t('priceHeader')}</th>
                <th className="pb-2 pr-4 font-medium">{t('availabilityHeader')}</th>
                <th className="pb-2 pr-4 font-medium">{t('countryHeader')}</th>
                <th className="pb-2 font-medium">{t('observedHeader')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {offers.map((offer) => {
                // Stock badge (task 4.1): the last observed availability as
                // a localized badge; an unknown state renders no badge.
                // Out-of-stock rows stay visible (price-history context)
                // but de-emphasized.
                const outOfStock = offer.availability === 'out_of_stock';
                const rowClasses = outOfStock
                  ? 'opacity-60'
                  : undefined;
                return (
                  <tr key={offer.id} className={rowClasses}>
                    <td className="py-2 pr-4 font-medium text-gray-900">
                      {/* Registry display name (fi-locale-surface-
                          hardening 2.5): the API resolves the name from
                          merchant_registry; an unregistered merchant or
                          a degraded lookup falls back to the raw id —
                          the row can never render blank. The identifier
                          stays the wire/link key. */}
                      {offer.merchantName ?? offer.merchant}
                      {/* Outbound CTA (task 2.2): routes through the shared
                          /api/v1/outbound/:offerId redirect controller, the
                          same click-recording path the compare page uses —
                          the redirect records the click server-side, so no
                          client callback rides along. Offers without a
                          source URL stay plain text. */}
                      {offer.sourceUrl && (
                        <span className="mt-1.5 block">
                          <MerchantLink
                            label={t('viewAtStore')}
                            offerId={offer.id}
                            variant="cta"
                          />
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {/* Locale money form (2.4); a non-EUR quote keeps
                          its currency code verbatim — no conversion is
                          invented for a rendered figure. */}
                      {offer.currency === 'EUR'
                        ? formatMoney(offer.priceCents, locale)
                        : `${(offer.priceCents / 100).toFixed(2)} ${offer.currency}`}
                    </td>
                    <td className="py-2 pr-4">
                      {isAvailabilityState(offer.availability) ? (
                        <Badge
                          tone={AVAILABILITY_TONES[offer.availability]}
                          size="sm"
                        >
                          {t(`availability.${offer.availability}`)}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4 text-gray-500">
                      {countryName(offer.country, locale)}
                      {/* Distance-selling status badge (task 4.2):
                          derived from the seller-country signal only —
                          FI seller → Etämyynti, foreign → Etäosto with
                          the guides link. Additive display field: it
                          never enters a calculation or ranking input,
                          and the framing note below states the general-
                          information, not-legal-advice boundary. */}
                      <span className="mt-1.5 block">
                        <SellingDistanceBadge
                          country={offer.country}
                          sellingLabel={t('distanceSellingBadge')}
                          buyingLabel={t('distanceBuyingBadge')}
                          guideHref={locale === 'en' ? '/en/guides' : '/guides'}
                        />
                      </span>
                    </td>
                    <td className="py-2 text-gray-500">
                      {formatObserved(offer.observedAt, locale)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            </table>
          </div>
        )}

        {/* ── Distance-selling framing (task 4.2): general information,
            not legal advice — empowering, never a warning. ── */}
        {offers.length > 0 ? (
          <p className="mt-3 text-xs text-gray-400">
            {t('distanceSellingNote')}
          </p>
        ) : null}
      </section>

      {/* ── Price-context line (insight-surfaces 3.3) — derives from the
          API's same current-best-price selection as the offers above, so
          the sentence and the panel cannot contradict each other; absent
          from the HTML when the context is unavailable ── */}
      <ProductPriceContextLine productId={productId} locale={locale} />

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
