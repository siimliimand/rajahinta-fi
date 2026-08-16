/**
 * Transport classification types — distinguishes retailer-arranged transport
 * from independent carrier transport for Transaction Classification.
 *
 * @module TransportClassification
 */

/**
 * Who arranged the transport for a cross-border transaction.
 *
 * - `RETAILER_ARRANGED` — the seller selected and paid the carrier (e.g.,
 *   DDP / delivered-duty-paid terms).  The transport cost is included in
 *   the retail price or charged by the retailer.
 * - `INDEPENDENT_CARRIER` — the buyer chose and paid a carrier directly
 *   (e.g., a freight forwarder, the buyer's own logistics provider).
 * - `UNKNOWN` — insufficient data to determine.
 */
export type TransactionTransportType =
  | 'RETAILER_ARRANGED'
  | 'INDEPENDENT_CARRIER'
  | 'UNKNOWN';