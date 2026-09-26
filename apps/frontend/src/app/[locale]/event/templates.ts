/**
 * Event occasion templates (price-intelligence-roadmap task 4.3): pure
 * data for the ready-made occasions (wedding, birthday, company party,
 * graduation) offered on the event page.
 *
 * Guardrails: a template only PREFILLS the form's editable inputs — it
 * never locks a field and never computes anything. The drink mix rides
 * the event profile (each profile maps to the published consumption
 * norms), so a template prefills guests, duration, and profile; every
 * estimate keeps deriving from the current editable inputs at submit
 * time. Labels live in the message catalogs (`EventPage.templates.*`).
 *
 * @module EventTemplates
 */

import type { EventProfile } from './event.types';

/** The event form's editable simple-mode inputs a template fills. */
export interface EventFormPrefill {
  /** Raw field values, exactly as the form's own inputs hold them. */
  readonly guests: string;
  readonly durationHours: string;
  readonly eventProfile: EventProfile;
}

/** One occasion template: identity, catalog key, and the editable values. */
export interface EventOccasionTemplate {
  /** Stable id — the chip's test handle and re-apply semantics; never displayed. */
  readonly id: string;
  /** Label key under `EventPage.templates`. */
  readonly labelKey: string;
  /** The editable inputs this template prefills. */
  readonly prefill: EventFormPrefill;
}

/**
 * The four occasions, with plausible example guest counts and durations
 * mapped onto the closed profile set (wedding/company party → juhlat,
 * birthday → rentoutunut kokoontuminen, graduation → päivälliskutsut).
 * All prefilled values stay freely editable.
 */
export const EVENT_OCCASION_TEMPLATES: readonly EventOccasionTemplate[] = [
  {
    id: 'wedding',
    labelKey: 'wedding',
    prefill: { guests: '60', durationHours: '8', eventProfile: 'celebration' },
  },
  {
    id: 'birthday',
    labelKey: 'birthday',
    prefill: {
      guests: '20',
      durationHours: '5',
      eventProfile: 'casual_gathering',
    },
  },
  {
    id: 'company-party',
    labelKey: 'companyParty',
    prefill: { guests: '40', durationHours: '6', eventProfile: 'celebration' },
  },
  {
    id: 'graduation',
    labelKey: 'graduation',
    prefill: {
      guests: '25',
      durationHours: '6',
      eventProfile: 'dinner_party',
    },
  },
];
