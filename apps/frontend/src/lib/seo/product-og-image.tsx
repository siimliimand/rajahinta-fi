/**
 * Per-product Open Graph image composition (seo-aeo-agent-surfaces 1.7).
 *
 * Pure module — no fetches, no `next/og`, no next-intl — exactly the
 * purity rationale of the sibling product-structured-data builders: the
 * two route adapters (`tuotteet/[id]/opengraph-image.tsx` and
 * `[locale]/products/[id]/opengraph-image.tsx`) resolve the data (fetch,
 * translator, category guard) and call {@link productOgImageElement}
 * here, so the composition itself stays unit-testable.
 *
 * IDENTITY-ONLY, PINNED BY SPEC: the image renders the product name,
 * brand, and localized category label — and NOTHING else. No price, no
 * availability, no observation dates, no counts: the OG image is cached
 * far longer than the 300 s price window, so any volatile figure would
 * outlive its truth. The guarantee is structural — {@link ProductOgIdentity}
 * has no other fields, and {@link productOgIdentity} projects a
 * `ProductDetailResponse` (offers, prices, timestamps and all) down to
 * exactly those three, so volatile payload fields cannot reach the
 * composition even by accident.
 *
 * Degradation contract (spec: optional fields absent → composition
 * degrades, render never fails): a null brand or unknown category
 * contributes no element; a failed/null detail fetch degrades to the
 * static site composition (wordmark only — no invented product copy).
 *
 * Render constraints mirror `app/opengraph-image.tsx`: Satori supports
 * inline styles only, and the token values from globals.css are mirrored
 * as literals (gray-900 #111827, gray-600 #4b5563, gray-200 #e5e7eb,
 * primary-700 #1d4ed8) with the bundled default font — no network font
 * fetch at build. The square initial mark reuses the Logo geometry.
 *
 * The composition takes no `locale`: every string arrives pre-localized
 * (name and brand are stored data; the category label the adapter
 * resolves through ProductPage translations), and the identity-only rule
 * leaves nothing else to localize.
 *
 * @module LibSeoProductOgImage
 */

// Namespace import: vitest's esbuild transform emits classic JSX
// (products/page.tsx precedent), so the module scope needs React.
import * as React from 'react';

// ---------------------------------------------------------------------------
// Segment facts the route adapters re-declare as static exports (Next reads
// the image route's exports from the route module itself; keep in sync)
// ---------------------------------------------------------------------------

/** 1200×630 — the OG image canvas every social crawler expects. */
export const PRODUCT_OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/** Satori's only output format. */
export const PRODUCT_OG_IMAGE_CONTENT_TYPE = 'image/png' as const;

// ---------------------------------------------------------------------------
// Canonical category keys — the same D1 CHECK the rest of the app mirrors
// ---------------------------------------------------------------------------

/**
 * Canonical product categories, one-to-one with `PRODUCT_CATEGORIES`
 * behind `product_master_category_check` (packages/data-platform). This
 * is the third frontend mirror of the set — `product-page.tsx` guards its
 * localized rows with a private copy, `sitemap-entries.ts` guards its
 * catalog filters with another; the frontend cannot import the worker
 * module, so the copies are the mechanism. Keep the three in sync.
 */
export const PRODUCT_CATEGORY_KEYS = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'intermediate_products',
  'other_fermented',
  'spirits',
] as const;

export type ProductCategoryKey = (typeof PRODUCT_CATEGORY_KEYS)[number];

/**
 * Storage-key guard: an unknown key never reaches the translator (which
 * would surface a raw storage key or a missing-message marker in the
 * image) — the label contributes nothing instead.
 */
export function isProductCategoryKey(value: string): value is ProductCategoryKey {
  return (PRODUCT_CATEGORY_KEYS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Identity projection — the structural identity-only guarantee
// ---------------------------------------------------------------------------

/** The exact identity fields the OG image may render — nothing else. */
export interface ProductOgIdentity {
  /** Stored product name; null only when the detail fetch failed. */
  readonly name: string | null;
  /** Stored brand; null when absent or empty (the JSON-LD parity rule). */
  readonly brand: string | null;
  /**
   * Localized category label, pre-resolved by the adapter; null when the
   * key is unknown or the label absent — never a raw storage key.
   */
  readonly categoryLabel: string | null;
}

/**
 * Project a resolved product detail down to the identity triple. The
 * input carries offers, prices, and observation timestamps — none of
 * which survive the projection, which is the point: the image's inputs
 * are typed so volatility cannot leak in. `detail` null (failed fetch)
 * yields the all-null identity that renders the static composition.
 */
export function productOgIdentity(
  detail: {
    readonly product: {
      readonly name: string;
      readonly brand: string;
    };
  } | null,
  categoryLabel: string | null,
): ProductOgIdentity {
  if (detail === null) {
    return { name: null, brand: null, categoryLabel: null };
  }
  return {
    name: detail.product.name,
    brand: detail.product.brand !== '' ? detail.product.brand : null,
    categoryLabel,
  };
}

// ---------------------------------------------------------------------------
// The composition — pure JSX, Satori-safe (inline styles only)
// ---------------------------------------------------------------------------

/** Literal mirrors of the globals.css tokens (see the module docblock). */
const GRAY_900 = '#111827';
const GRAY_600 = '#4b5563';
const GRAY_200 = '#e5e7eb';
const PRIMARY_700 = '#1d4ed8';

/** Style fragments for the square initial mark (Logo geometry). */
function markStyle(size: number, fontSize: number) {
  return {
    height: size,
    width: size,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY_700,
    borderRadius: 6,
    color: '#ffffff',
    fontSize,
    fontWeight: 700,
    lineHeight: 1,
  };
}

/** Style fragment for the wordmark — the site image's exact form. */
function wordmarkStyle(fontSize: number) {
  return {
    display: 'flex',
    color: GRAY_900,
    fontSize,
    fontWeight: 700,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
  };
}

/**
 * The image content for one identity triple. Full identity renders the
 * brand row (mark + wordmark), the product name as the anchor, a divider,
 * and the brand · category line; each optional field's absence removes
 * only its own piece; the all-null identity renders the static site
 * composition — still a valid, on-brand image, never an error card.
 */
export function productOgImageElement(identity: ProductOgIdentity): React.ReactElement {
  const { name, brand, categoryLabel } = identity;

  // Failed fetch — no stored identity to state. The wordmark alone is
  // honest: nothing about the product is invented, and the render still
  // satisfies the "valid image" contract.
  if (name === null) {
    return (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#ffffff',
        }}
      >
        {/* The square initial mark and the wordmark — the site-wide OG
            image's exact vocabulary, centered. */}
        <div style={markStyle(96, 56)}>R</div>
        <div style={{ height: 40, width: 0 }} />
        <div style={wordmarkStyle(88)}>
          Rajahinta<span style={{ color: PRIMARY_700 }}>.fi</span>
        </div>
      </div>
    );
  }

  const detailLine = [brand, categoryLabel]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
        padding: '0 96px',
      }}
    >
      {/* Site attribution row — the same mark + wordmark vocabulary as the
          site-wide OG image, smaller, so the card reads as first-party. */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 48 }}>
        <div style={markStyle(56, 32)}>R</div>
        <div style={{ width: 20, height: 0 }} />
        <div style={wordmarkStyle(30)}>
          Rajahinta<span style={{ color: PRIMARY_700 }}>.fi</span>
        </div>
      </div>

      {/* The identity anchor: the stored name, verbatim — no template, no
          decoration, three lines at most. */}
      <div
        style={{
          display: 'flex',
          width: '100%',
          color: GRAY_900,
          fontSize: 68,
          fontWeight: 700,
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
          lineClamp: 3,
        }}
      >
        {name}
      </div>

      {/* Brand · category — only when at least one survived degradation;
          absent entirely rather than an empty shell. */}
      {detailLine !== '' ? (
        <>
          <div
            style={{
              height: 4,
              width: 72,
              backgroundColor: GRAY_200,
              marginTop: 36,
              marginBottom: 36,
            }}
          />
          <div
            style={{
              display: 'flex',
              color: GRAY_600,
              fontSize: 40,
              lineHeight: 1.3,
              lineClamp: 2,
            }}
          >
            {detailLine}
          </div>
        </>
      ) : null}
    </div>
  );
}
