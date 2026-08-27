/**
 * Basket Calculation Record Adapter — domain-port implementation for
 * IBasketCalculationRecordPort.
 *
 * Maps the domain CreateBasketCalculationRecordInput to the data-platform
 * BasketCalculationRecordRepository.create() insert shape (which accepts
 * the strongly-typed basketCalculationRecords.$inferInsert).
 *
 * ## Key transformations
 *
 * | Domain field            | DB column / JSON shape                    | Notes                       |
 * |-------------------------|-------------------------------------------|-----------------------------|
 * | `destination`           | `destination`                             | Pass-through                |
 * | `transportArrangement`  | `transport_arrangement`                   | Re-keyed to snake_case      |
 * | `inputBasket`           | `input_basket` (JSON)                     | Serialized                  |
 * | `shipmentBreakdown`     | `shipment_breakdown` (JSON)               | Serialized                  |
 * | `totalCents`            | `total_cents`                             | Re-keyed to snake_case      |
 * | `confidence`            | `confidence`                              | Pass-through                |
 * | `disclaimer`            | `disclaimer`                              | Pass-through                |
 * | `sessionId`             | `session_id`                              | Re-keyed to snake_case, nullable |
 *
 * @module BasketCalculationRecordAdapter
 */

import { Injectable } from '@nestjs/common';
import {
  type IBasketCalculationRecordPort,
  type CreateBasketCalculationRecordInput,
} from '@rajahinta/core-domain';
import { BasketCalculationRecordRepository } from '@rajahinta/data-platform';

@Injectable()
export class BasketCalculationRecordAdapter implements IBasketCalculationRecordPort {
  constructor(
    private readonly repo: BasketCalculationRecordRepository,
  ) {}

  /** @inheritdoc */
  async create(
    record: CreateBasketCalculationRecordInput,
  ): Promise<{ id: number }> {
    const persisted = await this.repo.create({
      sessionId: record.sessionId,
      destination: record.destination,
      transportArrangement: record.transportArrangement,
      inputBasket: JSON.stringify(record.inputBasket),
      shipmentBreakdown: JSON.stringify(record.shipmentBreakdown),
      totalCents: record.totalCents,
      confidence: record.confidence,
      disclaimer: record.disclaimer,
    });
    return { id: persisted.id };
  }
}