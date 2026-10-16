/**
 * Structural rhythm disclaimers — the versioned FI/EN constant pair that
 * travels with every EXPECTED-event presentation (spec: tax-change-
 * calendar: "Every EXPECTED-event presentation SHALL carry a structural
 * disclaimer stating the event is a recurring rhythm, not a forecast or
 * an official announcement").
 *
 * Wording rules (spec, design):
 * - structural only — selected from this versioned pair by explicit
 *   language, never composed at request time (the what-if discipline,
 *   reused so the two surfaces read consistently);
 * - free of forecast and political language — the wording contains no
 *   prediction vocabulary at all (unlike the what-if disclaimers, which
 *   NAME the forecast they are not, this one simply does not speak of
 *   prediction): it describes the publication rhythm and states what
 *   the note is not (an official announcement, a notice of a tax or
 *   price change);
 * - Finnish-first: an absent language selects `fi` (design D1).
 *
 * @module CalendarDisclaimer
 */

import type { Disclaimer } from '../calculator/calculator.types';
import type { CalendarLanguage } from './calendar.types';

export const CALENDAR_RHYTHM_DISCLAIMER_FI: Disclaimer = {
  text: 'Vuosirytmi: veromuutosten ja hintaluetteloiden ajankohdat toistuvat vuosittain saman kalenterirytmin mukaan. Merkintä kuvaa julkaisuaikataulua — se ei ole virallinen ilmoitus eikä tieto vero- tai hintamuutoksesta.',
  language: 'fi',
  version: '1.0',
};

export const CALENDAR_RHYTHM_DISCLAIMER_EN: Disclaimer = {
  text: 'Annual rhythm: tax changes and price-list switches recur each year on the same calendar rhythm. The note describes a publication schedule — it is not an official announcement and not a statement of a tax or price change.',
  language: 'en',
  version: '1.0',
};

/**
 * Select the rhythm disclaimer from the versioned pair — the ONLY
 * selection path. No wording is composed here or anywhere at request
 * time; an absent or unknown language falls back to `fi` (Finnish-first
 * site; `en` is an explicit request).
 */
export function selectRhythmDisclaimer(language: CalendarLanguage = 'fi'): Disclaimer {
  return language === 'en' ? CALENDAR_RHYTHM_DISCLAIMER_EN : CALENDAR_RHYTHM_DISCLAIMER_FI;
}
