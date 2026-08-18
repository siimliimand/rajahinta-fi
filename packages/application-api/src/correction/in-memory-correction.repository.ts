/**
 * In-memory implementation of {@link ICorrectionRepository}.
 *
 * Phase 1 dev/test adapter backed by a plain Map. Replaced by
 * {@link DrizzleCorrectionRepository} in production deployments.
 *
 * @module InMemoryCorrectionRepository
 */

import { Injectable } from '@nestjs/common';
import type { ICorrectionRepository } from './correction-repository.port';
import type { CorrectionItem } from './correction.dto';

@Injectable()
export class InMemoryCorrectionRepository implements ICorrectionRepository {
  /** In-memory flag store. */
  private readonly store = new Map<number, CorrectionItem>();

  /** Auto-incrementing ID counter. */
  private nextId = 1;

  async create(data: {
    targetType: 'calculation' | 'data_point';
    targetId: number;
    reason: string;
  }): Promise<CorrectionItem> {
    const id = this.nextId++;
    const now = new Date().toISOString();
    const item: CorrectionItem = {
      id,
      targetType: data.targetType,
      targetId: data.targetId,
      reason: data.reason,
      status: 'open',
      createdAt: now,
      resolvedAt: null,
      resolution: null,
    };
    this.store.set(id, item);
    return item;
  }

  async findAll(): Promise<CorrectionItem[]> {
    return Array.from(this.store.values()).reverse();
  }

  async resolve(
    id: number,
    resolution: string,
  ): Promise<CorrectionItem | null> {
    const item = this.store.get(id);
    if (item === undefined) return null;

    const now = new Date().toISOString();
    const updated: CorrectionItem = {
      ...item,
      status: 'resolved',
      resolvedAt: now,
      resolution,
    };
    this.store.set(id, updated);
    return updated;
  }
}