/**
 * Curated traveller-allowances seed (task 5.1, change
 * product-roadmap-phases-1-4, design R7) — the trip feasibility
 * calculator's dataset of EU personal-use indicative limits.
 *
 * Every row carries a verifiable OFFICIAL source citation: Commission
 * Directive 2007/74/EC of 20 December 2007 (the tax-free allowance for
 * travellers entering the EU), Annex, alcoholic beverages, with the
 * specific rule text an operator can check against EUR-Lex before
 * confirming publication. Values are the directive's quantity limits —
 * indicative personal-use figures; the citation is the provenance, the
 * disclaimer wording is the presentation layer's concern (tasks 5.2/5.3).
 *
 * Derivation notes (how the EU rule maps onto the canonical tax-rule
 * category keys):
 * - The EU defines four alcoholic-beverage lines: spirits 10 l,
 *   intermediate products 20 l, wine 90 l in total (of which no more
 *   than 60 l sparkling wine), beer 110 l.
 * - `spirits` → 10 l; `intermediate_products` → 20 l; `beer` → 110 l.
 * - The 90 l wine quota is SHARED between still and sparkling wine, so
 *   it is represented as two rows: `wine_still` 90 l (the combined
 *   quota) and `wine_sparkling` 60 l (the sparkling sub-cap within it).
 *   The calculator combines the two rows into the official rule; the
 *   citations on both rows document the split.
 * - `other_fermented` (cider, long drink) has NO distinct EU allowance
 *   line and is deliberately NOT seeded — a missing cap row is explicit
 *   absence an operator can see, never a fabricated number.
 *
 * Idempotency contract mirrors the consumption-norms seed: the upsert
 * refreshes rows under a PENDING_CONFIRMATION dataset only. Published
 * versions are immutable (append-only dataset — a correction is a new
 * version), so a re-run can never rewrite a published version — and the
 * seed NEVER publishes.
 *
 * @module TravellerAllowancesSeed
 */
import type { D1DatabaseLike } from '../d1/executor';

export interface TravellerAllowanceSeedRow {
  readonly category: string;
  /** Volume cap in litres — null when the cap is quantity-only (EU alcohol limits are volume-only). */
  readonly volumeCapLitres: number | null;
  /** Quantity cap in units — null when the cap is volume-only. */
  readonly quantityCap: number | null;
  /** Verifiable citation: the specific directive rule text + the EUR-Lex URL. */
  readonly sourceCitation: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

/** Verifiable official source — Commission Directive 2007/74/EC on EUR-Lex. */
export const TRAVELLER_ALLOWANCES_CITATION_URL =
  'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32007L0074';

/** The one curated version this seed appends. Corrections append a new version — they never edit this one. */
export const TRAVELLER_ALLOWANCES_SEED_VERSION = 'eu-2007-74-2026.1';

/** Seed window: effective from the start of 2026, open-ended (null effectiveTo). */
const EFFECTIVE_FROM = '2026-01-01';

const DIRECTIVE =
  'Commission Directive 2007/74/EC of 20 December 2007, Annex, alcoholic beverages';

/** The dataset-level citation every version row inherits for provenance. */
export const TRAVELLER_ALLOWANCES_DATASET_CITATION =
  `${DIRECTIVE} — EU personal-use indicative allowances for travellers; ` +
  `quantities per person, indicative figures. EUR-Lex CELEX 32007L0074 ` +
  `(${TRAVELLER_ALLOWANCES_CITATION_URL})`;

/** Format one limit row's citation: the specific rule over the verifiable URL. */
function citation(rule: string): string {
  return (
    `${DIRECTIVE}: ${rule}. EUR-Lex CELEX 32007L0074 ` +
    `(${TRAVELLER_ALLOWANCES_CITATION_URL})`
  );
}

// ---------------------------------------------------------------------------
// The curated dataset — the four EU alcohol lines mapped onto the
// canonical tax-rule category keys (see derivation notes above). All
// volume caps; quantityCap stays null (the EU alcohol limits are
// volume-only).
// ---------------------------------------------------------------------------

export const TRAVELLER_ALLOWANCES_SEED: readonly TravellerAllowanceSeedRow[] = [
  {
    category: 'spirits',
    volumeCapLitres: 10,
    quantityCap: null,
    sourceCitation: citation('10 litres of spirits'),
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  },
  {
    category: 'intermediate_products',
    volumeCapLitres: 20,
    quantityCap: null,
    sourceCitation: citation(
      '20 litres of intermediate products (e.g. fortified wine such as port, sherry and vermouth)',
    ),
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  },
  {
    category: 'wine_still',
    volumeCapLitres: 90,
    quantityCap: null,
    sourceCitation: citation(
      '90 litres of wine IN TOTAL — the combined wine quota shared with sparkling wine (still + sparkling ≤ 90 l)',
    ),
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  },
  {
    category: 'wine_sparkling',
    volumeCapLitres: 60,
    quantityCap: null,
    sourceCitation: citation(
      'no more than 60 litres of sparkling wine within the 90-litre shared wine quota',
    ),
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  },
  {
    category: 'beer',
    volumeCapLitres: 110,
    quantityCap: null,
    sourceCitation: citation('110 litres of beer'),
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  },
];

// Append-only guard: a re-run refreshes rows under a PENDING_CONFIRMATION
// dataset only — a PUBLISHED version is terminal and can never be
// rewritten by the seed (corrections append a new version instead). The
// dataset statement guards on its own row (norms-seed pattern); the
// limits statement guards through the parent dataset's status.
const UPSERT_DATASET_SQL = `
  INSERT INTO traveller_allowance_datasets (
    version_label, source_citation, effective_from, effective_to
  ) VALUES (?, ?, ?, ?)
  ON CONFLICT (version_label) DO UPDATE SET
    source_citation = excluded.source_citation,
    effective_from = excluded.effective_from,
    effective_to = excluded.effective_to
  WHERE traveller_allowance_datasets.status = 'PENDING_CONFIRMATION'`;

const UPSERT_LIMIT_SQL = `
  INSERT INTO traveller_allowance_limits (
    dataset_id, category, volume_cap_litres, quantity_cap, source_citation,
    effective_from, effective_to
  ) VALUES (
    (SELECT id FROM traveller_allowance_datasets WHERE version_label = ?),
    ?, ?, ?, ?, ?, ?
  )
  ON CONFLICT (dataset_id, category) DO UPDATE SET
    volume_cap_litres = excluded.volume_cap_litres,
    quantity_cap = excluded.quantity_cap,
    source_citation = excluded.source_citation,
    effective_from = excluded.effective_from,
    effective_to = excluded.effective_to
  WHERE EXISTS (
    SELECT 1 FROM traveller_allowance_datasets
     WHERE id = excluded.dataset_id AND status = 'PENDING_CONFIRMATION'
  )`;

/**
 * Upsert the curated version into traveller_allowance_datasets +
 * traveller_allowance_limits as one batch — either the whole version
 * lands or nothing does. Idempotent: re-runs refresh pending rows in
 * place and leave published versions untouched. Never publishes: every
 * row stays PENDING_CONFIRMATION until an operator confirms it through
 * the manual dataset-confirmation path.
 */
export async function seedTravellerAllowances(
  d1: D1DatabaseLike,
): Promise<void> {
  await d1.batch([
    d1
      .prepare(UPSERT_DATASET_SQL)
      .bind(
        TRAVELLER_ALLOWANCES_SEED_VERSION,
        TRAVELLER_ALLOWANCES_DATASET_CITATION,
        EFFECTIVE_FROM,
        null,
      ),
    ...TRAVELLER_ALLOWANCES_SEED.map((row) =>
      d1
        .prepare(UPSERT_LIMIT_SQL)
        .bind(
          TRAVELLER_ALLOWANCES_SEED_VERSION,
          row.category,
          row.volumeCapLitres,
          row.quantityCap,
          row.sourceCitation,
          row.effectiveFrom,
          row.effectiveTo,
        ),
    ),
  ]);
}
