/**
 * Shared ranking descriptions — the English reference copy for sort-order
 * display text, kept in lockstep with `RankingService.describeSortOrder()`
 * in `packages/core-domain/src/ranking/ranking.service.ts`.
 *
 * The rendered UI copy now lives in the message catalogs
 * (`src/messages/en.json` under `SortOrders.*.description`). The English
 * catalog values must equal these strings exactly; the catalog parity test
 * (`src/__tests__/messages.test.ts`) asserts that chain, and the compliance
 * test (`tests/compliance/ranking-lockstep.test.ts`) pins these strings to
 * the backend service. Change all three places together when adding or
 * updating sort orders.
 */

import type { SortOrder } from '@/lib/types';

/**
 * Plain-language description of each sort order.
 *
 * Mirrors the descriptions returned by `RankingService.describeSortOrder()`.
 */
export const SORT_ORDER_DESCRIPTIONS: Record<SortOrder, string> = {
  LOWEST_LANDED_COST:
    'Products are sorted by total estimated landed cost from lowest to ' +
    'highest. The total includes foreign retail price, transport costs, ' +
    'alcohol excise duty, and container duty.',
  LOWEST_PER_LITRE:
    'Products are sorted by cost per litre from lowest to highest. ' +
    'The cost per litre is calculated as total landed cost divided by ' +
    'product volume.',
  LOWEST_PER_UNIT:
    'Products are sorted by cost per unit from lowest to highest. ' +
    'The cost per unit is calculated as total landed cost divided by ' +
    'quantity.',
  ALPHABETICAL:
    'Products are sorted alphabetically by name from A to Z using ' +
    'Finnish locale rules.',
  ALCOHOL_PERCENTAGE:
    'Products are sorted by alcohol by volume (ABV) from highest to ' +
    'lowest.',
  PRODUCT_CATEGORY:
    'Products are grouped by category and sorted alphabetically ' +
    'within each category. Categories are ordered alphabetically ' +
    'using Finnish locale rules.',
};
