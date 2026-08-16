/**
 * /governance barrel — public exports for the source governance subdomain.
 *
 * Consumers import from `@rajahinta/core-domain/governance` (or from the
 * top-level index when the module is re-exported).
 *
 * @module GovernanceIndex
 */

// Types
export type {
  AcquisitionMethod,
  PermissionStatus,
  SourceGovernanceRecord,
  RegisterSourceInput,
  PermissionCheckResult,
} from './source-governance.types';

// Ports
export type { ISourceGovernanceRepository } from './ports/source-governance-repository.port';
export { SOURCE_GOVERNANCE_REPOSITORY_PORT } from './ports/source-governance-repository.port';

// Service
export { SourceGovernanceService } from './services/source-governance.service';

// Module
export { SourceGovernanceModule } from './governance.module';