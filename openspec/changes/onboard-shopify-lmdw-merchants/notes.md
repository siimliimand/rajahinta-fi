# Onboard Shopify and LMDW merchants — Notes

> Operator/engineer log. Probe measurements below are from the 2026-10-07
> exploration (this host, read-only GETs). Sweep numbers (tasks 1.1–1.3) are
> filled by whoever runs the sweep — never pre-filled. TBD placeholders are
> filled by the operator only.

## Probe baseline (2026-10-07)

- bottleofitaly.com: Shopify, EUR (cart.js), page 1 @250 full, gradazione-tag
  ABV 250/250, volume-in-title 98/250, barcodes 0/250, grams 250/250,
  product_type: Olio 90, Spirits 67, Vino Rosso 44, Vino Bianco 21, Aceto 12,
  Bollicine 12, Vino Rosato 4. Shopify-side 429 observed after ~6 rapid calls.
- kuhns.shop: Shopify, EUR (cart.js), title forms `alc. 12 Vol.-%` + `0,75l`
  (comma decimals), product_type `Wein`, vendor `Kuhns Trinkgenuss`,
  SKU `ML9500`-shaped (no EAN), grams present.
- gateway.prod2.whisky.fr: Magento 2 GraphQL (LMDW), EUR per-item, filter-less
  products queries rejected (French error), `category_id: "3"` walk = 3,213
  products, ABV in `short_description.html` (`45,8%`, `à 52%`), volume not
  located, `m3_family` clean taxonomy (`rhum`…), SKU numeric, no weight seen,
  `custom_attributesV2` internal-server-errors on probed products.

## 1.1 bottleofitaly sweep results

TBD (operator fills: total catalog size, merch share, tag-ABV share,
title-volume fallback outcomes, 429 behavior, go for 3.1)

## 1.2 kuhns sweep results

TBD (operator fills: catalog size, category census, parse shares, ESTIMATED
share, go for 3.2)

## 1.3 LMDW sweep + spike decision

TBD (operator fills: ABV share, volume-source decision + evidence, m3_family
census, EUR check, go/no-go for 3.3 per design D5)

## 2.2 Mapper re-sweep drop rates

TBD (drop rates before/after the IT/DE/FR vocabulary)

## 5.1 Local rollout evidence

TBD (per-merchant offer counts, idempotency second-run proof, correction-queue
rows observed)

## 6.2 Staging rollout evidence

TBD (Workers-egress smoke per source, workflow instance ids, offer counts,
commands executed)

## 7.2 Production rollout evidence

TBD (registration audit entries, first-ingest counts, 00:00 UTC scheduled
checklist results)

## 8.1 Verification evidence

TBD (suites run + results, hold-rule note for ESTIMATED lmdw rows)
