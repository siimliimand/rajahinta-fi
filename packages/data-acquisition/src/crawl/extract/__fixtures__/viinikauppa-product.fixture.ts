/**
 * Golden detail page for viinikauppa.com (task 1.2, change
 * sitemap-crawl-merchants).
 *
 * Pinned from the live page sample captured during the 2026-10-07
 * reconnaissance (read-only, one request, descriptive UA). The TRAP
 * source: JSON-LD whose `brand` is "Viinikauppa" — the STORE, not the
 * product brand — so the source config must clear it. ABV appears ONLY
 * in the Finnish description prose ("Alkoholipitoisuus on 4,7 %",
 * comma-decimal), volume only in the title's multipack token
 * ("24x33cl"). No GTIN; the stray `itemprop="sku"` in the Tuotenumero
 * properties table sits OUTSIDE the JSON-LD and is deliberately not
 * read — the record's productId is the URL slug. Availability varies
 * per product; this page is OutOfStock.
 *
 * The prose also carries a decoy percentage ("20 %") before the ABV
 * sentence: the description-ABV regex must anchor on
 * "Alkoholipitoisuus" and never promote the discount percentage.
 *
 * @module ViinikauppaProductFixture
 */

export const VIINIKAUPPA_PRODUCT_URL =
  'https://www.viinikauppa.com/catalog/sandels-olut-tolkki-24x33cl';

export const VIINIKAUPPA_PRODUCT_HTML = `<!DOCTYPE html>
<html lang="fi">
<head>
  <title>Sandels olut tölkki 24x33cl - Viinikauppa</title>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": "Sandels olut tölkki 24x33cl",
    "brand": "Viinikauppa",
    "image": "https://www.viinikauppa.com/kuvat/sandels-24x33cl.jpg",
    "description": "Sandels on täyteläinen suomalainen olut. Säästä 20 % irtomyynnissä. Alkoholipitoisuus on 4,7 %. Valmistettu Suomessa.",
    "offers": {
      "@type": "Offer",
      "price": 18.80,
      "priceCurrency": "EUR",
      "availability": "http://schema.org/OutOfStock",
      "priceValidUntil": "2026-12-31",
      "url": "${VIINIKAUPPA_PRODUCT_URL}"
    }
  }
  </script>
</head>
<body>
  <h1>Sandels olut tölkki 24x33cl</h1>
  <table class="product-properties">
    <tr><td>Tuotenumero</td><td itemprop="sku">123456</td></tr>
    <tr><td>Valmistusmaa</td><td>Suomi</td></tr>
  </table>
</body>
</html>`;
