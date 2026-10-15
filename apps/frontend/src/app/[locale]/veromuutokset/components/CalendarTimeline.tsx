'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiFetchError, request } from '@/lib/api';
import type { ApiFailureClass } from '@/lib/api';
import { formatDate } from '@/lib/format/date';
import { Badge } from '@/components/ui';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import {
  groupCalendarEvents,
  type CalendarEventDto,
  type CalendarEventsResponse,
  type CalendarPageLanguage,
} from '../calendar-events';

// ---------------------------------------------------------------------------
// Failure classification (the ValueRanking / listing-failure-honesty form)
// ---------------------------------------------------------------------------

/**
 * Map a fetch rejection to its failure class. `request()` already wraps
 * every transport rejection in an `ApiFetchError`; the raw-abort branch
 * is belt-and-braces for an unwrapped TimeoutError/AbortError, and
 * anything else joins the transient server/network family.
 */
function classifyFailure(err: unknown): ApiFailureClass {
  if (err instanceof ApiFetchError) return err.failureClass;
  if (
    (err instanceof DOMException || err instanceof Error) &&
    (err.name === 'AbortError' || err.name === 'TimeoutError')
  ) {
    return 'timeout';
  }
  return 'server';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The year timeline of the tax-change calendar page (task 4.1).
 *
 * Data comes from the age-gated `GET /api/v1/calendar/events` through
 * the shared API client, so the visitor's confirmation cookie travels
 * and a 403 re-opens the age gate through the client's recovery event —
 * the same client-island pattern the value and savings listings use.
 * A failure renders its class-distinct state: a 403 the age confirmation
 * CTA (never the backend-unavailable copy), a 429 the backoff copy, and
 * the transient family (timeout, server, network) the ErrorState with
 * retry. A year without events renders the honest empty state; rows are
 * never invented.
 *
 * Honest framing (spec: honest separation): CONFIRMED events render
 * their exact date and official source; EXPECTED events render their
 * window's group label, the annual-rhythm badge, and the API's
 * structural rhythm disclaimer — never a fabricated date.
 */
export default function CalendarTimeline({ year }: { year: number }) {
  const t = useTranslations('TaxChangeCalendarPage');
  const locale = useLocale();
  const language: CalendarPageLanguage = locale === 'en' ? 'en' : 'fi';

  const [data, setData] = useState<CalendarEventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  /** Failure class of the latest fetch; null while it stands. */
  const [failure, setFailure] = useState<ApiFailureClass | null>(null);
  // Bumping this value re-runs the effect — the retry affordance.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailure(null);

    request<CalendarEventsResponse>(
      `/api/v1/calendar/events?year=${year}&language=${language}`,
      // The read is a tiny indexed listing; the timeout surfaces a dead
      // backend through the ErrorState/retry in seconds (design D7).
      { signal: AbortSignal.timeout(10_000) },
    )
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFailure(classifyFailure(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [year, language, reloadToken]);

  const retry = useCallback(() => setReloadToken((n) => n + 1), []);

  if (loading) {
    return (
      <div aria-live="polite">
        {/* Skeleton is decorative; the live region announces the wait. */}
        <LoadingSkeleton variant="text" count={6} />
        <span className="sr-only">{t('loading')}</span>
      </div>
    );
  }

  if (failure !== null) {
    return <CalendarFailureNotice failureClass={failure} onRetry={retry} />;
  }

  const events = Array.isArray(data?.events) ? data.events : [];
  if (data === null || events.length === 0) {
    return (
      <EmptyState
        title={t('emptyTitle', { year })}
        description={t('emptyBody', { year })}
      />
    );
  }

  const groups = groupCalendarEvents(events, language);

  return (
    <div data-testid="calendar-timeline">
      {groups.map((group) => (
        <section
          key={group.key}
          data-testid="calendar-month-group"
          className="mb-8"
        >
          <h3 className="mb-3 border-b border-gray-200 pb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">
            {group.isExpected
              ? t('groupExpected', { period: group.label })
              : t('groupConfirmed', { period: group.label })}
          </h3>
          <div className="space-y-4">
            {group.events.map((event) => (
              <CalendarEventCard
                key={event.id}
                event={event}
                language={language}
                disclaimer={data.disclaimer}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event card
// ---------------------------------------------------------------------------

/** Grayscale-safe icon shapes (the reliability-badge shapes): a check for
 * the dated fact, the approximate-value wave for the rhythm window. */
function StatusIcon({ status }: { status: CalendarEventDto['status'] }) {
  const common = {
    viewBox: '0 0 12 12',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: 'false',
  } as const;

  return status === 'CONFIRMED' ? (
    <svg {...common} className="h-3 w-3 shrink-0">
      <path d="M2.5 6.3l2.3 2.3 4.7-5" />
    </svg>
  ) : (
    <svg {...common} className="h-3 w-3 shrink-0">
      <path d="M2 7.2c1.1-1.7 2.9-1.7 4 0s2.9 1.7 4 0" />
    </svg>
  );
}

/**
 * One sourced event card: locale-selected title and summary, the status
 * badge (green check "Vahvistettu" / blue wave "Vuosirytmi" — distinct
 * icon shapes so the status survives grayscale), the exact date for
 * CONFIRMED rows only, the API's rhythm disclaimer on EXPECTED
 * presentations, and the mandatory official-source link (the
 * authority-source anchor treatment: new tab, noopener noreferrer).
 */
function CalendarEventCard({
  event,
  language,
  disclaimer,
}: {
  event: CalendarEventDto;
  language: CalendarPageLanguage;
  disclaimer: string;
}) {
  const t = useTranslations('TaxChangeCalendarPage');
  const confirmed = event.status === 'CONFIRMED';
  const title = language === 'en' ? event.titleEn : event.titleFi;
  const summary = language === 'en' ? event.summaryEn : event.summaryFi;

  return (
    <article
      data-testid="calendar-event-card"
      className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={confirmed ? 'verified' : 'estimated'}>
          <StatusIcon status={event.status} />
          {confirmed ? t('badgeConfirmed') : t('badgeExpected')}
        </Badge>
        {confirmed && event.occurrenceDate !== null && (
          <span className="text-xs text-gray-500">
            {t('eventDateLabel', {
              date: formatDate(event.occurrenceDate, language),
            })}
          </span>
        )}
      </div>
      <h4 className="mb-1 text-base font-semibold text-gray-900">{title}</h4>
      <p className="mb-3 text-sm leading-relaxed text-gray-600">{summary}</p>
      {!confirmed && (
        <p
          data-testid="calendar-event-disclaimer"
          className="mb-3 text-xs italic leading-relaxed text-gray-500"
        >
          {disclaimer}
        </p>
      )}
      {/* External official source — plain anchor, the authority-source
          treatment (AuthoritySourceLinks): new tab, noopener noreferrer. */}
      <a
        href={event.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="calendar-source-link"
        className="text-sm text-primary-600 underline hover:text-primary-800"
      >
        {t('sourceLink')}
      </a>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Failure notice
// ---------------------------------------------------------------------------

/**
 * The class-distinct failure affordance (the ValueRanking form): a 403
 * renders the age confirmation CTA — a missing confirmation is not an
 * outage, so the backend-unavailable copy never appears here; a 429 the
 * backoff copy with retry; the transient family the established
 * ErrorState with retry.
 */
function CalendarFailureNotice({
  failureClass,
  onRetry,
}: {
  failureClass: ApiFailureClass;
  onRetry: () => void;
}) {
  const t = useTranslations('TaxChangeCalendarPage');
  const tCommon = useTranslations('Common');

  if (failureClass === 'age-gate') {
    return (
      <ErrorState title={t('ageGateCtaTitle')} description={t('ageGateCtaBody')}>
        <Link
          href="/age-gate"
          className="font-medium text-error-fg underline hover:text-error"
        >
          {t('ageGateCtaLink')}
        </Link>
      </ErrorState>
    );
  }

  if (failureClass === 'rate-limited') {
    return (
      <ErrorState
        title={t('errorTitle')}
        description={t('rateLimitBody')}
        onRetry={onRetry}
        retryLabel={tCommon('retry')}
      />
    );
  }

  // timeout / server / network / unknown — the transient family.
  return (
    <ErrorState
      title={t('errorTitle')}
      description={t('errorBody')}
      onRetry={onRetry}
      retryLabel={tCommon('retry')}
    />
  );
}
