/**
 * Calendar-event fan-out at the rate-version confirmation point (task 3.2,
 * change calendar-event-automation; spec "Calendar event fan-out at the
 * rate-confirmation gate", design D2).
 *
 * ## Trigger — rate-version confirmation, not a cadence
 *
 * A CONFIRMED FI_EXCISE_CHANGE row is born when an operator CONFIRMS a
 * rate dataset version whose effective year has no FI_EXCISE_CHANGE
 * event yet — the same human gate the blog-draft hook rides. NO cron
 * pattern registers here. Unlike the alerts/drafts twins, the ops
 * confirmation handler AWAITS this fan-out (fail-open) instead of
 * parking it on `waitUntil`: a confirmed fact must be visible through
 * the public calendar in the same response, and the route tests pin
 * that determinism. The fail-open rule is identical (spec: "a failure
 * SHALL NOT block or roll back the dataset confirmation").
 *
 * ## Single diff, no second implementation
 *
 * "What changed" is the SAME versioned delta the rate-change blog
 * drafts consume ({@link resolveVersionDelta} — the predecessor-paired
 * tax_rules projection), and the typical-basket impact figure is the
 * content module's own estimator — nothing here recomputes rates. The
 * delta's effective date fixes the event year; the row is dated
 * 1 January of that year, status CONFIRMED (exact dated fact), source
 * the version's tax_rules `official_source` (the authoritative URL
 * every rule row already carries — no operator-typed citation).
 *
 * ## Idempotency — the (year, event type) skip rule
 *
 * The year read goes through the SAME DrizzleCalendarEventRepository
 * the public API serves from: if the effective year already carries any
 * FI_EXCISE_CHANGE row (seed, ops console, or a previous fan-out), the
 * run is a logged skip — a re-confirmation can never duplicate the
 * event. `calendar_events` has deliberately no unique key on
 * (year, event_type): this read is the only gate, so the fan-out must
 * run exactly once per confirmation (the handler awaits it directly; it
 * is NOT added to the fire-and-forget aggregator, which would race it).
 *
 * @module CalendarEventFanout
 */

import {
  estimateTypicalBasketImpactCents,
  TYPICAL_BASKET,
} from '../../../../packages/core-domain/src/content/content';
import type { RateChangeLine } from '../../../../packages/core-domain/src/content/content.types';
import {
  validateCalendarEvent,
  type ValidatedCalendarEvent,
} from '../../../../packages/data-platform/src/repositories/calendar-event-validator';
import { DrizzleCalendarEventRepository } from '../../../../packages/data-platform/src/repositories/calendar-event.repository';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import type { Env } from '../env';
import type { Logger } from '../logger';
import { resolveVersionDelta, type VersionDelta } from './blog-drafts';
import { WorkerAuditService } from '../adapters/audit';

/** One calendar_events row as the year read returns it (domain shape). */
type ExistingEvent = Awaited<
  ReturnType<DrizzleCalendarEventRepository['listByYear']>
>[number];

/** Result of one fan-out run — logged by the wrapper, asserted by tests. */
export interface CalendarFanoutRunResult {
  /** Confirmed versions the run was scoped to. */
  readonly confirmedVersions: readonly string[];
  /** Effective year the delta resolves to (null when nothing ran). */
  readonly effectiveYear: number | null;
  /**
   * created — the CONFIRMED row was inserted and audited;
   * year-covered — the (year, FI_EXCISE_CHANGE) skip rule fired;
   * no-delta — the versions carry no predecessor-paired rate change;
   * no-versions — empty scoping (nothing to confirm).
   */
  readonly outcome: 'created' | 'year-covered' | 'no-delta' | 'no-versions';
}

/**
 * The confirmed version's authoritative source URL — the version's
 * first tax_rules row's `official_source` (the column every rule row
 * carries NOT NULL). Null when the version has no sourced rows: the
 * validator rejects an unsourced event, and the fail-open wrapper turns
 * that rejection into a log — never an unsourced calendar row.
 */
async function lookupOfficialSource(
  d1: D1DatabaseLike,
  versionLabel: string,
): Promise<string | null> {
  const row = await d1
    .prepare(
      `SELECT official_source FROM tax_rules
        WHERE version_label = ? AND official_source IS NOT NULL
        ORDER BY effective_from ASC, id ASC LIMIT 1`,
    )
    .bind(versionLabel)
    .first<{ official_source: string | null }>();
  const source = row?.official_source?.trim();
  return source ? source : null;
}

/** The four-digit year prefix of an ISO (or ISO-datetime) date string. */
function effectiveYearOf(effectiveFrom: string): number {
  const year = Number(effectiveFrom.slice(0, 4));
  if (!Number.isInteger(year) || year < 1000) {
    throw new Error(
      `Rate dataset effective date ${JSON.stringify(effectiveFrom)} carries no four-digit year — no calendar event can be dated from it`,
    );
  }
  return year;
}

/** Cents as euros in the locale's convention (the content module's style). */
function euros(cents: number, locale: 'fi' | 'en'): string {
  const value = (cents / 100).toFixed(2);
  return locale === 'fi' ? `${value.replace('.', ',')} €` : `€${value}`;
}

/** Uniform sign across the delta's lines — 'mixed' covers any mix. */
function deltaDirection(
  changes: readonly RateChangeLine[],
): 'up' | 'down' | 'mixed' {
  if (changes.every((line) => line.toRate > line.fromRate)) return 'up';
  if (changes.every((line) => line.toRate < line.fromRate)) return 'down';
  return 'mixed';
}

/** The typical-basket phrase, derived from the content module's constants. */
function basketPhrase(locale: 'fi' | 'en'): string {
  const percent = (TYPICAL_BASKET.alcoholFraction * 100).toFixed(1);
  return locale === 'fi'
    ? `${TYPICAL_BASKET.units} × ${TYPICAL_BASKET.unitVolumeLitres} l, ${percent.replace('.', ',')} %`
    : `${TYPICAL_BASKET.units} × ${TYPICAL_BASKET.unitVolumeLitres} l, ${percent} %`;
}

/**
 * FI + EN text for the auto-created event, derived from the SAME delta
 * output the blog-draft builder consumes: what categories changed, the
 * effective date, and the typical-basket impact. Tone follows the
 * seeded event style — factual sentences, no adjectives; an impact
 * figure is claimed only when the content module's estimator can price
 * the delta (never an impact the diff cannot produce).
 */
export function buildFanoutEventText(
  versionLabel: string,
  year: number,
  changes: readonly RateChangeLine[],
): Pick<
  ValidatedCalendarEvent,
  'titleFi' | 'titleEn' | 'summaryFi' | 'summaryEn'
> {
  const categories = [...new Set(changes.map((line) => line.productCategory))].join(
    ', ',
  );
  const direction = deltaDirection(changes);
  const impactCents = estimateTypicalBasketImpactCents(changes);

  const fiImpact =
    impactCents === null
      ? ''
      : ` Esimerkkikorin (${basketPhrase('fi')}) arvioitu vaikutus on ${euros(impactCents, 'fi')}.`;
  const enImpact =
    impactCents === null
      ? ''
      : ` On the example basket (${basketPhrase('en')}) the change is about ${euros(impactCents, 'en')}.`;

  const fiTitle =
    direction === 'up'
      ? `Valmistevero nousi 1.1.${year}`
      : direction === 'down'
        ? `Valmistevero laski 1.1.${year}`
        : `Valmistevero muuttui 1.1.${year}`;
  const enTitle =
    direction === 'up'
      ? `Finnish excise rose on 1 January ${year}`
      : direction === 'down'
        ? `Finnish excise fell on 1 January ${year}`
        : `Finnish excise changed on 1 January ${year}`;

  return {
    titleFi: fiTitle,
    titleEn: enTitle,
    summaryFi:
      `Veroaineiston versio ${versionLabel} muuttaa seuraavien juomaluokkien valmisteveroja: ${categories}. ` +
      `Muutos tulee voimaan 1.1.${year}.${fiImpact} ` +
      `Muutos on voimassa kalenterivuoden ${year}.`,
    summaryEn:
      `Rate dataset version ${versionLabel} changes the excise duty for these drink categories: ${categories}. ` +
      `The change takes effect on 1 January ${year}.${enImpact} ` +
      `The change is in force for calendar year ${year}.`,
  };
}

/**
 * The console-parity insert: autoassigned id beyond every existing row
 * (the ops createCalendarEvent pattern — single-operator console, no
 * allocation race to defend against). Returns the assigned id.
 */
async function insertCalendarEventRow(
  d1: D1DatabaseLike,
  event: ValidatedCalendarEvent,
): Promise<number> {
  const head = await d1
    .prepare('SELECT MAX(id) AS max_id FROM calendar_events')
    .first<{ max_id: number | null }>();
  const id = (head?.max_id ?? 0) + 1;
  await d1
    .prepare(
      'INSERT INTO calendar_events ' +
        '(id, year, event_type, status, occurrence_date, expected_window, ' +
        'title_fi, title_en, summary_fi, summary_en, source_url) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      event.year,
      event.eventType,
      event.status,
      event.occurrenceDate,
      event.expectedWindow,
      event.titleFi,
      event.titleEn,
      event.summaryFi,
      event.summaryEn,
      event.sourceUrl,
    )
    .run();
  return id;
}

/**
 * One calendar-event fan-out run: resolve the confirmed versions' delta
 * (the blog-draft builder's own resolution), skip when the effective
 * year already carries an FI_EXCISE_CHANGE row, otherwise validate and
 * insert the CONFIRMED 1 January row through the persistence-boundary
 * validator and audit the creation. Throws on failure — the wrapper
 * below is the fail-open boundary, never this function.
 *
 * `deps` is a test seam (delta resolution + the two repository faces).
 */
export async function handleCalendarEventFanout(
  env: Env,
  log: Logger,
  deps: {
    confirmedVersions?: readonly string[];
    resolveDelta?: (
      confirmedVersions: readonly string[],
    ) => Promise<VersionDelta | null>;
    /** Year-read seam (tests) — defaults to the Drizzle calendar repository. */
    listEvents?: (year: number) => Promise<readonly ExistingEvent[]>;
    /** Insert seam (tests) — returns the assigned row id. */
    insertEvent?: (event: ValidatedCalendarEvent) => Promise<number>;
    /** The creation audit's author; defaults to the fan-out itself. */
    actor?: string;
  } = {},
): Promise<CalendarFanoutRunResult> {
  const confirmedVersions = [...(deps.confirmedVersions ?? [])];
  if (confirmedVersions.length === 0) {
    return { confirmedVersions, effectiveYear: null, outcome: 'no-versions' };
  }

  // The SINGLE diff — the blog-draft builder's own resolution.
  const delta = deps.resolveDelta
    ? await deps.resolveDelta(confirmedVersions)
    : await resolveVersionDelta(env.DB, confirmedVersions);
  if (delta === null) {
    return { confirmedVersions, effectiveYear: null, outcome: 'no-delta' };
  }

  const year = effectiveYearOf(delta.effectiveFrom);
  const versionLabel = confirmedVersions[0];

  // Idempotency: the (year, event type) skip rule over the repository's
  // year read — the same rows the public calendar API serves.
  const existing = deps.listEvents
    ? await deps.listEvents(year)
    : await new DrizzleCalendarEventRepository(env.DB).listByYear(year);
  if (existing.some((event) => event.eventType === 'FI_EXCISE_CHANGE')) {
    log.info({
      message: `Calendar event fan-out skipped: ${year} already carries an FI_EXCISE_CHANGE event (idempotent re-confirmation)`,
      confirmedVersions,
      effectiveYear: year,
    });
    return { confirmedVersions, effectiveYear: year, outcome: 'year-covered' };
  }

  const officialSource = await lookupOfficialSource(env.DB, versionLabel);
  // The persistence-boundary validator is the single content contract —
  // an invalid derived row (e.g. an unsourced version) throws here and
  // lands in the fail-open wrapper's log, never in the table.
  const validated = validateCalendarEvent({
    year,
    eventType: 'FI_EXCISE_CHANGE',
    status: 'CONFIRMED',
    occurrenceDate: `${year}-01-01`,
    expectedWindow: null,
    sourceUrl: officialSource ?? '',
    ...buildFanoutEventText(versionLabel, year, delta.changes),
  });

  const id = deps.insertEvent
    ? await deps.insertEvent(validated)
    : await insertCalendarEventRow(env.DB, validated);

  await new WorkerAuditService(env.DB).logChange({
    entityType: 'calendar_event',
    entityId: String(id),
    action: 'created',
    author: deps.actor ?? 'rate-confirmation',
    reason: `FI_EXCISE_CHANGE event auto-created from confirmed dataset version ${versionLabel} (fail-open fan-out)`,
    newValue: {
      year: validated.year,
      eventType: validated.eventType,
      status: validated.status,
      occurrenceDate: validated.occurrenceDate,
      sourceUrl: validated.sourceUrl,
      confirmedVersions,
    },
  });

  log.info({
    message: `Calendar event fan-out created the CONFIRMED FI_EXCISE_CHANGE row for ${year} (source: ${validated.sourceUrl})`,
    confirmedVersions,
    effectiveYear: year,
    eventId: id,
  });
  return { confirmedVersions, effectiveYear: year, outcome: 'created' };
}

/**
 * The fail-open wrapper — the entry the confirmation handler awaits.
 * Never throws: every failure is caught and logged, and the wrapper
 * resolves to null so the confirmation response cannot observe anything
 * but success (the blog-draft wrapper twin; spec "Confirmation survives
 * event failure").
 */
export async function runCalendarEventFanout(
  env: Env,
  log: Logger,
  scope: {
    confirmedVersions?: readonly string[];
    /** The confirming operator — the creation audit's attribution. */
    actor?: string;
  } = {},
): Promise<CalendarFanoutRunResult | null> {
  try {
    return await handleCalendarEventFanout(env, log, {
      confirmedVersions: scope.confirmedVersions,
      actor: scope.actor,
    });
  } catch (err) {
    log.error({
      message: `Calendar event fan-out failed (fail-open, the confirmation is unaffected): ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
      confirmedVersions: [...(scope.confirmedVersions ?? [])],
    });
    return null;
  }
}
