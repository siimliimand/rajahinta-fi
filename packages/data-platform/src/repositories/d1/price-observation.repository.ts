/**
 * R2 observation-recorder port adapter — the Cloudflare-side
 * implementation of the core-domain {@link IPriceObservationPort} (task
 * 2.3, design D4 as amended by gate review G1). The adapter shell
 * serializes the domain observation to the R2 JSONL layout
 * (src/d1/observation-log.ts) and delegates persistence to a
 * constructor-injected {@link ObservationLogStore} — no wrangler types at
 * this layer; the real R2 binding satisfies the store interface
 * structurally once the wrangler wiring lands (binding task, phase 3).
 *
 * The pg adapter (DrizzlePriceObservationRepository) implemented the same
 * port against the price_observations table; per the amended D4 the row
 * becomes one JSONL line in the observation's date-partitioned object,
 * carrying the exact pg field set with rule-version snapshots collapsed
 * to FK ids — the identical mapping the pg append performed.
 *
 * Append-only: this port exposes no update or delete, and the adapter
 * never rewrites an existing line — corrections append new observations.
 *
 * ## Row identity
 *
 * The pg row id was a serial assigned by the database; the JSONL log has
 * no sequence, so the id is assigned application-side by a
 * constructor-injected generator. The default generator is process-local
 * monotonic (ms epoch × 4096 + per-call counter, within Number.MAX_SAFE_INTEGER)
 * preserving the (observed_at, id) series-order convention consumers
 * rely on; a multi-isolate production binding must inject a generator
 * with cross-isolate uniqueness (the wiring task's concern).
 *
 * @module R2ObservationPort
 */
import { Injectable } from '@nestjs/common';
import type {
  IPriceObservationPort,
  PriceObservation,
} from '@rajahinta/core-domain';
import {
  observationObjectKey,
  serializeObservationLine,
  type ObservationLogRecord,
  type ObservationLogStore,
} from '../../d1/observation-log';

/** Process-local monotonic id counter for the default generator. */
let defaultIdCounter = 0;

/**
 * Default observation-id generator: process-local monotonic, stable for
 * the (observed_at, id) tie-break convention. Inject `nextId` for tests
 * and for production bindings that need cross-isolate uniqueness.
 */
export function defaultObservationId(): number {
  const id = Date.now() * 4096 + (defaultIdCounter % 4096);
  defaultIdCounter += 1;
  return id;
}

/**
 * Domain observation + assigned id → the R2 log record. The mapping
 * mirrors the pg append exactly: rule-version snapshots collapse to
 * `*_rule_version_id` (null on engine fallback), `input_reliability`
 * passes through as the domain snapshot object (pg jsonb content),
 * `observed_at` becomes ISO-8601 UTC TEXT.
 */
export function toObservationLogRecord(
  observation: PriceObservation,
  id: number,
): ObservationLogRecord {
  return {
    id,
    product_id: observation.productId,
    merchant: observation.merchant,
    retail_offer_id: observation.retailOfferId,
    observed_at: observation.observedAt.toISOString(),
    foreign_retail_price_cents: observation.foreignRetailPriceCents,
    transport_cost_cents: observation.transportCostCents,
    transport_offer_id: observation.transportOfferId,
    excise_rule_version_id: observation.exciseRuleVersion?.ruleId ?? null,
    container_duty_rule_version_id:
      observation.containerDutyRuleVersion?.ruleId ?? null,
    landed_cost_cents: observation.landedCostCents,
    input_reliability: observation.inputReliability,
    confidence: observation.confidence,
  };
}

@Injectable()
export class R2PriceObservationPort implements IPriceObservationPort {
  constructor(
    private readonly store: ObservationLogStore,
    private readonly nextId: () => number = defaultObservationId,
  ) {}

  /**
   * Append one observation: assign the id, serialize to the R2 layout,
   * and delegate the append to the date-partitioned object of the
   * observation's UTC day. Returns the assigned row id.
   */
  async append(observation: PriceObservation): Promise<{ id: number }> {
    const id = this.nextId();
    const record = toObservationLogRecord(observation, id);
    await this.store.appendLine(
      observationObjectKey(observation.observedAt),
      serializeObservationLine(record),
    );
    return { id };
  }
}
