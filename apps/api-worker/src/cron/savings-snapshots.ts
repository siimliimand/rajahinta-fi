/**
 * Savings-snapshot materialization cron handler (task 2.2, change
 * insight-surfaces, design D1–D4) — the daily savings-discovery pass.
 *
 * ## Cadence — shared post-ingestion tick, daily grain
 *
 * Registered on the EXISTING 30-minute aggregation pattern
 * ({@link SAVINGS_SNAPSHOT_CRON}) after the time-series aggregation
 * handler, in its own waitUntil like every sibling (router.ts). The
 * snapshot itself is a DAILY materialization — one row per product per
 * as-of day — and {@link SAVINGS_SNAPSHOT_CADENCE} records that operator
 * decision. On the shared tick a same-day re-run is a converging no-op:
 * the (asOf, product_id) upsert key IS the idempotence, so no watermark
 * is kept (unlike the time-series scan, whose incremental protocol needs
 * one).
 *
 * ## Qualification and the gap (design D1/D3)
 *
 * A product qualifies only when it carries an Alko reference offer WITH
 * an observation timestamp — the exact predicate
 * `resolveAlkoBenchmark` applies, and the benchmark the calculator
 * returns is that selection (newest observedAt, ties to the higher
 * offer id). The gap is the FULL landed cost (calculator quantity 1,
 * destination FI, default transport arrangement) versus the Alko
 * domestic reference — never the retail price alone. A product without
 * a usable benchmark produces NO row: absence is the honest state, a
 * guessed gap never materializes.
 *
 * ## Per-product isolation and explainability
 *
 * One failing product is logged and counted, never dropped from the
 * run and never fatal to the tick. Every row carries the tax dataset
 * version(s) that produced its figures (the calculator's
 * `datasetVersions`, joined deterministically when excise and container
 * duty differ) — the explainability invariant. All money is integer
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
import { strictestReliability } from '../../../../packages/data-platform/src/d1/summary-aggregation';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import type { SavingsSnapshotUpsertInput } from '../../../../packages/data-platform/src/abstracts';
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
  now?: () => Date;
}

/**
 * One savings-snapshot pass: enumerate Alko-referenced products, compute
 * each one's full landed cost, and upsert the day's rows keyed
 * (asOf, productId). Never throws on per-product failure (isolation) —
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

  const productIds = await qualifyingProductIds();
  const counters = { rowsWritten: 0, skipped: 0, failed: 0 };

  log.info({
    message: `Starting savings-snapshot pass for ${asOf}`,
    products: productIds.length,
    cadence: SAVINGS_SNAPSHOT_CADENCE,
  });

  for (const productId of productIds) {
    try {
      // Qualification mirrors resolveAlkoBenchmark: an Alko offer row
      // counts as a reference only WITH its observation timestamp.
      const offers = await offersForProduct(productId);
      const hasReference = offers.some(
        (offer) => offer.merchant === ALKO_MERCHANT && offer.observedAt !== undefined,
      );
      if (!hasReference) {
        counters.skipped++;
        continue;
      }

      // Full landed cost for one unit to Finland, default transport
      // arrangement (SELLER_ARRANGED) — design D1.
      const result = await calculator.calculate({
        productId,
        quantity: 1,
        destination: SNAPSHOT_DESTINATION,
      });

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
      // read by the id the calculator itself selected.
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

  log.info({
    message: `Savings-snapshot pass for ${asOf}: ${counters.rowsWritten} rows written, ${counters.skipped} skipped, ${counters.failed} failed`,
    asOf,
    ...counters,
  });

  return { asOf, qualifyingProducts: productIds.length, ...counters };
}
