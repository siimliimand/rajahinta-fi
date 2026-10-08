# Onboard LMDW crawl merchant — Notes

> Operator/engineer log. The spike baseline below comes from the archived
> change `onboard-shopify-lmdw-merchants` (notes §1.3, verified
> 2026-10-08). Probe/sweep numbers are filled by whoever runs them — TBD
> placeholders are filled by the operator only, never pre-filled.

## Spike baseline (inherited, archived change notes §1.3)

- Full GraphQL walk: 6,814 distinct SKUs / 6,821 total_count (69 pages, 0
  failures); feed-side ABV (short_description) only 10.3 % → the NO-GO.
- Product pages `https://www.whisky.fr/<url_key>.html`: 10/10 HTTP 200 under
  the honest crawler UA; state JSON `"volume"` (litres) + `"strength"` (ABV)
  on 10/10 sampled pages — the full-coverage ABV/volume source.
- `m3_family` GraphQL census: 137 labels (reference evidence only — this
  change wires the page-side census, not the GraphQL one).
- EUR × 6,814, zero non-EUR; SKUs numeric; no weight field seen;
  `custom_attributesV2` internal-errors (rejected).
- GraphQL contract: `filter` OR `search` mandatory on `products`; pagination
  `pageSize`/`currentPage` to `total_count`.

## 1.1 Crawl probe results + URL-source decision

Probe: `scripts/lmdw-crawl-probe.ts`, run 2026-10-08 from this host (Node
v24.21, `pnpm --filter @rajahinta/data-platform exec tsx
../../scripts/lmdw-crawl-probe.ts`), read-only GETs + URL-source-only
GraphQL reads, UA `rajahinta-crawler/1.0 (+https://rajahinta.fi)`,
sequential, 1.1 s page pacing, 20 s per-fetch timeout, single bounded
retry, every failure collected. Sample: 300 URLs by even stride over the
product-shaped sitemap entries. Result: **300/300 pages fetched, 0 page
failures, 0 walk failures.**

**Sitemap availability** — robots.txt declares two `Sitemap:` directives:
`https://www.whisky.fr/media/sitemap/sitemap_whimag.xml` (FR store urlset,
9,964 entries, HTTP 200) and `.../sitemap_whimag_en.xml` (EN store, 9,765
entries). Bare `https://www.whisky.fr/sitemap.xml` is HTTP 404 (Next.js
HTML 404 page). Totals: 19,728 unique locs, **19,727 with `lastmod`**
(1 without). Product-shaped URLs (single path segment, `<url_key>.html`,
FR store): **6,842**. No sitemap indexes — both directives are urlsets.

**GraphQL url_key cross-walk** (URL-list use only; the spike NO-GO on
reading product data from GraphQL stands): `total_count` 6,875, 6,853
distinct skus (15 duplicate-sku rows, 0 failures; 69/70 pages ok, page 70
empty → pagination end). Predicate coverage — overlap sitemap ∩ catalog =
6,730 → **precision 98.4 %** (share of sitemap candidates that are catalog
products; the 97 non-catalog locs are CMS pages like
`nature-de-produit.html` plus live drift), **recall 98.2 %** (share of
catalog products present in the sitemap). Catalog churn between the two
probe runs the same day (6,868 → 6,853 distinct skus) confirms a live,
changing catalog — the daily cadence + lastmod diff is the convergence
mechanism, exactly as designed.

**DECISION (design D1): PURE SITEMAP.** `LmdwFeedAdapter extends
SitemapCrawlFeedAdapter`, `merchantId: 'lmdw'`, registry `feedUrl =
https://www.whisky.fr/media/sitemap/sitemap_whimag.xml`, `feedFormat:
'xml'`, product-URL predicate = single-segment `https://www.whisky.fr/
<url_key>.html` (the same shape as the four live crawl merchants; no new
machinery, no GraphQL-seeded variant). Non-product pages that pass the
predicate (measured ~1.6 % of entries) ride the D2 guarded-extraction
path — no volume/strength extract → keyed-uncertainty ESTIMATED +
correction, never guessed. The 98.2 % recall gap is handled by the daily
scheduled pass converging on sitemap regeneration.

**State-JSON extraction** (the D2 normalizer facts): the carrier is
`<script id="__NEXT_DATA__" type="application/json">` — pure JSON,
`JSON.parse` direct on 299/300 carrier pages (no assignment-slice needed).
- `volume` (litres): **297/300 (99.0 %)** present-and-numeric; guarded
  parse rejects 2 more (`"volume":"0"` → 0 not > 0) → **295/300 (98.3 %)
  usable**. All 297 reads are string-dot form (`"volume":"0.7"`).
  Top values: 0.7×224, 0.5×20, 0.75×12, 1×4, 0.05×4, 0.02×4, 0.72×4,
  0.059×3 (miniatures), 0×2.
- `strength` (ABV %): **299/300 (99.7 %)** present-and-numeric; guarded
  parse rejects 12 (`"strength":0` — non-alcoholic items) → **287/300
  (95.7 %) usable**. Forms: bare number ×297, string-dot ×2. Top values:
  40×47, 43×22, 45×13, 46×13, 0×12, 35×9.
- Guard necessity is **measured**: digit-free
  `"volume"/"strength"` i18n-dictionary strings appear on **300/300
  pages** (the normalizer MUST require pure-numeric values); digit-bearing
  non-conforming forms (`"45,8 %"`): 0/300.
- Exact key paths: `props.pageProps.productFromServer › volume` ×295 and
  `… › strength` ×295 (the canonical path). Alternate paths on 2 pages
  (`props.pageProps.document.data.body[2].items[0].product.attributes[20]
  › volume` / `[16] › strength` — CMS-rendered products without
  `productFromServer`) and on 2 redirect/listing-shaped pages
  (`categoryFromServer.products.items[0]` / `products.items[0]`) — the
  normalizer reads the `productFromServer` path and lets the rest fall to
  ESTIMATED. No-volume pages: `nature-de-produit.html` (CMS — expected
  predicate imprecision) + 2 Hampden product pages (alternate path above).
- Litres → ml ×1000 and percent → ÷100 confirmed against the pipeline
  windows (0 < litres < 100; 0 < abv ≤ 100) with the rejection counts
  above.

**Category signal census** (design D3 vocabulary input):
- JSON-LD `@type: Product` on 295/300 pages — but the `category` field is
  **absent everywhere** (0 distinct values).
- `BreadcrumbList` on 298/300 pages, 558 distinct terms — but the
  vocabulary is **geography + brand** (`Accueil`×295, `ecosse`×75,
  `france`×74, `japon`×21, `mexique`×18, `italie`×12, `belgique`×6,
  `irlande`×5, `jamaique`×5, plus brand crumbs LAPHROAIG×4, GLENLIVET×4,
  CAOL ILA×4…). Not product-type vocabulary — not mapper material.
- **The page-side product-type signal is the state JSON's m3 taxonomy** —
  present on **300/300 sampled pages**, the same m3 system as the archived
  137-label census, now measured where the crawl will actually read it:
  distinct labels: `m3_category` 40, `m3_family` 66, `m3_subfamily` 71,
  `m3_division` 2 (179 distinct key+label pairs). Top labels:

  | key | label (exact spelling) | pages |
  |---|---|---|
  | m3_division | liquide | 291 |
  | m3_category | whisky | 123 |
  | m3_family / m3_subfamily | single malt whisky | 99 |
  | m3_category | rhum | 41 |
  | m3_family / m3_subfamily | rhum | 31 |
  | m3_category | liqueurs | 18 |
  | m3_category | gin | 15 |
  | m3_category / m3_family / m3_subfamily | tequila (subfamily: tequila 100% agave) | 11 |
  | m3_family | Types de produit | 10 |
  | m3_family / m3_subfamily | blended whisky | 10 / 6 |
  | m3_subfamily | distilled gin | 10 |
  | m3_category / m3_family / m3_subfamily | sakes / bitters cocktails | 8 / 7 |
  | m3_category / m3_family / m3_subfamily | mezcal | 7 |
  | m3_family / m3_subfamily | rhum agricole / agricole rum | 6 |
  | m3_category | vodka | 6 |
  | m3_category | amers | 6 |
  | m3_category | autres spiritueux | 5 |
  | m3_* | BOISSONS SANS ALCOOL | 5 |
  | m3_* | armagnacs | 5 |
  | m3_* | cognacs | 4 |
  | m3_division | solide | 4 |

  Task 2.1 wires these exact spellings as additive keys; deliberately
  unmapped per the design: `BOISSONS SANS ALCOOL`, `solide`, gift/merch
  terms → correction queue. The `strength: 0` (×12) and `volume: "0"`
  (×2) rows are the same non-alcoholic/non-liquid population the
  listing-universe guard holds out — they land in correction, never as
  zero-ABV alcohol rows.

**GTIN13 verdict (design D4): PRESENT — page-attested only.** JSON-LD
`gtin13` on **220/300 pages (73.3 %)**; microdata `itemprop="gtin…"`:
0. All 220 values are 13-digit and **all 220 pass the GS1 check digit**
(0 invalid). The state JSON's `ean` field carries the identical values on
the identical 220 pages (samples: 5000277000982, 5060188980049,
7406341000106, 4995762103006, 3049197210776, 3586889931804, 3297364272038,
0724803003005, 3443210151020, 0856972005174) — two independent page-side
attestations of the same EAN. The ~26.7 % EAN-less remainder rides the
accepted correction path (D4; BOI 22,937 precedent) — zero fabrication.

**EUR verdict: CLEAN.** JSON-LD offers `priceCurrency` = EUR on all 295
Product-JSON-LD pages, 0 unparseable prices, 0 JSON-LD parse errors
(page-side; the GraphQL feed was EUR × 6,814 in the archived sweep).

**GO for task 3.1** — volume 99.0 % / strength 99.7 % raw (98.3 % / 95.7 %
after the guarded windows), URL source settled (pure sitemap, lastmod
99.99 %), category signal dense and page-side (m3 labels on 300/300
pages), GTIN real where attested, EUR clean. Conditions carried into 3.1:
ESTIMATED/correction paths for the measured minorities (no-volume 1.7 %,
implausible 14 rows, CMS-page ~1.6 % of sitemap entries, EAN-less ~26.7 %,
non-alcoholic m3 terms), never guesses.

## 2.1 Mapper re-probe drop rate

TBD (drop rate before/after the FR page-side vocabulary)

## 5.1 Local rollout evidence

TBD (registry/governance ids, watermark/cursor rows, chunking behavior,
ingested counts, idempotency second-run proof, correction rows)

## 6.1 PR + merge evidence

TBD (PR number, CI summary, merge SHA, staging deploy run id)

## 6.2 Staging rollout evidence

TBD (grant result, egress smoke, workflow instance + status, offer counts,
API/page checks)

## 7.1 Production deploy evidence

TBD (run id, health gate)

## 7.2 Production rollout evidence

TBD (registration audit entries, first crawl outcome — honest about
throttling if any, next-scheduled checklist)

## 8.1 Verification evidence

TBD (suite table, consolidated pointers, hold-rule note, correction-noise
observation)
