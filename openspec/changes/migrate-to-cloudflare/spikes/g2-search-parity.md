# G2 — Search parity spike (task 1.2)

**Question:** can SQLite/D1 (FTS5 + LIKE) reproduce the pg_trgm search
contract that `packages/application-api/src/search/` pins today, well
enough that every golden/fixture query still finds its expected product
within top-k (k=5)?

**Verdict below.** Spike code: `scripts/spikes/cloudflare/search-parity/`
(throwaway, isolated from the pnpm workspace; own package.json,
better-sqlite3 — the same SQLite engine D1 runs, FTS5 compiled in).

## Current contract (what was mirrored)

Learned from `SearchController.search` +
`DrizzleProductRepository.searchRanked` and the two test suites
(`search.controller.test.ts`, `product-search.db.test.ts`):

- **Recall:** case-insensitive match over `name`, `brand`,
  `manufacturer` (`ILIKE '%q%'`, gin_trgm-accelerated).
- **Rank:** `GREATEST(similarity(name,q), similarity(brand,q),
  similarity(manufacturer,q)) DESC`, then **product id ASC** — a total,
  deterministic order ("karhu" name match ranks ahead of the brand-only
  match).
- **Blank/absent `q`:** never ranked — passes through to the unfiltered
  alphabetical listing, ordered with `localeCompare(name, 'fi')` in the
  controller (Finnish A→Ö).
- **Pagination:** controller slices the ranked set in JS; `MAX_PAGE_SIZE`
  = 100 on the ranked query.
- **Tested queries:** `"karhu"` (ranked order pinned),
  `"karh"` (partial-word via ILIKE recall), determinism across repeated
  calls, `limit=1`, blank passthrough, explicit-sort-over-filtered-set.

## Method

1. Local SQLite database (better-sqlite3, WAL — D1's engine; D1 supports
   FTS5 and triggers, so the DDL below is the shape task 2.2 would ship).
2. `product` table mirroring the searchable columns of `productMaster`
   (`packages/data-platform/src/schema.ts`): name/manufacturer/brand/
   category/alcohol_by_volume/unit_volume/container_type/
   regulatory_classification/deposit_system_status/ean + timestamps
   (pg `numeric` → decimal TEXT, timestamps → ISO-8601 TEXT).
3. `product_fts` FTS5 **external-content** virtual table
   (`content='product', content_rowid='id'`) over name/brand/manufacturer
   with AFTER INSERT/UPDATE/DELETE sync triggers (index integrity
   asserted after seeding).
   Tokenizer: `unicode61 remove_diacritics 0` — case folding without
   diacritic stripping, matching ILIKE (which folds case but never
   maps ö→o). The first run used default diacritic removal and gave
   "öl" the extra recall of "ol*" (Olvi/olut) — broader than pg, so the
   option is pinned to 0 for parity.
4. Candidate query (`src/query.ts`):
   - FTS5 MATCH as the full query phrase with **prefix expansion on the
     final token** (`"karhu" *`, `"le coq" *`) — the closest analogue of
     `ILIKE '%q%'` adjacency recall;
   - ranked by `bm25(product_fts, 10.0, 5.0, 2.0) ASC` (name > brand >
     manufacturer weights, mirroring GREATEST per-field similarity), **id
     ASC tie-break** — deterministic, like the pg contract;
   - **LIKE `%q%` merge** for mid-token substrings token prefixes cannot
     express (`"arhu"`), FTS hits first, LIKE-only rows appended in id
     order, capped at the caller's limit;
   - blank queries route to the unfiltered listing, sorted app-side with
     `localeCompare(…, 'fi')` exactly like `SearchController.compareByName`
     (SQLite/D1 ships no Finnish collation; final ordering must stay in
     application code).
5. Fixtures (provenance noted in `src/fixtures.ts`): the four
   controller-test products verbatim (ids 10/20/30/31), the three
   ranked-search DB-test seed rows verbatim incl. the
   `(ranked-search-test)` marker (synthetic ids 40-42), plus seven
   realistic Finnish/Swedish products (ids 50+) for real-world token
   shapes (compound Finnish words, Ö/Ä, multi-token brands).
6. Every query the search tests pin, plus 10 realistic FI/SE queries;
   per query: expected product ids that must ALL appear in top-5,
   optional expected rank-1, hit/miss recorded to
   `results/search-parity.json`.

Run: `cd scripts/spikes/cloudflare/search-parity && npm install && npm run spike`.

## Per-query results (k=5)

| # | Query | Source / expectation | Expected (rank in top-5) | Hit | Top-5 ids |
|---|---|---|---|---|---|
| Q1 | `karhu` | controller test: name match before brand-only | 30 (#1), 31 (#3) | HIT | 30,40,31,41 |
| Q2 | `karh` | db-test partial-word ILIKE recall | 30 (#1), 31 (#3), 40 (#2), 41 (#4) | HIT | 30,40,31,41 |
| Q3 | `KARHU` | ILIKE case-insensitivity parity | 30 (#1), 31 (#3), 40 (#2), 41 (#4) | HIT | 30,40,31,41 |
| Q4 | `le coq` | realistic multi-token brand phrase | 20 (#1) | HIT | 20 |
| Q5 | `koff` | db-test seed brand | 42 (#2), 55 (#1) | HIT | 55,42 |
| Q6 | `olut` | Finnish generic word in names | 10 (#1), 55 (#2) | HIT | 10,55 |
| Q7 | `lager` | name token | 31 (#1), 41 (#2) | HIT | 31,41,54 |
| Q8 | `sandels` | Finnish brand | 50 (#1) | HIT | 50 |
| Q9 | `norrlands` | Swedish brand token | 51 (#1) | HIT | 51 |
| Q10 | `Öltermanni` | non-ASCII (Ö) name query | 10 (#1) | HIT | 10 |
| Q11 | `öl` | short Swedish/Finnish prefix | 10 (#1) | HIT | 10 |
| Q12 | `hartwall` | manufacturer-only recall | 30 (#2), 31 (#3), 40 (#5), 52 (#4) | HIT | 53,30,31,52,40 |
| Q13 | `long drink` | two-token Finnish phrase | 53 (#1) | HIT | 53 |

**Contract checks:**

| Check | Result |
|---|---|
| Determinism — identical id order across repeated `karhu` calls | OK |
| `searchRanked('karhu', 1)` respects the fetch limit (1 row) | OK |
| Blank `''` passthrough — full listing (14 rows), `A. Le Coq Premium` first, Finnish alphabetical | OK |
| FTS sync-trigger integrity (index rows == product rows after seed) | OK |

Script exit code: **0**.

## Findings

1. **Top-5 gate met for all 13 query cases** — the pinned relevance
   contract ("karhu" → `Karhu III` rank 1, brand-only `Tumma Lager`
   behind it) reproduces with bm25 column weights + id tie-break.
2. **bm25 is not trigram similarity.** Ranks *within* the matched set
   can differ from pg (e.g. Q5: a name+brand match outranked a
   longer-marker name+brand match). The controller contract only pins
   membership + determinism (order stable across calls), not exact
   trigram scores — no test asserts a specific similarity value.
3. **Mid-token recall needs the LIKE merge.** FTS5 token prefixes cannot
   express `"karh"`-style *partial* tokens at the start of a word in the
   middle of a name; the LIKE merge covers exactly the ILIKE recall
   remainder. Keep both paths in task 2.2.
4. **`remove_diacritics 0` is required.** Default unicode61 folding maps
   ö→o, silently broadening recall beyond ILIKE semantics. Pin it in the
   migration.
5. **Finnish ordering stays app-side.** D1 has no custom collations;
   blank-listing order must remain `localeCompare(…, 'fi')` in the
   Worker, same as the controller does today.

## VERDICT

G2: GO
