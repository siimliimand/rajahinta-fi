/**
 * Structural indicative-limits disclaimers — part of every trip
 * feasibility result object (spec: trip-feasibility-calculator,
 * "Input validation and disclaimers"). Wording names what the figures
 * ARE NOT: indicative personal-use reference figures, not legal advice
 * and not a customs decision (design R7). Neutral wording only.
 *
 * @module TripDisclaimer
 */

import type { Disclaimer } from '../calculator/calculator.types';

export const TRIP_DISCLAIMER_FI: Disclaimer = {
  text: 'Suuntaa-antava laskelma: matkakustannus- ja kannattavan ostomäärän arviot perustuvat EU:n matkustajan henkilökohtaiseen käyttöön tarkoitettuihin suuntaa-antaviin määrärajoihin. Laskelma ei ole lakineuvo eikä tullipäätös; todelliset määrärajat arvioidaan rajalla.',
  language: 'fi',
  version: '1.0',
};

export const TRIP_DISCLAIMER_EN: Disclaimer = {
  text: 'Indicative calculation: travel-cost and break-even figures are computed against EU personal-use allowance limits as indicative reference figures. The calculation is not legal advice and not a customs decision; actual allowances are assessed at the border.',
  language: 'en',
  version: '1.0',
};
