/**
 * Golden detail page for viinarannasta.eu (task 1.2, change
 * sitemap-crawl-merchants).
 *
 * Pinned from the live page sample captured during the 2026-10-07
 * reconnaissance (read-only, one request, descriptive UA): viinarannasta
 * serves NO JSON-LD — its PrestaShop pages carry schema.org MICRODATA
 * (`itemtype Product` + nested `Offer` itemscope) with `itemprop` name,
 * image, description, price, priceCurrency, availability (InStock), and
 * the GTIN13 on the Offer scope. No brand. Verdict: the microdata
 * reader tier is what extracts this source.
 *
 * The URL carries the shop's numeric product id
 * (`/fi/<category>/<id>-<slug>.html`) and there is no SKU — the record's
 * productId is that URL id. The image is kept in the fixture to prove
 * it is never read (minimization: no record field exists for it).
 *
 * @module ViinarannastaProductFixture
 */

export const VIINARANNASTA_PRODUCT_URL =
  'https://viinarannasta.eu/fi/viskit/1718-jameson-irish-whiskey-07l.html';

export const VIINARANNASTA_PRODUCT_HTML = `<!DOCTYPE html>
<html lang="fi">
<head>
  <title>Jameson Irish Whiskey 40% 0,7 l - Viinarannasta</title>
</head>
<body>
  <div itemscope itemtype="https://schema.org/Product" id="product-1718">
    <h1 itemprop="name">Jameson Irish Whiskey 40% 0,7 l</h1>
    <img itemprop="image" src="https://viinarannasta.eu/1718-large_default/jameson.jpg" alt="Jameson">
    <div itemprop="description" class="product-description">
      <p>Jameson Irish Whiskey triplatiskeutettu.</p>
    </div>
    <div itemprop="offers" itemscope itemtype="https://schema.org/Offer" class="product-offers">
      <span itemprop="price">27.99</span>
      <meta itemprop="priceCurrency" content="EUR">
      <link itemprop="availability" href="https://schema.org/InStock">
      <meta itemprop="gtin13" content="5011013100156">
    </div>
  </div>
</body>
</html>`;
