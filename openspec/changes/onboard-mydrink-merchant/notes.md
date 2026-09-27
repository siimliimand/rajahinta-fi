# Onboard mydrink merchant — Notes

## Task 1.1 — Catalog sweep (2026-09-27)

Script: `scripts/mydrink-catalog-sweep.ts` (cloned from `kippis-catalog-sweep.ts`; added brand-coverage and product-type censuses). Read-only: GETs only.

Run command:

```
pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/mydrink-catalog-sweep.ts
```

### Walk

- Collection: `https://mydrink.ee/wp-json/wc/store/v1/products`, `per_page=100`, sequential.
- X-WP-Total 707, 8 pages declared, 8/8 fetched ok, zero page failures, zero row drift.

### Headline numbers

| Metric | Value |
|---|---|
| Records parsed (production parser, unchanged) | 263 of 707 (37.2%) |
| Dropped: no canonical beverage category | 443 (62.7%) |
| Dropped: category disagreement (name vs categories) | 1 |
| Dropped: non-EUR / invalid price / missing name | 0 |
| SKUs matching an accepted EAN form | 0 of 707 (all internal codes, e.g. `MTJLD0078-1`, `MTBE026-1-2-1`) |
| Rows with a named `brands` entry | 0 of 707 |
| `type: simple` | 707 of 707 |
| ABV unparsed | 3 of 263 records (1.1%) |
| Volume unparsed | 0 |

### Category census (top terms, 70 distinct)

`Kange alkohol ▾` 251, `☝️ Pakkumised ▾` 178, `Pandipakend` 153, `Veinid ▾` 152, `Avaleht` 140, `Punased` 107, `Valged` 102, `Pakiveinid` 86, `☝️ Kange` 82, `☝️ Lahja alkohol` 77, `Liköör` 70, `Kokteilijoogid` 64, `Kingiideed ▾` 55, `Prantsuse` 55, `Õlu ▾` 52, `Vodka` 52, `Itaalia` 46, `Konjak` 38, `Hispaania` 36, `Viski` 36, `Eesti` 33, `Muu` 29, `Shampanjad` 28, `Kokteil` 27, `Alkoholivaba ▾` 25, `Austraalia` 24, `Vahuveinid` 22, `Karastusjoogid` 19, `Rumm` 19, `Tšiili` 17. Full list in the sweep output; `Siider` 14, `Gin` 15, long tail of country/usage terms.

### Go/no-go

GO for 1.2 (vocabulary: design D3 table) and 2.1 (adapter). The 1 disagreement drop and 3 ABV-missing records are within the parser's existing keyed-uncertainty discipline.

### Merge-path facts (owner confirmed no EAN data)

- EAN tier will never fire; compound tier (name, `''` brand, containerType, unitVolume) owns matching.
- Repeat runs idempotent; mydrink forms its own catalog rows (alks/longero parallel-catalog precedent).
- Name edits on the merchant side create a new row beside the old one; data-quality pass owns reconciliation.

## Task 1.2 — Re-sweep after vocabulary extension

Rerun after extending `SWEDISH_SOURCE_CATEGORY_MAP` with the D3 vocabulary (15 additive keys — the 14 uncovered terms plus Estonian double-ö `liköör`; the single-ö Swedish `likör` key does not match it, verified by byte census `U+00F6 U+00F6` vs `U+00F6`). The store's ` ▾` decoration is part of the raw term: census output bytes confirm `U+0020` + `U+25BE` (e.g. `Kange alkohol ▾`), matching the map keys exactly. `viski` needed no key (already maps to spirits).

Run command: `pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/mydrink-catalog-sweep.ts` — exit 0, 8/8 pages ok, zero page failures, read-only.

### Headline numbers (vs task 1.1)

| Metric | 1.1 | 1.2 (after D3) |
|---|---|---|
| Records parsed | 263 of 707 (37.2%) | 643 of 707 (91.0%) |
| Dropped: no canonical beverage category | 443 (62.7%) | 52 (7.4%) |
| Dropped: category disagreement (name vs categories) | 1 | 12 (1.7%) |
| Dropped: non-EUR / invalid price / missing name | 0 | 0 |
| 643 + 52 + 12 = 707 ✓ | | |

The 12 disagreement rows: name tokens imply wine_sparkling while the category payload's first mappable term is now `kange alkohol ▾` (spirits). The parser's contradiction gate flags them for the correction queue instead of silently resolving — keyed-uncertainty discipline, unchanged.

### Wine-leaf remainder (design-expected)

5 rows still drop on "no canonical beverage category" because only the `veinid ▾` parent applies (the term attributes 157 error lines: 152 are the expected kept-without-EAN lines, 5 are the category drops). Sparkling resolves only from its own leaves; wine rows with no leaf stay unmapped and fall to the correction queue — correct D3 behavior, not a failure. The rest of the 52 no-canonical drops carry only promo/navigational or RTD-cocktail terms (`kokteilijoogid`/`kokteil`, deliberately unmapped).

### Checks

- `pnpm --filter @rajahinta/core-domain build` exit 0 (mapper change is compiled into dist, which the sweep resolves through `@rajahinta/core-domain`).
- `pnpm --filter @rajahinta/core-domain test`: 56 files / 1427 tests passed, including 10 new mydrink vocabulary tests (canonical + tax key per new term, case/trim on the ` ▾`-decorated keys, `veinid ▾` and cocktail non-mappings, viski/likör regressions).

## Task 3.1 — Local rollout

(recorded by the implementing agent)

## Task 4.2 — Staging rollout

(recorded by the implementing agent)

## Task 5.2 — Production rollout

(recorded by the implementing agent)

## Task 6.1 — Verification

(recorded by the implementing agent)
