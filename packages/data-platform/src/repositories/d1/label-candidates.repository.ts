/**
 * D1 LabelCandidatesRepository — the token-AND candidate funnel behind
 * the scan-label route (task 1.2, change label-scan-product-lookup;
 * design D3). The search endpoint's phrase-adjacency MATCH is built for
 * human queries (synonym OR-groups, final-token prefix) and measured a
 * 67% top-1 ceiling on OCR token soup, where read order is noise; this
 * funnel instead conjoins the extracted tokens with AND over
 * `product_master_fts` — every token must appear somewhere in the row,
 * adjacency never required — then orders survivors by a two-term band
 * score and returns at most five.
 *
 * ## Band scoring — the exact widening discipline (design D3)
 *
 * The score copies `findCandidatesSql` semantics
 * (product-master-query.repository.ts) as an ORDER-BY expression:
 * `abs(coalesce(p.alcohol_by_volume, 0) - :abv) * 10 +
 * abs(coalesce(p.unit_volume, 0) - :vol) * 2`, i.e. ABV distance in
 * 0.5-percentage-point units weighted ×10 and volume distance in
 * 0.05-litre units weighted ×2. Both parameters arrive on the STORED
 * column scales (ABV as a fraction — 0.375, not 37.5; volume in
 * litres) so the subtraction is scale-consistent; the route converts
 * the extracted percentage before calling.
 *
 * A null (or unusable) extraction field drops its band term entirely —
 * the term is ABSENT from the SQL text, exactly like findCandidatesSql's
 * abvBlocked/volumeBlocked pattern (four variants; both dropped →
 * order by id ASC only). Widening is structural, never a fabricated
 * 0-value comparison. The same widening discipline as the ingestion
 * matcher: degrade to a larger candidate set, never guess.
 *
 * ## Universe, price, and bounds
 *
 * Candidates are bounded to the visible catalog universe through the
 * shared {@link PRODUCT_LISTING_UNIVERSE_SQL} fragment (imported, never
 * reworded — a quarantined or review-held row can never surface as a
 * scan candidate). Each row carries the lowest price over its CURRENT
 * offers — the latest-observation-per-(product, merchant) set the
 * listing and detail surfaces render — as a correlated scalar
 * subquery, acceptable at LIMIT 5. An offer-less product reports null:
 * honest absence, never a guessed price.
 *
 * Diacritic folding happens at the composition site (foldToSearchTokens,
 * label-fold.ts — unicode61 does not fold ż→z); this repository takes
 * the already-folded tokens as given.
 *
 * @module D1LabelCandidatesRepository
 */
import { Injectable } from '@nestjs/common';
import { PRODUCT_LISTING_UNIVERSE_SQL } from './product-search.repository';
import type { D1DatabaseLike } from '../../d1/executor';

/**
 * Candidate ceiling (spec label-scan: "at most five candidates ordered
 * by band score then product id") — the UI confirms over a top-3, so
 * five leaves headroom without a second page.
 */
export const LABEL_CANDIDATES_LIMIT = 5;

/**
 * Upper bound of AND-terms in one MATCH expression. An OCR transcription
 * can be long, but every added AND term only narrows recall while
 * growing the expression — past the brand/product/type signature the
 * extractor emits first, more terms subtract matches rather than add
 * precision. The first eight tokens are kept, the tail dropped.
 */
export const MAX_LABEL_MATCH_TOKENS = 8;

/** Band weight of one 0.5-percentage-point ABV distance unit (design D3). */
export const ABV_BAND_WEIGHT = 10;

/** Band weight of one 0.05-litre volume distance unit (design D3). */
export const VOLUME_BAND_WEIGHT = 2;

/**
 * Quote one FTS5 term, doubling embedded quotes — the same discipline
 * product-search.repository.ts applies to its phrases; duplicated here
 * because that helper is private and this module must not widen the
 * search repository's surface for a one-line concern.
 */
function ftsQuote(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/**
 * The token-AND MATCH expression: one quoted term per token joined with
 * ` AND ` (e.g. 3 tokens → `"gran" AND "mirador" AND "brandy"`).
 * AND-conjunction is the point — OCR token order is noise, so adjacency
 * and read order must not gate the match. Exported for the suite.
 */
export function buildLabelMatchExpression(tokens: readonly string[]): string {
  const kept = tokens
    .filter((t) => t.length > 0)
    .slice(0, MAX_LABEL_MATCH_TOKENS);
  if (kept.length === 0) return '';
  return kept.map(ftsQuote).join(' AND ');
}

/**
 * A usable extraction numeric — the ingestion matcher's
 * `isUsableSeedValue` discipline (design D3): finite and > 0. The
 * route's parser is null-on-absent, so null IS the unknown signal; a
 * non-positive or non-finite value additionally refuses the band (no
 * in-universe beverage has 0 % ABV). An unusable value widens (term
 * dropped) rather than fabricating a comparison.
 */
function isUsableExtraction(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && value > 0;
}

/**
 * The lowest price over one product's CURRENT offers — the correlated
 * scalar form of the cheapest-current-offer aggregate the listing
 * computes (CHEAPEST_CURRENT_OFFER_PROVENANCE_SQL /
 * offerAggregatesByProductId): the offer set is the latest observation
 * per (product, merchant) — retail_offers is append-per-scrape, so
 * without the MAX(id)-per-group collapse a superseded cheaper scrape
 * would drag the minimum below what the detail page lists. Written for
 * the `p` alias of product_master; MIN over an empty set is NULL, which
 * is exactly the offer-less product's honest absence. Kept correlated
 * (not a pre-grouped join) so LIMIT 5 bounds the subquery's executions.
 */
const CHEAPEST_CURRENT_OFFER_PRICE_SQL = `
    (SELECT MIN(o2.price_cents)
       FROM retail_offers o2
       JOIN (SELECT product_id, merchant, MAX(id) AS id
               FROM retail_offers
              WHERE product_id = p.id
           GROUP BY product_id, merchant) latest
         ON latest.id = o2.id)`;

/** ABV band term: stored fraction distance in 0.5-pp units, ×10. */
const ABV_BAND_TERM_SQL = `abs(coalesce(p.alcohol_by_volume, 0) - ?) * ${ABV_BAND_WEIGHT}`;

/** Volume band term: stored litres distance in 0.05-l units, ×2. */
const VOLUME_BAND_TERM_SQL = `abs(coalesce(p.unit_volume, 0) - ?) * ${VOLUME_BAND_WEIGHT}`;

/**
 * Assemble the label-candidates query. A null extraction field drops
 * its band term from the SQL TEXT (structural widening — the
 * findCandidatesSql abvBlocked/volumeBlocked pattern); with both
 * dropped the order degenerates to id ASC. Exported so the suite runs
 * EXPLAIN QUERY PLAN on the exact statement the repository executes
 * (the findCandidatesSql precedent) — never reworded at the call site.
 */
export function labelCandidatesSql(options: {
  abvScored: boolean;
  volumeScored: boolean;
}): string {
  const bandTerms: string[] = [];
  if (options.abvScored) bandTerms.push(ABV_BAND_TERM_SQL);
  if (options.volumeScored) bandTerms.push(VOLUME_BAND_TERM_SQL);
  // The band expression is selected only so ORDER BY can reference it by
  // alias without re-binding the weights; the mapper ignores the column.
  const bandColumn = bandTerms.length
    ? `,\n       ${bandTerms.join('\n           + ')} AS band_score`
    : '';
  const orderClause = bandTerms.length ? 'band_score ASC, p.id ASC' : 'p.id ASC';
  return `
  SELECT p.id, p.name, p.alcohol_by_volume, p.unit_volume, p.category,
         ${CHEAPEST_CURRENT_OFFER_PRICE_SQL} AS lowest_price_cents${bandColumn}
    FROM product_master_fts f
    JOIN product_master p ON p.id = f.rowid
   WHERE product_master_fts MATCH ? AND ${PRODUCT_LISTING_UNIVERSE_SQL}
   ORDER BY ${orderClause}
   LIMIT ${LABEL_CANDIDATES_LIMIT}`;
}

/** Funnel parameters — `{tokens, abv, volume}` per the task contract. */
export interface LabelCandidateParams {
  /**
   * Folded, lowercase, punctuation-free search tokens — the
   * foldToSearchTokens output (label-fold.ts). Order is significance
   * order: past {@link MAX_LABEL_MATCH_TOKENS} the tail is dropped.
   */
  readonly tokens: readonly string[];
  /** Extracted ABV as the stored fraction (0.375 = 37.5 %); null when absent. */
  readonly abv: number | null;
  /** Extracted unit volume in litres; null when absent. */
  readonly volume: number | null;
}

/** One funnel candidate (spec label-scan: the candidate card fields). */
export interface LabelCandidate {
  readonly id: number;
  readonly name: string;
  /** Stored ABV fraction (0.375 = 37.5 %); null when the row has none. */
  readonly alcoholByVolume: number | null;
  /** Stored unit volume in litres. */
  readonly unitVolume: number;
  readonly category: string;
  /** Cheapest current offer in EUR cents; null when the product has no offers. */
  readonly lowestPriceCents: number | null;
}

/** Raw D1 row of {@link labelCandidatesSql} (snake_case, REAL numbers). */
interface D1LabelCandidateRow {
  readonly id: number;
  readonly name: string;
  readonly alcohol_by_volume: number | null;
  readonly unit_volume: number;
  readonly category: string;
  readonly lowest_price_cents: number | null;
  /** Present only in the scored SQL variants; ORDER BY alias, unmapped. */
  readonly band_score?: number;
}

function toLabelCandidate(row: D1LabelCandidateRow): LabelCandidate {
  return {
    id: row.id,
    name: row.name,
    alcoholByVolume: row.alcohol_by_volume,
    unitVolume: row.unit_volume,
    category: row.category,
    lowestPriceCents: row.lowest_price_cents,
  };
}

/**
 * The scan funnel's catalog read (design D3). Stateless over the D1
 * binding; composed with the extractor and fold at the route — this
 * repository stays free of surface concerns (the search.routes.ts
 * composition discipline).
 */
@Injectable()
export class D1LabelCandidatesRepository {
  constructor(private readonly d1: D1DatabaseLike) {}

  /**
   * Token-AND retrieval with band scoring, visible-catalog universe,
   * and a five-candidate ceiling ordered band ASC then id ASC. An empty
   * token list returns [] WITHOUT executing SQL: an empty MATCH is
   * invalid FTS5 syntax, and no token carries no candidate by design
   * (surfacing zero rows for a tokenless label is the deliberate
   * recall trade — design D3 / risk "funnel recall ceiling").
   */
  async findCandidates(params: LabelCandidateParams): Promise<LabelCandidate[]> {
    const tokens = params.tokens.filter((t) => t.length > 0);
    if (tokens.length === 0) return [];

    const abvScored = isUsableExtraction(params.abv);
    const volumeScored = isUsableExtraction(params.volume);

    // Ordinals follow SQL-text order: the band terms sit in the SELECT
    // list, MATCH in WHERE — abv, volume, then the match expression.
    const args: Array<string | number> = [];
    if (abvScored) args.push(params.abv as number);
    if (volumeScored) args.push(params.volume as number);
    args.push(buildLabelMatchExpression(tokens));

    const rows = (
      await this.d1
        .prepare(labelCandidatesSql({ abvScored, volumeScored }))
        .bind(...args)
        .all<D1LabelCandidateRow>()
    ).results;
    return rows.map(toLabelCandidate);
  }
}
