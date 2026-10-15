/**
 * Seed: the 2026 tax-change calendar event set (task 1.3, change
 * tax-change-calendar).
 *
 * Six price-change rhythm facts transcribed from the change's
 * verified-facts note (`openspec/changes/tax-change-calendar/
 * verified-facts.md`), every row citing the official source URL the
 * note verified it against:
 *
 *   1. FI_EXCISE_CHANGE        CONFIRMED  2026-01-01   (vero.fi 2026 duty table)
 *   2. EE_EXCISE_CHANGE        CONFIRMED  2026-01-01   (emta.ee rate table)
 *   3. ALKO_PRICE_LIST spring  EXPECTED   2026-03      (alko.fi rhythm statement)
 *   4. ALKO_PRICE_LIST autumn  EXPECTED   2026-09      (alko.fi rhythm statement)
 *   5. TAX_TABLE_PUBLICATION   CONFIRMED  2026-08-06   (Verohallinto decision)
 *   6. RATE_DECISION           EXPECTED   2026-Q4      (vero.fi news / HE 172/2026)
 *
 * The two Alko rows and the rate-decision row carry no dated official
 * announcement — they are seeded as the EXPECTED annual rhythm (month /
 * quarter window, never a day) per the note's status rationale. The
 * Estonian consumer-price examples the note flags as UNVERIFIED are
 * deliberately absent from every text: only the official EMTA rates are
 * quoted.
 *
 * Every row runs through the persistence-boundary validator
 * (`repositories/calendar-event-validator.ts`) at module load — an
 * invalid row fails loudly at import time (the tax-rules effective-range
 * self-check precedent), before any SQL can be emitted or applied.
 *
 * Wiring: same as every D1 reference seed — the rows are the source of
 * truth for `seed/d1/generate.ts` (byte-deterministic INSERT OR IGNORE
 * SQL applied to the live D1 by scripts/seed-d1.ts), and the function
 * below is the binding-facing apply path used by tests and tools.
 *
 * Idempotent: rows carry explicit deterministic ids 1–6 and insert with
 * INSERT OR IGNORE — a re-run conflicts on the primary key and inserts
 * nothing, in both the generated SQL and this function. The ops console
 * (task 5.1) edits rows IN PLACE with no delete (status upgrades
 * EXPECTED → CONFIRMED mutate the same id), so re-seeding after an ops
 * edit never resurrects the pre-edit status nor duplicates the row;
 * ops-created rows (2027+) autoassign ids beyond the seed set and are
 * never touched.
 *
 * @module Seed
 */
import type { D1DatabaseLike } from '../d1/executor';
import {
  type CalendarEventInput,
  validateCalendarEvent,
} from '../repositories/calendar-event-validator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A seed row — the validator's input shape plus its deterministic id. */
export interface CalendarEventSeedRow extends CalendarEventInput {
  /**
   * Explicit deterministic id (position in the note's row table). Stable
   * across re-seeds so the ops console's in-place edits can never be
   * duplicated by a re-run.
   */
  readonly id: number;
}

// ---------------------------------------------------------------------------
// Official source URLs (verbatim from the verified-facts note)
// ---------------------------------------------------------------------------

/** vero.fi — the 2026 excise duty table the row-1 figures come from. */
const SOURCE_FI_2026_DUTY_TABLE =
  'https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-alcohol-and-alcoholic-beverages/Excise-duty-table-for-alcohol-and-alcoholic-beveragesoholijuomaverotaulukko/';

/** emta.ee — the Estonian alcohol excise rate table. */
const SOURCE_EE_RATE_TABLE =
  'https://www.emta.ee/en/business-client/taxes-and-payment/excise-duties/alcohol';

/** alko.fi — the official twice-yearly price-list rhythm statement. */
const SOURCE_ALKO_RHYTHM =
  'https://www.alko.fi/fi/alko-oy/uutishuone/verotusmuutokset-2026';

/** Verohallinto — the decision fixing the 2027 alcohol duty rates. */
const SOURCE_VERO_2027_DECISION =
  'https://www.vero.fi/syventavat-vero-ohjeet/paatokset/371142/verohallinnon-paatos-alkoholi-ja-alkoholijuomaveron-maarasta';

/** vero.fi — the news page on the 2027 excise changes (HE 172/2026 vp). */
const SOURCE_VERO_2027_NEWS =
  'https://www.vero.fi/tietoa-verohallinnosta/uutishuone/verotuksen_muutoksia/valmisteverotuksen-muutoksia-1.1.2027';

// ---------------------------------------------------------------------------
// Data — the 2026 event set, in the verified-facts note's row order
// ---------------------------------------------------------------------------

/** Every seeded row belongs to the 2026 calendar (the note's set). */
export const CALENDAR_SEED_YEAR = 2026;

export const CALENDAR_EVENTS_SEED: readonly CalendarEventSeedRow[] = [
  {
    id: 1,
    year: 2026,
    eventType: 'FI_EXCISE_CHANGE',
    status: 'CONFIRMED',
    occurrenceDate: '2026-01-01',
    expectedWindow: null,
    titleFi: 'Viinien ja siiderien valmistevero nousi 1.1.2026',
    titleEn: 'Finnish wine and cider excise rose on 1 January 2026',
    summaryFi:
      'Viinien ja siiderien valmisteveroa korotettiin noin 9 prosentilla, ja kaikkien yli 2,8 tilavuusprosentin alkoholijuomien vero sidottiin pysyvästi kuluttajahintaindeksiin (indeksikorotus 1,4 % vuonna 2026). Viinien (yli 8–15 %) vero on 504,97 snt/l, ja Alkon keskihinnat nousivat noin 1 %. Muutos on voimassa 1.1.2026–31.12.2026.',
    summaryEn:
      'Finland raised the excise duty on wines and ciders by roughly 9 %, and permanently tied the duty of all beverages above 2.8 % ABV to the HICP consumer price index (a further 1.4 % index adjustment in 2026). The duty on wine above 8–15 % ABV is 504.97 snt/l, and Alko\u2019s average prices rose about 1 %. The change is in force from 1 January to 31 December 2026.',
    sourceUrl: SOURCE_FI_2026_DUTY_TABLE,
  },
  {
    id: 2,
    year: 2026,
    eventType: 'EE_EXCISE_CHANGE',
    status: 'CONFIRMED',
    occurrenceDate: '2026-01-01',
    expectedWindow: null,
    titleFi: 'Viron alkoholivalmistevero nousi 10 % 1.1.2026',
    titleEn: 'Estonian alcohol excise rose 10 % on 1 January 2026',
    summaryFi:
      'Viro korotti alkoholivalmisteveroa kaikissa juomaluokissa 10 prosentilla 1.1.2026. Oluen vero on nyt 15,40 € hl:n alkoholiprosenttia kohden ja yli 6 tilavuusprosentin viinien 179,27 €/hl. Lain mukaan vero nousee 5 % myös vuosina 2027 ja 2028.',
    summaryEn:
      'Estonia raised its alcohol excise duty by 10 % in every beverage category on 1 January 2026. The duty on beer is now 15.40 € per hectolitre per volume percent and 179.27 €/hl for wine above 6 % ABV. The law schedules further 5 % steps for 2027 and 2028.',
    sourceUrl: SOURCE_EE_RATE_TABLE,
  },
  {
    id: 3,
    year: 2026,
    eventType: 'ALKO_PRICE_LIST',
    status: 'EXPECTED',
    occurrenceDate: null,
    expectedWindow: '2026-03',
    titleFi: 'Alkon kevään jaksovaihto (odotettu maaliskuun lopussa)',
    titleEn: 'Alko spring price-list change (expected late March)',
    summaryFi:
      'Alkon vähittäismyyntihinnat vaihtuvat kaksi kertaa vuodessa, normaalisti maalis- ja syyskuun lopussa. Kevään 2026 jaksovaihdokselle ei ole vielä julkaistua päivämäärää, joten tapahtuma odottaa vahvistusta.',
    summaryEn:
      'Alko changes its retail prices twice a year, normally at the end of March and September. No dated announcement exists yet for the spring 2026 switch, so the event is listed as expected.',
    sourceUrl: SOURCE_ALKO_RHYTHM,
  },
  {
    id: 4,
    year: 2026,
    eventType: 'ALKO_PRICE_LIST',
    status: 'EXPECTED',
    occurrenceDate: null,
    expectedWindow: '2026-09',
    titleFi: 'Alkon syksyn jaksovaihto (odotettu syyskuun lopussa)',
    titleEn: 'Alko autumn price-list change (expected late September)',
    summaryFi:
      'Alkon vähittäismyyntihinnat vaihtuvat kaksi kertaa vuodessa, normaalisti maalis- ja syyskuun lopussa. Syksyn 2026 jaksovaihdokselle ei ole vielä julkaistua päivämäärää, joten tapahtuma odottaa vahvistusta.',
    summaryEn:
      'Alko changes its retail prices twice a year, normally at the end of March and September. No dated announcement exists yet for the autumn 2026 switch, so the event is listed as expected.',
    sourceUrl: SOURCE_ALKO_RHYTHM,
  },
  {
    id: 5,
    year: 2026,
    eventType: 'TAX_TABLE_PUBLICATION',
    status: 'CONFIRMED',
    occurrenceDate: '2026-08-06',
    expectedWindow: null,
    titleFi: 'Verohallinto vahvisti vuoden 2027 alkoholiverot 6.8.2026',
    titleEn:
      'Finnish Tax Administration confirmed the 2027 alcohol duty rates on 6 August 2026',
    summaryFi:
      'Verohallinto julkaisi 6.8.2026 päätöksen vuoden 2027 alkoholi- ja alkoholijuomaveron määristä (diaarinumero VH/4545/00.01.00/2026). Indeksitarkistettuna viinin (yli 8–15 %) vero on 515,22 snt/l ja etyylialkoholin (yli 10 %) 57,42 snt/cl. Tasot tulevat voimaan 1.1.2027.',
    summaryEn:
      'On 6 August 2026 the Finnish Tax Administration published its decision fixing the 2027 alcohol excise rates (record number VH/4545/00.01.00/2026). After index adjustment, the duty on wine above 8–15 % ABV is 515.22 snt/l and on ethyl alcohol above 10 % 57.42 snt/cl. The rates take effect on 1 January 2027.',
    sourceUrl: SOURCE_VERO_2027_DECISION,
  },
  {
    id: 6,
    year: 2026,
    eventType: 'RATE_DECISION',
    status: 'EXPECTED',
    occurrenceDate: null,
    expectedWindow: '2026-Q4',
    titleFi: 'Vuoden 2027 verotaulukon lainsäädäntö odottaa eduskuntakäsittelyä',
    titleEn:
      'The 2027 statutory tax-table legislation awaits the Finnish parliament',
    summaryFi:
      'Hallituksen esitys (HE 172/2026 vp) ehdottaa uutta lakisääteistä verotaulukkoa Verohallinnon vahvistamien indeksitasojen päälle: keskimääräinen korotus olisi noin 4,5 %, pääosin yli 5,5 tilavuusprosentin juomien valmisteveroon. Laki ei ole vielä voimassa; tasot vahvistuvat eduskunnan päätöksellä loppuvuoden 2026 aikana, ja muutos tulisi voimaan 1.1.2027.',
    summaryEn:
      'Government bill HE 172/2026 vp proposes a statutory tax table on top of the Tax Administration\u2019s confirmed index rates: an average increase of about 4.5 %, targeting mainly beverages above 5.5 % ABV. The law is not yet in force; the rates depend on a parliamentary decision during late 2026, with the change taking effect on 1 January 2027.',
    sourceUrl: SOURCE_VERO_2027_NEWS,
  },
];

// ---------------------------------------------------------------------------
// Self-check — every row through the persistence-boundary validator
// ---------------------------------------------------------------------------

/**
 * Validate the whole seed at module load: every row passes
 * `validateCalendarEvent` (closed vocabularies, status/precision split,
 * real calendar dates, http(s) source, FI/EN text present), ids are
 * unique positive integers, and each row's year matches the year
 * embedded in its occurrence_date / expected_window (a row claiming
 * year 2026 with a 2027 window would be a transcription error).
 *
 * Throws loudly on the first violation — the module never loads with an
 * invalid row, so neither the generated SQL nor the function seed can
 * ship bad data (the tax-rules range self-check precedent).
 */
(function selfCheckSeedRows(): void {
  const seenIds = new Set<number>();
  for (const row of CALENDAR_EVENTS_SEED) {
    // Full contract validation — throws with the offending column named.
    validateCalendarEvent(row);

    if (!Number.isInteger(row.id) || row.id <= 0) {
      throw new Error(
        `calendar_events seed row has a non-positive or non-integer id: ${JSON.stringify(row.id)}`,
      );
    }
    if (seenIds.has(row.id)) {
      throw new Error(`calendar_events seed has a duplicate id: ${row.id}`);
    }
    seenIds.add(row.id);

    const periodYear =
      row.occurrenceDate?.slice(0, 4) ?? row.expectedWindow?.slice(0, 4);
    if (periodYear !== String(row.year)) {
      throw new Error(
        `calendar_events seed row ${row.id} (${row.eventType}) declares year ${row.year} ` +
          `but its period value "${row.occurrenceDate ?? row.expectedWindow}" starts with ` +
          `"${periodYear}" — a transcription error against the verified-facts note`,
      );
    }
  }
})();

// ---------------------------------------------------------------------------
// Seed function — the binding-facing apply path (tests, tools)
// ---------------------------------------------------------------------------

/** Result of a seed run. */
export interface CalendarEventSeedResult {
  /** Rows actually inserted (INSERT OR IGNORE that did not conflict). */
  inserted: number;
  /** Seed rows already present (conflicted on their id) and left untouched. */
  skipped: number;
}

/**
 * Seed the 2026 calendar event set into `calendar_events` over a D1
 * binding — one presence-guarded INSERT per row, batched.
 *
 * Safe to call repeatedly: every row carries its explicit deterministic
 * id, so a re-run conflicts on the primary key and inserts nothing
 * (mirroring the generated SQL exactly — parity is pinned by test).
 * Rows are never mutated: an ops-console edit (EXPECTED → CONFIRMED
 * upgrade, window → date) always survives re-seeding, and ops-created
 * rows live outside the seed's id range.
 *
 * @param d1 — a D1 binding (or the test shim over node:sqlite).
 */
export async function seedCalendarEvents(
  d1: D1DatabaseLike,
): Promise<CalendarEventSeedResult> {
  const insertSql =
    'INSERT OR IGNORE INTO calendar_events ' +
    '(id, year, event_type, status, occurrence_date, expected_window, ' +
    'title_fi, title_en, summary_fi, summary_en, source_url) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

  const results = await d1.batch(
    CALENDAR_EVENTS_SEED.map((row) =>
      d1
        .prepare(insertSql)
        .bind(
          row.id,
          row.year,
          row.eventType,
          row.status,
          row.occurrenceDate,
          row.expectedWindow,
          row.titleFi,
          row.titleEn,
          row.summaryFi,
          row.summaryEn,
          row.sourceUrl,
        ),
    ),
  );

  // An ignored insert reports 0 changes; a landed one reports 1.
  let inserted = 0;
  for (const result of results) {
    inserted += Number(result.meta.changes ?? 0);
  }

  return { inserted, skipped: CALENDAR_EVENTS_SEED.length - inserted };
}
