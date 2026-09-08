/**
 * Merchant-warnings join (task 2.2, change trust-and-reach-roadmap,
 * design D2) — resolves PUBLISHED blacklist entries for the merchants
 * appearing in a response's offers and returns the additive
 * `merchantWarnings` block.
 *
 * Matching is the module's merchant identity (core-domain blacklist):
 * a response merchant string matches an entry on the normalized DOMAIN
 * or the normalized NAME — offers store one loose merchant string, and
 * either half of the identity is a legitimate match. Every comparison
 * runs on normalized values so `WWW.Example.com`, `www.example.com`,
 * and `Example Oy` resolve to the same merchants the reports and
 * entries were stored under.
 *
 * Strictly additive (spec merchant-blacklist "Display-only warnings"):
 * the block never excludes offers, never reorders, and never touches a
 * calculated value — the route embeds it as one extra top-level field.
 * The lookup is fail-open: a warnings-store failure omits the block
 * (absent, not an empty array — the byte-identity contract keys on the
 * offers, and a partial outage must not present a false "no warnings").
 *
 * @module MerchantWarningsService
 */

import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import {
  isEntryPubliclyVisible,
  normalizeMerchantDomain,
  normalizeMerchantName,
} from '../../../../packages/core-domain/src/blacklist/blacklist';

/** The public methodology page a warning links to (task 2.4 renders it). */
export const RANKING_METHODOLOGY_URL = '/ranking';

/** One public warning — the published entry's display face. */
export interface MerchantWarning {
  /** Normalized domain of the warned merchant (entry identity, domain half). */
  readonly merchantDomain: string;
  /** Normalized name of the warned merchant (entry identity, name half). */
  readonly merchantName: string;
  /** The published-standard basis the operator published under. */
  readonly standardMet: string;
  /** When the entry was published (ISO-8601). */
  readonly publishedAt: string;
  /** The ranking-methodology page explaining what a warning means. */
  readonly methodologyUrl: string;
}

/** A raw published-entry row the join reads (blacklist_entries projection). */
interface PublishedEntryRow {
  readonly merchant_domain: string;
  readonly merchant_name_normalized: string;
  readonly standard_met: string;
  readonly published_at: string;
  readonly status: string;
}

const PUBLISHED_ENTRIES_SQL = `
  SELECT merchant_domain, merchant_name_normalized, standard_met,
         published_at, status
    FROM blacklist_entries
   WHERE status = 'PUBLISHED'
   ORDER BY id ASC`;

/**
 * Normalize a response merchant string into its (domain, name) match
 * keys WITHOUT throwing — an offer merchant that cannot normalize to a
 * domain (internal whitespace) still has a name key, and the join must
 * never fail a response over an unmatchable string.
 */
function merchantMatchKeys(merchant: string): { domain: string; name: string } {
  const trimmed = merchant.trim();
  let domain = '';
  try {
    domain = normalizeMerchantDomain(trimmed);
  } catch {
    domain = '';
  }
  return { domain, name: normalizeMerchantName(trimmed) };
}

/**
 * The `merchantWarnings` block for a set of response merchants, or
 * `undefined` when nothing matches or the lookup fails. One query —
 * the entries table is governance-scale, not offer-scale.
 */
export async function getMerchantWarnings(
  d1: D1DatabaseLike,
  merchants: ReadonlySet<string>,
): Promise<MerchantWarning[] | undefined> {
  if (merchants.size === 0) return [];

  try {
    const rows = (
      await d1.prepare(PUBLISHED_ENTRIES_SQL).all<PublishedEntryRow>()
    ).results;

    // Defense in depth: the query filters PUBLISHED, the state machine's
    // visibility predicate decides — an unknown stored status never warns.
    const published = rows.filter((row) => isEntryPubliclyVisible(row.status as never));

    const warnings: MerchantWarning[] = [];
    for (const merchant of merchants) {
      const keys = merchantMatchKeys(merchant);
      for (const entry of published) {
        if (entry.merchant_domain === keys.domain || entry.merchant_name_normalized === keys.name) {
          warnings.push({
            merchantDomain: entry.merchant_domain,
            merchantName: entry.merchant_name_normalized,
            standardMet: entry.standard_met,
            publishedAt: new Date(entry.published_at).toISOString(),
            methodologyUrl: RANKING_METHODOLOGY_URL,
          });
        }
      }
    }
    return warnings;
  } catch {
    // Fail-open: informational embed, never a response-killing dependency.
    return undefined;
  }
}

/**
 * Distinct merchants across the offers of one page of products — the
 * search/compare join's merchant set (one query, ids bounded by the
 * search route's page caps).
 */
export async function merchantsForProducts(
  d1: D1DatabaseLike,
  productIds: readonly number[],
): Promise<Set<string>> {
  const merchants = new Set<string>();
  if (productIds.length === 0) return merchants;

  const placeholders = productIds.map(() => '?').join(', ');
  const rows = (
    await d1
      .prepare(
        `SELECT DISTINCT merchant FROM retail_offers WHERE product_id IN (${placeholders})`,
      )
      .bind(...productIds)
      .all<{ merchant: string }>()
  ).results;
  for (const row of rows) merchants.add(row.merchant);
  return merchants;
}
