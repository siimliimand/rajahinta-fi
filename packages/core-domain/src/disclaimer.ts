/**
 * Structural disclaimers — part of every calculation result object.
 *
 * Defined in a leaf module (not the package barrel) because services such
 * as LandedCostCalculatorService and BasketOptimizerService import the
 * constant directly; importing it from the barrel created a circular
 * module chain (barrel -> optimizer module -> service -> barrel) that left
 * constructor param types undefined at decoration time under some module
 * resolution orders (found by the CI composition-smoke suite).
 *
 * @module disclaimer
 */

import type { Disclaimer } from './calculator/calculator.types';

export const DISCLAIMER_FI: Disclaimer = {
  text: 'Arvioitu kokonaiskustannus Suomessa. Ei ole lopullinen verovelvollisuuden määrä. Lopullinen verovelvollisuus määräytyy Tullin ja Verohallinnon vahvistamien verokantojen ja säännösten mukaan.',
  language: 'fi',
  version: '1.0',
};

export const DISCLAIMER_EN: Disclaimer = {
  text: 'Estimated total cost in Finland. Not final legal tax liability. Final tax liability is determined by the tax rates and regulations established by Finnish Customs and the Tax Administration.',
  language: 'en',
  version: '1.0',
};
