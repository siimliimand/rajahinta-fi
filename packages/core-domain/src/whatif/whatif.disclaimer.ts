/**
 * Structural HYPOTHETICAL disclaimers — part of every what-if result
 * object (spec: excise-what-if-simulator). Wording is deliberately
 * stronger than the standard calculator disclaimer and names what the
 * result is NOT: a forecast, an estimate of future prices, or an
 * official statement. Neutral wording only — no forecast or political
 * phrasing anywhere (design R11).
 *
 * @module WhatIfDisclaimer
 */

import type { Disclaimer } from '../calculator/calculator.types';

export const WHATIF_DISCLAIMER_FI: Disclaimer = {
  text: 'Hypoteettinen laskelma: tulokset on laskettu korvaamalla alkoholiveron oletettu verokanta käyttäjän valitsemalla arvolla kiinteässä lähtötietoaineistossa. Laskelma ei ole ennuste, arvio tulevaisuuden hinnoista eikä virallinen ilmoitus.',
  language: 'fi',
  version: '1.0',
};

export const WHATIF_DISCLAIMER_EN: Disclaimer = {
  text: 'Hypothetical calculation: results are computed by substituting an assumed excise rate chosen by the user into a fixed baseline dataset. The calculation is not a forecast, not an estimate of future prices, and not an official statement.',
  language: 'en',
  version: '1.0',
};
