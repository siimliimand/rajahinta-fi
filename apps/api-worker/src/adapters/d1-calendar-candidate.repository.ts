/**
 * D1CalendarCandidateRepository — the Worker-side store for the
 * `calendar_event_candidates` review queue (task 4.1, change
 * calendar-event-automation). The calendar-event side of the house
 * pattern is port-in-core-domain + Drizzle-adapter-in-data-platform;
 * the candidate port has no core-domain home (task 4.1's scope keeps
 * the packages untouched), so the port interface and this D1 adapter
 * live together here — the worker-local d1-*.store.ts adapter
 * precedent (`d1-crawl-watermark.store.ts`, `d1-upsert.repository.ts`).
 *
 * Raw D1 SQL over the same binding shape every D1 repository takes
 (`env.DB`), mirroring the source-watcher's insert (task 3.3) so the
 * queue's two writers share one id-allocation convention (MAX(id)+1 —
 * single-operator table, no allocation race) and one idiom. Writes go
 * through the persistence-boundary validator
 * (`validateCalendarEventCandidate`) — the one content contract the
 * watcher and this console share; the schema CHECKs stay the last-line
 * guarantee for raw paths.
 *
 * Reads map rows onto the pure core-domain candidate shape
 * (`CalendarEventCandidate`) so every decision below the route goes
 * through the pure state machine (`acceptCandidate`/`rejectCandidate`)
 * in its own vocabulary — the repository never re-decides.
 *
 * @module D1CalendarCandidateRepository
 */

import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import {
  validateCalendarEventCandidate,
  type ValidatedCalendarEventCandidate,
} from '../../../../packages/data-platform/src/repositories/calendar-candidate-validator';
import type { CalendarEventCandidate } from '../../../../packages/core-domain/src/calendar/calendar.candidate';

/** The port the ops candidates routes program against (test seam too). */
export interface ICalendarCandidateRepository {
  /** Every PENDING candidate, newest-first, deterministically tied. */
  listPending(): Promise<(CalendarEventCandidate & { id: number })[]>;
  /** One candidate by row id, any status, or null when unknown. */
  findById(id: number): Promise<(CalendarEventCandidate & { id: number }) | null>;
  /** Validate + insert one candidate row (PENDING), returning its id. */
  insert(candidate: ValidatedCalendarEventCandidate): Promise<number>;
  /**
   * Transition a PENDING row to a terminal status; false when no
   * PENDING row matched (unknown id, or already decided — terminal
   * states are never overwritten).
   */
  updateStatus(
    id: number,
    status: Extract<CalendarEventCandidate['status'], 'ACCEPTED' | 'REJECTED'>,
  ): Promise<boolean>;
}

/** A stored row's camelCase read shape, exactly the D1 columns. */
interface CandidateRow {
  readonly id: number;
  readonly source: string;
  readonly url: string;
  readonly title: string;
  readonly published_at: string;
  readonly status: string;
  readonly draft_fi: string | null;
  readonly draft_en: string | null;
}

/** Raw row → the pure module's read model. Status trusted from the
 * CHECK/validator pair; the pure machine re-validates on every decision. */
function toCandidate(row: CandidateRow): CalendarEventCandidate {
  return {
    source: row.source,
    url: row.url,
    title: row.title,
    publishedAt: row.published_at,
    status: row.status as CalendarEventCandidate['status'],
    draftFi: row.draft_fi,
    draftEn: row.draft_en,
  };
}

const LIST_PENDING_SQL =
  // The queue read the composite index serves: leading status column
  // filters, published_at orders newest-first; the url tiebreak keeps
  // the order deterministic without a second index.
  'SELECT id, source, url, title, published_at, status, draft_fi, draft_en ' +
  "FROM calendar_event_candidates WHERE status = 'PENDING' " +
  'ORDER BY published_at DESC, url ASC';

export class D1CalendarCandidateRepository implements ICalendarCandidateRepository {
  constructor(private readonly d1: D1DatabaseLike) {}

  /** @inheritdoc */
  async listPending(): Promise<(CalendarEventCandidate & { id: number })[]> {
    const result = await this.d1.prepare(LIST_PENDING_SQL).all<CandidateRow>();
    return (result.results ?? []).map((row) => ({
      id: row.id,
      ...toCandidate(row),
    }));
  }

  /** @inheritdoc */
  async findById(
    id: number,
  ): Promise<(CalendarEventCandidate & { id: number }) | null> {
    const row = await this.d1
      .prepare(
        'SELECT id, source, url, title, published_at, status, draft_fi, draft_en ' +
          'FROM calendar_event_candidates WHERE id = ?',
      )
      .bind(id)
      .first<CandidateRow>();
    return row === null ? null : { id: row.id, ...toCandidate(row) };
  }

  /** @inheritdoc */
  async insert(candidate: ValidatedCalendarEventCandidate): Promise<number> {
    // The persistence-boundary validator is the content contract — run
    // even though the watcher pre-validates, so this repository owns
    // its own guarantee and any future caller inherits it.
    const validated = validateCalendarEventCandidate(candidate);
    const head = await this.d1
      .prepare('SELECT MAX(id) AS max_id FROM calendar_event_candidates')
      .first<{ max_id: number | null }>();
    const id = (head?.max_id ?? 0) + 1;
    await this.d1
      .prepare(
        'INSERT INTO calendar_event_candidates ' +
          '(id, source, url, title, published_at, status, draft_fi, draft_en) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        id,
        validated.source,
        validated.url,
        validated.title,
        validated.publishedAt,
        validated.status,
        validated.draftFi,
        validated.draftEn,
      )
      .run();
    return id;
  }

  /** @inheritdoc */
  async updateStatus(
    id: number,
    status: 'ACCEPTED' | 'REJECTED',
  ): Promise<boolean> {
    // The PENDING predicate is the state machine's storage-side guard: a
    // stale queue view can never overwrite a decision (ACCEPTED and
    // REJECTED are terminal), mirroring the pure layer's
    // InvalidCandidateTransitionError.
    const result = await this.d1
      .prepare(
        "UPDATE calendar_event_candidates SET status = ? WHERE id = ? AND status = 'PENDING'",
      )
      .bind(status, id)
      .run();
    // The source-governance revoke path's changes read — the fake-D1
    // harness and the real binding both report writes' meta.changes.
    return Number(result.meta.changes ?? 0) > 0;
  }
}
