/**
 * Product-page structured-data builders (seo-aeo-agent-surfaces 1.1).
 *
 * Pure, typed functions over the product detail payload — no fetches, no
 * Next APIs, no locale resolution — so the shared product-page module
 * (the only renderer, for the physical FI route and the `[locale]` route
 * alike) composes them from data it already resolved, and the builders
 * stay unit-testable (the buildCuratedListJsonLd precedent).
 *
 * THE SAFE VARIANT IS PINNED (design D1): the graph carries identity and
 * attributes only. `retail_offers` rows are collected observations, not
 * merchant offers, so the type has NO `offers`, `Offer`,
 * `AggregateOffer`, `AggregateRating`, or review field at all — a
 * Misrepresented-Offer graph cannot compile, let alone serialize. Absent
 * data contributes absent properties, never placeholders (the house
 * absence principle): no EAN → no `gtin13`, null ABV → no ABV entry, an
 * unknown container key → no container entry, no `updatedAt` → no
 * `dateModified`.
 *
 * The deposit-system `PropertyValue` name is module-local vocabulary
 * (FI "Palautusjärjestelmä", EN "Deposit system") rather than a message
 * catalog key: the change pins the ProductPage key set (no new keys
 * beyond the breadcrumb labels), and this name is factual schema
 * vocabulary for a machine-readable surface, not rendered page copy.
 *
 * @module LibSeoProductStructuredData
 */

import { SITE_URL } from '@/lib/api';
import { localizedPath } from '@/lib/i18n/localized-paths';
import type { ProductDetail } from '@/lib/types';
import { formatAbv, formatVolume } from '@/lib/format/product-attributes';

// ---------------------------------------------------------------------------
// Localized URL vocabulary — one source for the JSON-LD and the visible trail
// ---------------------------------------------------------------------------

/**
 * The three breadcrumb destinations' localized paths for one product
 * page: the locale's site root, its catalog URL, and the product URL —
 * the exact segments `localizedPath` emits from the routing config
 * (FI bare `/tuotteet`, EN `/en/products`; localePrefix 'as-needed').
 * The visible trail renders these as `href`s; the JSON-LD prefixes
 * `SITE_URL` onto the same strings, so schema and visible links can
 * never disagree about the destinations.
 */
export function productBreadcrumbPaths(
  id: string,
  locale: string,
): { readonly home: string; readonly catalog: string; readonly product: string } {
  const normalized = locale === 'en' ? 'en' : 'fi';
  return {
    home: localizedPath(normalized, { pathname: '/' }),
    catalog: localizedPath(normalized, { pathname: '/products' }),
    product: localizedPath(normalized, {
      pathname: '/products/[id]',
      params: { id },
    }),
  };
}

/** Absolute form of the product page URL — schema.org wants absolute URLs. */
export function productPageUrl(id: string, locale: string): string {
  return `${SITE_URL}${productBreadcrumbPaths(id, locale).product}`;
}

// ---------------------------------------------------------------------------
// Product graph (safe variant — no offer semantics, see the module docblock)
// ---------------------------------------------------------------------------

/**
 * One schema.org PropertyValue. `value` accepts the JSON booleans the
 * deposit status arrives as; text values are the shared formatters'
 * output verbatim.
 */
interface JsonLdPropertyValue {
  readonly '@type': 'PropertyValue';
  readonly name: string;
  readonly value: string | number | boolean;
}

/**
 * The safe `Product` graph. The type lists exactly what the spec allows —
 * name, url, brand, gtin13, additionalProperty, dateModified — and
 * nothing else; optional fields are omitted from the serialized JSON
 * when absent (exactOptionalPropertyTypes-compatible construction).
 */
export interface ProductJsonLd {
  readonly '@context': 'https://schema.org';
  readonly '@type': 'Product';
  readonly name: string;
  readonly url: string;
  readonly brand?: { readonly '@type': 'Brand'; readonly name: string };
  readonly gtin13?: string;
  readonly additionalProperty?: readonly JsonLdPropertyValue[];
  readonly dateModified?: string;
}

/**
 * A GTIN-shaped EAN: digits only, one of the valid GTIN lengths
 * (8/12/13/14). Anything else — null, empty, placeholder text, or a
 * dash/space-decorated string — contributes NO `gtin13`: the spec's
 * "explicit-GTIN EAN" rule, and the house rule that a crawler never
 * receives a value the data cannot back.
 */
export function isGtinShapedEan(ean: string | null): ean is string {
  return ean !== null && /^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(ean);
}

/**
 * The deposit `PropertyValue` name per serving locale (see the module
 * docblock for why this is not a catalog key).
 */
const DEPOSIT_PROPERTY_NAMES: Readonly<Record<'fi' | 'en', string>> = {
  fi: 'Palautusjärjestelmä',
  en: 'Deposit system',
};

/** Labels the caller pre-resolves from its translator (the detailParts precedent). */
export interface ProductJsonLdLabels {
  /** `ProductPage.volumeLabel` — the volume entry's name. */
  readonly volumeLabel: string;
  /** `Common.abvLabel` — the ABV entry's name. */
  readonly abvLabel: string;
  /** `ProductPage.containerLabel` — the container entry's name. */
  readonly containerLabel: string;
  /**
   * The localized container-type label for the product's storage key —
   * null when the key is unknown or the field absent, in which case the
   * container entry contributes nothing (never a raw storage key).
   */
  readonly containerTypeLabel: string | null;
}

export interface ProductJsonLdInput {
  readonly product: ProductDetail;
  /** The route's id segment — the same value the served URL carries. */
  readonly id: string;
  readonly locale: string;
  readonly labels: ProductJsonLdLabels;
}

/**
 * Build the safe Product graph from the resolved detail payload. Every
 * property traces to a stored field: `name`/`brand`/`ean`/attributes to
 * product_master, `dateModified` to its updated_at. Absent inputs omit
 * their properties; the attribute VALUES render through the shared
 * formatters exactly as the page body renders them, so the schema never
 * states something the visible page does not.
 */
export function buildProductJsonLd(input: ProductJsonLdInput): ProductJsonLd {
  const { product, id, locale, labels } = input;

  const volume = formatVolume(product.unitVolume);
  const abv = formatAbv(product.alcoholByVolume);

  // Stable order — volume, ABV, container, deposit — so the serialized
  // graph is deterministic for a given payload (snapshot-friendly).
  const additionalProperty: JsonLdPropertyValue[] = [];
  if (volume !== null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: labels.volumeLabel,
      value: volume,
    });
  }
  if (abv !== null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: labels.abvLabel,
      value: abv,
    });
  }
  if (labels.containerTypeLabel !== null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: labels.containerLabel,
      value: labels.containerTypeLabel,
    });
  }
  // depositSystemStatus is a NOT NULL boolean on the contract (the API's
  // documented `?? false` parity), so the entry always renders when the
  // payload is present — there is no "absent" deposit state to fake.
  additionalProperty.push({
    '@type': 'PropertyValue',
    name: DEPOSIT_PROPERTY_NAMES[locale === 'en' ? 'en' : 'fi'],
    value: product.depositSystemStatus,
  });

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    url: productPageUrl(id, locale),
    ...(product.brand !== '' ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    ...(isGtinShapedEan(product.ean) ? { gtin13: product.ean } : {}),
    ...(additionalProperty.length > 0 ? { additionalProperty } : {}),
    ...dateModifiedOf(product.updatedAt),
  };
}

/**
 * `dateModified` from the row's updated_at: present only when the field
 * arrived AND parses as a timestamp, normalized to UTC ISO-8601 (a
 * formatting step — the instant is the stored one, never re-based).
 */
function dateModifiedOf(updatedAt: string | undefined): { readonly dateModified?: string } {
  if (updatedAt === undefined) return {};
  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) return {};
  return { dateModified: parsed.toISOString() };
}

// ---------------------------------------------------------------------------
// BreadcrumbList graph
// ---------------------------------------------------------------------------

/** One schema.org ListItem in the trail — position, name, absolute URL. */
export interface JsonLdBreadcrumbListItem {
  readonly '@type': 'ListItem';
  readonly position: number;
  readonly name: string;
  readonly item: string;
}

export interface BreadcrumbListJsonLd {
  readonly '@context': 'https://schema.org';
  readonly '@type': 'BreadcrumbList';
  readonly itemListElement: readonly JsonLdBreadcrumbListItem[];
}

export interface ProductBreadcrumbInput {
  /** The route's id segment — the same value the served URL carries. */
  readonly id: string;
  readonly locale: string;
  readonly productName: string;
  /** `ProductPage.breadcrumbHomeLabel`, pre-resolved by the caller. */
  readonly homeLabel: string;
  /** `ProductPage.breadcrumbCatalogLabel`, pre-resolved by the caller. */
  readonly catalogLabel: string;
}

/**
 * The Home → catalog → product trail over the shared URL vocabulary —
 * the same three destinations the page renders as visible links, in the
 * same locale. The product item's name is the stored product name, so
 * the schema mirrors the page's h1 rather than inventing a label.
 */
export function buildProductBreadcrumbJsonLd(
  input: ProductBreadcrumbInput,
): BreadcrumbListJsonLd {
  const { id, locale, productName, homeLabel, catalogLabel } = input;
  const paths = productBreadcrumbPaths(id, locale);
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: homeLabel,
        item: `${SITE_URL}${paths.home}`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: catalogLabel,
        item: `${SITE_URL}${paths.catalog}`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: productName,
        item: `${SITE_URL}${paths.product}`,
      },
    ],
  };
}
