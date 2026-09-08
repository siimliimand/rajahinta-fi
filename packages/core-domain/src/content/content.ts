/**
 * Pure blog draft builder (task 5.1, change trust-and-reach-roadmap;
 * spec content-publication, design D3) — turns one confirmed rate
 * dataset version's delta into FI + EN DRAFT posts.
 *
 * Every body states: what changed (per category, old → new rate), the
 * effective date, and the estimated impact on a TYPICAL BASKET computed
 * from the same versioned delta (never from estimates of any single
 * user's basket). The tone is the content policy's: factual, no
 * adjectives — {@link lintContentPolicy} polices the vocabulary and the
 * module's own tests pin the bodies clean.
 *
 * No I/O, no clock: everything is derived from the input. The cron hook
 * at the rate-confirmation point calls this and persists the drafts
 * fail-open (a draft failure never blocks a confirmation).
 *
 * @module Content
 */

import type {
  BlogDraft,
  ContentLocale,
  RateChangeDraftInput,
  RateChangeLine,
} from './content.types';
import { RATE_CHANGE_SLUG_PREFIX } from './content.types';

// ---------------------------------------------------------------------------
// Typical-basket impact
// ---------------------------------------------------------------------------

/**
 * The typical basket the impact figure is computed on — fixed, versioned
 * by THIS constant only, and published in every body so the number is
 * explainable (architecture: every number is explainable). A mundane
 * weekly purchase, not a maximal case: 12 × 0.33 l cans of 4.7 % beer.
 */
export const TYPICAL_BASKET = {
  /** Units per basket line. */
  units: 12,
  /** Unit volume in litres. */
  unitVolumeLitres: 0.33,
  /** Alcohol by volume as a fraction (0.047 = 4.7 %). */
  alcoholFraction: 0.047,
  /** The category the basket prices (excise beer line). */
  productCategory: 'beer',
} as const;

/** Formula-reference vocabulary the impact math understands (tax constants parity). */
const FORMULA_PER_CENTILITRE_ETHANOL = 'PER_CENTILITRE_ETHANOL';
const FORMULA_FLAT_PER_LITRE = 'FLAT_PER_LITRE';

/** The rate-unit delta of one line — the per-unit cents delta. */
function lineRateDelta(line: RateChangeLine): number {
  return line.toRate - line.fromRate;
}

/**
 * Estimated impact of one versioned delta on the typical basket, in
 * euro cents. Only the beer line of the basket is priced: the basket is
 * beer, so a line whose category does not match contributes nothing —
 * and a body never claims an impact the delta cannot produce.
 *
 * Per-centilitre-ethanol lines scale by the basket's ethanol centilitres;
 * flat-per-litre lines scale by the basket's litres. Other formula
 * references are skipped (unknown scaling is not silently converted —
 * the body reports the delta without a basket figure instead).
 */
export function estimateTypicalBasketImpactCents(
  changes: readonly RateChangeLine[],
): number | null {
  const litres = TYPICAL_BASKET.units * TYPICAL_BASKET.unitVolumeLitres;
  const ethanolCl = litres * TYPICAL_BASKET.alcoholFraction * 100;

  let impact = 0;
  let priced = false;
  for (const line of changes) {
    if (line.productCategory !== TYPICAL_BASKET.productCategory) continue;
    const delta = lineRateDelta(line);
    if (line.formulaReference === FORMULA_PER_CENTILITRE_ETHANOL) {
      impact += delta * ethanolCl;
      priced = true;
    } else if (line.formulaReference === FORMULA_FLAT_PER_LITRE) {
      impact += delta * litres;
      priced = true;
    }
  }
  return priced ? Math.round(impact) : null;
}

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

/** Deterministic slug for a version: `veromuutos-<version-slugified>`. */
export function rateChangeSlug(versionLabel: string): string {
  const slugified = versionLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${RATE_CHANGE_SLUG_PREFIX}-${slugified}`;
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

interface LocalizedBodies {
  readonly title: string;
  readonly body: string;
}

/** Format cents as euros with the Finnish/European convention. */
function euros(cents: number, locale: ContentLocale): string {
  const value = (cents / 100).toFixed(2);
  return locale === 'fi' ? `${value.replace('.', ',')} €` : `€${value}`;
}

function buildBodies(
  input: RateChangeDraftInput,
  locale: ContentLocale,
  basketImpactCents: number | null,
): LocalizedBodies {
  const lines = input.changes
    .map((change) =>
      locale === 'fi'
        ? `- ${change.productCategory} (${change.taxType}): ${change.fromRate} → ${change.toRate}`
        : `- ${change.productCategory} (${change.taxType}): ${change.fromRate} → ${change.toRate}`,
    )
    .join('\n');

  const impact = basketImpactCents === null
    ? locale === 'fi'
      ? 'Muutoksella ei ole suoraa vaikutusta esimerkkikoriin.'
      : 'The change has no direct effect on the example basket.'
    : locale === 'fi'
      ? `Muutos on esimerkkikorissa arviolta ${euros(basketImpactCents, 'fi')} (` +
        `${TYPICAL_BASKET.units} × ${TYPICAL_BASKET.unitVolumeLitres} l, ` +
        `${(TYPICAL_BASKET.alcoholFraction * 100).toFixed(1)} %).`
      : `On the example basket the change is about ${euros(basketImpactCents, 'en')} ` +
        `(${TYPICAL_BASKET.units} × ${TYPICAL_BASKET.unitVolumeLitres} l, ` +
        `${(TYPICAL_BASKET.alcoholFraction * 100).toFixed(1)} %).`;

  if (locale === 'fi') {
    return {
      title: `Veromuutos ${input.versionLabel}`,
      body: [
        `Veroaineiston versio ${input.versionLabel} tulee voimaan ${input.effectiveFrom}.`,
        '',
        'Mitä muuttuu:',
        lines,
        '',
        impact,
        '',
        'Luvut perustuvat vahvistettuun aineistoversioon. Lasketun kokonaishinnan ' +
          'arvio on arvio, ei lopullinen verovelka.',
      ].join('\n'),
    };
  }

  return {
    title: `Tax change ${input.versionLabel}`,
    body: [
      `Rate dataset version ${input.versionLabel} takes effect on ${input.effectiveFrom}.`,
      '',
      'What changes:',
      lines,
      '',
      impact,
      '',
      'The figures come from the confirmed dataset version. The estimated total ' +
        'cost is an estimate, not a final tax liability.',
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build the FI + EN DRAFT pair for one confirmed version. Deterministic:
 * the slug is version-keyed, so a re-run for the same version produces
 * the same (slug, locale) keys — the repository's unique key turns an
 * accidental double-hook into a no-op surface the hook catches, not a
 * duplicate post.
 *
 * An empty delta builds nothing: a post with nothing to announce would
 * be noise (the hook treats this as a normal no-op).
 */
export function buildRateChangeDrafts(input: RateChangeDraftInput): BlogDraft[] {
  if (input.changes.length === 0) return [];

  const basketImpactCents = estimateTypicalBasketImpactCents(input.changes);
  const slug = rateChangeSlug(input.versionLabel);

  return (['fi', 'en'] as const).map((locale) => {
    const { title, body } = buildBodies(input, locale, basketImpactCents);
    return {
      slug,
      locale,
      title,
      bodyMarkdown: body,
      rateDatasetVersion: input.versionLabel,
    };
  });
}
