/**
 * Unit tests for the shared date formatters (change
 * fi-locale-surface-hardening, design D2). Pins the two-convention
 * contract: fi localized numeric dates (`4.10.2026`) replacing raw ISO
 * strings inside Finnish prose, the site's en-GB numeric convention for
 * en, and the calculator's existing datetime form (`4.10.2026 klo
 * …`) as the fi datetime shape. Date-only values are calendar dates:
 * formatting pins UTC so no runtime timezone can shift the day.
 *
 * @module DateFormattersTest
 */

import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './date';

describe('formatDate — fi convention (design D2)', () => {
  it('renders the localized numeric date, never raw ISO', () => {
    expect(formatDate('2026-10-04', 'fi')).toBe('4.10.2026');
    expect(formatDate('2026-01-01', 'fi')).toBe('1.1.2026');
  });

  it('is timezone-safe: a date-only string renders as that calendar day everywhere', () => {
    // UTC midnight formatted in UTC — a runtime west of UTC must not
    // pull the date back to the previous day (the raw-ISO-in-prose bug
    // class this helper replaces could not even state a day).
    expect(formatDate('2026-09-08', 'fi')).toBe('8.9.2026');
  });

  it('renders unparseable input verbatim — data, never invented copy', () => {
    expect(formatDate('ei-päivämäärä', 'fi')).toBe('ei-päivämäärä');
  });
});

describe('formatDate — en convention (design D2)', () => {
  it('renders the en-GB numeric form', () => {
    expect(formatDate('2026-10-04', 'en')).toBe('04/10/2026');
  });
});

describe('formatDateTime', () => {
  it('keeps the calculator convention under fi: "4.10.2026 klo …"', () => {
    // Self-consistent expectation: the same call the calculator
    // components made before the helper existed — the rendered value
    // is byte-identical under fi (design D2 names this form correct).
    const iso = '2026-10-04T22:57:50.000Z';
    expect(formatDateTime(iso, 'fi')).toBe(
      new Date(iso).toLocaleString('fi-FI'),
    );
    expect(formatDateTime(iso, 'fi')).toMatch(/^\d{1,2}\.\d{1,2}\.\d{4} klo /);
  });

  it('adjusts to the en convention', () => {
    const iso = '2026-10-04T22:57:50.000Z';
    expect(formatDateTime(iso, 'en')).toBe(new Date(iso).toLocaleString('en-GB'));
  });

  it('renders unparseable input verbatim', () => {
    expect(formatDateTime('not-a-timestamp', 'fi')).toBe('not-a-timestamp');
  });
});
