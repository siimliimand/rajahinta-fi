/**
 * D1 CarrierBoxTypesRepository — read access to the carrier box catalogue
 * (task 3.1, change product-roadmap-phases-1-4). Read-only by contract:
 * rows are curated reference data maintained through the seed module
 * (a carrier-side spec change is a seed edit, not a runtime write path).
 *
 * Listings are ordered smallest internal volume first — the packing
 * engine's iteration order (design R4: select the smallest sufficient
 * box), made deterministic here so every consumer walks boxes the same
 * way. ISO-8601 TEXT instants convert to Date at the repository boundary
 * (design D2). Co-located abstract + concrete (price-alert precedent —
 * no pg counterpart exists).
 *
 * @module D1CarrierBoxTypesRepository
 */
import { Injectable } from '@nestjs/common';
import type { D1DatabaseLike } from '../../d1/executor';

/** Contract row — camelCase projection of the snake_case D1 row. */
export interface CarrierBoxTypeRecord {
  readonly id: number;
  readonly carrier: string;
  readonly name: string;
  readonly internalHeightMm: number;
  readonly internalWidthMm: number;
  readonly internalDepthMm: number;
  readonly maxWeightG: number;
  readonly source: string;
  readonly observedAt: Date;
}

/**
 * Box-geometry reference contract (spec: packing-optimization) — the
 * packing module's only source of box shapes and weight limits.
 */
@Injectable()
export abstract class CarrierBoxTypesRepository {
  /** One carrier's boxes, smallest internal volume first. */
  abstract listByCarrier(carrier: string): Promise<CarrierBoxTypeRecord[]>;

  /** Every carrier's boxes, smallest internal volume first. */
  abstract listAll(): Promise<CarrierBoxTypeRecord[]>;
}

/** Raw D1 carrier_box_types row. */
interface D1CarrierBoxTypeRow {
  readonly id: number;
  readonly carrier: string;
  readonly name: string;
  readonly internal_height_mm: number;
  readonly internal_width_mm: number;
  readonly internal_depth_mm: number;
  readonly max_weight_g: number;
  readonly source: string;
  readonly observed_at: string;
}

function toContractBox(row: D1CarrierBoxTypeRow): CarrierBoxTypeRecord {
  return {
    id: row.id,
    carrier: row.carrier,
    name: row.name,
    internalHeightMm: row.internal_height_mm,
    internalWidthMm: row.internal_width_mm,
    internalDepthMm: row.internal_depth_mm,
    maxWeightG: row.max_weight_g,
    source: row.source,
    observedAt: new Date(row.observed_at),
  };
}

const BOX_COLUMNS = `
  id, carrier, name, internal_height_mm, internal_width_mm, internal_depth_mm,
  max_weight_g, source, observed_at`;

// Volume-then-carrier-then-name ordering: "smallest box first" for the
// packing engine, fully deterministic even when two carriers list
// same-named or equal-volume boxes.
const ORDER_SMALLEST_FIRST = `
  ORDER BY internal_height_mm * internal_width_mm * internal_depth_mm ASC,
           carrier ASC, name ASC`;

const LIST_BY_CARRIER_SQL = `
  SELECT ${BOX_COLUMNS} FROM carrier_box_types WHERE carrier = ? ${ORDER_SMALLEST_FIRST}`;

const LIST_ALL_SQL = `
  SELECT ${BOX_COLUMNS} FROM carrier_box_types ${ORDER_SMALLEST_FIRST}`;

@Injectable()
export class D1CarrierBoxTypesRepository extends CarrierBoxTypesRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async listByCarrier(carrier: string): Promise<CarrierBoxTypeRecord[]> {
    const rows = (
      await this.d1.prepare(LIST_BY_CARRIER_SQL).bind(carrier).all<D1CarrierBoxTypeRow>()
    ).results;
    return rows.map(toContractBox);
  }

  /** @inheritdoc */
  async listAll(): Promise<CarrierBoxTypeRecord[]> {
    const rows = (await this.d1.prepare(LIST_ALL_SQL).all<D1CarrierBoxTypeRow>()).results;
    return rows.map(toContractBox);
  }
}
