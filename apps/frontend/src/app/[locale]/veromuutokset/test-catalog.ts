/**
 * Test-local message-catalog stub for the tax-change calendar surfaces
 * (task 4.1). The REAL `src/messages/{fi,en}.json` entries belong to
 * task 4.3; until then the suites render against this two-locale stub
 * so the component i18n keys are pinned and reviewable in one place —
 * the exact key set 4.3 must land (namespace `TaxChangeCalendarPage`,
 * plus the reused `Common.retry`).
 *
 * Copy stance (content policy): factual rhythm description only — no
 * forecast or purchase-advice vocabulary; the rhythm notes are
 * publication-schedule facts, never predictions.
 */

export interface CalendarCatalogStub {
  readonly [namespace: string]: unknown;
}

/** Finnish stub — Finnish is the source of truth. */
export const FI_CATALOG_STUB: CalendarCatalogStub = {
  Common: { retry: 'Yritä uudelleen' },
  TaxChangeCalendarPage: {
    metaTitle: 'Veromuutokset ja hintamuutosten vuosirytmi',
    metaDescription:
      'Lähteellinen kalenteri alkoholin veromuutoksista sekä Alkon hintaluetteloiden ja Viron veronousujen vuosirytmistä.',
    title: 'Veromuutokset',
    subtitle:
      'Vahvistetut veromuutokset ja toistuva hintamuutosrytmi — kukin merkintä virallisen lähteen kanssa.',
    rhythmIntro:
      'Hintoihin vaikuttavat veromuutokset toistuvat vuosittain saman rytmin mukaan: Suomen valmisteverot muuttuvat yleensä vuodenvaihteessa, ja Verohallinto julkaisee seuraavan vuoden verotasot etukäteen. Alkon vähittäismyyntihinnat vaihtuvat kaksi kertaa vuodessa, normaalisti maalis- ja syyskuun lopussa. Virossa alkoholivalmistevero nousee lain mukaan porrastetusti vuodenvaihteessa. Aikajana erottaa vahvistetut ajankohdat virallisine lähteineen toistuvaan vuosirytmiin perustuvista merkinnöistä.',
    timelineHeading: 'Vuosi {year}',
    yearNavLabel: 'Vaihda vuotta',
    prevYearLink: '← {year}',
    nextYearLink: '{year} →',
    groupConfirmed: '{period}',
    groupExpected: '{period} (odotettu)',
    badgeConfirmed: 'Vahvistettu',
    badgeExpected: 'Vuosirytmi',
    eventDateLabel: 'Voimaantulopäivä: {date}',
    sourceLink: 'Virallinen lähde',
    loading: 'Ladataan veromuutoksia…',
    emptyTitle: 'Ei merkintöjä vuodelle {year}',
    emptyBody: 'Vuodelle {year} ei ole lisätty yhtään merkintää.',
    ageGateCtaTitle: 'Ikävahvistus tarvitaan',
    ageGateCtaBody: 'Vahvista ikäsi nähdäksesi veromuutoskalenterin.',
    ageGateCtaLink: 'Siirry ikävahvistukseen',
    errorTitle: 'Luetteloa ei saatu haettua',
    errorBody: 'Taustajärjestelmä ei vastannut. Voit yrittää uudelleen.',
    rateLimitBody:
      'Palveluun kohdistuu juuri nyt hyvin paljon pyyntöjä. Yritä uudelleen hetken kuluttua.',
    crossLinksHeading: 'Miten veromuutos vaikuttaa koriisi?',
    crossLinksBody:
      'Skenaariolaskurilla voi laskea verotason muutoksen vaikutuksen esimerkkikorin kokonaiskustannukseen, ja blogissa käydään läpi voimaan astuneita veromuutoksia.',
    whatIfLink: 'Avaa skenaariolaskuri',
    blogLink: 'Lue veromuutosblogia',
  },
};

/** English stub — the en variant of the same key set. */
export const EN_CATALOG_STUB: CalendarCatalogStub = {
  Common: { retry: 'Retry' },
  TaxChangeCalendarPage: {
    metaTitle: 'Tax changes and the annual price-change rhythm',
    metaDescription:
      'A sourced calendar of alcohol tax changes and of the annual rhythm of Alko price-list switches and Estonian excise steps.',
    title: 'Tax changes',
    subtitle:
      'Confirmed tax changes and the recurring price-change rhythm — every entry with its official source.',
    rhythmIntro:
      'Price-affecting tax changes follow the same rhythm every year: Finnish excise rates usually change at the turn of the year, and the Finnish Tax Administration publishes the next year\u2019s rates in advance. Alko switches its retail prices twice a year, normally at the end of March and September. In Estonia, alcohol excise rises in legislated steps at the turn of the year. The timeline separates confirmed dates, each with its official source, from entries based on the recurring annual rhythm.',
    timelineHeading: 'Year {year}',
    yearNavLabel: 'Switch year',
    prevYearLink: '← {year}',
    nextYearLink: '{year} →',
    groupConfirmed: '{period}',
    groupExpected: 'Expected {period}',
    badgeConfirmed: 'Confirmed',
    badgeExpected: 'Annual rhythm',
    eventDateLabel: 'Effective date: {date}',
    sourceLink: 'Official source',
    loading: 'Loading tax changes…',
    emptyTitle: 'No entries for {year}',
    emptyBody: 'No entries have been added for {year} yet.',
    ageGateCtaTitle: 'Age confirmation required',
    ageGateCtaBody: 'Confirm your age to see the tax-change calendar.',
    ageGateCtaLink: 'Go to age confirmation',
    errorTitle: 'Could not fetch the listing',
    errorBody: 'The backend did not respond. You can try again.',
    rateLimitBody:
      'The service is receiving a very large number of requests right now. Please retry in a moment.',
    crossLinksHeading: 'What would a tax change do to your basket?',
    crossLinksBody:
      'The scenario calculator recalculates an example basket under a rate you choose, and the blog covers tax changes that have entered into force.',
    whatIfLink: 'Open the scenario calculator',
    blogLink: 'Read the tax-change blog',
  },
};
