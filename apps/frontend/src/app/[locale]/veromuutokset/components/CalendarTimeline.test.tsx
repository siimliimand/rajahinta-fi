/**
 * @vitest-environment jsdom
 */
/**
 * CalendarTimeline — the client island of the tax-change calendar page
 * (task 4.1, change tax-change-calendar).
 *
 * Contract under test: the 2026 seeded six-event set renders grouped by
 * month/window with a status badge and an official-source link on every
 * card; EXPECTED cards carry the API's structural rhythm disclaimer and
 * never an invented exact date; the en variant renders the English copy
 * and fetches with `language=en`; and the failure states follow the
 * house listing-honesty pattern (403 age-gate CTA, 429 backoff,
 * transient ErrorState with retry, honest empty state).
 *
 * Message catalogs (task 4.3 owns the real entries): the suites render
 * against a TEST-LOCAL catalog stub with both locales, since the real
 * fi.json/en.json entries land in a later task.
 */
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import CalendarTimeline from './CalendarTimeline';
import { ApiFetchError, request } from '@/lib/api';
import type { CalendarEventDto, CalendarEventsResponse } from '../calendar-events';
import { EN_CATALOG_STUB, FI_CATALOG_STUB } from '../test-catalog';

// The real API client module stays loaded — the component narrows its
// rejections with `instanceof ApiFetchError` and reads `.failureClass` —
// only `request` is replaced so each test controls the outcome.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, request: vi.fn() };
});

// The router-aware navigation module does not load under vitest
// (documented repo limitation); stub the Link with the plain-anchor
// double every other suite uses, so the age-gate CTA renders a real <a>.
vi.mock('@/i18n/navigation', async () => {
  const { TestI18nLink } = await import('@/lib/testing/i18n-navigation');
  return { Link: TestI18nLink };
});

const mockRequest = vi.mocked(request);

// ---------------------------------------------------------------------------
// Test-local catalog stub — shared two-locale module (the real entries
// are task 4.3's; the stub is the reviewable key set for that task).
// ---------------------------------------------------------------------------

function renderWithCatalog(
  ui: React.ReactElement,
  locale: 'fi' | 'en',
): ReturnType<typeof render> {
  const messages = locale === 'fi' ? FI_CATALOG_STUB : EN_CATALOG_STUB;
  return render(ui, {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    ),
  });
}

// ---------------------------------------------------------------------------
// Fixtures — the 2026 seeded set (titles/windows verbatim from the seed)
// ---------------------------------------------------------------------------

const DISCLAIMER_FI =
  'Vuosirytmi: veromuutosten ja hintaluetteloiden ajankohdat toistuvat vuosittain saman kalenterirytmin mukaan. Merkintä kuvaa julkaisuaikataulua — se ei ole virallinen ilmoitus eikä tieto vero- tai hintamuutoksesta.';

const DISCLAIMER_EN =
  'Annual rhythm: tax changes and price-list switches recur each year on the same calendar rhythm. The note describes a publication schedule — it is not an official announcement and not a statement of a tax or price change.';

/** One seeded 2026 row (the data-platform seed's shapes and texts). */
function seededEvent(overrides: Partial<CalendarEventDto>): CalendarEventDto {
  return {
    id: 1,
    year: 2026,
    eventType: 'FI_EXCISE_CHANGE',
    status: 'CONFIRMED',
    occurrenceDate: '2026-01-01',
    expectedWindow: null,
    titleFi: 'Viinien ja siiderien valmistevero nousi 1.1.2026',
    titleEn: 'Finnish wine and cider excise rose on 1 January 2026',
    summaryFi: 'Viinien ja siiderien valmisteveroa korotettiin noin 9 prosentilla.',
    summaryEn: 'Finland raised the excise duty on wines and ciders by roughly 9 %.',
    sourceUrl: 'https://www.vero.fi/valmisteverotaulukko',
    ...overrides,
  };
}

/** The six seeded 2026 events in the API's deterministic order. */
const SEEDED_2026: readonly CalendarEventDto[] = [
  seededEvent({ id: 1, eventType: 'FI_EXCISE_CHANGE' }),
  seededEvent({
    id: 2,
    eventType: 'EE_EXCISE_CHANGE',
    titleFi: 'Viron alkoholivalmistevero nousi 10 % 1.1.2026',
    titleEn: 'Estonian alcohol excise rose 10 % on 1 January 2026',
    sourceUrl: 'https://www.emta.ee/alkoholi',
  }),
  seededEvent({
    id: 3,
    eventType: 'ALKO_PRICE_LIST',
    status: 'EXPECTED',
    occurrenceDate: null,
    expectedWindow: '2026-03',
    titleFi: 'Alkon kevään jaksovaihto (odotettu maaliskuun lopussa)',
    titleEn: 'Alko spring price-list change (expected late March)',
    sourceUrl: 'https://www.alko.fi/verotusmuutokset-2026',
  }),
  seededEvent({
    id: 4,
    eventType: 'ALKO_PRICE_LIST',
    status: 'EXPECTED',
    occurrenceDate: null,
    expectedWindow: '2026-09',
    titleFi: 'Alkon syksyn jaksovaihto (odotettu syyskuun lopussa)',
    titleEn: 'Alko autumn price-list change (expected late September)',
    sourceUrl: 'https://www.alko.fi/verotusmuutokset-2026',
  }),
  seededEvent({
    id: 5,
    eventType: 'TAX_TABLE_PUBLICATION',
    occurrenceDate: '2026-08-06',
    titleFi: 'Verohallinto vahvisti vuoden 2027 alkoholiverot 6.8.2026',
    titleEn:
      'Finnish Tax Administration confirmed the 2027 alcohol duty rates on 6 August 2026',
    sourceUrl: 'https://www.vero.fi/paatos-2027',
  }),
  seededEvent({
    id: 6,
    eventType: 'RATE_DECISION',
    status: 'EXPECTED',
    occurrenceDate: null,
    expectedWindow: '2026-Q4',
    titleFi: 'Vuoden 2027 verotaulukon lainsäädäntö odottaa eduskuntakäsittelyä',
    titleEn: 'The 2027 statutory tax-table legislation awaits the Finnish parliament',
    sourceUrl: 'https://www.vero.fi/veromuutokset-2027',
  }),
];

function eventsResponse(
  events: readonly CalendarEventDto[],
  language: 'fi' | 'en' = 'fi',
): CalendarEventsResponse {
  return {
    year: 2026,
    // The route's serialization: the versioned disclaimer OBJECT
    // (`selectRhythmDisclaimer` verbatim), never a bare string.
    disclaimer: {
      text: language === 'fi' ? DISCLAIMER_FI : DISCLAIMER_EN,
      language,
      version: '1.0',
    },
    events,
  };
}

beforeEach(() => {
  mockRequest.mockReset();
});

// ---------------------------------------------------------------------------
// The 2026 seeded timeline
// ---------------------------------------------------------------------------

describe('CalendarTimeline — 2026 seeded set (fi)', () => {
  it('renders the six events grouped by month/window with a badge and source per card', async () => {
    mockRequest.mockResolvedValue(eventsResponse(SEEDED_2026));
    renderWithCatalog(<CalendarTimeline year={2026} />, 'fi');

    const timeline = await screen.findByTestId('calendar-timeline');
    const cards = within(timeline).getAllByTestId('calendar-event-card');
    expect(cards).toHaveLength(6);

    // Groups: two confirmed January rows, then March, August, September
    // and the Q4 window, each expected group carrying the marker.
    const groups = within(timeline).getAllByTestId('calendar-month-group');
    expect(groups).toHaveLength(5);
    expect(groups[0]).toHaveTextContent('Tammikuu 2026');
    expect(groups[1]).toHaveTextContent('Maaliskuu 2026 (odotettu)');
    expect(groups[2]).toHaveTextContent('Elokuu 2026');
    expect(groups[3]).toHaveTextContent('Syyskuu 2026 (odotettu)');
    expect(groups[4]).toHaveTextContent('Q4 2026 (odotettu)');

    // Every card carries a status badge and its official-source link
    // (6 sources — no unsourced card).
    expect(within(timeline).getAllByText('Vahvistettu')).toHaveLength(3);
    expect(within(timeline).getAllByText('Vuosirytmi')).toHaveLength(3);
    const sources = within(timeline).getAllByTestId('calendar-source-link');
    expect(sources).toHaveLength(6);
    expect(sources[0]).toHaveAttribute('href', 'https://www.vero.fi/valmisteverotaulukko');
    for (const source of sources) {
      expect(source).toHaveAttribute('target', '_blank');
      expect(source).toHaveAttribute('rel', 'noopener noreferrer');
    }

    // The timeline fetches the year listing in the provider's language.
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/calendar/events?year=2026&language=fi',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('renders confirmed dates and never an invented date on EXPECTED cards', async () => {
    mockRequest.mockResolvedValue(eventsResponse(SEEDED_2026));
    renderWithCatalog(<CalendarTimeline year={2026} />, 'fi');

    const timeline = await screen.findByTestId('calendar-timeline');
    const cards = within(timeline).getAllByTestId('calendar-event-card');

    // CONFIRMED cards show their exact date…
    expect(cards[0]).toHaveTextContent('Voimaantulopäivä: 1.1.2026');
    expect(cards[3]).toHaveTextContent('Voimaantulopäivä: 6.8.2026');
    // …and every EXPECTED card shows the structural rhythm disclaimer
    // from the API and NO exact date (no day precision is invented).
    for (const index of [2, 4, 5]) {
      expect(
        within(cards[index]).getByTestId('calendar-event-disclaimer'),
      ).toHaveTextContent('Vuosirytmi: veromuutosten ja hintaluetteloiden');
      expect(cards[index].textContent).not.toContain('Voimaantulopäivä');
    }
    // CONFIRMED cards carry no disclaimer — the rhythm note belongs to
    // the EXPECTED presentations alone.
    expect(
      within(cards[0]).queryByTestId('calendar-event-disclaimer'),
    ).not.toBeInTheDocument();
  });

  it('renders cards in the API order inside a group (deterministic)', async () => {
    mockRequest.mockResolvedValue(eventsResponse(SEEDED_2026));
    renderWithCatalog(<CalendarTimeline year={2026} />, 'fi');

    const timeline = await screen.findByTestId('calendar-timeline');
    // January: the FI change precedes the EE change (type tiebreak).
    const groups = within(timeline).getAllByTestId('calendar-month-group');
    const january = within(groups[0]).getAllByTestId('calendar-event-card');
    expect(january[0]).toHaveTextContent(
      'Viinien ja siiderien valmistevero nousi 1.1.2026',
    );
    expect(january[1]).toHaveTextContent(
      'Viron alkoholivalmistevero nousi 10 % 1.1.2026',
    );
  });

  it('renders the full 2026 seeded set in deterministic period order across every group', async () => {
    // Task 4.4, spec R4: the intra-group pair above pins one tiebreak;
    // this pins the WHOLE seeded timeline — groups in period order
    // (August's confirmed date renders before the September window even
    // though the fixture lists the window first), the API order kept
    // inside each group, and every card in its correct month/window
    // group. The flat rendered sequence is therefore fully determined.
    mockRequest.mockResolvedValue(eventsResponse(SEEDED_2026));
    renderWithCatalog(<CalendarTimeline year={2026} />, 'fi');

    const timeline = await screen.findByTestId('calendar-timeline');
    const titles = within(timeline)
      .getAllByTestId('calendar-event-card')
      .map((card) => card.querySelector('h4')?.textContent);
    expect(titles).toEqual([
      'Viinien ja siiderien valmistevero nousi 1.1.2026',
      'Viron alkoholivalmistevero nousi 10 % 1.1.2026',
      'Alkon kevään jaksovaihto (odotettu maaliskuun lopussa)',
      'Verohallinto vahvisti vuoden 2027 alkoholiverot 6.8.2026',
      'Alkon syksyn jaksovaihto (odotettu syyskuun lopussa)',
      'Vuoden 2027 verotaulukon lainsäädäntö odottaa eduskuntakäsittelyä',
    ]);
  });

  it('renders the honest empty state for a year without events', async () => {
    mockRequest.mockResolvedValue(eventsResponse([]));
    renderWithCatalog(<CalendarTimeline year={2027} />, 'fi');

    const empty = await screen.findByText('Ei merkintöjä vuodelle 2027');
    expect(empty).toBeInTheDocument();
    expect(screen.queryByTestId('calendar-timeline')).not.toBeInTheDocument();
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/calendar/events?year=2027&language=fi',
      expect.anything(),
    );
  });

  it('announces the wait while loading', async () => {
    mockRequest.mockReturnValue(new Promise(() => undefined)); // never settles
    renderWithCatalog(<CalendarTimeline year={2026} />, 'fi');

    expect(screen.getByText('Ladataan veromuutoksia…')).toBeInTheDocument();
    expect(screen.queryByTestId('calendar-timeline')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The route's real serialization (task 4.6 amendment) — the fixture below
// IS the live `/api/v1/calendar/events` payload shape (staging-verified;
// calendar.routes.ts serializes the core-domain Disclaimer object), so
// the assertions prove the island renders the ACTUAL response, not the
// pre-fix bare-string shape that blanked the cards.
// ---------------------------------------------------------------------------

describe('CalendarTimeline — live payload serialization', () => {
  /** The route's real serialization: versioned disclaimer object at the top level. */
  const LIVE_PAYLOAD: CalendarEventsResponse = {
    year: 2026,
    disclaimer: {
      text: DISCLAIMER_FI,
      language: 'fi',
      version: '1.0',
    },
    events: [
      seededEvent({
        id: 5,
        eventType: 'TAX_TABLE_PUBLICATION',
        status: 'CONFIRMED',
        occurrenceDate: '2026-08-06',
        expectedWindow: null,
      }),
      seededEvent({
        id: 6,
        eventType: 'RATE_DECISION',
        status: 'EXPECTED',
        occurrenceDate: null,
        expectedWindow: '2026-Q4',
      }),
    ],
  };

  it('renders the live object disclaimer on EXPECTED cards and the date on CONFIRMED cards', async () => {
    mockRequest.mockResolvedValue(LIVE_PAYLOAD);
    renderWithCatalog(<CalendarTimeline year={2026} />, 'fi');

    const timeline = await screen.findByTestId('calendar-timeline');
    const cards = within(timeline).getAllByTestId('calendar-event-card');

    // The CONFIRMED card shows its exact date…
    expect(cards[0]).toHaveTextContent('Voimaantulopäivä: 6.8.2026');
    // …and the EXPECTED card renders the disclaimer TEXT from the live
    // object (the pre-fix code rendered the object itself → blank).
    expect(
      within(cards[1]).getByTestId('calendar-event-disclaimer'),
    ).toHaveTextContent(DISCLAIMER_FI);
    expect(cards[1].textContent).not.toContain('Voimaantulopäivä');
  });

  it('degrades to the transient failure state when the disclaimer violates its shape', async () => {
    // Both violations degrade identically: a bare string (the pre-fix
    // consumer shape) and an object without the required text.
    for (const broken of [
      { ...eventsResponse(SEEDED_2026), disclaimer: { language: 'fi', version: '1.0' } },
      {
        ...eventsResponse(SEEDED_2026),
        disclaimer: 'Vuosirytmi: …' as unknown as CalendarEventsResponse['disclaimer'],
      },
    ]) {
      cleanup();
      mockRequest.mockResolvedValue(broken);
      renderWithCatalog(<CalendarTimeline year={2026} />, 'fi');

      // R2 requires the disclaimer on every EXPECTED card — an unusable
      // disclaimer means the failure state, never a card without it.
      await screen.findByText('Luetteloa ei saatu haettua');
      expect(screen.queryByTestId('calendar-timeline')).not.toBeInTheDocument();
    }
  });
});

// ---------------------------------------------------------------------------
// The English variant
// ---------------------------------------------------------------------------

describe('CalendarTimeline — en variant', () => {
  it('renders the English copy, badges, window label, and fetches language=en', async () => {
    mockRequest.mockResolvedValue(eventsResponse(SEEDED_2026, 'en'));
    renderWithCatalog(<CalendarTimeline year={2026} />, 'en');

    const timeline = await screen.findByTestId('calendar-timeline');
    expect(timeline).toHaveTextContent(
      'Finnish wine and cider excise rose on 1 January 2026',
    );
    // Locale-selected badge labels and the English window phrasing.
    expect(within(timeline).getAllByText('Confirmed')).toHaveLength(3);
    expect(within(timeline).getAllByText('Annual rhythm')).toHaveLength(3);
    expect(timeline).toHaveTextContent('Expected September 2026');
    expect(timeline).toHaveTextContent('Expected Q4 2026');
    // Dates follow the en convention (the house numeric en-GB form).
    expect(timeline).toHaveTextContent('Effective date: 01/01/2026');
    // The en disclaimer rides the EXPECTED cards.
    expect(
      within(timeline).getAllByTestId('calendar-event-disclaimer')[0],
    ).toHaveTextContent('Annual rhythm: tax changes and price-list switches');

    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/calendar/events?year=2026&language=en',
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// Failure honesty (the house listing-honesty pattern)
// ---------------------------------------------------------------------------

describe('CalendarTimeline — failure honesty', () => {
  it('renders the age-gate CTA on 403, never the backend-down copy', async () => {
    mockRequest.mockRejectedValue(new ApiFetchError(403, null));
    renderWithCatalog(<CalendarTimeline year={2026} />, 'fi');

    await screen.findByText('Ikävahvistus tarvitaan');
    const link = screen.getByRole('link', { name: 'Siirry ikävahvistukseen' });
    expect(link).toHaveAttribute('href', '/age-gate');
    // A missing confirmation is not an outage: no backend copy, no retry.
    expect(
      screen.queryByText('Luetteloa ei saatu haettua'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('calendar-timeline')).not.toBeInTheDocument();
  });

  it('renders backoff copy on 429, and retry recovers the timeline', async () => {
    mockRequest
      .mockRejectedValueOnce(new ApiFetchError(429, null))
      .mockResolvedValueOnce(eventsResponse(SEEDED_2026));
    renderWithCatalog(<CalendarTimeline year={2026} />, 'fi');

    await screen.findByText(
      'Palveluun kohdistuu juuri nyt hyvin paljon pyyntöjä. Yritä uudelleen hetken kuluttua.',
    );

    await userEvent.setup().click(screen.getByRole('button'));
    await screen.findByTestId('calendar-timeline');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('renders the transient state with retry on a 500', async () => {
    mockRequest
      .mockRejectedValueOnce(new ApiFetchError(500, null))
      .mockResolvedValueOnce(eventsResponse(SEEDED_2026));
    renderWithCatalog(<CalendarTimeline year={2026} />, 'fi');

    await screen.findByText('Luetteloa ei saatu haettua');
    expect(
      screen.getByText('Taustajärjestelmä ei vastannut. Voit yrittää uudelleen.'),
    ).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button'));
    await screen.findByTestId('calendar-timeline');
  });

  it('renders the transient state for a network-class failure', async () => {
    mockRequest.mockRejectedValue(
      new ApiFetchError(0, null, null, {
        failureClass: 'network',
        message: 'API request failed: Failed to fetch',
      }),
    );
    renderWithCatalog(<CalendarTimeline year={2026} />, 'fi');

    await screen.findByText('Luetteloa ei saatu haettua');
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.queryByTestId('calendar-timeline')).not.toBeInTheDocument();
  });
});
