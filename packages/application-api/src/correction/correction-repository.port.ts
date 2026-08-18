/**
 * Correction repository port — abstraction for correction flag persistence.
 *
 * The port uses the application-layer {@link CorrectionItem} type so the
 * controller and service work with DTOs directly without cross-layer type
 * mapping during Phase 1.
 *
 * Concrete adapters:
 * - {@link InMemoryCorrectionRepository} — dev/test (in-memory Map)
 * - DrizzleCorrectionRepository — prod (Drizzle ORM over PostgreSQL)
 *
 * @module CorrectionRepositoryPort
 */

import type { CorrectionItem } from './correction.dto';

/** Injection token for ICorrectionRepository. */
export const CORRECTION_REPOSITORY_PORT = 'CORRECTION_REPOSITORY_PORT';

/**
 * Repository contract for correction flag persistence.
 */
export interface ICorrectionRepository {
  /**
   * Persist a new correction flag.
   *
   * @param data — The flag data (id is assigned by the repository).
   * @returns The created flag with assigned id and timestamps.
   */
  create(data: {
    targetType: 'calculation' | 'data_point';
    targetId: number;
    reason: string;
  }): Promise<CorrectionItem>;

  /**
   * Retrieve all correction flags.
   *
   * Ordered by createdAt descending (most recent first).
   */
  findAll(): Promise<CorrectionItem[]>;

  /**
   * Resolve a correction flag by setting its status to 'resolved'.
   *
   * @param id — The flag to resolve.
   * @param resolution — Resolution notes.
   * @returns The updated flag, or null if not found.
   */
  resolve(id: number, resolution: string): Promise<CorrectionItem | null>;
}