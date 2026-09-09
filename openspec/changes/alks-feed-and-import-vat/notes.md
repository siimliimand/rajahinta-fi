# Notes: alks-feed-and-import-vat

## Task 7.1: full-catalog sweep, 2026-09-09

Script: `scripts/alks-catalog-sweep.ts`. It walked the live Store API
(`https://alks.fi/wp-json/wc/store/v1/products`) with read-only GETs,
sequential requests, `per_page=100`, bounded by `X-WP-TotalPages`, the
same discipline as the adapter (design D2). Every raw row went through
the production parser `parseAlksStoreProducts`. No writes anywhere.

Reproduce:

```
pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/alks-catalog-sweep.ts
```

### Numbers

Walk: 29/29 pages ok, 0 page failures, `X-WP-Total` 2856 equals rows
seen (2856).

1. EAN pattern coverage (`^[a-z]{2}-\d{13}$`): 2607 of 2856 SKUs match,
   91.3%. Non-matching SKUs: 249 (8.7%), rows with no/empty SKU: 0.
   The misses are pack-variant suffixes (`de-5011166082071-1`) and
   wrong digit counts (`de-854745000104`, 12 digits).
2. ESTIMATED share (unparsed ABV or volume): 52 of 2570 parsed
   records, 2.0% (1.8% of raw rows). ABV null: 51, volume 0 ml: 4,
   both: 3.
3. Category disagreements (name and categories on different tax-rule
   keys): 16 rows dropped, 0.6%. Samples are vermouth/sherry-type
   names ("intermediate_products") under spirits categories.
4. Totals: 2856 raw rows, 2570 records parsed (90.0%), 286 rows
   dropped (10.0%).
5. Adapter-level row-drop categories: no canonical beverage category
   270 (9.5%), category disagreement 16 (0.6%), non-EUR price 0,
   invalid price 0, missing name 0. Separately, 249 records were kept
   without an EAN (SKU mismatch, correction queue).

### Interpretation

The sampled EAN assumption did not hold: full-catalog coverage is
91.3%, below the 142/150 sample (94.7%), so EAN stays viable as the
primary upsert key but the 8.7% missing it (pack variants, 12-digit
UPCs) need a documented fallback decision before apply-phase
completion. The parser is healthy on the rows it accepts (ESTIMATED
2.0%, no parser iteration needed; disagreements 0.6%), but the 9.5%
"no canonical category" bucket is not all out-of-scope assortment:
sampled drops include alcoholic products lost to mapper vocabulary
gaps ("Aalborg Taffel Akvavit 41%" has no `akvavit` mapping, "Shaker
Lemon & Lime 10%" sits under the plural "Cocktails"), which shrinks
the catalog by dropping records contrary to design D3 and needs a
mapping iteration or an explicit scope decision.
