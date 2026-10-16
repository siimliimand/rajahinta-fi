/**
 * Unit tests for the pure candidate state machine (spec: calendar-
 * event-automation, "Candidate collection from source feeds" +
 * "Operator review queue", task 2.2): the PENDING → ACCEPTED | REJECTED
 * transitions (terminal states), URL dedup (exact string, any stored
 * status), and the accept→event mapping through the committed
 * {@link assertValidCalendarEvent} contract.
 *
 * Pure functions — no DB, no mocks, no clock.
 */
import { describe, expect, it } from 'vitest';

import {
  CALENDAR_CANDIDATE_STATUSES,
  InvalidCandidateTransitionError,
  acceptCandidate,
  assertValidCalendarCandidate,
  decideCandidateInsert,
  rejectCandidate,
  type CalendarCandidateAcceptanceForm,
  type CalendarEventCandidate,
} from '../calendar.candidate';
import {
  CALENDAR_EVENT_TYPES,
  InvalidCalendarInputError,
  type CalendarEvent,
} from '../calendar.types';
import { assertValidCalendarEvent } from '../calendar';
import { resolveExpectedWindow } from '../ordering';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let seq = 1;

/** A PENDING candidate with watcher drafts — the typical watcher output. */
function candidate(overrides: Partial<CalendarEventCandidate> = {}): CalendarEventCandidate {
  return {
    source: 'vero-fi-news',
    url: `https://www.vero.fi/uutishuone/item-${seq++}`,
    title: 'Valmisteveromuutoksia 1.1.2027',
    publishedAt: '2026-10-15',
    status: 'PENDING',
    draftFi: 'Luonnos: alkoholijuomien valmisteverot muuttuvat 1.1.2027.',
    draftEn: 'Draft: alcoholic beverage excise duties change on 1 January 2027.',
    ...overrides,
  };
}

/** A candidate with no watcher drafts — the operator must supply the texts. */
function bareCandidate(overrides: Partial<CalendarEventCandidate> = {}): CalendarEventCandidate {
  return candidate({ draftFi: null, draftEn: null, ...overrides });
}

/** The plain operator form: a CONFIRMED FI excise event on a chosen day. */
function confirmForm(overrides: Partial<CalendarCandidateAcceptanceForm> = {}): CalendarCandidateAcceptanceForm {
  return {
    eventType: 'FI_EXCISE_CHANGE',
    status: 'CONFIRMED',
    occurrenceDate: '2027-01-01',
    expectedWindow: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Status machine — the legal transitions
// ---------------------------------------------------------------------------

describe('candidate state machine — transitions', () => {
  it('PENDING → ACCEPTED: the decided row keeps every field but the status', () => {
    const pending = candidate();
    const accepted = acceptCandidate(pending, confirmForm()).candidate;

    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted).toEqual({ ...pending, status: 'ACCEPTED' });
  });

  it('PENDING → REJECTED: the decided row keeps every field but the status', () => {
    const pending = candidate();
    const rejected = rejectCandidate(pending);

    expect(rejected.status).toBe('REJECTED');
    expect(rejected).toEqual({ ...pending, status: 'REJECTED' });
  });

  it('transitions never mutate the input — each decision is a new object', () => {
    const pending = candidate();
    const snapshot = { ...pending };

    acceptCandidate(pending, confirmForm());
    rejectCandidate(pending);

    expect(pending).toEqual(snapshot);
  });

  it('ACCEPTED is terminal: neither action can re-decide it', () => {
    const accepted = acceptCandidate(candidate(), confirmForm()).candidate;

    expect(() => acceptCandidate(accepted, confirmForm())).toThrow(InvalidCandidateTransitionError);
    expect(() => rejectCandidate(accepted)).toThrow(InvalidCandidateTransitionError);
  });

  it('REJECTED is terminal: neither action can re-decide it', () => {
    const rejected = rejectCandidate(candidate());

    expect(() => acceptCandidate(rejected, confirmForm())).toThrow(InvalidCandidateTransitionError);
    expect(() => rejectCandidate(rejected)).toThrow(InvalidCandidateTransitionError);
  });

  it('a transition violation names the state and the terminality', () => {
    const rejected = rejectCandidate(candidate());

    try {
      rejectCandidate(rejected);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidCandidateTransitionError);
      expect((error as Error).message).toContain('REJECTED, not PENDING');
      expect((error as Error).message).toContain('terminal');
    }
  });
});

// ---------------------------------------------------------------------------
// URL dedup — the watcher's insert decision
// ---------------------------------------------------------------------------

describe('decideCandidateInsert — URL dedup', () => {
  it('an unknown URL inserts', () => {
    expect(decideCandidateInsert({ url: 'https://www.vero.fi/new' }, [])).toBe('INSERT');
    expect(decideCandidateInsert({ url: 'https://www.vero.fi/new' }, ['https://other.fi/a'])).toBe('INSERT');
  });

  it('a known URL skips — from any stored status, REJECTED included', () => {
    const known = [
      candidate({ status: 'PENDING', url: 'https://www.vero.fi/a' }).url,
      candidate({ status: 'ACCEPTED', url: 'https://www.vero.fi/b' }).url,
      candidate({ status: 'REJECTED', url: 'https://www.vero.fi/c' }).url,
    ];

    for (const url of known) {
      expect(decideCandidateInsert({ url }, known)).toBe('SKIP_KNOWN_URL');
    }
  });

  it('accepts the known set as an array or a Set', () => {
    const known = new Set(['https://www.vero.fi/a']);

    expect(decideCandidateInsert({ url: 'https://www.vero.fi/a' }, known)).toBe('SKIP_KNOWN_URL');
    expect(decideCandidateInsert({ url: 'https://www.vero.fi/b' }, known)).toBe('INSERT');
    // And it never mutates the caller's Set.
    expect(known.size).toBe(1);
  });

  it('the comparison is the exact string — the same rule the url UNIQUE column enforces', () => {
    const known = ['https://www.vero.fi/a'];

    // A trailing slash, a case difference, a scheme difference: distinct
    // strings are distinct URLs. No silent normalization here — the
    // storage boundary would disagree with the pure layer otherwise.
    expect(decideCandidateInsert({ url: 'https://www.vero.fi/a/' }, known)).toBe('INSERT');
    expect(decideCandidateInsert({ url: 'https://www.vero.fi/A' }, known)).toBe('INSERT');
    expect(decideCandidateInsert({ url: 'http://www.vero.fi/a' }, known)).toBe('INSERT');
    expect(decideCandidateInsert({ url: 'https://www.vero.fi/a' }, known)).toBe('SKIP_KNOWN_URL');
  });

  it('rejects a blank URL — a malformed item is a caller bug, not a skip', () => {
    for (const bad of ['', '   ']) {
      expect(() => decideCandidateInsert({ url: bad }, [])).toThrow(InvalidCalendarInputError);
    }
  });
});

// ---------------------------------------------------------------------------
// Candidate validation
// ---------------------------------------------------------------------------

describe('assertValidCalendarCandidate', () => {
  it('accepts a well-formed candidate in every legal status', () => {
    for (const status of CALENDAR_CANDIDATE_STATUSES) {
      expect(() => assertValidCalendarCandidate(candidate({ status }))).not.toThrow();
    }
  });

  it('rejects an unknown status, naming the valid statuses', () => {
    try {
      assertValidCalendarCandidate(candidate({ status: 'MAYBE' as CalendarEventCandidate['status'] }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidCalendarInputError);
      for (const valid of CALENDAR_CANDIDATE_STATUSES) {
        expect((error as Error).message).toContain(valid);
      }
    }
  });

  it('rejects blank source, url, or title', () => {
    for (const blank of ['source', 'url', 'title'] as const) {
      const broken = candidate({ [blank]: '  ' } as Partial<CalendarEventCandidate>);
      try {
        assertValidCalendarCandidate(broken);
        expect.unreachable(`${blank} must be required`);
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidCalendarInputError);
        expect((error as Error).message).toContain(blank);
      }
    }
  });

  it('rejects a malformed or impossible publishedAt', () => {
    for (const bad of ['2026-10', '15.10.2026', '2026-02-30', '']) {
      expect(() => assertValidCalendarCandidate(candidate({ publishedAt: bad }))).toThrow(
        InvalidCalendarInputError,
      );
    }
  });

  it('rejects a whitespace-only draft — it would read as present and fail mid-acceptance', () => {
    expect(() => assertValidCalendarCandidate(candidate({ draftFi: '  ' }))).toThrow(
      /draftFi must be null or a non-empty string/,
    );
    expect(() => assertValidCalendarCandidate(candidate({ draftEn: '' }))).toThrow(
      /draftEn must be null or a non-empty string/,
    );
  });

  it('the machine validates its inputs before deciding — a malformed row is never transitioned', () => {
    const broken = candidate({ publishedAt: '2026-02-30' });

    expect(() => rejectCandidate(broken)).toThrow(InvalidCalendarInputError);
    expect(() => acceptCandidate(broken, confirmForm())).toThrow(InvalidCalendarInputError);
  });
});

// ---------------------------------------------------------------------------
// Accept → event mapping — through the existing event validator
// ---------------------------------------------------------------------------

describe('acceptCandidate — event mapping', () => {
  it('produces an id-less payload that satisfies the calendar event contract once an id is assigned', () => {
    const { event } = acceptCandidate(candidate(), confirmForm());

    // The payload itself carries no id — ids are the repository's job…
    expect('id' in event).toBe(false);

    // …and the contract holds the moment the repository assigns one.
    const stored: CalendarEvent = { id: 42, ...event };
    expect(() => assertValidCalendarEvent(stored)).not.toThrow();
  });

  it('fills the event identity from the candidate: url is the source, drafts are the texts', () => {
    const pending = candidate();
    const { event } = acceptCandidate(pending, confirmForm());

    expect(event.sourceUrl).toBe(pending.url);
    expect(event.titleFi).toBe(pending.draftFi);
    expect(event.titleEn).toBe(pending.draftEn);
    expect(event.summaryFi).toBe(pending.draftFi);
    expect(event.summaryEn).toBe(pending.draftEn);
  });

  it('operator overrides beat the drafts, field by field', () => {
    const pending = candidate();
    const { event } = acceptCandidate(
      pending,
      confirmForm({
        titleFi: 'Operaattorin otsikko',
        summaryEn: 'Operator summary',
      }),
    );

    expect(event.titleFi).toBe('Operaattorin otsikko');
    expect(event.titleEn).toBe(pending.draftEn); // draft used where no override
    expect(event.summaryFi).toBe(pending.draftFi);
    expect(event.summaryEn).toBe('Operator summary');
  });

  it('a field with neither override nor draft is a violation naming the field — never fabricated', () => {
    for (const field of ['titleFi', 'titleEn', 'summaryFi', 'summaryEn'] as const) {
      // Supply the other three texts so the looped field is genuinely
      // the first violation (resolution fails at the first hole).
      const overrides: Partial<
        Record<'titleFi' | 'titleEn' | 'summaryFi' | 'summaryEn', string>
      > = {};
      for (const other of ['titleFi', 'titleEn', 'summaryFi', 'summaryEn'] as const) {
        if (other !== field) {
          overrides[other] = `operator ${other}`;
        }
      }
      try {
        acceptCandidate(bareCandidate(), confirmForm(overrides));
        expect.unreachable(`${field} must be required`);
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidCalendarInputError);
        expect((error as Error).message).toContain(field);
      }
    }

    // With nothing supplied at all, the first field in resolution order wins.
    expect(() => acceptCandidate(bareCandidate(), confirmForm())).toThrow(/titleFi has no operator override/);
  });

  it('an explicit empty override fails the contract instead of silently using the draft', () => {
    // A cleared form field must not fall back to the watcher draft —
    // the operator asked for empty, and empty text is a contract
    // violation the event validator names.
    try {
      acceptCandidate(candidate(), confirmForm({ titleFi: '' }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidCalendarInputError);
      expect((error as Error).message).toContain('titleFi');
    }
  });

  it('derives the year from the chosen period — CONFIRMED date', () => {
    const { event } = acceptCandidate(candidate(), confirmForm({ occurrenceDate: '2029-01-01' }));
    expect(event.year).toBe(2029);
    expect(event.occurrenceDate).toBe('2029-01-01');
    expect(event.expectedWindow).toBeNull();
  });

  it('derives the year from the chosen period — EXPECTED month window, contract-valid', () => {
    const { event } = acceptCandidate(
      candidate(),
      confirmForm({
        status: 'EXPECTED',
        occurrenceDate: null,
        expectedWindow: '2027-03',
        eventType: 'ALKO_PRICE_LIST',
      }),
    );

    expect(event.year).toBe(2027);
    expect(event.occurrenceDate).toBeNull();
    expect(event.status).toBe('EXPECTED');
    expect(resolveExpectedWindow(event.expectedWindow as string).startMonth).toBe(3);

    const stored: CalendarEvent = { id: 1, ...event };
    expect(() => assertValidCalendarEvent(stored)).not.toThrow();
  });

  it('derives the year from the chosen period — EXPECTED quarter window too', () => {
    const { event } = acceptCandidate(
      bareCandidate({
        draftFi: 'Luonnos: verotaulukon lainsäädäntö.',
        draftEn: 'Draft: statutory tax-table legislation.',
      }),
      confirmForm({
        eventType: 'RATE_DECISION',
        status: 'EXPECTED',
        occurrenceDate: null,
        expectedWindow: '2027-Q4',
      }),
    );

    expect(event.year).toBe(2027);
    expect(event.expectedWindow).toBe('2027-Q4');
  });

  it('illegal combinations fail the contract the same way events do — CONFIRMED with a window', () => {
    try {
      acceptCandidate(
        candidate(),
        confirmForm({ occurrenceDate: null, expectedWindow: '2027-01' }),
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidCalendarInputError);
      expect((error as Error).message).toContain('CONFIRMED event must not carry an expected window');
    }
  });

  it('illegal combinations fail the contract the same way events do — EXPECTED with a date', () => {
    try {
      acceptCandidate(
        candidate(),
        confirmForm({ status: 'EXPECTED', occurrenceDate: '2027-01-01', expectedWindow: null }),
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidCalendarInputError);
      expect((error as Error).message).toContain('EXPECTED event must not carry an exact occurrence date');
    }
  });

  it('neither date nor window — or both — is rejected before anything is built', () => {
    const neither = confirmForm({ occurrenceDate: null, expectedWindow: null });
    expect(() => acceptCandidate(candidate(), neither)).toThrow(/exactly one of occurrenceDate/);

    const both = confirmForm({ occurrenceDate: '2027-01-01', expectedWindow: '2027-01' });
    expect(() => acceptCandidate(candidate(), both)).toThrow(/exactly one of occurrenceDate/);
  });

  it('an unknown event type is rejected naming the valid types', () => {
    try {
      acceptCandidate(
        candidate(),
        confirmForm({ eventType: 'VOLCANO' as CalendarCandidateAcceptanceForm['eventType'] }),
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidCalendarInputError);
      for (const valid of CALENDAR_EVENT_TYPES) {
        expect((error as Error).message).toContain(valid);
      }
    }
  });

  it('a malformed period value fails at the contract boundary — impossible day, bad month, bad year prefix', () => {
    const impossibleDay = confirmForm({ occurrenceDate: '2027-02-30' });
    expect(() => acceptCandidate(candidate(), impossibleDay)).toThrow(/real calendar day/);

    const badMonth = confirmForm({
      status: 'EXPECTED',
      occurrenceDate: null,
      expectedWindow: '2027-13',
    });
    expect(() => acceptCandidate(candidate(), badMonth)).toThrow(/valid shapes/);

    const badYear = confirmForm({ occurrenceDate: 'jan-01-01' });
    expect(() => acceptCandidate(candidate(), badYear)).toThrow(/four-digit year/);
  });

  it('the accepted candidate retains its url — rejection and acceptance both keep dedup working', () => {
    const pending = candidate({ url: 'https://www.vero.fi/once' });
    const { candidate: accepted } = acceptCandidate(pending, confirmForm());

    expect(accepted.url).toBe('https://www.vero.fi/once');
    expect(decideCandidateInsert({ url: accepted.url }, [accepted.url])).toBe('SKIP_KNOWN_URL');
  });
});
