/**
 * In-memory rate-review repository (Phase 1).
 *
 * Stores {@link RateReviewEntry} objects in a Map.  Ephemeral — entries
 * are lost on process restart.  Suitable for MVP; replace with a
 * Drizzle/PostgreSQL adapter for production.
 *
 * Uses the same pattern as {@code InMemoryAuditRepository} in
 * application-api.
 *
 * @module InMemoryRateReviewRepository
 */

import { Injectable } from '@nestjs/common';
import type {
  IRateReviewRepository,
} from '../interfaces/rate-review-repository.port';
import type {
  RateReviewEntry,
  RateReviewStatus,
  RateReviewResolution,
} from '../interfaces/rate-review.types';

@Injectable()
export class InMemoryRateReviewRepository implements IRateReviewRepository {
  private readonly entries: Map<string, RateReviewEntry> = new Map();

  async create(entry: RateReviewEntry): Promise<void> {
    if (this.entries.has(entry.id)) {
      throw new Error(
        `Rate-review entry with id "${entry.id}" already exists`,
      );
    }
    this.entries.set(entry.id, { ...entry });
  }

  async findById(id: string): Promise<RateReviewEntry | null> {
    const entry = this.entries.get(id);
    return entry ? { ...entry } : null;
  }

  async findByStatus(status: RateReviewStatus): Promise<RateReviewEntry[]> {
    const results: RateReviewEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status === status) {
        results.push({ ...entry });
      }
    }
    // Newest first
    results.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return results;
  }

  async updateStatus(
    id: string,
    status: RateReviewStatus,
    resolution?: RateReviewResolution,
    resolvedAt?: string,
    reviewerNotes?: string,
  ): Promise<void> {
    const existing = this.entries.get(id);
    if (!existing) {
      throw new Error(
        `Cannot update status: no rate-review entry with id "${id}"`,
      );
    }
    this.entries.set(id, {
      ...existing,
      status,
      ...(resolution !== undefined ? { resolution } : {}),
      ...(resolvedAt !== undefined ? { resolvedAt } : {}),
      ...(reviewerNotes !== undefined ? { reviewerNotes } : {}),
    });
  }
}