/**
 * CorrectionService — application-layer service for correction flag management.
 *
 * Delegates persistence to an {@link ICorrectionRepository} adapter wired
 * at the composition root. Phase 1 uses {@link InMemoryCorrectionRepository};
 * production uses the Drizzle-based repository from data-platform.
 *
 * @module CorrectionService
 */

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CORRECTION_REPOSITORY_PORT,
  type ICorrectionRepository,
} from './correction-repository.port';
import type {
  CreateCorrectionDto,
  CorrectionItem,
  CorrectionListResponse,
} from './correction.dto';

@Injectable()
export class CorrectionService {
  private readonly logger = new Logger(CorrectionService.name);

  constructor(
    @Inject(CORRECTION_REPOSITORY_PORT)
    private readonly repository: ICorrectionRepository,
  ) {}

  /**
   * Create a new correction flag.
   *
   * @param dto — The flag details from the request body.
   * @returns The created CorrectionItem with assigned id and timestamps.
   */
  async createFlag(dto: CreateCorrectionDto): Promise<CorrectionItem> {
    this.logger.debug(
      `Creating flag: targetType=${dto.targetType} targetId=${dto.targetId}`,
    );
    return this.repository.create({
      targetType: dto.targetType,
      targetId: dto.targetId,
      reason: dto.reason,
    });
  }

  /**
   * List all correction flags, newest first.
   *
   * @returns A list response with items and total count.
   */
  async listFlags(): Promise<CorrectionListResponse> {
    const items = await this.repository.findAll();
    return { items, total: items.length };
  }

  /**
   * Resolve a correction flag by ID.
   *
   * @param id — The flag to resolve.
   * @param resolution — Resolution notes.
   * @returns The updated CorrectionItem.
   * @throws {NotFoundException} If the flag does not exist.
   */
  async resolveFlag(id: number, resolution: string): Promise<CorrectionItem> {
    const updated = await this.repository.resolve(id, resolution);
    if (updated === null) {
      throw new NotFoundException(`Correction flag ${id} not found`);
    }
    this.logger.debug(`Flag ${id} resolved`);
    return updated;
  }
}