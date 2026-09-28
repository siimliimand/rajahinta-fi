/**
 * Posti carrier rate source — manually curated dataset.
 *
 * Posti's parcel price tables are transcribed into the curated dataset
 * below and updated by hand, exactly like the Fransberg source
 * (`fransberg-rate.source.ts`). The historical reason is access: the
 * price-list JSON endpoint (www.posti.fi/api/price-list/parcels.json)
 * sits behind a CDN that rejects datacenter and Cloudflare egress IPs
 * (HTTP 403 / error 1031), so no Worker can fetch it; the endpoint had
 * no Wayback captures either. If Posti ever grants API access, reintroduce
 * the live fetch — the JSON parser lives in git history
 * (posti-rate.source.ts before 2026-09-28) and its golden fixture with it.
 *
 * Admin procedure (same contract as Fransberg):
 * 1. Read Posti's published parcel price table (posti.fi price pages).
 * 2. Transcribe the rows relevant to the calculator's lanes (shipping
 *    TO Finland) into POSTI_RATES below — one entry per lane + package
 *    tier + weight bracket.
 * 3. Bump POSTI_OBSERVED_AT to the review date.
 * 4. Deploy — the monthly curated sync cron appends the new rows; the
 *    per-carrier skip keeps an unchanged dataset from duplicating history.
 *
 * The dataset starts EMPTY (2026-09-28): no authoritative price source
 * was reachable for the initial transcription, and illustrative fixture
 * prices must never become production data. Until the first
 * transcription, the transport offer table simply carries no Posti rows
 * and the calculator degrades transport to ESTIMATED/UNAVAILABLE, as it
 * already does with an empty table.
 *
 * @module PostiRateSource
 */

import { Injectable } from '@nestjs/common';
import type {
  CarrierRateOffer,
  ICarrierRateSource,
} from '../interfaces/carrier-rate-source.port';

// ---------------------------------------------------------------------------
// Curated dataset — edit here when transcribing Posti's price table
// ---------------------------------------------------------------------------

/** Review date of the current transcription — the observation time every offer carries. */
export const POSTI_OBSERVED_AT = new Date('2026-09-28T00:00:00Z');

/**
 * The transcribed Posti rate rows.
 *
 * Row shape (see {@link CarrierRateOffer}): carrier is always 'posti';
 * originCountry/destinationCountry name the shipping lane (ISO alpha-2);
 * weightMinKg/weightMaxKg bound the bracket (null = no limit); priceCents
 * is VAT-inclusive in EUR cents; sellerInvolvementIndicator is true only
 * when the SELLER pays the transport (recipient-paid deliveries are
 * false). Copy the observedAt from POSTI_OBSERVED_AT.
 *
 * Transcription targets when filling this in: Posti's published parcel
 * price tables for shipping to Finland (posti.fi). The downstream
 * calculator selects by lane + package tier (parcel/box/pallet) + weight
 * bracket, so transcribe every tier the source publishes per lane.
 */
const POSTI_RATES: readonly CarrierRateOffer[] = [];

/** Build the curated Posti rate rows — pure, like the Fransberg builder. */
export function buildPostiRates(): CarrierRateOffer[] {
  return POSTI_RATES.map((rate) => ({ ...rate }));
}

// ---------------------------------------------------------------------------
// Source adapter
// ---------------------------------------------------------------------------

/**
 * Curated Posti source — deterministic, no network. The pipeline appends
 * the built rows verbatim with a VERIFIED reliability status; the
 * curated sync cron's per-carrier skip prevents unchanged datasets from
 * writing duplicate history.
 */
@Injectable()
export class PostiCarrierRateSource implements ICarrierRateSource {
  readonly carrierId = 'posti';

  async fetchRates(): Promise<{ rates: CarrierRateOffer[]; errors: string[] }> {
    return { rates: buildPostiRates(), errors: [] };
  }
}
