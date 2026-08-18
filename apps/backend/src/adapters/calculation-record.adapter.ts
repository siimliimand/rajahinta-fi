/**
 * Calculation Record Adapter — domain-port implementation for ICalculationRecordPort.
 *
 * Maps the domain CreateCalculationRecordInput to the Drizzle
 * CalculationRecordRepository insert type and delegates persistence.
 *
 * ## Key transformations
 *
 * | Domain field              | Database column        | Notes                         |
 * |---------------------------|------------------------|-------------------------------|
 * | `disclaimer` (object)     | `disclaimer` (text)    | JSON.stringify — text storage |
 * | `retailOfferIds` (array)  | `retail_offer_ids` (jsonb) | Passed as-is (Drizzle serializes) |
 * | `breakdown` (unknown)     | `breakdown` (jsonb)    | Passed as-is (Drizzle serializes) |
 *
 * @module CalculationRecordAdapter
 */

import { Injectable } from '@nestjs/common';
import { CalculationRecordRepository } from '@rajahinta/data-platform';
import type {
  ICalculationRecordPort,
  CreateCalculationRecordInput,
} from '@rajahinta/core-domain';

@Injectable()
export class CalculationRecordAdapter implements ICalculationRecordPort {
  constructor(private readonly repo: CalculationRecordRepository) {}

  /**
   * Persist a calculation record and return its assigned ID.
   */
  async create(
    record: CreateCalculationRecordInput,
  ): Promise<{ id: number }> {
    const persisted = await this.repo.create({
      productMasterId: record.productMasterId,
      retailOfferIds: record.retailOfferIds as unknown,
      transportOfferId: record.transportOfferId,
      exciseRuleVersionId: record.exciseRuleVersionId,
      containerDutyRuleVersionId: record.containerDutyRuleVersionId,
      totalCents: record.totalCents,
      breakdown: record.breakdown,
      confidence: record.confidence,
      quantity: record.quantity,
      destination: record.destination,
      disclaimer: JSON.stringify(record.disclaimer),
      sessionId: record.sessionId,
    });

    return { id: persisted.id };
  }
}