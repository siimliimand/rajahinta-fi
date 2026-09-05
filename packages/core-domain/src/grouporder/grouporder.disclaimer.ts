/**
 * Structural settlement-boundary note — part of every group order ledger
 * result object (spec: group-order-ledger, "Accounting-only boundary":
 * the system SHALL NOT process, broker, or facilitate payments, and the
 * boundary SHALL be stated). Wording names what the ledger IS NOT: an
 * accounting view of who owes whom, with settlement happening outside
 * Rajahinta through participants' own methods (design R12). Deliberately
 * neutral: no payment-instrument vocabulary, no named methods — naming
 * user-side examples is the UI's job (task 9.4), not the module's.
 *
 * @module GroupOrderDisclaimer
 */

import type { Disclaimer } from '../calculator/calculator.types';

export const GROUP_ORDER_DISCLAIMER_FI: Disclaimer = {
  text: 'Vain kirjanpitoesitys: jaettujen kustannusten jako perustuu osallistujien tavaramäärien arvoihin. Rajahinta ei käsittele, välitä eikä vastaanota maksuja; laskettujen osuuksien suorittaminen tapahtuu Rajahinnan ulkopuolella osallistujien omilla menetelmillä.',
  language: 'fi',
  version: '1.0',
};

export const GROUP_ORDER_DISCLAIMER_EN: Disclaimer = {
  text: 'Accounting view only: shared costs are split by the value of each participant\u2019s items. Rajahinta does not process, broker, or receive payments; settling the stated amounts happens outside Rajahinta through the participants\u2019 own methods.',
  language: 'en',
  version: '1.0',
};
