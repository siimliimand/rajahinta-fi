/**
 * Pure FX effective-window and rate-selection math.
 *
 * Every function here is deterministic and side-effect free — the
 * resolution rules of design D2 are domain policy, so they are defined
 * once, in the domain, and unit-tested without any storage. The
 * repository only persists and queries rows; it must not re-implement
 * these rules (its SQL effective-window predicate mirrors
 * {@link isEffectiveOn} for lookup efficiency).
 *
 * @module FxRateWindow
 */

import type { FxDatasetVersion, FxRateEntry, ResolvedFxDatasetRate } from './fx-dataset.types';

/**
 * Whether an effective window covers `asOf`.
 *
 * Inclusive start, exclusive end (null end = open-ended), matching the
 * tax-rules convention: `effectiveFrom <= asOf < effectiveTo`.
 */
export function isEffectiveOn(
  dataset: Pick<FxDatasetVersion, 'effectiveFrom' | 'effectiveTo'>,
  asOf: Date,
): boolean {
  if (dataset.effectiveFrom.getTime() > asOf.getTime()) return false;
  if (dataset.effectiveTo !== null && dataset.effectiveTo.getTime() <= asOf.getTime()) {
    return false;
  }
  return true;
}

/**
 * The published dataset effective on `asOf` from a candidate list.
 *
 * Multiple published windows can cover a date only transiently (while an
 * operator confirms an overlapping replacement); the most recent
 * `effectiveFrom` is the authoritative one, mirroring the repository's
 * resolution order.
 */
export function resolveEffectiveDataset(
  datasets: readonly FxDatasetVersion[],
  asOf: Date,
): FxDatasetVersion | null {
  let best: FxDatasetVersion | null = null;
  for (const dataset of datasets) {
    if (dataset.status !== 'PUBLISHED') continue;
    if (!isEffectiveOn(dataset, asOf)) continue;
    if (best === null || dataset.effectiveFrom.getTime() > best.effectiveFrom.getTime()) {
      best = dataset;
    }
  }
  return best;
}

/**
 * Select the conversion rate for a pair from a dataset's rate entries.
 *
 * Rates are stored in the source's direction (ECB reference rates are
 * EUR-based). Resolution policy: an exact (base, quote) match wins;
 * otherwise the inverted (quote, base) entry is used — inversion is a
 * domain decision applied here, never at storage time. No match returns
 * null; callers must reject the conversion, never assume 1:1.
 */
export function resolveRateFromEntries(
  entries: readonly FxRateEntry[],
  dataset: FxDatasetVersion,
  baseCurrency: string,
  quoteCurrency: string,
): ResolvedFxDatasetRate | null {
  const base = baseCurrency.trim().toUpperCase();
  const quote = quoteCurrency.trim().toUpperCase();

  const direct = entries.find(
    (e) => e.baseCurrency === base && e.quoteCurrency === quote,
  );
  if (direct) {
    return {
      dataset,
      baseCurrency: base,
      quoteCurrency: quote,
      rate: direct.rate,
      inverted: false,
    };
  }

  const opposite = entries.find(
    (e) => e.baseCurrency === quote && e.quoteCurrency === base,
  );
  if (oppositeUsable(opposite)) {
    return {
      dataset,
      baseCurrency: base,
      quoteCurrency: quote,
      rate: 1 / opposite.rate,
      inverted: true,
    };
  }

  return null;
}

function oppositeUsable(entry: FxRateEntry | undefined): entry is FxRateEntry {
  return entry !== undefined && entry.rate > 0;
}
