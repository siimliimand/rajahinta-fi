/**
 * Source Governance Module.
 *
 * Registers the source governance service and exports the repository port
 * token so the composition root can wire a concrete adapter.
 *
 * Import this module into CoreDomainModule to make SourceGovernanceService
 * available for injection.
 *
 * @module SourceGovernanceModule
 */
import { Module } from '@nestjs/common';
import { SourceGovernanceService } from './services/source-governance.service';
import { SOURCE_GOVERNANCE_REPOSITORY_PORT } from './ports/source-governance-repository.port';

@Module({
  providers: [
    SourceGovernanceService,
    { provide: SOURCE_GOVERNANCE_REPOSITORY_PORT, useValue: null },
  ],
  exports: [SourceGovernanceService],
})
export class SourceGovernanceModule {}