'use client';

/**
 * BasketComparisonSection — store-grouped multi-store comparison view.
 *
 * Gated behind the BASKET_OPTIMIZATION feature flag, whose state arrives
 * inlined with the initial HTML payload.  When hidden, renders nothing —
 * at the correct visibility from the first render.  When visible, provides
 * a product-search → basket-builder → optimize → store-grouped-results flow
 * that mirrors the basket page's patterns but is integrated into the compare
 * page context.
 *
 * **Neutrality**: every store card is visually identical.  No visual preference
 * cues beyond objective cost ordering (total ascending).  Sorting is applied
 * by the API, not by client-side reordering.
 *
 * **Disclaimer**: rendered from the API response (structural), never as a
 * UI-only string.
 *
 * @module BasketComparisonSection
 */

import { useState, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { ProductSearchItem } from '@/lib/types';
import type {
  BasketOptimizationResult,
  BasketItemInput,
  TransportArrangement,
  BasketShipment,
  ConsolidatedTransport,
  ConsolidatedTransportReliability,
  MinimumOrderThresholdCheck,
} from '@/lib/basket.types';
import type { ConfidenceLevel, ReliabilityStatus } from '@/lib/types';
import { searchProducts } from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';
import { optimizeBasket, classifyBasketError } from '@/lib/basket.client';
import {
  CONFIDENCE_LEVEL_META,
  RELIABILITY_STATUS_META,
} from '@/lib/design/status';
import {
  Badge,
  Button,
  Card,
  ConfidenceBadge,
  ReliabilityBadge,
} from '@/components/ui';
import type { BadgeTone } from '@/components/ui';
import ProductSearch from '../../calculator/components/ProductSearch';
import ProductSelector from '../../calculator/components/ProductSelector';
import QuantitySelector from '../../calculator/components/QuantitySelector';
import DisclaimerBanner from '../../calculator/components/DisclaimerBanner';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ITEMS = 10;
const MIN_QUERY_LENGTH = 2;
const DEFAULT_DESTINATION = 'FI';

const COUNTRY_CODES: readonly string[] = [
  'FI',
  'EE',
  'LV',
  'LT',
  'DE',
  'SE',
  'DK',
  'PL',
  'NL',
  'BE',
  'FR',
  'ES',
  'IT',
  'AT',
  'CZ',
];

const TRANSPORT_VALUES: readonly TransportArrangement[] = [
  'SELLER_ARRANGED',
  'INDEPENDENT_CARRIER',
  'PERSONAL',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format cents to a euro string. */
function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Badge/label conventions — matches BasketResults and CalculatorResult
// ---------------------------------------------------------------------------

/**
 * Transport reliability is a domain enum the shared status module does not
 * key, so it maps onto the canonical ladder tones (EXACT → verified green,
 * ESTIMATED → estimated blue, PARTIAL → error red); every colour class
 * itself comes from the shared module via the Badge primitive.
 */
const TRANSPORT_RELIABILITY_TONE: Record<
  ConsolidatedTransportReliability,
  BadgeTone
> = {
  EXACT: 'verified',
  ESTIMATED: 'estimated',
  PARTIAL: 'error',
};

// ---------------------------------------------------------------------------
// Sub-components (following BasketResults conventions)
// ---------------------------------------------------------------------------

/** Reliability badge matching BasketResults/CalculatorResult. */
function LocalizedReliabilityBadge({ status }: { status: ReliabilityStatus }) {
  const tAll = useTranslations();
  return (
    <ReliabilityBadge status={status}>
      {tAll(RELIABILITY_STATUS_META[status].labelKey)}
    </ReliabilityBadge>
  );
}

/** Transport reliability badge. */
function TransportReliabilityBadge({
  reliability,
}: {
  reliability: ConsolidatedTransportReliability;
}) {
  const tCommon = useTranslations('Common');
  const tBasket = useTranslations('BasketCommon');
  return (
    <Badge tone={TRANSPORT_RELIABILITY_TONE[reliability]} size="sm">
      {reliability === 'ESTIMATED'
        ? tCommon('reliability.ESTIMATED')
        : tBasket(`transportReliability.${reliability}`)}
    </Badge>
  );
}

/** Confidence badge. */
function LocalizedConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const tAll = useTranslations();
  return (
    <ConfidenceBadge level={level}>
      {tAll(CONFIDENCE_LEVEL_META[level].labelKey)}
    </ConfidenceBadge>
  );
}

/** Threshold check line. */
function ThresholdCheckLine({
  thresholdCheck,
}: {
  thresholdCheck: MinimumOrderThresholdCheck;
}) {
  const t = useTranslations('BasketCommon');
  if (thresholdCheck.minimumOrderValueCents === null) {
    return (
      <p className="text-xs text-gray-400">{t('thresholdUnknown')}</p>
    );
  }
  const meets = thresholdCheck.meetsThreshold;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-500">
        {t('minimumOrder', {
          value: formatEur(thresholdCheck.minimumOrderValueCents),
        })}
      </span>
      {meets ? (
        <span className="text-green-700">{t('met')}</span>
      ) : (
        <span className="text-red-700">{t('notMet')}</span>
      )}
      {thresholdCheck.termsReliability && (
        <span className="text-gray-400">
          ({thresholdCheck.termsReliability})
        </span>
      )}
    </div>
  );
}

/** Consolidated transport section for a shipment. */
function TransportSection({ transport }: { transport: ConsolidatedTransport }) {
  const tCommon = useTranslations('Common');
  return (
    <div className="mt-3 rounded-md bg-gray-50 px-3 py-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-gray-700">
            {tCommon('transport')}
          </p>
          <p className="text-xs text-gray-500">
            {transport.weightTier} · {transport.packageTier}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm tabular-nums text-gray-700">
            {formatEur(transport.totalCents)}
          </span>
          <TransportReliabilityBadge reliability={transport.reliability} />
        </div>
      </div>
    </div>
  );
}

/** Per-item cost line in a shipment. */
function ShipmentItemCost({
  label,
  cents,
  reliability,
}: {
  label: string;
  cents: number;
  reliability: ReliabilityStatus;
}) {
  const dot = RELIABILITY_STATUS_META[reliability].dot;
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 ${dot}`}
        />
        <span className="text-sm text-gray-700">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm tabular-nums text-gray-600">
          {formatEur(cents)}
        </span>
        <LocalizedReliabilityBadge status={reliability} />
      </div>
    </div>
  );
}

/** One shipment card — identical visual weight per store. */
function ShipmentCard({ shipment }: { shipment: BasketShipment }) {
  return (
    <Card padding="sm">
      {/* Merchant header */}
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {shipment.merchant}
          </h3>
          <p className="text-xs text-gray-500">{shipment.country}</p>
        </div>
        <span className="text-sm font-semibold tabular-nums text-gray-900">
          {formatEur(shipment.retailSubtotalCents)}
        </span>
      </div>

      {/* Per-item costs */}
      <div className="divide-y divide-gray-100">
        {shipment.items.map((item, i) => (
          <ShipmentItemCost
            key={`${item.label}-${i}`}
            label={item.label}
            cents={item.cents}
            reliability={item.reliability}
          />
        ))}
      </div>

      {/* Transport */}
      <TransportSection transport={shipment.consolidatedTransport} />

      {/* Threshold check */}
      <div className="mt-2">
        <ThresholdCheckLine thresholdCheck={shipment.thresholdCheck} />
      </div>
    </Card>
  );
}

/** Confidence breakdown list. */
function ConfidenceBreakdown({
  breakdown,
}: {
  breakdown: readonly {
    readonly status: ReliabilityStatus;
    readonly detail: string;
    readonly inputName?: string;
  }[];
}) {
  const t = useTranslations('BasketResults');
  if (breakdown.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {t('dataReliability')}
      </h3>
      <ul className="space-y-1">
        {breakdown.map((detail, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span
              className={`mt-0.5 inline-block h-1.5 w-1.5 shrink-0 ${RELIABILITY_STATUS_META[detail.status].dot}`}
            />
            <span className="text-gray-600">{detail.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Metadata section for a result. */
function ResultMetadata({
  metadata,
}: {
  metadata: {
    readonly calculationTimestamp: string;
    readonly datasetVersions: readonly string[];
    readonly calculationRecordId: number | null;
  };
}) {
  const tCommon = useTranslations('Common');
  return (
    <div className="rounded-md bg-gray-50 px-3 py-2">
      <dl className="space-y-1 text-xs text-gray-500">
        <div className="flex justify-between">
          <dt>{tCommon('calculatedAt')}</dt>
          <dd className="tabular-nums">
            {new Date(metadata.calculationTimestamp).toLocaleString('fi-FI')}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>{tCommon('datasetVersions')}</dt>
          <dd className="tabular-nums">
            {metadata.datasetVersions.length > 0
              ? metadata.datasetVersions.join(', ')
              : '—'}
          </dd>
        </div>
        {metadata.calculationRecordId !== null && (
          <div className="flex justify-between">
            <dt>{tCommon('recordId')}</dt>
            <dd className="tabular-nums">#{metadata.calculationRecordId}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Multi-store comparison section for the compare page.
 *
 * Orchestrates the feature-flag gate, product search, basket builder, API
 * call, and store-grouped result rendering with per-item figures, transport,
 * threshold checks, confidence, and the structural disclaimer.
 */
export default function BasketComparisonSection() {
  const t = useTranslations('BasketComparison');
  const tBasket = useTranslations('BasketCommon');
  const tPage = useTranslations('BasketPage');
  const tCommon = useTranslations('Common');
  const tResults = useTranslations('BasketResults');
  const tCalc = useTranslations('Calculator');

  // ── Feature flag (inlined with the initial HTML payload) ──
  const flags = useFeatureFlags();
  const flagEnabled = flags.flags.BASKET_OPTIMIZATION;

  // ── Search state ──
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductSearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // ── Basket builder state ──
  const [items, setItems] = useState<
    { productId: number; productName: string; quantity: number }[]
  >([]);
  const [destination, setDestination] = useState(DEFAULT_DESTINATION);
  const [transportArrangement, setTransportArrangement] =
    useState<TransportArrangement>('SELLER_ARRANGED');

  // ── Optimization state ──
  const [optimizing, setOptimizing] = useState(false);
  const [result, setResult] = useState<BasketOptimizationResult | null>(null);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);

  const searchInFlight = useRef(false);
  const optimizeInFlight = useRef(false);

  // ── Search handler ──
  const handleSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < MIN_QUERY_LENGTH || searchInFlight.current) return;

    searchInFlight.current = true;
    setSearchLoading(true);
    setSearchError(null);

    try {
      const res = await searchProducts(trimmed);
      setSearchResults(res.items);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : tCalc('searchFailed');
      setSearchError(message);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
      searchInFlight.current = false;
    }
  }, [tCalc]);

  // ── Add item to basket ──
  const handleAddItem = useCallback(
    (productId: number, productName: string) => {
      setItems((prev) => {
        if (prev.length >= MAX_ITEMS) return prev;
        const existing = prev.find((i) => i.productId === productId);
        if (existing) {
          return prev.map((i) =>
            i.productId === productId
              ? { ...i, quantity: Math.min(i.quantity + 1, 99) }
              : i,
          );
        }
        return [...prev, { productId, productName, quantity: 1 }];
      });
      setResult(null);
      setOptimizeError(null);
      setQuery('');
      setSearchResults([]);
    },
    [],
  );

  // ── Select product from search results ──
  const handleSelectProduct = useCallback(
    (item: ProductSearchItem) => {
      handleAddItem(item.id, item.name);
    },
    [handleAddItem],
  );

  // ── Update quantity ──
  const handleUpdateQuantity = useCallback(
    (productId: number, quantity: number) => {
      setItems((prev) =>
        prev.map((i) =>
          i.productId === productId
            ? { ...i, quantity: Math.max(1, Math.min(99, quantity)) }
            : i,
        ),
      );
    },
    [],
  );

  // ── Remove item ──
  const handleRemoveItem = useCallback((productId: number) => {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
    setResult(null);
    setOptimizeError(null);
  }, []);

  // ── Optimize ──
  const handleOptimize = useCallback(async () => {
    if (items.length === 0 || optimizeInFlight.current) return;

    optimizeInFlight.current = true;
    setOptimizing(true);
    setOptimizeError(null);
    setResult(null);

    try {
      const input: BasketItemInput[] = items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      }));
      const res = await optimizeBasket({
        items: input,
        destination,
        transportArrangement,
      });
      setResult(res);
    } catch (err: unknown) {
      const { kind } = classifyBasketError(err);
      setOptimizeError(tPage(`errors.${kind}`));
    } finally {
      setOptimizing(false);
      optimizeInFlight.current = false;
    }
  }, [items, destination, transportArrangement, tPage]);

  // ── Hidden states (after all hooks — early returns above them break
  // React's hook-order invariant) ──
  if (!flagEnabled) return null;

  const atCapacity = items.length >= MAX_ITEMS;
  const canOptimize = items.length > 0 && !optimizing;

  return (
    <section className="mt-8 space-y-6">
      {/* ── Section heading ── */}
      <div>
        <h2 className="text-lg font-semibold text-primary-700">{t('title')}</h2>
        <p className="text-sm text-gray-500">{t('subtitle')}</p>
      </div>

      {/* ── Product search ── */}
      <Card padding="sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">
          {tBasket('addProducts')}
        </h3>

        {atCapacity ? (
          <p className="text-sm text-amber-700">
            {tBasket('basketFull', { max: MAX_ITEMS })}
          </p>
        ) : (
          <>
            <div className="mb-3">
              <ProductSearch
                value={query}
                onChange={setQuery}
                onSubmit={handleSearch}
                loading={searchLoading}
                error={searchError}
              />
            </div>

            {searchResults.length > 0 && (
              <ProductSelector
                items={searchResults}
                selectedId={null}
                onSelect={handleSelectProduct}
                loading={searchLoading}
                query={query}
              />
            )}
          </>
        )}
      </Card>

      {/* ── Current basket items ── */}
      <Card padding="sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">
            {tBasket('basketTitle', { count: items.length, max: MAX_ITEMS })}
          </h3>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-gray-400">{tBasket('emptyBasket')}</p>
        ) : (
          <>
            {atCapacity && (
              <p className="mb-3 text-xs text-amber-600">
                {tBasket('maxReached', { max: MAX_ITEMS })}
              </p>
            )}

            <ul className="divide-y divide-gray-100">
              {items.map((item) => (
                <li
                  key={item.productId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {item.productName}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <QuantitySelector
                      value={item.quantity}
                      onChange={(q) => handleUpdateQuantity(item.productId, q)}
                      min={1}
                      max={99}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.productId)}
                      className="text-xs font-medium text-red-600 hover:text-red-800"
                      aria-label={tBasket('removeAria', { name: item.productName })}
                    >
                      {tCommon('remove')}
                    </button>
                  </div>
                </li>
              ))}
             </ul>
          </>
        )}
      </Card>

      {/* ── Destination ── */}
      <Card padding="sm">
        <label
          htmlFor="basket-comparison-destination"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          {tBasket('destination')}
        </label>
        <select
          id="basket-comparison-destination"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          {COUNTRY_CODES.map((code) => (
            <option key={code} value={code}>
              {tCommon(`countries.${code}`)}
            </option>
          ))}
        </select>
      </Card>

      {/* ── Transport arrangement ── */}
      <Card padding="sm">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-700">
            {tBasket('transportTitle')}
          </legend>
          <div className="space-y-2">
            {TRANSPORT_VALUES.map((value) => (
              <label
                key={value}
                className="flex items-center gap-2 text-sm text-gray-700"
              >
                <input
                  type="radio"
                  name="basket-transport-arrangement"
                  value={value}
                  checked={transportArrangement === value}
                  onChange={() => setTransportArrangement(value)}
                  className="text-primary-600 focus:ring-primary-500"
                />
                {tBasket(`transport.${value}`)}
                {value === 'PERSONAL' && (
                  <span className="text-xs text-gray-400">
                    {tBasket('personalNote')}
                  </span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      {/* ── Optimize button ── */}
      <div>
        <Button size="lg" fullWidth onClick={handleOptimize} disabled={!canOptimize}>
          {optimizing ? tPage('optimizing') : t('compareButton')}
        </Button>

        {optimizeError && (
          <p className="mt-2 text-sm text-error">{optimizeError}</p>
        )}
      </div>

      {/* ── Results ── */}
      {result && (
        <div className="space-y-6">
          {/* Recommended combination */}
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {t('comparisonTitle')}
                </h3>
                <p className="mt-0.5 text-2xl font-bold tabular-nums text-primary-700">
                  {formatEur(result.totalCents)}
                </p>
              </div>
              <LocalizedConfidenceBadge level={result.confidence} />
            </div>

            {/* Store-grouped cards */}
            {result.shipments.map((shipment) => (
              <ShipmentCard key={shipment.merchant} shipment={shipment} />
            ))}

            {/* Confidence breakdown */}
            {result.confidenceBreakdown.length > 0 && (
              <ConfidenceBreakdown breakdown={result.confidenceBreakdown} />
            )}

            {/* Disclaimer — structural, from the API response */}
            <DisclaimerBanner disclaimer={result.disclaimer} />

            {/* Metadata */}
            <ResultMetadata metadata={result.metadata} />
          </div>

          {/* ── Alternatives — neutral, cost-ordered, no visual preference cues ── */}
          {result.alternatives.length > 0 && (
            <div>
              <h3 className="mb-4 text-base font-semibold text-gray-700">
                {t('alternativesTitle')}
              </h3>
              <div className="divide-y divide-gray-200">
                {result.alternatives.map((alt, i) => (
                  <div key={i} className="py-4 first:pt-0 last:pb-0">
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900">
                            {tResults('alternative', { index: i + 1 })}
                          </h4>
                          <p className="mt-0.5 text-xl font-bold tabular-nums text-primary-700">
                            {formatEur(alt.totalCents)}
                          </p>
                        </div>
                        <LocalizedConfidenceBadge level={alt.confidence} />
                      </div>

                      {alt.shipments.map((shipment) => (
                        <ShipmentCard
                          key={shipment.merchant}
                          shipment={shipment}
                        />
                      ))}

                      {alt.confidenceBreakdown.length > 0 && (
                        <ConfidenceBreakdown breakdown={alt.confidenceBreakdown} />
                      )}

                      <DisclaimerBanner disclaimer={alt.disclaimer} />
                      <ResultMetadata metadata={alt.metadata} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
