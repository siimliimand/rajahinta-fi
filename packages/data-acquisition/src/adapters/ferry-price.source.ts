/**
 * Ferry onboard-shop price source — manually curated dataset (the
 * Fransberg/Posti pattern) behind the trip responses' display-only
 * observed-prices block (task 2.2, change ferry-onboard-prices; storage:
 * `ferry_price_observations` via D1FerryPriceRepository).
 *
 * None of the three Baltic operators offers a sanctioned machine-readable
 * feed (task 1.1 sweep verdict: live-feed NO-GO), so the prices are
 * transcribed by hand from the operators' publicly browsable shops into
 * the dataset below and updated by hand. When an operator's shop prices
 * change: re-transcribe the affected rows, bump {@link FERRY_OBSERVED_AT}
 * to the review date, deploy — the monthly curated sync cron upserts the
 * new observation set (a changed observedAt lands NEW rows; prior months
 * stay as append-only history) and the per-operator unchanged-skip keeps
 * an unchanged dataset from writing duplicate history. The transcription
 * procedure, citation rules, and the per-operator governance grants are
 * documented in docs/ingestion-runbook.md (ferry section).
 *
 * Dataset contract (first transcription 2026-10-11):
 * - Operators: `tallink` (Tallink Silja), `eckero` (Eckerö Line), and
 *   `viking` (Viking Line). The operator keys are also the
 *   source_governance keys the refresh cron checks before ingesting —
 *   one operator key per ferry operator, fail-closed PENDING until
 *   granted through the ops console.
 * - Routes: `Helsinki–Tallinn` (en dash) for both transcribed operators —
 *   Tallink rows come from the per-ship onboard shop of M/S MyStar (a
 *   Helsinki–Tallinn vessel; the onboard shop's URL path IS the ship/route
 *   dimension), Eckerö rows from the M/S Finlandia pre-order shop (single
 *   -route operator). Viking has ZERO rows: its shop is bot-gated
 *   (Imperva Incapsula + Distil), no price was reachable without
 *   circumvention, and the route taxonomy needed operator input — the
 *   empty operator is the designed empty state, never a placeholder.
 *   Empty state accepted 2026-10-11 — see the runbook ferry section
 *   for the revisit path.
 * - Prices: EUR minor units, VAT-inclusive as displayed. Tallink's shop
 *   dual-publishes priceExTax/priceIncTax with taxMultiplier 1.24 — the
 *   recorded price is priceIncTax, the VAT-inclusive consumer price the
 *   shop displays (24% Finnish VAT). Eckerö's data-price carries the
 *   currently displayed (sale-adjusted, VAT-inclusive) Magento price —
 *   where the shop shows regular + special, the special (purchasable)
 *   price is recorded, exactly as displayed at access time.
 * - Labels are verbatim shop display labels (including the operators'
 *   own spacing and pack notation, e.g. "3 x 50 cl"), so the trip block
 *   can show what the onboard menu shows. No EAN is stored — schema-level
 *   data minimization (the sweep saw EANs in Tallink's custom1 field;
 *   they are deliberately not transcribed).
 * - Citations: `"<operator shop name>, <product page URL>, accessed
 *   2026-10-11"` — one per row, pointing at the page the price was read
 *   from. Tallink product URLs were verified present in the operator's
 *   own product sitemap before transcription (rows the sitemap did not
 *   confirm were dropped, not guessed).
 *
 * Transcription honesty rules (binding, see the runbook): public catalog
 * pages only, read-only GETs, the operators' robots honored (Eckerö
 * Crawl-delay: 10), a bot-gated page is a finding rather than a prompt to
 * circumvent, and a price that cannot be fetched and cited is never
 * invented.
 *
 * @module FerryPriceSource
 */

// ---------------------------------------------------------------------------
// Curated dataset — edit here when an operator's shop prices change
// ---------------------------------------------------------------------------

/** Review date of the current transcription — the observation time every row carries. */
export const FERRY_OBSERVED_AT = new Date('2026-10-11T00:00:00Z');

/**
 * The operator keys, in governance-check order. Also the source_governance
 * merchant keys (`tallink`, `viking`, `eckero`) the refresh cron resolves
 * through the ops console before ingesting that operator's rows.
 */
export const FERRY_OPERATOR_KEYS = ['tallink', 'viking', 'eckero'] as const;

export type FerryOperatorKey = (typeof FERRY_OPERATOR_KEYS)[number];

/** One transcribed dataset row, as the shop displayed it. */
export interface CuratedFerryPrice {
  readonly operator: FerryOperatorKey;
  /** Human route label from the transcription (e.g. "Helsinki–Tallinn"). */
  readonly route: string;
  /** Display label exactly as printed in the onboard/pre-order shop. */
  readonly label: string;
  /** VAT-inclusive consumer price, EUR minor units, as displayed. */
  readonly priceCents: number;
  /** `"<shop name>, <product page URL>, accessed <date>"` — never empty. */
  readonly citation: string;
}

/** Ingestion row — the curated row plus the shared observation date. */
export interface FerryPriceObservation extends CuratedFerryPrice {
  readonly observedAt: Date;
}

/** Viking Line rows — deliberately empty (bot-gated shop; see module docblock). */
const VIKING_PRICES: readonly CuratedFerryPrice[] = [];

/**
 * Tallink Silja — M/S MyStar onboard shop (Helsinki–Tallinn), first
 * transcription 2026-10-11: strong alcohol, long drinks, beer, and
 * sparkling wine categories, first page(s) per category, on-sale rows
 * excluded (campaign prices are transient; the dataset records the
 * standing display price). 42 rows; every product URL verified against
 * the operator's product sitemap (shopping-onboard.tallink.com
 * sitemap-products_26–35.xml).
 */
const TALLINK_PRICES: readonly CuratedFerryPrice[] = [
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 4086,
    label: 'Tullamore D.E.W.  100 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/tullamore-d-e-w-100-cl-21350, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 4086,
    label: 'Tullamore D.E.W. Honey 100 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/tullamore-d-e-w-honey-100-cl-5201985, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 6318,
    label: 'Johnnie Walker Black Label 100 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/johnnie-walker-black-label-100-cl-21221, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 3590,
    label: 'Johnnie Walker Red Label 100 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/johnnie-walker-red-label-100-cl-21211, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 10658,
    label: 'Johnnie Walker Black Ruby 100 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/johnnie-walker-black-ruby-100-cl-5201908, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 6318,
    label: 'Aberfeldy 12 YO Madeira Cask 70 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/aberfeldy-12-yo-madeira-cask-70-cl-5200277, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 9418,
    label: 'Aberfeldy 16 YO Madeira Cask 70 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/aberfeldy-16-yo-madeira-cask-70cl-70-cl-5201995, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 9914,
    label: 'Lagavulin 8 YO 70 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/lagavulin-8-yo-70-cl-230509, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 3962,
    label: 'Finlandia Grapefruit 100 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/finlandia-grapefruit-100-cl-220405, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 3962,
    label: 'Finlandia Lime 100 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/finlandia-lime-100-cl-21382, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 3962,
    label: 'Finlandia Redberry 100 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/finlandia-redberry-100-cl-5203396, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 10534,
    label: 'Saaremaa Vodka Original 10x50 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/saaremaa-vodka-10x50cl-pet-10x50-cl-219357, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 4334,
    label: 'Bombay Sapphire  100 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/bombay-sapphire-100-cl-225797, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 4086,
    label: 'Bacardi Carta Blanca 100 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/bacardi-carta-blanca-100-cl-5201572, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 3591,
    label: 'Garage Vodka Lemonade 24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/garage-vodka-lemonade-24x33-24x33-cl-749510, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 3591,
    label: 'Garage Vodka Lemonade Lime 24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/garage-vodka-lemonade-lime-24x33-cl-24x33-cl-5702267, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 3591,
    label: 'Koff Long Drink Grapefruit 24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/koff-long-drink-grapefruit-24x33cl-24x33-cl-743058, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 3591,
    label: 'Koff Long Drink Pink Grapefruit 24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/koff-long-drink-pink-grapefruit-24x33cl-24x33-cl-751268, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 3591,
    label: 'Koff Long Drink Vibe 24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/koff-long-drink-vibe-5-5-24x33cl-24x33-cl-5903160, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 3714,
    label: 'Hartwall Hard Seltzer Ice Tea Lemon 24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/hartwall-hard-seltzer-ice-tea-lemon-24x33-cl-24x33-cl-5702988, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 3714,
    label: 'Hartwall Hard Seltzer Raspberry 24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/hartwall-hard-seltzer-raspberry-24x33-cl-24x33-cl-5702075, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 3714,
    label: 'Hartwall Hard Seltzer Lemon 24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/hartwall-hard-seltzer-lemon-24x33-cl-24x33-cl-5702114, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 4086,
    label: 'Hartwall Original Long Drink Light Strawberry 24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/hartwall-original-long-drink-light-strawberry-4-5-24x33-cl-24x33-cl-5703670, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 3839,
    label: 'Hartwall Original Long Drink Light 24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/hartwall-original-long-drink-light-24x33-cl-24x33-cl-5703815, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 3839,
    label: 'Hartwall Original Long Drink 24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/hartwall-original-long-drink-24x33-24x33-cl-21556, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 4335,
    label: 'Hartwall Original Long Drink Summer Mandarin 24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/hartwall-original-long-drink-summer-mandarin-24x33-24x33-cl-5703187, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 2598,
    label: 'Saaremaa Tuulik Export 24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/saaremaa-tuulik-export-24x33-24x33-cl-736878, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 2598,
    label: 'Koff  24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/koff-4-5-24x33-cl-24x33-cl-5702669, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 2598,
    label: 'A. Le Coq Premium Export 5.2% 24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/a-le-coq-premium-export-24x33-24x33-cl-210688, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 2846,
    label: 'Aura  24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/aura-4-5-24x33cl-24x33-cl-5701320, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 3094,
    label: 'Beck\'s  24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/becks-24x33cl-24x33-cl-705423, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 3467,
    label: 'Birra Moretti L\'Autentica CAN 24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/birra-moretti-l-autentica-4x6x33cl-can-24x33-cl-5701309, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 7062,
    label: 'Birra Moretti  24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/birra-moretti-export-24x33-cl-24x33-cl-743476, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 5822,
    label: 'Brooklyn East IPA 24x33 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/brooklyn-east-ipa-24x33cl-24x33-cl-749204, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 2102,
    label: 'Pongrácz Cuvée Brut 75 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/pongracz-brut-75-cl-219818, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 3590,
    label: 'Juvé & Camps Milesime Chardonnay 75 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/juve-and-camps-milesime-chardonnay-75-cl-5202688, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 1110,
    label: 'Codorníu Clasico Seco 75 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/codorniu-clasico-seco-75-cl-228279, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 1110,
    label: 'Codorníu Clasico Brut 75 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/codorniu-clasico-brut-75-cl-219817, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 1110,
    label: 'Codorníu Clasico Rosado 75 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/codorniu-clasico-brut-rose-75-cl-244584, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 2474,
    label: 'Pongrácz Blanc de Blancs 75 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/pongracz-blanc-de-blancs-75-cl-5200312, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 862,
    label: 'Ballet Carte Noire Organic Brut 75 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/ballet-carte-noire-organic-brut-75-cl-5201337, accessed 2026-10-11' },
  { operator: 'tallink', route: 'Helsinki–Tallinn', priceCents: 862,
    label: 'Ballet Carte Noire Organic Demi-Sec 75 cl',
    citation: 'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/ballet-carte-noire-organic-demi-sec-75-cl-5201338, accessed 2026-10-11' },
];

/**
 * Eckerö Line — M/S Finlandia pre-order shop ("Eckerö Market",
 * Helsinki–Tallinn), first transcription 2026-10-11: pre-order strong
 * alcohol and long-drink categories, first page per category
 * (robots Crawl-delay: 10 honored during the fetch). 28 rows; citations
 * are the tile product URLs the shop itself renders.
 */
const ECKERO_PRICES: readonly CuratedFerryPrice[] = [
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 4170,
    label: 'Jaloviina Yrtti 30%, 3 x 50 cl',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol/jaloviina-yrtti-3x50-cl, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 5970,
    label: 'Veterano Solera, 3 x 100 cl',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol/veterano-solera-3-x-100-cl, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 1990,
    label: 'Laplandia Testing Set 5 x 5 cl',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol/laplandia-vodka-testing, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 3690,
    label: 'Koskenkorva Salmiakki-Vadelma (PET), 3 x 50 cl',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol/209977-koskenkorva-salmiakki-vadelma-50-cl-3-pack, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 3690,
    label: 'Koskenkorva Salmiakki (PET), 3 x 50 cl',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol/koskenkorva-salmiakki-1, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 3515,
    label: 'Jaloviina * x 3 (PET)',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol/jaloviina-x-3-pet, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 7470,
    label: 'Engine Pure Organic Gin 3-pack',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol/engine-pure-organic-gin-3-pack, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 4950,
    label: 'Koskenkorva Vodka 40%, 3 x 70 cl',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol/koskenkorva-vodka-3x70, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 13770,
    label: 'Aberfeldy 12YO Madeira Cask, 3 x 70 cl',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol/69052-aberfeldy-12yo-madeiracask-70cl-3, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 15270,
    label: 'Larsen VSOP, 3 x 100 cl',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol/larsen-vsop-3-100, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 10470,
    label: 'Crafter\'s London Dry Gin, 3 x 100 cl',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol/crafter-s-london-dry-gin-3-x-100-cl, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 10470,
    label: 'Crafter\'s Infinite Citrus Gin, 3 x 100 cl',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol/213739-crafter-s-infinite-citrus-gin-3-x-100-cl, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 5070,
    label: 'Finlandia Vodka, 3 x 70 cl',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol/210893-finlandia-vodka-3x-70-cl, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 3690,
    label: 'Koskenkorva Minttu, 3 x 50 cl',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol/209975-koskenkorva-lakritsi-pet-3-x-50-cl-1, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 3690,
    label: 'Koskenkorva Lakritsi (PET), 3 x 50 cl',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol/209975-koskenkorva-lakritsi-pet-3-x-50-cl, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 13350,
    label: 'Bumbu XO, 3-pack',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol/209974-bumbu-xo, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 2550,
    label: 'Garage Vodka Lemonade, 24-pack',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-long-drink/garage-vodka-lemonade-24-pack, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 2950,
    label: 'Hartwall Original Long Drink Light Grapefruit, 24-pack',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-long-drink/hartwall-original-long-drink-light-grapefruit-24-pack, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 3695,
    label: 'Hartwall Original Long Drink Strong, 24-pack',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-long-drink/hartwall-original-long-drink-strong-24-pack, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 2950,
    label: 'Hartwall Original Long Drink Light Strawberry, 24-pack',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-long-drink/hartwall-original-longdrink-strawberry-24-pack, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 3095,
    label: 'Hartwall Original Long Drink, 24-pack',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-long-drink/hartwall-original-long-drink-24-pack, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 3195,
    label: 'Hartwall Original Long Drink Peach Tea, 24-pack',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-long-drink/212032-hartwall-original-long-drink-peach-tea-24-pack, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 2895,
    label: 'Olvi Hard Seltzer Strawberry-Rhubarb 4,5% 24-pack',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-long-drink/olvi-hard-seltzer-strawberry-rhubarb-4-5-24-pack, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 2695,
    label: 'Hartwall Hard Seltzer Lemon 24-pack',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-long-drink/hartwall-hard-seltzer-lemon-24-pack, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 4990,
    label: 'Smirnoff ICE, 24-pack',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-long-drink/smirnoff-ice-24-pack, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 3195,
    label: 'Hartwall Original Long Drink Raspberry, 24-pack',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-long-drink/hartwall-original-longdrink-raspberry-24-pack, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 2695,
    label: 'Hartwall Hard Seltzer Raspberry 24-pack',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-long-drink/hartwall-hard-seltzer-raspberry-24-pack, accessed 2026-10-11' },
  { operator: 'eckero', route: 'Helsinki–Tallinn', priceCents: 3195,
    label: 'Hartwall Original Long Drink Pineapple, 24-pack',
    citation: 'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-long-drink/hartwall-original-long-drink-pineapple-24-pack, accessed 2026-10-11' },
];

/** The full curated dataset, operator-grouped in {@link FERRY_OPERATOR_KEYS} order. */
const FERRY_PRICES: readonly CuratedFerryPrice[] = [
  ...TALLINK_PRICES,
  ...VIKING_PRICES,
  ...ECKERO_PRICES,
];

/**
 * Build the ingestion rows for one operator (or all of them). Pure and
 * deterministic — the same dataset always produces identical rows, so a
 * refresh over an unchanged dataset converges on the stored observations
 * and the cron's unchanged-check guards it before any write.
 */
export function buildFerryPriceObservations(
  operator?: FerryOperatorKey,
): FerryPriceObservation[] {
  return FERRY_PRICES.filter(
    (row) => operator === undefined || row.operator === operator,
  ).map((row) => ({ ...row, observedAt: FERRY_OBSERVED_AT }));
}
