/**
 * VAT Module — aggregates the import-VAT engine.
 *
 * Import this module to make ImportVatService available for injection.
 * Unlike TaxModule there is no repository port option: the versioned rate
 * dataset ships with the module (design D5, alks-feed-and-import-vat), so
 * no host-provided adapter exists yet.
 *
 * @module VatModule
 */
import { Module } from '@nestjs/common';
import { ImportVatService } from './import-vat.service';

@Module({
  providers: [ImportVatService],
  exports: [ImportVatService],
})
export class VatModule {}
