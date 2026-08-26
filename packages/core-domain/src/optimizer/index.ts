/**
 * /optimizer barrel — public exports for the basket optimization subdomain.
 *
 * Consumers import from `@rajahinta/core-domain` (re-exported via the
 * top-level index).
 *
 * @module OptimizerIndex
 */

// Caps
export {
  MAX_BASKET_ITEMS,
  MAX_CANDIDATE_MERCHANTS_PER_ITEM,
} from './optimizer.types';

// Types
export type {
  BasketInputItem,
  BasketOptimizationInput,
  ConsolidatedTransportReliability,
  ConsolidatedTransport,
  MinimumOrderThresholdCheck,
  BasketShipment,
  BasketOptimizationMetadata,
  BasketOptimizationAlternate,
  BasketOptimizationResult,
} from './optimizer.types';

// Ports
export type { IMerchantTermsPort, MerchantTerms } from './ports/merchant-terms.port';
export { MERCHANT_TERMS_PORT } from './ports/merchant-terms.port';

// Module
export { OptimizerModule } from './optimizer.module';