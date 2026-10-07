/**
 * Extraction-layer tests against the four golden fixtures (task 1.2,
 * change sitemap-crawl-merchants; design D3 / spec "Extraction prefers
 * structured data with bounded fallbacks").
 *
 * Each source's fixture pins its recon verdict: licorea complete
 * JSON-LD (no fallback parsing), viinarannasta microdata with GTIN13,
 * drinkonline offers-as-array, viinikauppa store-brand trap plus
 * ABV-from-description and title multipack volume. The shared
 * contracts are pinned too: tier order, the minimization rule (no
 * images, no descriptions on records), and the per-row failure paths
 * (non-EUR, no category, bundle names, zero-ABV hold).
 *
 * @module ExtractPageTest
 */
import { describe, it, expect } from 'vitest';
import { extractProductPage } from '../extract-page';
import {
  DRINKONLINE_EXTRACTOR_CONFIG,
  LICOREA_EXTRACTOR_CONFIG,
  VIINARANNASTA_EXTRACTOR_CONFIG,
  VIINIKAUPPA_EXTRACTOR_CONFIG,
} from '../source-configs';
import {
  LICOREA_PRODUCT_HTML,
  LICOREA_PRODUCT_URL,
} from '../__fixtures__/licorea-product.fixture';
import {
  VIINARANNASTA_PRODUCT_HTML,
  VIINARANNASTA_PRODUCT_URL,
} from '../__fixtures__/viinarannasta-product.fixture';
import {
  VIINIKAUPPA_PRODUCT_HTML,
  VIINIKAUPPA_PRODUCT_URL,
} from '../__fixtures__/viinikauppa-product.fixture';
import {
  DRINKONLINE_PRODUCT_HTML,
  DRINKONLINE_PRODUCT_URL,
} from '../__fixtures__/drinkonline-product.fixture';

function jsonLdProduct(body: string): string {
  return `<html><head><script type="application/ld+json">${body}</script></head><body></body></html>`;
}

describe('licorea.com — complete JSON-LD (no fallback parsing)', () => {
  const { record, errors } = extractProductPage(
    LICOREA_PRODUCT_URL,
    LICOREA_PRODUCT_HTML,
    LICOREA_EXTRACTOR_CONFIG,
  );

  it('spec: carries EAN, EUR price, and availability straight from JSON-LD', () => {
    expect(errors).toEqual([]);
    expect(record).toMatchObject({
      productId: 'LIC-31415',
      productName: 'Brugal Añejo Rum 40% 0.7 l',
      brand: 'Brugal',
      manufacturer: 'Brugal',
      category: 'spirits',
      regulatoryClassification: 'spirits',
      alcoholByVolume: 0.4,
      volumeMl: 700,
      packCount: null,
      ean: '8410184100115',
      priceCents: 1895,
      currency: 'EUR',
      originalPriceCents: 1895,
      originalCurrency: 'EUR',
      availability: 'in_stock',
      sourceUrl: LICOREA_PRODUCT_URL,
      reviewHoldReason: null,
    });
  });

  it('the record carries no image and no description (minimization)', () => {
    expect(record).not.toBeNull();
    expect('description' in (record as object)).toBe(false);
    expect('image' in (record as object)).toBe(false);
  });
});

describe('viinarannasta.eu — schema.org microdata with GTIN13', () => {
  const { record, errors } = extractProductPage(
    VIINARANNASTA_PRODUCT_URL,
    VIINARANNASTA_PRODUCT_HTML,
    VIINARANNASTA_EXTRACTOR_CONFIG,
  );

  it('spec: the microdata tier extracts the product, GTIN13 included', () => {
    expect(errors).toEqual([]);
    expect(record).toMatchObject({
      productId: '1718',
      productName: 'Jameson Irish Whiskey 40% 0,7 l',
      brand: '',
      category: 'spirits',
      alcoholByVolume: 0.4,
      volumeMl: 700,
      ean: '5011013100156',
      priceCents: 2799,
      availability: 'in_stock',
      sourceUrl: VIINARANNASTA_PRODUCT_URL,
    });
  });

  it('a page with no JSON-LD at all still extracts (microdata tier reached)', () => {
    expect(record).not.toBeNull();
  });
});

describe('drinkonline.eu — JSON-LD with offers as an array', () => {
  const { record, errors } = extractProductPage(
    DRINKONLINE_PRODUCT_URL,
    DRINKONLINE_PRODUCT_HTML,
    DRINKONLINE_EXTRACTOR_CONFIG,
  );

  it('spec: selects the valid offer from the array instead of failing', () => {
    expect(errors).toEqual([]);
    expect(record).toMatchObject({
      productId: 'DN-78901',
      productName: 'Koskenkorva Vodka 60% 500 ml',
      brand: 'Koskenkorva',
      category: 'spirits',
      alcoholByVolume: 0.6,
      volumeMl: 500,
      ean: null,
      priceCents: 368,
      availability: 'in_stock',
      sourceUrl: DRINKONLINE_PRODUCT_URL,
    });
  });
});

describe('viinikauppa.com — store-brand trap, description ABV, title volume', () => {
  const { record, errors } = extractProductPage(
    VIINIKAUPPA_PRODUCT_URL,
    VIINIKAUPPA_PRODUCT_HTML,
    VIINIKAUPPA_EXTRACTOR_CONFIG,
  );

  it('spec: the store name brand is overridden and ABV parsed from the description prose', () => {
    expect(errors).toEqual([]);
    expect(record).toMatchObject({
      productName: 'Sandels olut tölkki 24x33cl',
      brand: '',
      manufacturer: '',
      category: 'beer',
      alcoholByVolume: 0.047,
      packCount: 24,
      volumeMl: 330,
      containerType: 'can',
      ean: null,
      priceCents: 1880,
      availability: 'out_of_stock',
      reviewHoldReason: null,
    });
  });

  it('the stray Tuotenumero itemprop outside the JSON-LD is not read — productId is the URL slug', () => {
    expect(record?.productId).toBe('sandels-olut-tolkki-24x33cl');
    expect(record?.ean).toBeNull();
  });
});

describe('extraction tiering (design D3)', () => {
  it('a usable JSON-LD Product wins over microdata on the same page', () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Tier Gin 40% 500 ml","offers":{"price":"10.00","priceCurrency":"EUR","availability":"https://schema.org/InStock"}}</script>
    </head><body>
      <div itemscope itemtype="https://schema.org/Product">
        <span itemprop="name">Microdata Gin 40% 500 ml</span>
        <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
          <span itemprop="price">99.99</span>
          <meta itemprop="priceCurrency" content="EUR">
        </div>
      </div>
    </body></html>`;

    const { record } = extractProductPage(
      'https://example.com/gin-en-p-1.html',
      html,
      LICOREA_EXTRACTOR_CONFIG,
    );

    expect(record?.productName).toBe('Tier Gin 40% 500 ml');
    expect(record?.priceCents).toBe(1000);
  });

  it('a JSON-LD product without a price falls through to a complete lower tier', () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Broken JSON-LD Wine 12% 0,75 l"}</script>
    </head><body>
      <div itemscope itemtype="https://schema.org/Product">
        <span itemprop="name">Tier Viini 12% 0,75 l</span>
        <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
          <span itemprop="price">12.50</span>
          <meta itemprop="priceCurrency" content="EUR">
        </div>
      </div>
    </body></html>`;

    const { record, errors } = extractProductPage(
      'https://example.com/wine.html',
      html,
      LICOREA_EXTRACTOR_CONFIG,
    );

    expect(errors).toEqual([]);
    expect(record?.productName).toBe('Tier Viini 12% 0,75 l');
    expect(record?.category).toBe('wine_still');
  });

  it('spec: the OG/meta tier is the last fallback and still yields a record', () => {
    const html = `<html><head>
      <meta property="og:title" content="Test Gin 40% 500 ml">
      <meta property="og:description" content="Dry gin.">
      <meta property="product:price:amount" content="24.50">
      <meta property="product:price:currency" content="EUR">
    </head><body><p>nothing structured here</p></body></html>`;

    const { record, errors } = extractProductPage(
      'https://example.com/p/gin.html',
      html,
      LICOREA_EXTRACTOR_CONFIG,
    );

    expect(errors).toEqual([]);
    expect(record).toMatchObject({
      productName: 'Test Gin 40% 500 ml',
      brand: '',
      category: 'spirits',
      alcoholByVolume: 0.4,
      volumeMl: 500,
      priceCents: 2450,
      availability: 'unknown',
    });
  });
});

describe('per-row failure paths — collected errors, never thrown', () => {
  it('a non-EUR structured price is rejected, not converted (Posti precedent)', () => {
    const { record, errors } = extractProductPage(
      'https://example.com/p/1.html',
      jsonLdProduct(
        '{"@type":"Product","name":"Swedish Brännvin 40% 500 ml","offers":{"price":"99","priceCurrency":"SEK"}}',
      ),
      LICOREA_EXTRACTOR_CONFIG,
    );

    expect(record).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"SEK" is not EUR');
  });

  it('a name with no beverage token drops the row with a correction error', () => {
    const { record, errors } = extractProductPage(
      'https://example.com/p/2.html',
      jsonLdProduct(
        '{"@type":"Product","name":"Mystery Gift Box","offers":{"price":"9.99","priceCurrency":"EUR"}}',
      ),
      LICOREA_EXTRACTOR_CONFIG,
    );

    expect(record).toBeNull();
    expect(errors).toEqual([
      expect.stringContaining('no canonical beverage category'),
    ]);
  });

  it('a multi-product bundle name is held for review, never published', () => {
    const { record, errors } = extractProductPage(
      'https://example.com/p/3.html',
      jsonLdProduct(
        '{"@type":"Product","name":"Vodka Gift Pack + Jägermeister 0,5 l","offers":{"price":"29.90","priceCurrency":"EUR"}}',
      ),
      LICOREA_EXTRACTOR_CONFIG,
    );

    expect(record).toBeNull();
    expect(errors).toEqual([
      expect.stringContaining('multi-product bundle'),
    ]);
  });

  it('an unparseable ABV on an alcohol-token name ingests with the non-alcoholic review hold (D7)', () => {
    const { record, errors } = extractProductPage(
      VIINIKAUPPA_PRODUCT_URL,
      VIINIKAUPPA_PRODUCT_HTML.replace(
        'Alkoholipitoisuus on 4,7 %. ',
        '',
      ),
      VIINIKAUPPA_EXTRACTOR_CONFIG,
    );

    expect(record).not.toBeNull();
    expect(record?.alcoholByVolume).toBeNull();
    expect(record?.reviewHoldReason).toBe('nonalcoholic_in_alcohol_category');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Held for review');
  });

  it('a malformed GTIN keeps the record without an EAN and names the value', () => {
    const { record, errors } = extractProductPage(
      'https://example.com/p/4.html',
      jsonLdProduct(
        '{"@type":"Product","name":"Craft Beer 5,5% 0,33 l","gtin13":"promo-9","offers":{"price":"4.49","priceCurrency":"EUR"}}',
      ),
      LICOREA_EXTRACTOR_CONFIG,
    );

    expect(record).not.toBeNull();
    expect(record?.ean).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('GTIN "promo-9"');
  });

  it('a page with no structured data at all yields a collected error', () => {
    const { record, errors } = extractProductPage(
      'https://example.com/p/5.html',
      '<html><body>nothing here</body></html>',
      LICOREA_EXTRACTOR_CONFIG,
    );

    expect(record).toBeNull();
    expect(errors).toEqual([
      expect.stringContaining('no readable JSON-LD Product'),
    ]);
  });

  it('a structured product without a usable price yields the tiering error', () => {
    const { record, errors } = extractProductPage(
      'https://example.com/p/6.html',
      jsonLdProduct('{"@type":"Product","name":"Priceless Wine 12%"}'),
      LICOREA_EXTRACTOR_CONFIG,
    );

    expect(record).toBeNull();
    expect(errors).toEqual([
      expect.stringContaining('no usable name+price'),
    ]);
  });
});
