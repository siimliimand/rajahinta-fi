/**
 * Label-candidates funnel suite (task 1.2, change
 * label-scan-product-lookup) — the scan route's retrieval seam against
 * the real SQLite engine with the committed migrations (node:sqlite
 * harness, FTS5 virtual table and sync triggers included):
 *
 *   - token-AND matching survives a mid-name number the phrase-adjacency
 *     MATCH of the search endpoint would break on (design D3's measured
 *     failure);
 *   - band scoring ranks the exact ABV/volume sibling ahead of its
 *     variant (design D4's Yeni Raki sibling case);
 *   - the fold composes end-to-end: foldToSearchTokens output reaches an
 *     ASCII catalog row (unicode61 does not fold ż→z);
 *   - null extraction fields widen structurally — each of the four SQL
 *     variants orders by its surviving band terms only, both-null by id;
 *   - the visible-catalog universe applies: a quarantined row never
 *     surfaces (spec label-scan, shared listing universe);
 *   - the price column is the cheapest CURRENT offer, never a superseded
 *     scrape;
 *   - EXPLAIN QUERY PLAN on the exact exported statement: MATCH
 *     index-served, PK join, the price probe rides the product_id-leading
 *     offer index — no whole-history offer scan (the findCandidatesSql
 *     house pattern; design risk "D1 FTS AND-query plan cost").
 *
 * @module D1LabelCandidatesRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import type { D1DatabaseLike } from '../../../d1/executor';
import { foldToSearchTokens } from '../label-fold';
import {
  D1LabelCandidatesRepository,
  LABEL_CANDIDATES_LIMIT,
  MAX_LABEL_MATCH_TOKENS,
  buildLabelMatchExpression,
  labelCandidatesSql,
} from '../label-candidates.repository';

const { db, d1 } = openMigratedD1();

/**
 * Insert one product row with explicit id/name/brand/ABF/volume and
 * name-quality. Category/container are pinned spirits-shaped — the
 * funnel never filters on them, but the columns are NOT NULL.
 */
const insertProduct = db.prepare(
  `INSERT INTO product_master (id, name, manufacturer, brand, category,
       alcohol_by_volume, unit_volume, container_type, regulatory_classification,
       name_quality)
   VALUES (?, ?, 'Distillery', ?, 'spirits', ?, ?, 'glass', 'spirits', ?)`,
);

/** Insert one observed offer (ids encode scrape recency — append-per-scrape). */
const insertOffer = db.prepare(
  `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
       availability, observed_at)
   VALUES (?, ?, 'FI', ?, ?, 'in_stock', '2026-10-01T00:00:00.000Z')`,
);

interface SeedProduct {
  readonly id: number;
  readonly name: string;
  readonly brand?: string;
  /** Stored fraction (0.36 = 36 %). */
  readonly abv?: number | null;
  readonly volume?: number | null;
  readonly nameQuality?: 'ok' | 'quarantined';
}

function seedProduct(seed: SeedProduct): void {
  insertProduct.run(
    seed.id,
    seed.name,
    seed.brand ?? 'Brand',
    seed.abv ?? null,
    seed.volume ?? null,
    seed.nameQuality ?? 'ok',
  );
}

/** Clear all three tables — every test seeds its own closed world. */
function resetCatalog(): void {
  db.exec('DELETE FROM retail_offers');
  db.exec('DELETE FROM product_master');
}

const repo = new D1LabelCandidatesRepository(d1);

describe('D1LabelCandidatesRepository.findCandidates', () => {
  it('retrieves a row across a mid-name number (token-AND, not phrase-adjacency)', async () => {
    resetCatalog();
    // The spec scenario verbatim: the non-adjacent `7` token sits between
    // the brand tokens — a phrase MATCH ("gran mirador brandy") cannot
    // reach this row; the AND-funnel must.
    seedProduct({ id: 1, name: 'GRAN MIRADOR 7 Brandy 0.7L 36%', abv: 0.36, volume: 0.7 });
    // Decoy sharing only the final token — AND must exclude it.
    seedProduct({ id: 2, name: 'Carlos I Brandy Solera 0.7L', abv: 0.4, volume: 0.7 });

    const candidates = await repo.findCandidates({
      tokens: ['gran', 'mirador', 'brandy'],
      abv: 0.36,
      volume: 0.7,
    });
    expect(candidates.map((c) => c.id)).toEqual([1]);
  });

  it('ranks the exact ABV/volume sibling ahead of its variant', async () => {
    resetCatalog();
    // Same brand, different abv/volume (design D4's sibling case).
    seedProduct({ id: 1, name: 'Yeni Raki 45% 0.7L', brand: 'Yeni', abv: 0.45, volume: 0.7 });
    seedProduct({ id: 2, name: 'Yeni Raki 30% 1.0L', brand: 'Yeni', abv: 0.3, volume: 1.0 });

    const candidates = await repo.findCandidates({
      tokens: ['yeni', 'raki'],
      abv: 0.45,
      volume: 0.7,
    });
    expect(candidates.map((c) => c.id)).toEqual([1, 2]);
    // The variant is ordered strictly behind: its band carries the ABV
    // distance (|0.45-0.30| ×10 = 1.5) plus the volume distance
    // (|0.70-1.00| ×2 = 0.6) against the exact sibling's 0.
  });

  it('reaches an ASCII catalog row through the fold (żołądkowa → zoladkowa)', async () => {
    resetCatalog();
    seedProduct({
      id: 1,
      name: 'Zoladkowa de Luxe Vodka 37.5% 1 l',
      abv: 0.375,
      volume: 1.0,
    });

    // The route's composition: foldToSearchTokens output feeds the funnel.
    const tokens = foldToSearchTokens('Żołądkowa');
    expect(tokens).toEqual(['zoladkowa']);

    const candidates = await repo.findCandidates({
      tokens,
      abv: 0.375,
      volume: 1.0,
    });
    expect(candidates.map((c) => c.id)).toEqual([1]);
    expect(candidates[0]!.name).toBe('Zoladkowa de Luxe Vodka 37.5% 1 l');
  });

  it('widens when the extraction carries nulls — every variant orders deterministically', async () => {
    resetCatalog();
    // Insertion order deliberately shuffled; both-null must order by id.
    seedProduct({ id: 3, name: 'Koskenkorva Viina 38% 0.5L', abv: 0.38, volume: 0.5 });
    seedProduct({ id: 1, name: 'Koskenkorva 38% 1.0L', abv: 0.38, volume: 1.0 });

    // Both null: no band term at all — id ASC only.
    const bothNull = await repo.findCandidates({
      tokens: ['koskenkorva'],
      abv: null,
      volume: null,
    });
    expect(bothNull.map((c) => c.id)).toEqual([1, 3]);
    expect(bothNull[0]!.lowestPriceCents).toBeNull();

    // Volume only: the 0.5-l row is exact, the 1.0-l row behind.
    const volumeOnly = await repo.findCandidates({
      tokens: ['koskenkorva'],
      abv: null,
      volume: 0.5,
    });
    expect(volumeOnly.map((c) => c.id)).toEqual([3, 1]);

    // ABV only: equal-band rows tie on band, id breaks it.
    const abvOnly = await repo.findCandidates({
      tokens: ['koskenkorva'],
      abv: 0.38,
      volume: null,
    });
    expect(abvOnly.map((c) => c.id)).toEqual([1, 3]);

    // A degenerate 0 extraction widens like null (no fabricated 0-band).
    const zeroAbv = await repo.findCandidates({
      tokens: ['koskenkorva'],
      abv: 0,
      volume: 0.5,
    });
    expect(zeroAbv.map((c) => c.id)).toEqual([3, 1]);
  });

  it('excludes quarantined rows from the visible-catalog universe', async () => {
    resetCatalog();
    // Both rows token-match (FTS itself has no universe filter) — the
    // WHERE-universe, not the index, is what hides the quarantined row.
    seedProduct({ id: 1, name: 'Karneval Kummeli 32% 0.5L', abv: 0.32, volume: 0.5 });
    seedProduct({
      id: 2,
      name: 'Karneval Kummeli 32% 0.5L',
      abv: 0.32,
      volume: 0.5,
      nameQuality: 'quarantined',
    });

    const candidates = await repo.findCandidates({
      tokens: ['karneval', 'kummeli'],
      abv: 0.32,
      volume: 0.5,
    });
    expect(candidates.map((c) => c.id)).toEqual([1]);
  });

  it('reports the cheapest CURRENT offer — a superseded cheaper scrape never leaks', async () => {
    resetCatalog();
    seedProduct({ id: 1, name: 'Renat Brännvin 37.5% 0.5L', abv: 0.375, volume: 0.5 });
    seedProduct({ id: 2, name: 'Renat Vikingbrännvin 37.5% 0.5L', abv: 0.375, volume: 0.5 });
    // Product 1, merchant alko: an old cheap scrape superseded by a
    // pricier latest observation; merchant pb current at 600.
    insertOffer.run(1, 'alko', 1, 500);
    insertOffer.run(2, 'alko', 1, 700);
    insertOffer.run(3, 'pb', 1, 600);
    // Product 2 has no offers at all.

    const candidates = await repo.findCandidates({
      tokens: ['renat'],
      abv: 0.375,
      volume: 0.5,
    });
    const byId = new Map(candidates.map((c) => [c.id, c]));
    // min over the CURRENT set {700, 600} — not the whole history (500).
    expect(byId.get(1)!.lowestPriceCents).toBe(600);
    expect(byId.get(2)!.lowestPriceCents).toBeNull();
  });

  it('caps at five candidates ordered by band then id', async () => {
    resetCatalog();
    for (let id = 1; id <= 7; id += 1) {
      seedProduct({ id, name: `Testbrand Brandy ${id}`, abv: 0.36, volume: 0.7 });
    }

    const candidates = await repo.findCandidates({
      tokens: ['testbrand', 'brandy'],
      abv: 0.36,
      volume: 0.7,
    });
    expect(candidates).toHaveLength(LABEL_CANDIDATES_LIMIT);
    // Identical extraction → identical band 0 → the id tie-break orders.
    expect(candidates.map((c) => c.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns [] for an empty token list without executing SQL', async () => {
    const throwingD1 = {
      prepare: () => {
        throw new Error('SQL must not execute for an empty token list');
      },
    } as unknown as D1DatabaseLike;
    const guardedRepo = new D1LabelCandidatesRepository(throwingD1);
    await expect(
      guardedRepo.findCandidates({ tokens: [], abv: 0.36, volume: 0.7 }),
    ).resolves.toEqual([]);
  });
});

describe('buildLabelMatchExpression', () => {
  it('conjoins quoted tokens with AND', () => {
    expect(buildLabelMatchExpression(['gran', 'mirador', 'brandy'])).toBe(
      '"gran" AND "mirador" AND "brandy"',
    );
  });

  it('doubles embedded quotes (ftsQuote discipline)', () => {
    expect(buildLabelMatchExpression(['a"b'])).toBe('"a""b"');
  });

  it('caps at the first eight tokens and drops the tail', () => {
    const tokens = Array.from({ length: 12 }, (_, i) => `tok${i}`);
    const expression = buildLabelMatchExpression(tokens);
    expect(expression).not.toContain('"tok8"');
    expect(expression).toBe(
      tokens
        .slice(0, MAX_LABEL_MATCH_TOKENS)
        .map((t) => `"${t}"`)
        .join(' AND '),
    );
  });

  it('yields an empty expression for empty input', () => {
    expect(buildLabelMatchExpression([])).toBe('');
  });
});

describe('labelCandidatesSql — EXPLAIN QUERY PLAN (exact statement)', () => {
  it('serves MATCH from the FTS index, joins on the PK, probes offers via the product_id-leading index', () => {
    resetCatalog();
    // Two rows so the planner reasons over a non-empty table; the plan
    // for the bound statement does not depend on the values.
    seedProduct({ id: 1, name: 'Gran Mirador Brandy', abv: 0.36, volume: 0.7 });
    seedProduct({ id: 2, name: 'Carlos Brandy', abv: 0.4, volume: 0.7 });
    insertOffer.run(1, 'alko', 1, 600);

    const sql = labelCandidatesSql({ abvScored: true, volumeScored: true });
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(0.36, 0.7, '"gran"') as { detail: string }[];
    const details = plan.map((r) => r.detail).join('\n');

    // The AND-conjunction MATCH is index-served (virtual-table index;
    // M<n> = n conjoined terms), never a product_master scan.
    expect(details).toMatch(/SCAN f VIRTUAL TABLE INDEX 0:M\d+/);
    expect(details).not.toMatch(/SCAN p\b/);
    // The candidate join resolves through the rowid.
    expect(details).toMatch(
      /SEARCH p USING INTEGER PRIMARY KEY \(rowid=\?\)/,
    );
    // The cheapest-current-offer probe rides the (product_id, merchant,
    // id) covering index — never a whole-history offer scan.
    expect(details).toMatch(
      /retail_offers_product_merchant_id_idx \(product_id=\?\)/,
    );
    expect(details).not.toMatch(/SCAN retail_offers\b/);
  });
});
