'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFeatureFlags } from '@/lib/feature-flags';
import { Card } from '@/components/ui';
import {
  calculateEventPlan,
  classifyEventCalcError,
  type EventCalcErrorKind,
} from './event.client';
import { isEventCalculatorFlagEnabled } from './event-calculator-flag';
import type {
  EventCalcResponse,
  EventProfile,
} from './event.types';
import EventForm from './components/EventForm';
import EventShoppingListResult from './components/EventShoppingListResult';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Today as an ISO `YYYY-MM-DD` calendar date in the user's local time.
 *
 * The API requires a date because norms resolve by effective window, but
 * the MVP simple mode has no date input — the event is assumed upcoming,
 * so the page supplies today. Local components (not UTC) so the date is
 * the calendar day the user is on.
 */
function todayIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

/**
 * Event calculator page — MVP simple mode (task 4.4, change
 * product-roadmap-phases-1-4).
 *
 * Behaviour:
 *  - `enable_event_calculator` off ⇒ renders nothing. The flag state is
 *    resolved server-side and inlined with the initial HTML payload
 *    (design R13), so the page is hidden from the first render — the
 *    account/alerts gating treatment, the most recent flag-gated page.
 *  - Submit posts to `/api/v1/event-calc`; both 200 states render:
 *    COMPUTED as a shopping list with per-line surplus, and
 *    NO_PUBLISHED_NORMS as a calm explanation.
 *  - The structural disclaimer from the response is rendered with the
 *    result — never a UI-only string.
 *
 * @module EventPage
 */
export default function EventPage() {
  const t = useTranslations('EventPage');

  // ── Feature flag (server-resolved, inlined with the initial HTML) ──
  const flags = useFeatureFlags();
  const flagEnabled = isEventCalculatorFlagEnabled(flags);

  // ── Submission state ──
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<EventCalcResponse | null>(null);
  const [errorKind, setErrorKind] = useState<EventCalcErrorKind | null>(null);

  // Guard against duplicate submits
  const submitInFlight = useRef(false);

  const handleSubmit = useCallback(
    async (input: {
      guests: number;
      durationHours: number;
      eventProfile: EventProfile;
    }) => {
      if (submitInFlight.current) return;

      submitInFlight.current = true;
      setSubmitting(true);
      setErrorKind(null);
      setResult(null);

      try {
        const res = await calculateEventPlan({
          ...input,
          eventDate: todayIsoDate(),
        });
        setResult(res);
      } catch (err: unknown) {
        setErrorKind(classifyEventCalcError(err).kind);
      } finally {
        setSubmitting(false);
        submitInFlight.current = false;
      }
    },
    [],
  );

  // ── Hidden state: flag off in the inlined payload ──
  if (!flagEnabled) {
    return null;
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Header ── */}
      <h1 className="mb-1 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm text-gray-500">{t('subtitle')}</p>

      {/* ── Simple-mode form ── */}
      <section className="mb-8">
        <Card>
          <EventForm onSubmit={handleSubmit} submitting={submitting} />
        </Card>
      </section>

      {/* ── Error (classified failure; the 403 case covers a flag flipped
              off server-side mid-session — degrade, never crash) ── */}
      {errorKind && (
        <p role="alert" className="mb-8 text-sm text-red-600">
          {t(`errors.${errorKind}`)}
        </p>
      )}

      {/* ── Result: shopping list or the no-published-norms state ── */}
      {result && <EventShoppingListResult result={result} />}
    </main>
  );
}
