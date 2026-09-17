'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui';
import {
  calculateEventPlan,
  classifyEventCalcError,
  type EventCalcErrorKind,
} from './event.client';
import type {
  EventCalcResponse,
  EventProfile,
  SourcingRequest,
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
// View component
// ---------------------------------------------------------------------------

/**
 * Event calculator view (price-intelligence-roadmap task 2.3, the D2
 * server-shell conversion): the interactive calculation flow moved intact
 * from the former single-file page. The server shell in `page.tsx` owns
 * the metadata, intro copy, and the method summary; this view renders
 * everything that needs the visitor's interaction state.
 *
 * Behaviour (tasks 4.4/4.5, change product-roadmap-phases-1-4):
 *  - Submit posts to `/api/v1/event-calc`; both 200 states render:
 *    COMPUTED as a shopping list with per-line surplus, and
 *    NO_PUBLISHED_NORMS as a calm explanation.
 *  - The COMPUTED response additionally carries the V2 sourcing plan —
 *    per-line source assignment, totals, explicit budget state, and the
 *    optional packing panel (offered by the form).
 *  - The structural disclaimer from the response is rendered with the
 *    result — never a UI-only string.
 *
 * @module EventView
 */
export default function EventView() {
  const t = useTranslations('EventPage');

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
      sourcing?: SourcingRequest;
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

  // ── Hidden state: none — the page renders unconditionally ──
  return (
    <>
      {/* ── Simple-mode form (with the V2 sourcing section) ── */}
      <section className="mb-8">
        <Card>
          <EventForm onSubmit={handleSubmit} submitting={submitting} packingAvailable />
        </Card>
      </section>

      {/* ── Error (classified failure; degrade, never crash) ── */}
      {errorKind && (
        <p role="alert" className="mb-8 text-sm text-red-600">
          {t(`errors.${errorKind}`)}
        </p>
      )}

      {/* ── Result: shopping list or the no-published-norms state ── */}
      {result && <EventShoppingListResult result={result} />}
    </>
  );
}
