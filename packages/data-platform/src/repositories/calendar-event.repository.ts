/**
 * DrizzleCalendarEventRepository — the concrete adapter behind the
 * core-domain {@link ICalendarEventRepositoryPort} for the tax-change
 * calendar (task 3.1, change tax-change-calendar).
 *
 * Reads the D1 `calendar_events` table through the typed Drizzle D1
 * instance (`getDrizzleD1` over the binding the composition root passes,
 * the same `env.DB` shape every D1 repository takes), with queries
 * schema-checked against the translated `calendarEvents` table
 * definition. Ordering and next-event selection are NOT re-implemented
 * here: rows map straight to the domain {@link CalendarEvent} shape at
 * this boundary and both reads delegate to the pure calendar module
 * (`sortCalendarEvents`, `findNextCalendarEvent`), so the repository and
 * the domain can never disagree about "the next event" or the listing
 * order.
 *
 * Year read: `listByYear` filters on the `year` column — the leading
 * column of `calendar_events_year_idx`. Next-event read: an EXPECTED
 * window event stays upcoming until its window has ENDED, so the read
 * takes every event from the year before `fromDate`'s year onward (no
 * upper bound — an ops-created 2027 event must be findable from
 * 2026-12-30 even when 2027 has no other rows); eligibility itself is
 * the pure selector's rule (`resolveWindowEnd >= fromDate`), so a
 * quarter/month window whose start has passed is still returned.
 *
 * DI note: the binding is optional only for the Nest container — the
 * DataPlatformModule binds the port token where no D1 binding exists
 * (the pg composition root, the DrizzleCorrectionRepository stub
 * precedent), while the Worker passes its real binding at its own
 * composition root (`new DrizzleCalendarEventRepository(env.DB)`).
 * Reading without a binding fails loudly, never silently.
 *
 * @module DrizzleCalendarEventRepository
 */
import { Injectable, Optional } from '@nestjs/common';
import { eq, gte } from 'drizzle-orm';
import {
  findNextCalendarEvent,
  sortCalendarEvents,
  type CalendarEvent,
  type CalendarEventType,
  type CalendarEventStatus,
  type ICalendarEventRepositoryPort,
} from '@rajahinta/core-domain';
import { getDrizzleD1 } from '../db/d1.module';
import type { DrizzleD1 } from '../db/d1.provider';
import type { D1DatabaseLike } from '../d1/executor';
import { calendarEvents } from '../d1/schema';

/** A raw `calendar_events` row as the Drizzle select returns it. */
type CalendarEventDbRow = typeof calendarEvents.$inferSelect;

/**
 * Raw row → the domain read model. The camelCase column mapping is 1:1
 * (the Drizzle table definition already carries the domain field names)
 * and `createdAt` stops here — the port carries no persistence metadata.
 * The status/eventType unions are trusted from the schema CHECKs and the
 * persistence-boundary validator; should a corrupted row ever exist (raw
 * SQL path), the pure module fails loudly on it — validation never
 * coerces or drops values.
 */
function toDomainEvent(row: CalendarEventDbRow): CalendarEvent {
  return {
    id: row.id,
    year: row.year,
    eventType: row.eventType as CalendarEventType,
    status: row.status as CalendarEventStatus,
    occurrenceDate: row.occurrenceDate,
    expectedWindow: row.expectedWindow,
    titleFi: row.titleFi,
    titleEn: row.titleEn,
    summaryFi: row.summaryFi,
    summaryEn: row.summaryEn,
    sourceUrl: row.sourceUrl,
  };
}

@Injectable()
export class DrizzleCalendarEventRepository
  implements ICalendarEventRepositoryPort
{
  constructor(
    // Optional for the DI container only — see the module docstring.
    @Optional() private readonly d1?: D1DatabaseLike,
  ) {}

  /** @inheritdoc */
  async listByYear(year: number): Promise<CalendarEvent[]> {
    const rows = await this.requireDb()
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.year, year));
    // The deterministic stated order (period start, then CONFIRMED before
    // EXPECTED in the same period, then event type, then id) is the pure
    // module's total order — never an SQL ORDER BY the domain would have
    // to agree with.
    return sortCalendarEvents(rows.map(toDomainEvent));
  }

  /** @inheritdoc */
  async findNext(fromDate: string): Promise<CalendarEvent | null> {
    // Malformed dates read nothing: the pure selector re-validates
    // fromDate as a caller-contract violation (InvalidCalendarInputError),
    // so date validation keeps exactly one home — the domain.
    const yearMatch = /^(\d{4})/.exec(fromDate);
    const rows = yearMatch
      ? await this.requireDb()
          .select()
          .from(calendarEvents)
          .where(gte(calendarEvents.year, Number(yearMatch[1]) - 1))
      : [];
    // Selection (eligibility, CONFIRMED-beats-EXPECTED precedence, tie
    // breaks, the daysUntil figure's presence rule) is delegated to the
    // pure function; the port returns the event itself, not the wrapper.
    return findNextCalendarEvent(rows.map(toDomainEvent), fromDate)?.event ?? null;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * The typed Drizzle instance for the binding — memoized per binding
   * object (`getDrizzleD1`), so the homepage widget's per-request reads
   * reuse one instance per isolate. The cast crosses the executor/provider
   * structural boundary only: the drizzle D1 driver drives exactly the
   * prepare/bind/all/run surface this repository issues; the provider
   * type's `raw()` is never touched by select paths (the same boundary
   * `createDrizzleD1` documents).
   */
  private requireDb(): DrizzleD1 {
    if (this.d1 === undefined) {
      throw new Error(
        'DrizzleCalendarEventRepository has no D1 binding — construct it over the D1 database (new DrizzleCalendarEventRepository(env.DB))',
      );
    }
    return getDrizzleD1(this.d1 as Parameters<typeof getDrizzleD1>[0]);
  }
}
