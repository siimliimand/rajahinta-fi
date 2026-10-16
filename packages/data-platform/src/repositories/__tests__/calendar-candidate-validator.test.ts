/**
 * Persistence-boundary validation for `calendar_event_candidates`
 * (task 1.2, change calendar-event-automation). Pure unit tests: every
 * rejection the spec's persistence-boundary clause demands — unknown
 * status, missing source/url/title, a publishedAt that is not a real
 * YYYY-MM-DD day, and blank drafts — plus the PENDING, ACCEPTED, and
 * REJECTED happy paths with the status narrowed onto the closed
 * vocabulary.
 *
 * @module CalendarCandidateValidatorTest
 */
import { describe, it, expect } from 'vitest';
import {
  validateCalendarEventCandidate,
  type CalendarEventCandidateInput,
} from '../calendar-candidate-validator';
import { CALENDAR_CANDIDATE_STATUSES } from '../../d1/schema';

function candidateInput(
  overrides: Partial<CalendarEventCandidateInput> = {},
): CalendarEventCandidateInput {
  return {
    source: 'vero-fi-news',
    url: 'https://vero.fi/uutiset/valmisteverot-muuttuvat',
    title: 'Valmisteverot muuttuvat vuoden 2027 alussa',
    publishedAt: '2026-10-15',
    status: 'PENDING',
    draftFi: 'Valmisteverot muuttuvat.',
    draftEn: 'Excise duties change.',
    ...overrides,
  };
}

describe('validateCalendarEventCandidate — happy paths', () => {
  it('accepts a PENDING candidate and narrows the status onto the closed vocabulary', () => {
    const candidate = validateCalendarEventCandidate(candidateInput());
    expect(candidate).toEqual({
      source: 'vero-fi-news',
      url: 'https://vero.fi/uutiset/valmisteverot-muuttuvat',
      title: 'Valmisteverot muuttuvat vuoden 2027 alussa',
      publishedAt: '2026-10-15',
      status: 'PENDING',
      draftFi: 'Valmisteverot muuttuvat.',
      draftEn: 'Excise duties change.',
    });
  });

  it('accepts every closed status value — PENDING, ACCEPTED, REJECTED', () => {
    for (const status of CALENDAR_CANDIDATE_STATUSES) {
      expect(() => validateCalendarEventCandidate(candidateInput({ status }))).not.toThrow();
    }
  });

  it('accepts null drafts and passes real drafts through unchanged', () => {
    const withoutDrafts = validateCalendarEventCandidate(
      candidateInput({ draftFi: null, draftEn: null }),
    );
    expect(withoutDrafts.draftFi).toBeNull();
    expect(withoutDrafts.draftEn).toBeNull();

    const decided = validateCalendarEventCandidate(
      candidateInput({ status: 'REJECTED', draftFi: null, draftEn: 'Rejected item text.' }),
    );
    expect(decided.status).toBe('REJECTED');
    expect(decided.draftEn).toBe('Rejected item text.');
  });
});

describe('validateCalendarEventCandidate — closed-vocabulary rejection', () => {
  it('rejects an unknown status naming the valid statuses', () => {
    expect(() =>
      validateCalendarEventCandidate(candidateInput({ status: 'MAYBE' })),
    ).toThrow(
      /calendar_event_candidates\.status "MAYBE" is not a known candidate status — valid statuses: PENDING, ACCEPTED, REJECTED/,
    );
  });
});

describe('validateCalendarEventCandidate — identity rejections', () => {
  it('rejects a missing source — every candidate cites the feed it came from', () => {
    expect(() => validateCalendarEventCandidate(candidateInput({ source: '' }))).toThrow(
      /calendar_event_candidates\.source is required/,
    );
    expect(() => validateCalendarEventCandidate(candidateInput({ source: '   ' }))).toThrow(
      /source is required/,
    );
  });

  it('rejects a missing url — the dedup key cannot be blank', () => {
    expect(() => validateCalendarEventCandidate(candidateInput({ url: '' }))).toThrow(
      /calendar_event_candidates\.url is required/,
    );
    expect(() => validateCalendarEventCandidate(candidateInput({ url: '  ' }))).toThrow(
      /url is required/,
    );
  });

  it('rejects a missing title — the queue renders the observed headline', () => {
    expect(() => validateCalendarEventCandidate(candidateInput({ title: '' }))).toThrow(
      /calendar_event_candidates\.title is required/,
    );
  });
});

describe('validateCalendarEventCandidate — publishedAt shape rejection', () => {
  it('rejects values that are not a real YYYY-MM-DD calendar day', () => {
    const bad = ['20261015', '2026-10', '15.10.2026', '2026-13-01', '2026-02-30', ''];
    for (const publishedAt of bad) {
      expect(() => validateCalendarEventCandidate(candidateInput({ publishedAt }))).toThrow(
        /calendar_event_candidates\.published_at .* must be a real calendar date in YYYY-MM-DD shape/,
      );
    }
  });
});

describe('validateCalendarEventCandidate — draft rejection', () => {
  it('rejects a whitespace-only draft — it would read as present and fail mid-acceptance', () => {
    expect(() => validateCalendarEventCandidate(candidateInput({ draftFi: '  ' }))).toThrow(
      /calendar_event_candidates\.draft_fi must be null or a non-empty string/,
    );
    expect(() => validateCalendarEventCandidate(candidateInput({ draftEn: '' }))).toThrow(
      /calendar_event_candidates\.draft_en must be null or a non-empty string/,
    );
  });
});
