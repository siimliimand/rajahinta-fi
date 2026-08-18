/**
 * DrizzleCorrectionRepository — stub adapter for the core-domain
 * {@link ICorrectionRepository} port.
 *
 * **Stub implementation.** The Drizzle schema for flagged_items does not
 * exist yet. Once the schema is created, replace the stub body with real
 * Drizzle queries.
 *
 * Registered under the {@code CORRECTION_REPOSITORY_PORT} token in
 * {@link DataPlatformModule} so that the domain {@link CorrectionService}
 * can consume it in production deployments.
 *
 * @module DrizzleCorrectionRepository
 */

import { Injectable, Logger } from '@nestjs/common';
import type {
  ICorrectionRepository,
  FlaggedItem,
  FlagTargetType,
} from '@rajahinta/core-domain';

@Injectable()
export class DrizzleCorrectionRepository implements ICorrectionRepository {
  private readonly logger = new Logger(DrizzleCorrectionRepository.name);

  /** Stub counter — replaced with DB sequence. */
  private nextId = 1000;

  async create(data: {
    targetType: FlagTargetType;
    targetId: number;
    reason: string;
    flaggedBy: string;
    inputSnapshot: unknown | null;
  }): Promise<FlaggedItem> {
    this.logger.warn(
      `DrizzleCorrectionRepository.create() is a stub — ` +
        `no DB table exists yet. Flag for ${data.targetType}#${data.targetId} simulated.`,
    );

    const id = this.nextId++;
    return {
      id,
      targetType: data.targetType,
      targetId: data.targetId,
      reason: data.reason,
      status: 'OPEN',
      flaggedBy: data.flaggedBy,
      createdAt: new Date(),
      resolvedBy: null,
      resolution: null,
      note: null,
      inputSnapshot: data.inputSnapshot,
    };
  }

  async resolve(
    id: number,
    _data: {
      status: 'OPEN' | 'ACCEPTED' | 'REJECTED';
      resolvedBy: string;
      resolution: 'OPEN' | 'ACCEPTED' | 'REJECTED';
      note: string | null;
    },
  ): Promise<FlaggedItem | null> {
    this.logger.warn(
      `DrizzleCorrectionRepository.resolve(${id}) is a stub — no DB table exists yet.`,
    );
    return null;
  }

  async findOpen(): Promise<FlaggedItem[]> {
    this.logger.warn(
      'DrizzleCorrectionRepository.findOpen() is a stub — returning empty array.',
    );
    return [];
  }

  async findById(_id: number): Promise<FlaggedItem | null> {
    this.logger.warn(
      `DrizzleCorrectionRepository.findById(${_id}) is a stub — returning null.`,
    );
    return null;
  }
}