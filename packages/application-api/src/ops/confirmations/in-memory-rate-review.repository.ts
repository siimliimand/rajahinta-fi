/**
 * InMemoryRateReviewRepository — application-api-owned backing for the
 * data-acquisition RATE_REVIEW_REPOSITORY_PORT, bound in the ops module
 * scope (task 12.1, change technical-assessment-remediation).
 *
 * The data-acquisition package binds its own in-memory instance inside
 * DataAcquisitionModule (not exported), so the console binds its own here
 * — the operator-facing rate-review resolution path (list / approve /
 * reject). Same Phase 1 pattern as InMemoryCorrectionRepository; the
 * production swap is a Drizzle adapter behind the same port token.
 *
 * @module InMemoryRateReviewRepository
 */

import { Injectable } from '@nestjs/common';
import type { IRateReviewRepository } from '@rajahinta/data-acquisition';
import type {
  RateReviewEntry,
  RateReviewResolution,
  RateReviewStatus,
} from '@rajahinta/data-acquisition';

@Injectable()
export class InMemoryRateReviewRepository implements IRateReviewRepository {
  private readonly entries = new Map<string, RateReviewEntry>();

  /** @inheritdoc */
  async create(entry: RateReviewEntry): Promise<void> {
    if (this.entries.has(entry.id)) {
      throw new Error(`Rate-review entry with id "${entry.id}" already exists`);
    }
    this.entries.set(entry.id, { ...entry });
  }

  /** @inheritdoc */
  async findById(id: string): Promise<RateReviewEntry | null> {
    const entry = this.entries.get(id);
    return entry === undefined ? null : { ...entry };
  }

  /** @inheritdoc */
  async findByStatus(status: RateReviewStatus): Promise<RateReviewEntry[]> {
    const results = [...this.entries.values()].filter((entry) => entry.status === status);
    results.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return results.map((entry) => ({ ...entry }));
  }

  /** @inheritdoc */
  async updateStatus(
    id: string,
    status: RateReviewStatus,
    resolution?: RateReviewResolution,
    resolvedAt?: string,
    reviewerNotes?: string,
  ): Promise<void> {
    const existing = this.entries.get(id);
    if (existing === undefined) {
      throw new Error(`Cannot update status: no rate-review entry with id "${id}"`);
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
