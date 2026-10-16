/**
 * Product-page deterministic Q&A block (seo-aeo-agent-surfaces 2.1,
 * design D4).
 *
 * Composes two to three factual question/answer pairs from the payloads
 * the page already renders — templates only, no LLM, no external text
 * generation, so every emitted claim stays traceable to stored data and
 * the copy remains content-lint enforceable:
 *
 *   - the price pair reads the price-context payload's current-best
 *     selection (the same figure, and the same "matalin nykyinen
 *     myyntihinta" / "lowest current offer price" term, that
 *     ProductPriceContextLine renders above — the two cannot
 *     contradict), rendered through formatMoney like the offers table;
 *   - the ABV and package-size pairs read the master data through the
 *     shared formatters (formatAbv / formatVolume), exactly as the
 *     master-data rows render them.
 *
 * Absence contract (the house stance): a question whose input is absent
 * or degraded is absent from the block — a null context payload drops
 * the price pair entirely, an unparseable volume or ABV drops its pair,
 * and a block with zero pairs renders nothing (never an empty shell).
 * The price-context promise is the page's still-pending hand-down
 * (product-page-cold-latency 4.1): awaited inside the page's Suspense
 * boundary, so the block streams after the shell, never a spinner.
 *
 * The task-2.2 seam: composeProductFaqPairs is exported and pure, and
 * THIS module feeds its output to the FAQPage builder (lib/seo
 * buildProductFaqJsonLd) — the graph is a structural mirror of the
 * pairs rendered here, not a DOM scrape, so the schema's pairs equal
 * the visibly rendered ones one-to-one and the schema can never exceed
 * visible content. The script renders inside this same Suspense
 * boundary, right after the visible block (streaming together), and a
 * zero-pair block emits no section AND no script — the FAQPage node
 * exists only when the block does (the spec's only-when-rendered rule).
 *
 * No new message keys: the graph carries the pair strings verbatim.
 *
 * @module ProductFaqPanel
 */

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { getTranslations } from 'next-intl/server';
import type { ProductDetail } from '@/lib/types';
import { formatAbv, formatVolume } from '@/lib/format/product-attributes';
import { formatMoney } from '@/lib/format/money';
import { buildProductFaqJsonLd } from '@/lib/seo/product-faq-structured-data';
import type { ProductPriceContextResponse } from '../price-context';

// ---------------------------------------------------------------------------
// The compose seam (task 2.2 mirrors these pairs into FAQPage JSON-LD)
// ---------------------------------------------------------------------------

/** The minimal translator surface the composition needs — the values
 * shape mirrors next-intl's Translator so the panel can pass its
 * resolved translator straight through. */
export type ProductFaqTranslator = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string;

/** One visible question/answer pair — the unit the FAQPage schema mirrors. */
export interface ProductFaqPair {
  readonly question: string;
  readonly answer: string;
}

export interface ProductFaqInput {
  /** The product's stored identity + attributes (master data). */
  readonly product: Pick<
    ProductDetail,
    'name' | 'unitVolume' | 'alcoholByVolume'
  >;
  /**
   * The price-context payload's current-best price in raw cents — the
   * exact value ProductPriceContextLine renders. null when the payload
   * degraded to null (failed fetch, unexpected shape): the price pair
   * then contributes nothing.
   */
  readonly currentBestPriceCents: number | null;
  /** The serving locale — the money figure renders through formatMoney. */
  readonly locale: string;
}

/**
 * Compose the visible Q&A pairs, in the panel's stable order (price,
 * ABV, package size); an absent input contributes no pair. Pure and
 * deterministic — identical inputs yield identical pairs, which is what
 * lets the task-2.2 JSON-LD mirror the rendered block by calling this
 * function with the same data instead of scraping the DOM.
 */
export function composeProductFaqPairs(
  input: ProductFaqInput,
  t: ProductFaqTranslator,
): readonly ProductFaqPair[] {
  const { product, currentBestPriceCents, locale } = input;
  const pairs: ProductFaqPair[] = [];

  if (currentBestPriceCents !== null) {
    pairs.push({
      question: t('faqPriceQuestion', { name: product.name }),
      answer: t('faqPriceAnswer', {
        price: formatMoney(currentBestPriceCents, locale),
      }),
    });
  }
  const abv = formatAbv(product.alcoholByVolume);
  if (abv !== null) {
    pairs.push({
      question: t('faqAbvQuestion', { name: product.name }),
      answer: t('faqAbvAnswer', { abv }),
    });
  }
  const volume = formatVolume(product.unitVolume);
  if (volume !== null) {
    pairs.push({
      question: t('faqVolumeQuestion'),
      answer: t('faqVolumeAnswer', { volume }),
    });
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// The rendered block
// ---------------------------------------------------------------------------

interface ProductFaqPanelProps {
  /**
   * The page's already-resolved detail payload — the shell awaits the
   * detail fetch before rendering any section, so the attribute pairs
   * derive from data in hand.
   */
  readonly product: ProductDetail;
  /**
   * The page's still-pending price-context promise (product-page-cold-
   * latency 4.1: the page starts all its server fetches concurrently and
   * hands the promise down; the panel awaits it inside the page's
   * Suspense boundary, so the block streams after the shell instead of
   * delaying it). A promise that resolves null — failed fetch, 404 when
   * the product's current offers are gone, unexpected shape — drops the
   * price pair: absent from the block, never a placeholder.
   */
  readonly payload: Promise<ProductPriceContextResponse | null>;
  /** The active request locale — copy and money form follow it. */
  readonly locale: string;
}

/**
 * Server component; the whole block streams behind the page's Suspense
 * boundary and renders NOTHING when no pair survives the absence
 * contract (no price context, no parseable ABV, no parseable volume).
 */
export default async function ProductFaqPanel({
  product,
  payload: payloadPromise,
  locale,
}: ProductFaqPanelProps) {
  const payload = await payloadPromise;
  const t = await getTranslations({ locale, namespace: 'ProductPage' });

  const pairs = composeProductFaqPairs(
    {
      product,
      currentBestPriceCents:
        payload === null ? null : payload.currentBestPriceCents,
      locale,
    },
    t,
  );
  // The builder's typed zero-pair outcome IS the absence guard: an
  // empty block renders neither the section nor a FAQPage script.
  const faqJsonLd = buildProductFaqJsonLd(pairs);
  if (faqJsonLd === null) {
    return null;
  }

  return (
    <>
      <section
        data-testid="product-faq-section"
        className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          {t('faqHeading')}
        </h2>
        <dl className="space-y-4">
          {pairs.map((pair) => (
            <div key={pair.question} data-testid="product-faq-pair">
              <dt className="text-sm font-medium text-gray-700">
                {pair.question}
              </dt>
              <dd className="mt-1 text-sm text-gray-500">{pair.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
      {/* ── The FAQPage mirror (seo-aeo-agent-surfaces 2.2) — built from
          the very pairs array above (structural, never scraped), so it
          equals the visible block one-to-one in the same order and
          locale; rendered inside this boundary right after the block,
          so the schema streams with the content it mirrors. ── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </>
  );
}
