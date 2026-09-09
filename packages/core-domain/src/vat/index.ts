/**
 * /vat barrel — public exports for the import-VAT subdomain.
 *
 * Consumers import from `@rajahinta/core-domain/vat` once the package
 * barrel re-exports this module (calculator integration, task 4.3).
 *
 * @module VatIndex
 */

// Dataset
export {
  IMPORT_VAT_TAX_TYPE,
  IMPORT_VAT_FORMULA,
  IMPORT_VAT_VERSION_V1,
  IMPORT_VAT_VERSION_V2,
  IMPORT_VAT_DATASET,
} from './import-vat.dataset';
export type {
  ImportVatVersion,
  VatBaseComponent,
  VatComponentAmounts,
} from './import-vat.dataset';

// Pure math (exported for testing / direct use)
export {
  resolveImportVatVersion,
  calculateImportVat,
  sumBaseComponents,
} from './import-vat.math';
export type { VatBaseComponentAmount } from './import-vat.math';

// Service
export { ImportVatService } from './import-vat.service';
export type { ImportVatInput, ImportVatResult } from './import-vat.service';

// Module
export { VatModule } from './vat.module';
