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
 * Task 3.1 (price-history-latency): the page body starts ALL of its
 * server fetches — detail, price history, price-context, dupes — as
 * promises up front and awaits each only where its data is needed, so
 * the render is bounded by the slowest response rather than the sum of
 * four serialized round-trips. The context line and dupes panel are
 * presentational: the page owns their fetches; the null-degradation
 * contracts are unchanged.
 *
 * Streaming design (product-page-cold-latency 4.1): the shell and the
 * primary content (title, master data, offers) flush as soon as the
 * body's awaits resolve; the price-context line and the dupes panel
 * receive their still-pending promises and await them inside
 * `<Suspense fallback={null}>` boundaries — absent from the early
 * HTML, never a spinner or a skeleton shell (house stance: absent,
 * not an empty shell).
 *
 * The history section is the one deliberate non-streaming piece: it
 * stays awaited in the page body rather than moving behind a
 * Suspense-wrapped async child. Its null → absent conditional render
 * is part of this route's crawler-facing contract, and this repo's
 * harnesses can only pin that contract through real-flow renders (an
 * async child suspends indefinitely under Testing Library's client
 * render and aborts a renderToString pass), so the child would trade
 * real degradation coverage for a marginal streaming win over one
 * same-class concurrent D1 read — the read still starts concurrently
 * with the other three, so its latency overlaps theirs instead of
 * serializing after them.
 *
 * Caching contract (product-page-cold-latency 1.1): the route renders
 * on-demand ISR — revalidate 300, dynamicParams true, plus an empty
 * generateStaticParams. The first visit to each product renders the page
 * and caches the HTML in the OpenNext R2 incremental cache; later visits
 * inside the 300 s window serve that cached shell. This supersedes the
 * cache-headers task's earlier per-request verdict: its no-store outcome
 * was mechanical — a dynamic param without a build-time id catalog — not
 * age-gate policy, and on-demand ISR needs no build-time catalog. The
 * /account precedent applies: the cached HTML shell is shared, while
 * session/personalized state is client-side — favorites and alerts are
 * client components that resolve their state at mount.
 *
 * Why the empty generateStaticParams (fix round): Next 15.5 engages the
 * ISR fallback cache for a dynamic segment ONLY when the route exports
 * generateStaticParams — revalidate and dynamicParams alone keep it
 * per-request forever. An empty return + dynamicParams true means every
 * path renders on demand and enters the cache, with no build-time id
 * catalog built or wanted. Staging evidence (5.2): without the export
 * the deployed route still served `private, no-store` with warm TTFB
 * 1.29–2.09 s; with it, the first hit is `x-nextjs-cache: MISS`, the
 * next HIT at 0.011 s warm.
 *
 * Extraction (fi-path-isr 2.1): the page body, generateMetadata, and the
 * ISR segment config moved here from the `[locale]` route file, which
 * becomes a thin adapter. The module is locale-parameterized — an
 * explicit `locale` prop plus `{ id }`-shaped params — so the upcoming
 * root-level route (task 3.1) can render it with locale 'fi' and no
 * `[locale]` segment; nothing here reads the locale from params. The
 * `[locale]` route file (page.tsx) awaits its `{ locale, id }` params,
 * delegates, and carries its own copy of the segment config: Next reads
 * segment options from the route module itself, and the cache-headers
 * audit pins the ISR constants to that file's source. Behavior is
 * unchanged — this file renders exactly what the pre-extraction page
 * rendered, byte for byte.
 *
 * Structured data (seo-aeo-agent-surfaces 1.1): the page body renders
 * the safe no-Offer `Product` JSON-LD and the localized `BreadcrumbList`
 * plus a visible breadcrumb trail, built by the pure lib/seo builders
 * from the same resolved detail payload. Both route adapters inherit the
 * scripts through this shared module; the ISR segment config and cache
 * windows are untouched.
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
  getServerProductDetail,
  getServerPriceHistory,
  getServerProductPriceContext,
  getServerProductDupes,
} from '@/lib/server-api';
import { localizedAlternates } from '@/lib/i18n/localized-paths';
import {
  buildProductJsonLd,
  buildProductBreadcrumbJsonLd,
  productBreadcrumbPaths,
} from '@/lib/seo/product-structured-data';
import { formatAbv, formatVolume } from '@/lib/format/product-attributes';
import { formatMoney } from '@/lib/format/money';
import type { ProductDetailResponse } from '@/lib/types';
import { Badge, type BadgeTone } from '@/components/ui';
import MerchantWarningNotice from '../../components/MerchantWarningNotice';
import { MerchantLink } from '../../compare/components/MerchantLink';
import { SellingDistanceBadge } from '../../compare/components/SellingDistanceBadge';
import ProductAlertAction from './components/ProductAlertAction';
import ProductFavoriteAction from './components/ProductFavoriteAction';
import ProductDupesPanel from './components/ProductDupesPanel';
import ProductPriceContextLine from './components/ProductPriceContextLine';
import PriceHistoryChart from './components/PriceHistoryChart';

// On-demand ISR (product-page-cold-latency 1.1): the first visit to each
// product renders and caches in the OpenNext R2 incremental cache; later
// visits inside the window serve that shell. dynamicParams stays true
// explicitly so unknown ids keep rendering on demand — no build-time id
// catalog is required or wanted here.
export const revalidate = 300;
export const dynamicParams = true;

// The empty generateStaticParams is load-bearing, not vestigial (fix
// round): Next 15.5 engages the dynamic-segment ISR fallback cache only
// when the route exports it, so without this export the two constants
// above have no runtime effect (5.2 staging measured per-request
// rendering without it). Empty return + dynamicParams true = every path
// renders on demand. Sync shape, like the [locale] layout's export.
export function generateStaticParams() {
  return [];
}

interface ProductPageProps {
  /** The route's product id segment. */
  params: Promise<{ id: string }>;
  /**
   * Request locale, resolved by the caller from its own routing params —
   * deliberately NOT read from `params` here, so a route without a
   * `[locale]` segment (the upcoming root route) can supply it directly.
   */
  locale: string;
}

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

/**
 * Locale-appropriate date formatting for observation timestamps.
 */
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
  locale: rawLocale,
}: ProductPageProps): Promise<Metadata> {
  const { id } = await params;
  // Routing serves fi and en only (localePrefix 'as-needed'); anything
  // else can only arrive through a hand-crafted request, which renders
  // as Finnish — the products-page precedent. The caller resolves the
  // locale from its own routing params; normalization stays here so
  // every consumer degrades identically.
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

  // Enriched metadata (seo-aeo-agent-surfaces 1.4): the identifying
  // tokens (brand, localized category label, volume, ABV) flow through
  // the shared detailParts composition into BOTH the title and the
  // description — one composition, two templates, no drift. The degraded
  // branch above keeps its pinned fallback copy untouched.
  const details = detailParts(detail, categoryLabel);

  return {
    title: t('metaTitle', { name: detail.product.name, details }),
    description: t('metaDescription', {
      name: detail.product.name,
      details,
    }),
    alternates,
  };
}

export default async function ProductPage({
  params,
  locale,
}: ProductPageProps) {
  const { id } = await params;
  const t = await getTranslations({ locale, namespace: 'ProductPage' });
  const tCommon = await getTranslations({ locale, namespace: 'Common' });

  const productId = Number.parseInt(id, 10);
  if (!Number.isInteger(productId) || productId <= 0) {
    notFound();
  }

  // Task 3.1 (price-history-latency): all four server fetches start
  // here, concurrently, before any await — detail, history, price-context,
  // dupes. Detail and history are awaited here (streaming-design note in
  // the module docblock); the context and dupes promises are handed to
  // their sections below and awaited inside the page's Suspense
  // boundaries (product-page-cold-latency 4.1).
  const detailPromise = getServerProductDetail(productId);
  const historyPromise = getServerPriceHistory(productId);
  const contextPromise = getServerProductPriceContext(productId);
  const dupesPromise = getServerProductDupes(productId);

  const detail = await detailPromise;
  if (detail === null) {
    notFound();
  }

  // Price history (task 5.1) — fetched once, widest window; null on any
  // failure, and the chart component itself renders nothing for an
  // empty series, so the section is absent exactly when there is no
  // history to show. Deliberately awaited with the shell (see the
  // streaming-design note in the module docblock).
  const priceHistory = await historyPromise;

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

  // ── Structured data (seo-aeo-agent-surfaces 1.1) — the safe no-Offer
  // Product graph (design D1: collected observations are not merchant
  // offers) and the localized BreadcrumbList pair, composed by the pure
  // lib/seo builders from this same resolved payload. Absent data omits
  // its property (no EAN → no gtin13, unknown container key → no
  // container entry, no updated_at → no dateModified) — the schema never
  // exceeds what the page renders. Both route adapters (the physical
  // /tuotteet/<id> and the [locale] one) inherit the scripts through
  // this shared module (design D2); they ride the cached ISR shell, so
  // the revalidate contract is untouched.
  const productJsonLd = buildProductJsonLd({
    product,
    id,
    locale,
    labels: {
      volumeLabel: t('volumeLabel'),
      abvLabel: tCommon('abvLabel'),
      containerLabel: t('containerLabel'),
      containerTypeLabel: container,
    },
  });
  const breadcrumbJsonLd = buildProductBreadcrumbJsonLd({
    id,
    locale,
    productName: product.name,
    homeLabel: t('breadcrumbHomeLabel'),
    catalogLabel: t('breadcrumbCatalogLabel'),
  });
  // The visible trail renders the same three localized destinations the
  // schema carries — one URL vocabulary (productBreadcrumbPaths).
  const breadcrumbPaths = productBreadcrumbPaths(id, locale);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Breadcrumb trail (seo-aeo-agent-surfaces 1.1) — the visible
          pair of the BreadcrumbList schema below: same destinations,
          localized labels, the house metadata-line styling. ── */}
      <p className="mb-4 text-xs text-gray-400">
        <a
          className="hover:text-gray-600 hover:underline"
          href={breadcrumbPaths.home}
        >
          {t('breadcrumbHomeLabel')}
        </a>
        {' › '}
        <a
          className="hover:text-gray-600 hover:underline"
          href={breadcrumbPaths.catalog}
        >
          {t('breadcrumbCatalogLabel')}
        </a>
        {' › '}
        <span aria-current="page">{product.name}</span>
      </p>

      {/* ── The graphs themselves (LocaleChrome script-tag pattern) ── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

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

      {/* ── Price-context line (insight-surfaces 3.3) — the page hands
          down the still-pending promise (product-page-cold-latency 4.1)
          and the line awaits it inside this boundary, so the sentence
          streams after the shell instead of delaying it. Derives from
          the API's same current-best-price selection as the offers
          above, so the sentence and the panel cannot contradict each
          other; a promise that resolves null (failed fetch) renders
          nothing — absent from the HTML, never an empty shell. ── */}
      <React.Suspense fallback={null}>
        <ProductPriceContextLine payload={contextPromise} locale={locale} />
      </React.Suspense>

      {/* ── Price history (task 5.1) — server-fetched series, client
          range views; renders NOTHING when there is no history.
          Deliberately awaited with the shell, not streamed — see the
          streaming-design note in the module docblock. ── */}
      {priceHistory !== null && <PriceHistoryChart history={priceHistory} />}

      {/* ── Producer dupe panel — the page hands down the still-pending
          promise (product-page-cold-latency 4.1), awaited inside the
          boundary; absent from the HTML when no curated links exist or
          the fetch degraded to null (design R9) ── */}
      <React.Suspense fallback={null}>
        <ProductDupesPanel dupes={dupesPromise} />
      </React.Suspense>

      {/* ── Favorite heart (task 4.3) — mount-time membership check,
          optimistic toggle, login-modal funnel for signed-out taps ── */}
      <ProductFavoriteAction productId={productId} />

      {/* ── Price-alert action ── */}
      <ProductAlertAction productId={productId} />

      <p className="text-xs text-gray-400">{t('landingNote')}</p>
    </main>
  );
}
