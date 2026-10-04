/**
 * Savings-snapshot materialization cron handler (tasks 2.2 + 4.1, changes
 * insight-surfaces / alko-reference-matching-pipeline) — the daily
 * savings-discovery pass.
 *
 * ## Cadence — shared post-ingestion tick, cursor-chunked daily grain (v3)
 *
 * Registered on the EXISTING 30-minute aggregation pattern
 * ({@link SAVINGS_SNAPSHOT_CRON}) after the time-series aggregation
 * handler, in its own waitUntil like every sibling (router.ts). The
 * snapshot itself is a DAILY materialization — one row per product per
 * as-of day — and {@link SAVINGS_SNAPSHOT_CADENCE} records that operator
 * decision. The daily walk does not fit one Worker invocation (the
 * 2026-10-04 incident: a single-invocation O(catalog) walk exceeded the
 * subrequest budget partway through, capping the direct path and making
 * every appended-tail linked row unreachable), so each tick processes a
 * bounded {@link SAVINGS_SNAPSHOT_CHUNK_SIZE} chunk of the combined
 * qualifying list and advances a persisted product-id cursor
 * ({@link SAVINGS_SNAPSHOT_CURSOR_JOB} row in `aggregation_watermarks` —
 * the same job-cursor protocol as the time-series scan, D1 design).
 * Write-then-advance: the cursor moves only after the chunk's upserts
 * are attempted; per-product isolation absorbs individual failures so a
 * poisoned product cannot stall the walk. When no ids remain above the
 * cursor the cursor resets to 0 and the next tick begins the day's pass
 * anew — a same-day re-run stays a converging no-op: the
 * (asOf, product_id) upsert key IS the idempotence.
 *
 * ## Qualification and the gap (design D1/D3; v2 links per D4)
 *
 * A product qualifies two ways (spec savings-discovery): it carries an
 * Alko reference offer WITH an observation timestamp on its own record —
 * the exact predicate `resolveAlkoBenchmark` applies, and the benchmark
 * the calculator returns is that selection (newest observedAt, ties to
 * the higher offer id) — OR a CONFIRMED product reference link connects
 * its record to a distinct Alko product record. A product in both sets
 * evaluates ONCE via the direct path (dedupe by product id; direct
 * wins). The linked evaluation computes the landed cost on the foreign
 * product's own best offer and passes the linked Alko product to the
 * calculator as `alkoReferenceProductId` — benchmark selection stays
 * inside the calculator (design D4: no cron-side selection logic); the
 * CONFIRMED status is the qualification, so the linked path runs no
 * Alko-offer pre-check of its own. Only links in CONFIRMED status are
 * read (`listConfirmed`); PENDING and REJECTED links have no effect.
 *
 * The gap is the FULL landed cost (calculator quantity 1, destination
 * FI, default transport arrangement) versus the Alko domestic reference
 * — never the retail price alone. A product without a usable benchmark
 * produces NO row: absence is the honest state, a guessed gap never
 * materializes.
 *
 * ## Per-product isolation and explainability
 *
 * One failing product is logged and counted, never dropped from the
 * run and never fatal to the tick. Every row carries the tax dataset
 * version(s) that produced its figures (the calculator's
 * `datasetVersions`, joined deterministically when excise and container
 * duty differ) and — when a CONFIRMED link produced the pair — the
 * `reference_link_id` provenance column. The best-merchant fields come
 * from the offer the landed total was computed on
 * (`metadata.retailOfferIds[0]`), which for a linked row is the FOREIGN
 * offer, and the category is the evaluated product's own — the row
 * stays explainable about the product it is about. All money is integer
 * cents, the gap ratio integer basis points (design D4).
 *
 * Note: `calculate` persists a calculation record per product by design;
 * the calculation-record retention sweep bounds that table's growth.
 *
 * @module SavingsSnapshotsCron
 */

import {
  ConfidenceFrameworkService,
  ClassificationGateService,
  AlcoholExciseService,
  ContainerDutyService,
  LandedCostCalculatorService,
  ReliabilityService,
  TransactionClassificationService,
  TransportClassificationService,
  TransportEstimationService,
  type CalculatorRetailOfferData,
} from '../adapters/core-domain-bridge';
import {
  D1CalculationRecordPort,
  D1ProductDataPort,
  D1TransportOfferQuery,
} from '../adapters/d1-domain-ports';
import { D1TaxRuleRepositoryAdapter } from '../../../../packages/data-platform/src/repositories/d1/tax-rate.repository';
import { D1TransportOfferRepository } from '../../../../packages/data-platform/src/repositories/d1/transport-offer.repository';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import { D1SavingsSnapshotRepository } from '../../../../packages/data-platform/src/repositories/d1/savings-snapshot.repository';
import { D1ReferenceLinkRepository } from '../../../../packages/data-platform/src/repositories/d1/reference-link.repository';
import { strictestReliability } from '../../../../packages/data-platform/src/d1/summary-aggregation';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import type {
  ReferenceLinkRecord,
  SavingsSnapshotUpsertInput,
} from '../../../../packages/data-platform/src/abstracts';
import {
  computeSavingsGap,
  isSavingsGapValue,
} from '../../../../packages/core-domain/src/savings/gap';
import { AGGREGATION_CRON } from './time-series-aggregation';
import type { Env } from '../env';
import type { Logger } from '../logger';

/**
 * The cron pattern this handler registers under — the 30-minute
 * aggregation tick (see the module doc for the shared-tick semantics).
 */
export const SAVINGS_SNAPSHOT_CRON = AGGREGATION_CRON;

/**
 * Operator cadence decision (design leaves daily vs per-tick open): the
 * snapshot is a DAILY materialization — one row per product per as-of
 * day. The constant documents the intent and is the single point where
 * a cadence change would be expressed; extra same-day runs on the shared
 * tick are converging no-ops either way (keyed upsert).
 */
export const SAVINGS_SNAPSHOT_CADENCE = 'daily';

/**
 * Products processed per tick (design D2): the daily walk is chunked so
 * one invocation stays inside the empirical subrequest budget — at the
 * documented qualifying density a chunk costs ≈600 D1 statements, half
 * the budget with 2× safety. Recalibrate upward (never downward) if the
 * catalog's qualifying share grows past the D2 margin.
 */
export const SAVINGS_SNAPSHOT_CHUNK_SIZE = 300;

/** Watermark row holding the pass's product-id cursor (design D1). */
export const SAVINGS_SNAPSHOT_CURSOR_JOB = 'savings-snapshot-cursor';

/**
 * The pass cursor: the last processed product id of the current
 * day-pass, read/written as raw prepared statements against the generic
 * `aggregation_watermarks` table (the module already owns raw SQL for
 * the enumeration) — the Date-typed AggregationWatermarkRepository
 * abstract is not bent for an integer cursor. Absent row → 0: a fresh
 * pass, the same semantics as the time-series scan's first run (design
 * risk note). Mirrors the repository's own statement shapes.
 */
async function readSavingsCursor(d1: D1DatabaseLike): Promise<number> {
  const row = await d1
    .prepare('SELECT watermark FROM aggregation_watermarks WHERE job_name = ?')
    .bind(SAVINGS_SNAPSHOT_CURSOR_JOB)
    .first<{ watermark: string }>();
  if (row === null) {
    return 0;
  }
  const parsed = Number(row.watermark);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/** Write-then-advance persist step (design D1): called only after the
 *  chunk's upserts are attempted, so the cursor never promises work the
 *  tick did not do. Upsert keyed on the job_name UNIQUE index. */
async function writeSavingsCursor(d1: D1DatabaseLike, productId: number): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO aggregation_watermarks (job_name, watermark, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (job_name) DO UPDATE SET
         watermark = excluded.watermark,
         updated_at = excluded.updated_at`,
    )
    .bind(SAVINGS_SNAPSHOT_CURSOR_JOB, String(productId), new Date().toISOString())
    .run();
}

/** Merchant id of the domestic reference feed — byte-parity with the
 *  calculator's private ALKO_MERCHANT (inlined on purpose: importing the
 *  service module for one string would couple the cron pass to it). */
const ALKO_MERCHANT = 'alko';

/** Landed-cost destination for every snapshot row (design D1). */
const SNAPSHOT_DESTINATION = 'FI';

/** Product ids carrying at least one Alko offer row, id ascending.
 *  Enumeration is a superset of the qualification predicate — the
 *  per-product offer read below applies the observedAt rule. */
async function findQualifyingProductIds(d1: D1DatabaseLike): Promise<number[]> {
  const rows = await d1
    .prepare(
      `SELECT DISTINCT product_id FROM retail_offers
        WHERE merchant = ? ORDER BY product_id ASC`,
    )
    .bind(ALKO_MERCHANT)
    .all<{ product_id: number }>();
  return rows.results.map((row) => row.product_id);
}

/**
 * One enumerated evaluation: a direct product (link null — the v1 path,
 * benchmark from its own Alko offers) or a linked product (the CONFIRMED
 * link whose Alko side the benchmark resolves from, design D4).
 */
interface SnapshotEvaluation {
  readonly productId: number;
  readonly link: ReferenceLinkRecord | null;
}

/**
 * The v3 evaluation set (design D3): the combined deduplicated list —
 * direct ∪ CONFIRMED-linked — in ONE total order, product id ascending.
 * The v2 direct-then-appended order was the incident's bug class: ids
 * appended after a long enumeration sit past the subrequest death line
 * and never materialize. Sorting puts every product at a cursor address
 * proportional to its id, so a confirmed link becomes materializable in
 * the first chunk that covers its id. Dedupe is still "direct path
 * wins": a product with its own Alko reference never evaluates through
 * a link (a live CONFIRMED link per foreign product is a schema
 * invariant, but the first link wins regardless).
 */
function buildEvaluations(
  directProductIds: number[],
  confirmedLinks: ReferenceLinkRecord[],
): SnapshotEvaluation[] {
  const byProductId = new Map<number, SnapshotEvaluation>();
  for (const link of confirmedLinks) {
    if (!byProductId.has(link.foreignProductId)) {
      byProductId.set(link.foreignProductId, { productId: link.foreignProductId, link });
    }
  }
  for (const productId of directProductIds) {
    // Direct overwrites any linked entry — the dedupe rule.
    byProductId.set(productId, { productId, link: null });
  }
  return [...byProductId.values()].sort((a, b) => a.productId - b.productId);
}

/**
 * Default calculator wiring — the same composition the calculator route
 * builds (D1 read ports, real tax engines). Local to the cron module so
 * the pass does not drag the Hono route module into the cron bundle.
 */
export function buildSavingsCalculator(
  d1: D1DatabaseLike,
): Pick<LandedCostCalculatorService, 'calculate'> {
  const taxRepo = new D1TaxRuleRepositoryAdapter(d1);
  return new LandedCostCalculatorService(
    new ClassificationGateService(),
    new AlcoholExciseService(taxRepo),
    new ContainerDutyService(taxRepo),
    new TransactionClassificationService(new TransportClassificationService()),
    new TransportEstimationService(
      new D1TransportOfferQuery(new D1TransportOfferRepository(d1)),
    ),
    new ConfidenceFrameworkService(new ReliabilityService()),
    new D1ProductDataPort(new D1ProductSearchRepository(d1)),
    new D1CalculationRecordPort(d1),
  );
}

/**
 * The tax dataset version(s) behind one landed total, joined
 * deterministically when the excise and container-duty engines resolved
 * different versions. A run can only be explained WITH its versions, so
 * an empty set is a caller-contract violation, never an empty string.
 */
function taxDatasetVersionOf(datasetVersions: readonly string[]): string {
  const unique: string[] = [];
  for (const version of datasetVersions) {
    if (version !== '' && !unique.includes(version)) {
      unique.push(version);
    }
  }
  if (unique.length === 0) {
    throw new Error('calculator returned no tax dataset versions');
  }
  return unique.join('+');
}

/** One run's outcome — logged by the cron dispatch, asserted by tests. */
export interface SavingsSnapshotRunResult {
  /** The materialized day, 'YYYY-MM-DD' (UTC calendar day of the run). */
  readonly asOf: string;
  /** Products the enumeration surfaced. */
  readonly qualifyingProducts: number;
  /** Snapshot rows upserted. */
  readonly rowsWritten: number;
  /** Qualified products that produced NO row (no usable reference). */
  readonly skipped: number;
  /** Products whose evaluation threw (isolation — the run continued). */
  readonly failed: number;
}

/** Seam overrides (test doubles; defaults are the real D1 paths). */
export interface SavingsSnapshotDeps {
  calculator?: Pick<LandedCostCalculatorService, 'calculate'>;
  snapshots?: D1SavingsSnapshotRepository;
  products?: D1ProductSearchRepository;
  offersForProduct?: (productId: number) => Promise<CalculatorRetailOfferData[]>;
  qualifyingProductIds?: () => Promise<number[]>;
  /** CONFIRMED links only — the real seam is `listConfirmed`, whose
   *  WHERE clause is the status filter (PENDING/REJECTED never surface). */
  confirmedLinks?: () => Promise<ReferenceLinkRecord[]>;
  /** The pass cursor (design D1) — the real seams are the raw watermark
   *  statements above: read defaults to 0 when the row is absent. */
  readCursor?: () => Promise<number>;
  writeCursor?: (productId: number) => Promise<void>;
  now?: () => Date;
}

/**
 * One tick of the savings-snapshot pass (v3, cursor-chunked): enumerate
 * the combined qualifying list — a direct Alko reference offer with an
 * observation timestamp, or the foreign side of a CONFIRMED reference
 * link — in one id-ascending total order, take the
 * {@link SAVINGS_SNAPSHOT_CHUNK_SIZE} chunk just above the persisted
 * cursor, compute each one's full landed cost (the linked path against
 * the linked Alko product's benchmark, selection inside the calculator),
 * and upsert the day's rows keyed (asOf, productId). Write-then-advance:
 * the cursor is persisted only after the chunk's upserts are attempted
 * (a failed product still advances — isolation already absorbed it, and
 * advancing past a poisoned product prevents an eternal stall, design
 * D1); an exhausted list resets the cursor to 0 so the next tick begins
 * the day's pass anew. Never throws on per-product failure (isolation) —
 * the router's handler boundary only sees failures of the scan itself.
 */
export async function handleSavingsSnapshots(
  env: Env,
  log: Logger,
  deps: SavingsSnapshotDeps = {},
): Promise<SavingsSnapshotRunResult> {
  const now = deps.now ?? (() => new Date());
  const asOf = now().toISOString().slice(0, 10);

  const products = deps.products ?? new D1ProductSearchRepository(env.DB);
  const calculator = deps.calculator ?? buildSavingsCalculator(env.DB);
  const snapshots = deps.snapshots ?? new D1SavingsSnapshotRepository(env.DB);
  const offersForProduct =
    deps.offersForProduct ?? ((id: number) => new D1ProductDataPort(products).findRetailOffers(id));
  const qualifyingProductIds =
    deps.qualifyingProductIds ?? (() => findQualifyingProductIds(env.DB));
  const confirmedLinks =
    deps.confirmedLinks ?? (() => new D1ReferenceLinkRepository(env.DB).listConfirmed());
  const readCursor = deps.readCursor ?? (() => readSavingsCursor(env.DB));
  const writeCursor = deps.writeCursor ?? ((id: number) => writeSavingsCursor(env.DB, id));

  const [cursor, directProductIds, links] = await Promise.all([
    readCursor(),
    qualifyingProductIds(),
    confirmedLinks(),
  ]);
  const evaluations = buildEvaluations(directProductIds, links);
  // The chunk is the next CHUNK_SIZE ids above the cursor in the one
  // total order (design D2); a wrap tick (nothing above the cursor)
  // processes nothing and resets the cursor.
  let chunkStart = 0;
  while (chunkStart < evaluations.length && evaluations[chunkStart].productId <= cursor) {
    chunkStart++;
  }
  const chunk = evaluations.slice(chunkStart, chunkStart + SAVINGS_SNAPSHOT_CHUNK_SIZE);
  const counters = { rowsWritten: 0, skipped: 0, failed: 0 };

  log.info({
    message: `Starting savings-snapshot pass for ${asOf}`,
    products: evaluations.length,
    linkedProducts: evaluations.filter((evaluation) => evaluation.link !== null).length,
    chunkProducts: chunk.length,
    cursor,
    cadence: SAVINGS_SNAPSHOT_CADENCE,
  });

  for (const { productId, link } of chunk) {
    try {
      if (link === null) {
        // Direct path (v1, unchanged): qualification mirrors
        // resolveAlkoBenchmark — an Alko offer row counts as a reference
        // only WITH its observation timestamp. The linked path skips
        // this pre-check on purpose: its qualification IS the CONFIRMED
        // link, and the foreign product need not carry any Alko offer.
        const offers = await offersForProduct(productId);
        const hasReference = offers.some(
          (offer) => offer.merchant === ALKO_MERCHANT && offer.observedAt !== undefined,
        );
        if (!hasReference) {
          counters.skipped++;
          continue;
        }
      }

      // Full landed cost for one unit to Finland, default transport
      // arrangement (SELLER_ARRANGED) — design D1. Linked (design D4):
      // the calculator resolves the benchmark from the linked Alko
      // product's offers with its own selection predicate.
      const result = await calculator.calculate(
        link === null
          ? { productId, quantity: 1, destination: SNAPSHOT_DESTINATION }
          : {
              productId,
              quantity: 1,
              destination: SNAPSHOT_DESTINATION,
              alkoReferenceProductId: link.alkoProductId,
            },
      );

      // The benchmark on the result IS the newest-reference selection.
      // Absent → no row, never a guessed gap (design D3).
      const benchmark = result.alkoBenchmark;
      if (benchmark === undefined) {
        counters.skipped++;
        continue;
      }

      const gap = computeSavingsGap({
        productId,
        productName: result.metadata.productName,
        landedTotalCents: result.totalCents,
        alkoReferenceCents: benchmark.referencePriceCents,
      });
      if (!isSavingsGapValue(gap)) {
        counters.skipped++;
        log.warn({
          message: `Savings gap unavailable for product ${productId}: ${gap.reason} — no row written`,
          productId,
        });
        continue;
      }

      // The row documents the offer the landed total was computed on —
      // read by the id the calculator itself selected. For a linked row
      // that offer is the FOREIGN product's (the benchmark came from the
      // linked Alko product's offers instead).
      const bestOfferId = result.metadata.retailOfferIds[0];
      const bestOffer = await products.findRetailOfferById(bestOfferId);
      if (bestOffer === null) {
        throw new Error(`best offer ${bestOfferId} not found for product ${productId}`);
      }

      const snapshot: SavingsSnapshotUpsertInput = {
        asOf,
        productId,
        category: result.metadata.category,
        bestMerchant: bestOffer.merchant,
        bestMerchantCountry: bestOffer.country,
        bestPriceCents: bestOffer.priceCents,
        bestObservedAt: bestOffer.observedAt,
        alkoReferenceCents: gap.alkoReferenceCents,
        alkoObservedAt: new Date(benchmark.observedAt),
        landedTotalCents: gap.landedTotalCents,
        landedReliability: strictestReliability(
          result.itemizedCosts.map((cost) => cost.reliability),
        ),
        confidence: result.confidence,
        gapCents: gap.gapCents,
        gapBasisPoints: gap.gapBasisPoints,
        taxDatasetVersion: taxDatasetVersionOf(result.metadata.datasetVersions),
        referenceLinkId: link === null ? null : link.id,
      };
      await snapshots.upsertSnapshot(snapshot);
      counters.rowsWritten++;
    } catch (err) {
      counters.failed++;
      log.error({
        message: `Savings snapshot failed for product ${productId}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
        productId,
      });
    }
  }

  // Write-then-advance (design D1): the cursor moves only after the
  // chunk's upserts were attempted — per-product isolation means the
  // chunk's outcome never blocks the advance (a failed product retries
  // on the next day-pass instead of stalling the walk, design D1). When
  // nothing remains above the chunk — the tail chunk, or a cursor
  // already past the list — the pass is complete and the cursor wraps
  // to 0, so the NEXT tick begins the day's pass anew and an immediate
  // same-day re-run re-walks the list idempotently (the v2 converging
  // no-op, unchanged: the keyed upsert absorbs the re-write).
  const exhausted = chunkStart + chunk.length >= evaluations.length;
  const nextCursor = exhausted
    ? 0
    : chunk[chunk.length - 1].productId;
  await writeCursor(nextCursor);

  // Design D5: the chunk window and cursor position on every tick, so
  // budget death or a stall is visible in tail/Grafana without forensics.
  if (chunk.length === 0) {
    log.info({
      message: `Savings-snapshot pass chunk exhausted of ${evaluations.length} qualifying (cursor ${cursor}): wrap — cursor reset to 0, ${counters.rowsWritten} rows written, ${counters.skipped} skipped, ${counters.failed} failed`,
      asOf,
      cursor,
      nextCursor,
      qualifyingTotal: evaluations.length,
      ...counters,
    });
  } else {
    const lastId = chunk[chunk.length - 1].productId;
    const wrapNote = exhausted ? ' — list exhausted, cursor wrapped to 0' : '';
    log.info({
      message: `Savings-snapshot pass chunk [${chunk[0].productId}..${lastId}] of ${evaluations.length} qualifying (cursor ${cursor}): ${counters.rowsWritten} rows written, ${counters.skipped} skipped, ${counters.failed} failed${wrapNote}`,
      asOf,
      cursor,
      nextCursor,
      chunkWindow: { from: chunk[0].productId, to: lastId },
      qualifyingTotal: evaluations.length,
      ...counters,
    });
  }

  log.info({
    message: `Savings-snapshot pass for ${asOf}: ${counters.rowsWritten} rows written, ${counters.skipped} skipped, ${counters.failed} failed`,
    asOf,
    ...counters,
  });

  return { asOf, qualifyingProducts: evaluations.length, ...counters };
}
