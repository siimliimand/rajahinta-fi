'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@/components/ui';
import type { EventProfile } from '../event.types';

// ---------------------------------------------------------------------------
// Caps — mirror the server-side zod caps (event-calc.routes.ts, task 4.3)
// ---------------------------------------------------------------------------

export const MIN_GUESTS = 1;
export const MAX_GUESTS = 500;
export const MIN_DURATION_HOURS = 1;
export const MAX_DURATION_HOURS = 72;

/** The MVP simple mode's closed profile set, in display order. */
const PROFILES: readonly EventProfile[] = [
  'casual_gathering',
  'dinner_party',
  'celebration',
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EventFormProps {
  /** Raised with parsed, in-cap values once the inputs validate. */
  readonly onSubmit: (input: {
    guests: number;
    durationHours: number;
    eventProfile: EventProfile;
  }) => void;
  /** Disables the submit control while a calculation is in flight. */
  readonly submitting: boolean;
}

/**
 * Parse a positive integer from a text input value; anything else is NaN.
 */
function parseCount(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return Number.NaN;
  return Number.parseInt(trimmed, 10);
}

/**
 * Simple-mode event form: guests, duration, profile.
 *
 * The event date is intentionally absent — the MVP simple mode has no date
 * input (spec event-calculator "MVP simple mode"); the page supplies today
 * client-side because the API resolves norms by effective date.
 *
 * All user-visible copy comes from the `EventPage` message namespace.
 *
 * @module EventForm
 */
export default function EventForm({ onSubmit, submitting }: EventFormProps) {
  const t = useTranslations('EventPage');

  // ── Field state (strings — parse and clamp at the submit boundary) ──
  const [guests, setGuests] = useState('10');
  const [durationHours, setDurationHours] = useState('4');
  const [eventProfile, setEventProfile] = useState<EventProfile>('casual_gathering');

  const guestsCount = parseCount(guests);
  const durationCount = parseCount(durationHours);
  const valid =
    Number.isInteger(guestsCount) &&
    guestsCount >= MIN_GUESTS &&
    guestsCount <= MAX_GUESTS &&
    Number.isInteger(durationCount) &&
    durationCount >= MIN_DURATION_HOURS &&
    durationCount <= MAX_DURATION_HOURS;

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!valid || submitting) return;
      onSubmit({
        guests: guestsCount,
        durationHours: durationCount,
        eventProfile,
      });
    },
    [valid, submitting, onSubmit, guestsCount, durationCount, eventProfile],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="event-form">
      <Input
        id="event-guests"
        label={t('form.guests')}
        type="number"
        inputMode="numeric"
        min={MIN_GUESTS}
        max={MAX_GUESTS}
        step={1}
        value={guests}
        onChange={(e) => setGuests(e.target.value)}
        required
      />
      <Input
        id="event-duration"
        label={t('form.duration')}
        type="number"
        inputMode="numeric"
        min={MIN_DURATION_HOURS}
        max={MAX_DURATION_HOURS}
        step={1}
        value={durationHours}
        onChange={(e) => setDurationHours(e.target.value)}
        required
      />
      <div>
        <label
          htmlFor="event-profile"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          {t('form.profile')}
        </label>
        <select
          id="event-profile"
          value={eventProfile}
          onChange={(e) => setEventProfile(e.target.value as EventProfile)}
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          {PROFILES.map((profile) => (
            <option key={profile} value={profile}>
              {t(`profile.${profile}`)}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={!valid || submitting} className="w-full">
        {submitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
