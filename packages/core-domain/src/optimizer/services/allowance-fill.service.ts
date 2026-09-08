/**
 * AllowanceFillService — the optimizer's allowance-fill objective
 * (design D8, task 8.1): maximize filled value (euro-cents of retail
 * price) subject to the traveller-allowance limit resolved from the
 * versioned allowance datasets by effective travel date.
 *
 * ## Search
 *
 * The same discipline as the basket optimizer's bounded exhaustive
 * search, adapted to a fill objective: candidate lines are explored in
 * value-density order and each line's quantity ranges over
 * `0..min(maxQuantity, floor(remainingLitres / unitLitres), remainingUnits)`
 * — cap-infeasible quantities are never branched on. A branch-and-bound
 * cut prunes any partial fill whose optimistic completion (per category,
 * the cheaper of the density × remaining-litres and best-unit-price ×
 * remaining-units upper bounds — both valid relaxations) cannot beat the
 * best complete fill found so far, and an explored-node budget (the
 * module's MAX_TOTAL_COMBINATIONS constant) guarantees termination with
 * an explicit typed error instead of an unbounded walk. The result is
 * the exact value optimum: pruning only discards provably dominated
 * branches, and the pruning order is deterministic.
 *
 * ## Data boundaries
 *
 * - The allowance version is resolved FROM the travel date by
 *   {@link ITravellerAllowancePort} — this service never sees dataset
 *   rows or windows, only the resolved caps + `versionLabel`.
 * - Line categories use the excise engine's `normaliseCategory`, so the
 *   cap a fill line consumes is keyed exactly like the tax category the
 *   landed-cost engine would apply to the same product.
 * - Ferry offers never enter this computation (design D8: display-only,
 *   separate section, later tasks).
 * - Every error state is typed and explicit; values are never clamped
 *   or invented (bound exhaustion is a result state, not a synthesized
   * basket).
 *
 * @module AllowanceFillService
 */

import { Inject, Injectable } from '@nestjs/common';
import { ClassificationGateService } from '../../normalization/classification-gate.service';
import { DISCLAIMER_FI } from '../../disclaimer';
import { PRODUCT_DATA_PORT } from '../../calculator/calculator.types';
import { normaliseCategory } from '../../tax/services/alcohol-excise.math';
import {
  MAX_TOTAL_COMBINATIONS,
  BasketClassificationGateError,
} from '../optimizer.types';
import {
  MAX_FILL_ITEMS,
  MAX_FILL_QUANTITY,
  AllowanceFillError,
} from '../allowance-fill.types';
import type {
  AllowanceFillInput,
  AllowanceFillResult,
  AllowanceFillLine,
  AllowanceFillLineStatus,
  AllowanceFillCategoryHeadroom,
  AllowanceFillHeadroom,
} from '../allowance-fill.types';
import { TRAVELLER_ALLOWANCE_PORT } from '../ports/traveller-allowance.port';
import type { ITravellerAllowancePort } from '../ports/traveller-allowance.port';
import type { TripAllowanceLimitRow, TripResolvedAllowances } from '../../tripcalc/tripcalc.types';
import type {
  IProductDataPort,
  CalculatorProductData,
  CalculatorRetailOfferData,
} from '../../calculator/calculator.types';
import { TRIP_CATEGORY_KEYS } from '../../tripcalc/tripcalc.types';

// ---------------------------------------------------------------------------
// Internal types — alive only during a single fill() call
// ---------------------------------------------------------------------------

/** One candidate line with its resolved data and cap row. */
interface FillCandidate {
  /** Position in the INPUT items — result lines echo this order. */
  readonly inputIndex: number;
  readonly productId: number;
  readonly merchant: string;
  readonly unitPriceCents: number;
  readonly unitVolumeLitres: number;
  readonly maxQuantity: number;
  readonly category: string;
  /** Null when the resolved version has no row for this category. */
  readonly capRow: TripAllowanceLimitRow | null;
}

/** One complete fill solution — quantities per ordered candidate. */
interface FillSolution {
  readonly valueCents: number;
  readonly units: number;
  /** Quantity per candidate, indexed by the SEARCH order. */
  readonly quantities: readonly number[];
}

// ---------------------------------------------------------------------------
// Numeric helpers — litres are decimals; drift must never surface
// ---------------------------------------------------------------------------

/** Fit-decision tolerance: unit volumes and caps are exact decimals at
 *  centilitre granularity, so 1e-9 never flips a real decision. */
const LITRES_EPSILON = 1e-9;

/** Round a litre figure for reporting — six decimals is sub-millilitre. */
function roundLitres(litres: number): number {
  return Math.round(litres * 1e6) / 1e6;
}

/**
 * Whether one unit of the candidate fits the remaining caps.
 * Uncapped dimensions (Infinity) always fit.
 */
function unitFits(
  candidate: FillCandidate,
  remainingLitres: ReadonlyMap<string, number>,
  remainingUnits: ReadonlyMap<string, number>,
): boolean {
  const litres = remainingLitres.get(candidate.category) ?? Number.POSITIVE_INFINITY;
  const units = remainingUnits.get(candidate.category) ?? Number.POSITIVE_INFINITY;
  if (units < 1) return false;
  return candidate.unitVolumeLitres <= litres + LITRES_EPSILON;
}

/**
 * The deterministic search order: value density descending (cents per
 * litre), then unit price descending, then input order. Shared by the
 * search and result assembly so quantity mapping is a clean permutation.
 */
function searchOrder(a: FillCandidate, b: FillCandidate): number {
  const densityA = a.unitPriceCents / a.unitVolumeLitres;
  const densityB = b.unitPriceCents / b.unitVolumeLitres;
  if (densityA !== densityB) return densityB - densityA;
  if (a.unitPriceCents !== b.unitPriceCents) return b.unitPriceCents - a.unitPriceCents;
  return a.inputIndex - b.inputIndex;
}

/** Largest quantity of the candidate that fits the remaining caps. */
function maxFitQuantity(
  candidate: FillCandidate,
  remainingLitres: ReadonlyMap<string, number>,
  remainingUnits: ReadonlyMap<string, number>,
): number {
  let fit = candidate.maxQuantity;
  const litres = remainingLitres.get(candidate.category) ?? Number.POSITIVE_INFINITY;
  const units = remainingUnits.get(candidate.category) ?? Number.POSITIVE_INFINITY;
  fit = Math.min(fit, Math.floor((litres + LITRES_EPSILON) / candidate.unitVolumeLitres));
  fit = Math.min(fit, units);
  return Math.max(0, fit);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AllowanceFillService {
  constructor(
    private readonly classificationGate: ClassificationGateService,

    @Inject(PRODUCT_DATA_PORT)
    private readonly productData: IProductDataPort,

    @Inject(TRAVELLER_ALLOWANCE_PORT)
    private readonly travellerAllowances: ITravellerAllowancePort | null,
  ) {}

  /**
   * Fill the candidate lines with the value-maximal quantity selection
   * that respects the travel-date-resolved traveller allowance.
   *
   * @throws {AllowanceFillError} on invalid input, unknown products or
   *                              offers, a missing or malformed resolved
   *                              allowance dataset, or a search whose
   *                              explored-node budget was exhausted.
   * @throws {BasketClassificationGateError} when a product fails the
   *                              classification gate (the basket rule).
   */
  async fill(input: AllowanceFillInput): Promise<AllowanceFillResult> {
    // =======================================================================
    // 1. Input validation (deterministic precedence: shape first)
    // =======================================================================
    this.validateInput(input);

    // =======================================================================
    // 2. Resolve the allowance version for the travel date — provenance
    //    comes from the port, never from this service.
    // =======================================================================
    const allowances = await this.resolveAllowances(input.travelDate);
    const capByCategory = this.validateAndIndexCaps(allowances);

    // =======================================================================
    // 3. Prefetch — resolve products, gate them, pick the cheapest offer
    //    per line (deterministic), map to cap rows.
    // =======================================================================
    const candidates = await this.buildCandidates(input.items, capByCategory);

    // =======================================================================
    // 4. Bounded branch-and-bound over per-line quantities.
    // =======================================================================
    const solution = this.searchBestFill(candidates);

    // =======================================================================
    // 5. Assemble — per-line contribution, running headroom, final
    //    category headroom, dataset-version provenance.
    // =======================================================================
    return this.assembleResult(input, candidates, solution, allowances);
  }

  // -------------------------------------------------------------------------
  // Private: input validation
  // -------------------------------------------------------------------------

  private validateInput(input: AllowanceFillInput): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.travelDate)) {
      throw new AllowanceFillError(
        'INVALID_TRAVEL_DATE',
        `travelDate "${input.travelDate}" is not an ISO YYYY-MM-DD calendar date`,
      );
    }
    if (input.items.length > MAX_FILL_ITEMS) {
      throw new AllowanceFillError(
        'TOO_MANY_ITEMS',
        `fill request contains ${input.items.length} lines, maximum is ${MAX_FILL_ITEMS}`,
      );
    }
    for (const item of input.items) {
      if (
        !Number.isInteger(item.maxQuantity) ||
        item.maxQuantity < 1 ||
        item.maxQuantity > MAX_FILL_QUANTITY
      ) {
        throw new AllowanceFillError(
          'INVALID_QUANTITY',
          `maxQuantity ${String(item.maxQuantity)} for product ${item.productId} ` +
            `must be a whole number between 1 and ${MAX_FILL_QUANTITY}`,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private: allowance resolution + dataset validation
  // -------------------------------------------------------------------------

  private async resolveAllowances(travelDate: string): Promise<TripResolvedAllowances> {
    if (this.travellerAllowances === null) {
      throw new AllowanceFillError(
        'NO_ALLOWANCE_DATASET',
        'the traveller allowance port is not wired — no dataset source can resolve the travel date',
      );
    }
    const resolved = await this.travellerAllowances.resolveForTravelDate(travelDate);
    if (resolved === null) {
      throw new AllowanceFillError(
        'NO_ALLOWANCE_DATASET',
        `no PUBLISHED allowance dataset covers travel date "${travelDate}" — ` +
          'a fill cannot run without a bound',
      );
    }
    return resolved;
  }

  /**
   * Validate the resolved dataset (tripcalc's curation-error discipline:
   * a version resolves as a unit; blank labels, empty limit lists,
   * unknown/duplicate categories, cap-less rows, and non-positive caps
   * are caller/data errors — never papered over) and index caps by
   * category.
   */
  private validateAndIndexCaps(
    allowances: TripResolvedAllowances,
  ): Map<string, TripAllowanceLimitRow> {
    if (
      typeof allowances.dataset.versionLabel !== 'string' ||
      allowances.dataset.versionLabel.trim() === ''
    ) {
      throw new AllowanceFillError(
        'INVALID_ALLOWANCE_DATASET',
        'the resolved dataset has no version label — a fill result must name its dataset version',
      );
    }
    if (!Array.isArray(allowances.limits) || allowances.limits.length === 0) {
      throw new AllowanceFillError(
        'INVALID_ALLOWANCE_DATASET',
        'the resolved allowance dataset carries no limit rows — ' +
          'the 5.1 publish gate refuses such versions, so this is a caller-contract violation',
      );
    }

    const byCategory = new Map<string, TripAllowanceLimitRow>();
    for (const limit of allowances.limits) {
      if (!(TRIP_CATEGORY_KEYS as readonly string[]).includes(limit.category)) {
        throw new AllowanceFillError(
          'INVALID_ALLOWANCE_DATASET',
          `allowance limit category "${String(limit.category)}" is not one of: ` +
            TRIP_CATEGORY_KEYS.join(', '),
        );
      }
      if (byCategory.has(limit.category)) {
        throw new AllowanceFillError(
          'INVALID_ALLOWANCE_DATASET',
          `allowance category "${limit.category}" appears in more than one resolved limit row`,
        );
      }
      if (limit.volumeCapLitres === null && limit.quantityCap === null) {
        throw new AllowanceFillError(
          'INVALID_ALLOWANCE_DATASET',
          `allowance limit for "${limit.category}" carries neither a volume nor a quantity cap — ` +
            'a row that caps nothing is a curation error',
        );
      }
      if (
        limit.volumeCapLitres !== null &&
        (!Number.isFinite(limit.volumeCapLitres) || limit.volumeCapLitres <= 0)
      ) {
        throw new AllowanceFillError(
          'INVALID_ALLOWANCE_DATASET',
          `allowance volumeCapLitres for "${limit.category}" must be a positive finite number, ` +
            `got ${String(limit.volumeCapLitres)}`,
        );
      }
      if (
        limit.quantityCap !== null &&
        (!Number.isSafeInteger(limit.quantityCap) || limit.quantityCap <= 0)
      ) {
        throw new AllowanceFillError(
          'INVALID_ALLOWANCE_DATASET',
          `allowance quantityCap for "${limit.category}" must be a positive whole number, ` +
            `got ${String(limit.quantityCap)}`,
        );
      }
      byCategory.set(limit.category, limit);
    }
    return byCategory;
  }

  // -------------------------------------------------------------------------
  // Private: prefetch helpers
  // -------------------------------------------------------------------------

  private async buildCandidates(
    items: AllowanceFillInput['items'],
    capByCategory: ReadonlyMap<string, TripAllowanceLimitRow>,
  ): Promise<FillCandidate[]> {
    const candidates: FillCandidate[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      const product = await this.productData.findProductById(item.productId);
      if (product === null) {
        throw new AllowanceFillError(
          'PRODUCT_NOT_FOUND',
          `product ${item.productId} not found`,
        );
      }

      const gateResult = this.classificationGate.checkProductGate({
        regulatoryClassification: product.regulatoryClassification,
      });
      if (!gateResult.passed) {
        throw new BasketClassificationGateError(item.productId, gateResult.reason!);
      }

      const offers = await this.productData.findRetailOffers(item.productId);
      if (offers.length === 0) {
        throw new AllowanceFillError(
          'NO_OFFERS',
          `no retail offers found for product ${item.productId}`,
        );
      }

      // Cheapest offer, deterministic tie-break — the same comparator the
      // basket optimizer's candidate builder applies.
      const best = [...offers].sort((a, b) => {
        if (a.priceCents !== b.priceCents) return a.priceCents - b.priceCents;
        return a.merchant.localeCompare(b.merchant);
      })[0];
      this.validateOffer(product, best);

      const category = normaliseCategory(product.category);
      candidates.push({
        inputIndex: i,
        productId: item.productId,
        merchant: best.merchant,
        unitPriceCents: best.priceCents,
        unitVolumeLitres: product.volumeLitres,
        maxQuantity: item.maxQuantity,
        category,
        capRow: capByCategory.get(category) ?? null,
      });
    }
    return candidates;
  }

  private validateOffer(
    product: CalculatorProductData,
    offer: CalculatorRetailOfferData,
  ): void {
    if (!Number.isSafeInteger(offer.priceCents) || offer.priceCents < 0) {
      throw new AllowanceFillError(
        'INVALID_PRODUCT_DATA',
        `offer price ${String(offer.priceCents)} for product ${product.id} ` +
          'must be a non-negative integer cent amount',
      );
    }
    if (!Number.isFinite(product.volumeLitres) || product.volumeLitres <= 0) {
      throw new AllowanceFillError(
        'INVALID_PRODUCT_DATA',
        `volume ${String(product.volumeLitres)} for product ${product.id} ` +
          'must be a positive finite litre figure — a fill line must consume a boundable volume',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Private: bounded branch-and-bound search
  // -------------------------------------------------------------------------

  /**
   * Exact value-maximal fill over per-line quantities, or null when no
   * candidate is boundable (the explicit NO_BOUNDABLE_LINE state).
   */
  private searchBestFill(candidates: readonly FillCandidate[]): FillSolution | null {
    const anyBoundable = candidates.some((c) => c.capRow !== null);
    if (!anyBoundable) return null;

    // Density-descending first descent finds a strong incumbent early,
    // which is what makes the bound cut hard.
    const ordered = [...candidates].sort(searchOrder);

    // Remaining caps per category; uncapped dimensions are Infinity so
    // the arithmetic needs no branching.
    const remainingLitres = new Map<string, number>();
    const remainingUnits = new Map<string, number>();
    for (const candidate of ordered) {
      if (candidate.capRow === null || remainingLitres.has(candidate.category)) continue;
      remainingLitres.set(
        candidate.category,
        candidate.capRow.volumeCapLitres ?? Number.POSITIVE_INFINITY,
      );
      remainingUnits.set(
        candidate.category,
        candidate.capRow.quantityCap ?? Number.POSITIVE_INFINITY,
      );
    }

    // Suffix maxima for the optimistic bound: per search position, the
    // best unit price and best value density still to come, per category,
    // plus the total value of every remaining line filled to its
    // maxQuantity (a cap-blind relaxation).
    const n = ordered.length;
    const suffixPrice: Array<Map<string, number>> = new Array(n + 1);
    const suffixDensity: Array<Map<string, number>> = new Array(n + 1);
    const suffixMaxQuantityValue: number[] = new Array(n + 1).fill(0);
    suffixPrice[n] = new Map();
    suffixDensity[n] = new Map();
    for (let i = n - 1; i >= 0; i--) {
      const c = ordered[i];
      suffixPrice[i] = new Map(suffixPrice[i + 1]);
      suffixDensity[i] = new Map(suffixDensity[i + 1]);
      const price = suffixPrice[i].get(c.category) ?? 0;
      suffixPrice[i].set(c.category, Math.max(price, c.unitPriceCents));
      const density = suffixDensity[i].get(c.category) ?? 0;
      suffixDensity[i].set(
        c.category,
        Math.max(density, c.unitPriceCents / c.unitVolumeLitres),
      );
      suffixMaxQuantityValue[i] =
        suffixMaxQuantityValue[i + 1] + c.maxQuantity * c.unitPriceCents;
    }

    let nodes = 0;
    let bestValue = -1;
    let bestUnits = Number.POSITIVE_INFINITY;
    let bestQuantities: readonly number[] | null = null;
    const current: number[] = new Array(n).fill(0);

    const explore = (i: number, value: number, units: number): void => {
      nodes++;
      if (nodes > MAX_TOTAL_COMBINATIONS) {
        throw new AllowanceFillError(
          'SEARCH_BUDGET_EXCEEDED',
          `the fill search exceeded its ${MAX_TOTAL_COMBINATIONS}-node exploration budget — ` +
            'the request space is too large to solve exactly',
        );
      }
      if (i === n) {
        // Deterministic preference: more value, then fewer units, then
        // the lexicographically smaller quantity vector.
        let better = value > bestValue;
        if (!better && value === bestValue) {
          if (units < bestUnits) {
            better = true;
          } else if (units === bestUnits && bestQuantities !== null) {
            for (let k = 0; k < n; k++) {
              if (current[k] !== bestQuantities[k]) {
                better = current[k] < bestQuantities[k];
                break;
              }
            }
          }
        }
        if (better) {
          bestValue = value;
          bestUnits = units;
          bestQuantities = [...current];
        }
        return;
      }

      // Optimistic bound: the completion value cannot exceed the cheaper
      // of (a) the per-category cap relaxations — per category with lines
      // still to come, min of densest-density × remaining litres and best
      // unit price × remaining units, summed — and (b) every remaining
      // line filled to its maxQuantity. All are valid relaxations; their
      // minimum prunes every provably dominated branch.
      let byCaps = value;
      for (const [category, price] of suffixPrice[i]) {
        const density = suffixDensity[i].get(category)!;
        const byLitres = density * (remainingLitres.get(category) ?? Number.POSITIVE_INFINITY);
        const byUnits = price * (remainingUnits.get(category) ?? Number.POSITIVE_INFINITY);
        byCaps += Math.min(byLitres, byUnits);
      }
      const bound = Math.min(byCaps, value + suffixMaxQuantityValue[i]);
      if (bound <= bestValue) return;

      const candidate = ordered[i];
      if (candidate.capRow === null) {
        explore(i + 1, value, units);
        return;
      }

      const qMax = maxFitQuantity(candidate, remainingLitres, remainingUnits);
      for (let q = qMax; q >= 0; q--) {
        current[i] = q;
        remainingLitres.set(
          candidate.category,
          (remainingLitres.get(candidate.category) ?? Number.POSITIVE_INFINITY) -
            q * candidate.unitVolumeLitres,
        );
        remainingUnits.set(
          candidate.category,
          (remainingUnits.get(candidate.category) ?? Number.POSITIVE_INFINITY) - q,
        );
        explore(i + 1, value + q * candidate.unitPriceCents, units + q);
        remainingLitres.set(
          candidate.category,
          (remainingLitres.get(candidate.category) ?? Number.POSITIVE_INFINITY) +
            q * candidate.unitVolumeLitres,
        );
        remainingUnits.set(
          candidate.category,
          (remainingUnits.get(candidate.category) ?? Number.POSITIVE_INFINITY) + q,
        );
      }
      current[i] = 0;
    };

    explore(0, 0, 0);

    // bestQuantities is non-null here: the first descent always reaches a
    // leaf before any pruning can occur (bestValue starts at -1).
    return {
      valueCents: bestValue,
      units: bestUnits,
      quantities: bestQuantities ?? new Array(n).fill(0),
    };
  }

  // -------------------------------------------------------------------------
  // Private: result assembly
  // -------------------------------------------------------------------------

  private assembleResult(
    input: AllowanceFillInput,
    candidates: readonly FillCandidate[],
    solution: FillSolution | null,
    allowances: TripResolvedAllowances,
  ): AllowanceFillResult {
    const quantityByInputIndex = new Map<number, number>();
    if (solution !== null) {
      // Map search-order quantities back to input positions — the search
      // order is a permutation of the candidates array, sorted the same way.
      const ordered = [...candidates].sort(searchOrder);
      ordered.forEach((candidate, idx) => {
        quantityByInputIndex.set(candidate.inputIndex, solution.quantities[idx]);
      });
    }

    // Final remaining caps under the winning solution.
    const finalLitres = new Map<string, number>();
    const finalUnits = new Map<string, number>();
    for (const candidate of candidates) {
      if (candidate.capRow === null || finalLitres.has(candidate.category)) continue;
      finalLitres.set(
        candidate.category,
        candidate.capRow.volumeCapLitres ?? Number.POSITIVE_INFINITY,
      );
      finalUnits.set(
        candidate.category,
        candidate.capRow.quantityCap ?? Number.POSITIVE_INFINITY,
      );
    }
    for (const candidate of candidates) {
      if (candidate.capRow === null) continue;
      const q = quantityByInputIndex.get(candidate.inputIndex) ?? 0;
      finalLitres.set(
        candidate.category,
        (finalLitres.get(candidate.category) ?? Number.POSITIVE_INFINITY) -
          q * candidate.unitVolumeLitres,
      );
      finalUnits.set(
        candidate.category,
        (finalUnits.get(candidate.category) ?? Number.POSITIVE_INFINITY) - q,
      );
    }

    // Lines in input order with a running headroom walk.
    const runningLitres = new Map<string, number>();
    const runningUnits = new Map<string, number>();
    for (const candidate of candidates) {
      if (candidate.capRow === null || runningLitres.has(candidate.category)) continue;
      runningLitres.set(
        candidate.category,
        candidate.capRow.volumeCapLitres ?? Number.POSITIVE_INFINITY,
      );
      runningUnits.set(
        candidate.category,
        candidate.capRow.quantityCap ?? Number.POSITIVE_INFINITY,
      );
    }

    const lines: AllowanceFillLine[] = candidates.map((candidate) => {
      const q = candidate.capRow === null ? 0 : quantityByInputIndex.get(candidate.inputIndex) ?? 0;
      const valueContributionCents = q * candidate.unitPriceCents;
      const consumedVolumeLitres = q * candidate.unitVolumeLitres;

      let status: AllowanceFillLineStatus;
      if (candidate.capRow === null) {
        status = 'NO_ALLOWANCE_ROW';
      } else if (q > 0) {
        status = 'FILLED';
      } else if (!unitFits(candidate, finalLitres, finalUnits)) {
        status = 'CAP_EXHAUSTED';
      } else {
        status = 'NOT_SELECTED';
      }

      let headroomAfter: AllowanceFillHeadroom | null = null;
      if (candidate.capRow !== null) {
        runningLitres.set(
          candidate.category,
          (runningLitres.get(candidate.category) ?? Number.POSITIVE_INFINITY) -
            consumedVolumeLitres,
        );
        runningUnits.set(
          candidate.category,
          (runningUnits.get(candidate.category) ?? Number.POSITIVE_INFINITY) - q,
        );
        headroomAfter = this.headroomFor(candidate.category, candidate.capRow, runningLitres, runningUnits);
      }

      return {
        productId: candidate.productId,
        category: candidate.category,
        merchant: candidate.merchant,
        unitPriceCents: candidate.unitPriceCents,
        unitVolumeLitres: candidate.unitVolumeLitres,
        maxQuantity: candidate.maxQuantity,
        filledQuantity: q,
        valueContributionCents,
        consumedVolumeLitres,
        status,
        headroomAfter,
      };
    });

    // Final per-category headroom over the categories the fill touched.
    const touchedCategories = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.capRow !== null) touchedCategories.add(candidate.category);
    }
    const categoryHeadroom: AllowanceFillCategoryHeadroom[] = [...touchedCategories]
      .sort()
      .map((category) => {
        const capRow = candidates.find((c) => c.category === category)!.capRow!;
        const capLitres = capRow.volumeCapLitres;
        const capUnits = capRow.quantityCap;
        const remainingLitres = finalLitres.get(category) ?? Number.POSITIVE_INFINITY;
        const remainingUnits = finalUnits.get(category) ?? Number.POSITIVE_INFINITY;
        return {
          category,
          capLitres,
          capUnits,
          usedLitres: capLitres === null ? 0 : roundLitres(capLitres - remainingLitres),
          usedUnits: capUnits === null ? 0 : capUnits - remainingUnits,
          remainingLitres:
            capLitres === null || !Number.isFinite(remainingLitres)
              ? null
              : roundLitres(remainingLitres),
          remainingUnits:
            capUnits === null || !Number.isFinite(remainingUnits)
              ? null
              : remainingUnits,
        };
      });

    const filledUnits = lines.reduce((sum, line) => sum + line.filledQuantity, 0);
    const filledValueCents = lines.reduce((sum, line) => sum + line.valueContributionCents, 0);

    const status: AllowanceFillResult['status'] =
      solution === null ? 'NO_BOUNDABLE_LINE' : filledUnits > 0 ? 'FILLED' : 'BOUND_EXHAUSTED';

    return {
      status,
      travelDate: input.travelDate,
      allowanceDatasetVersion: allowances.dataset.versionLabel,
      filledValueCents,
      filledUnits,
      lines,
      categoryHeadroom,
      disclaimer: DISCLAIMER_FI,
      metadata: {
        input: {
          items: [...input.items],
          travelDate: input.travelDate,
          ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        },
        calculationTimestamp: new Date().toISOString(),
      },
    };
  }

  private headroomFor(
    category: string,
    capRow: TripAllowanceLimitRow,
    runningLitres: ReadonlyMap<string, number>,
    runningUnits: ReadonlyMap<string, number>,
  ): AllowanceFillHeadroom {
    const litres = runningLitres.get(category) ?? Number.POSITIVE_INFINITY;
    const units = runningUnits.get(category) ?? Number.POSITIVE_INFINITY;
    return {
      category,
      capLitres: capRow.volumeCapLitres,
      capUnits: capRow.quantityCap,
      remainingLitres:
        capRow.volumeCapLitres === null || !Number.isFinite(litres)
          ? null
          : roundLitres(litres),
      remainingUnits:
        capRow.quantityCap === null || !Number.isFinite(units) ? null : units,
    };
  }
}
