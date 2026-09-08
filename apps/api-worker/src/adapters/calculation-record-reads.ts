/**
 * Owned calculation-record reads (tasks 3.2/6.1, change
 * trust-and-reach-roadmap) — the raw record rows the outcome-submission
 * and share-snapshot routes need, which the declaration-facing query
 * adapter deliberately does not expose: the OWNER (session_id — the
 * account userId that claimed the record, first-claim-wins via the
 * account store) and the raw breakdown JSON the outcome freezes as its
 * estimate digest.
 *
 * Ownership is resolved HERE and compared by the route: a record that
 * does not exist and one owned by another account are distinct results,
 * so the API can answer 404 vs 403 without a second query.
 *
 * @module CalculationRecordReads
 */

import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';

/** The record facts the outcome/share flows consume. */
export interface OwnedCalculationRecord {
  readonly id: number;
  /** The owning account's userId (calculation_records.session_id), or null while unclaimed. */
  readonly ownerUserId: string | null;
  /** The record's calculation timestamp — the outcome window's origin. */
  readonly calculatedAt: Date;
  readonly totalCents: number;
  /** The itemized estimate lines (JSON-parsed) — the outcome's frozen digest face. */
  readonly breakdown: unknown;
  readonly confidence: string;
  readonly quantity: number;
  readonly destination: string;
  /** The structural disclaimer (JSON-parsed object) — part of every frozen copy. */
  readonly disclaimer: unknown;
  readonly productName: string;
  readonly productBrand: string | null;
  readonly productCategory: string;
}

interface OwnedRecordRow {
  readonly id: number;
  readonly session_id: string | null;
  readonly calculated_at: string;
  readonly total_cents: number;
  readonly breakdown: string;
  readonly confidence: string;
  readonly quantity: number;
  readonly destination: string;
  readonly disclaimer: string;
  readonly product_name: string;
  readonly product_brand: string | null;
  readonly product_category: string;
}

const OWNED_RECORD_SQL = `
  SELECT r.id, r.session_id, r.calculated_at, r.total_cents, r.breakdown,
         r.confidence, r.quantity, r.destination, r.disclaimer,
         p.name AS product_name, p.brand AS product_brand,
         p.category AS product_category
    FROM calculation_records r
    JOIN product_master p ON p.id = r.product_master_id
   WHERE r.id = ?
   LIMIT 1`;

/** Parse the persisted disclaimer JSON; plain text degrades verbatim. */
function parseDisclaimer(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * One calculation record with its owner, or null when absent. The
 * breakdown/disclaimer parse degrades to null/verbatim like the
 * declaration adapter — a corrupt row must not fail a share or block an
 * outcome with an opaque 500.
 */
export async function findOwnedCalculationRecord(
  d1: D1DatabaseLike,
  recordId: number,
): Promise<OwnedCalculationRecord | null> {
  const row = await d1.prepare(OWNED_RECORD_SQL).bind(recordId).first<OwnedRecordRow>();
  if (row === null) return null;

  let breakdown: unknown = null;
  try {
    breakdown = JSON.parse(row.breakdown);
  } catch {
    breakdown = null;
  }

  return {
    id: row.id,
    ownerUserId: row.session_id,
    calculatedAt: new Date(row.calculated_at),
    totalCents: row.total_cents,
    breakdown,
    confidence: row.confidence,
    quantity: row.quantity,
    destination: row.destination,
    disclaimer: parseDisclaimer(row.disclaimer),
    productName: row.product_name,
    productBrand: row.product_brand,
    productCategory: row.product_category,
  };
}
