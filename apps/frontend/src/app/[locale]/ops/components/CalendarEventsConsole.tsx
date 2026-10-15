'use client';

/**
 * CalendarEventsConsole — the tax-change calendar maintenance surface
 * (task 5.1, change tax-change-calendar): list every sourced event
 * across years, create a new one, and update a row in place (the
 * EXPECTED → CONFIRMED upgrade supplies the exact date and clears the
 * window). There is deliberately NO delete — a public calendar row never
 * dangles mid-year. Content is submitted as the FULL row every time:
 * the status/precision coupling makes partial edits ambiguous, and the
 * server re-validates the whole row through the persistence-boundary
 * validator (closed vocabularies, precision split, mandatory source and
 * locale texts). Realm model and string strategy mirror GuidesConsole
 * (bearer token in component state; locale-selected literals, no
 * catalog keys).
 *
 * @module CalendarEventsConsole
 */

import React, { useCallback, useState } from 'react';
import {
  OpsApiError,
  createCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
  type OpsCalendarEventItem,
} from '../api';
import { ConsoleSection, StatusBadge, consoleLabels, inputClass } from './console-ui';

/** The closed event-type vocabulary (mirrors the server's validator). */
const EVENT_TYPES = [
  'FI_EXCISE_CHANGE',
  'EE_EXCISE_CHANGE',
  'ALKO_PRICE_LIST',
  'TAX_TABLE_PUBLICATION',
  'RATE_DECISION',
] as const;

/** One editable content form — shared by the create section and the
 * inline per-row editor (the full-content update contract). */
interface EventFormState {
  year: string;
  eventType: string;
  status: 'CONFIRMED' | 'EXPECTED';
  occurrenceDate: string;
  expectedWindow: string;
  titleFi: string;
  titleEn: string;
  summaryFi: string;
  summaryEn: string;
  sourceUrl: string;
}

const EMPTY_FORM: EventFormState = {
  year: '',
  eventType: 'RATE_DECISION',
  status: 'EXPECTED',
  occurrenceDate: '',
  expectedWindow: '',
  titleFi: '',
  titleEn: '',
  summaryFi: '',
  summaryEn: '',
  sourceUrl: '',
};

function formFromEvent(event: OpsCalendarEventItem): EventFormState {
  return {
    year: String(event.year),
    eventType: event.eventType,
    status: event.status === 'CONFIRMED' ? 'CONFIRMED' : 'EXPECTED',
    occurrenceDate: event.occurrenceDate ?? '',
    expectedWindow: event.expectedWindow ?? '',
    titleFi: event.titleFi,
    titleEn: event.titleEn,
    summaryFi: event.summaryFi,
    summaryEn: event.summaryEn,
    sourceUrl: event.sourceUrl,
  };
}

/** The payload one form submission carries — the status decides which
 * precision field travels (the validator forbids the other). */
function payloadFromForm(
  form: EventFormState,
  operator: string,
  note: string,
) {
  return {
    operator,
    year: Number(form.year),
    eventType: form.eventType,
    status: form.status,
    occurrenceDate: form.status === 'CONFIRMED' ? form.occurrenceDate.trim() : null,
    expectedWindow: form.status === 'EXPECTED' ? form.expectedWindow.trim() : null,
    titleFi: form.titleFi.trim(),
    titleEn: form.titleEn.trim(),
    summaryFi: form.summaryFi.trim(),
    summaryEn: form.summaryEn.trim(),
    sourceUrl: form.sourceUrl.trim(),
    ...(note.trim() === '' ? {} : { note: note.trim() }),
  };
}

/** The content fields a submission needs filled per its status. */
function formReady(form: EventFormState): boolean {
  const textReady =
    form.year.trim() !== '' &&
    form.titleFi.trim() !== '' &&
    form.titleEn.trim() !== '' &&
    form.summaryFi.trim() !== '' &&
    form.summaryEn.trim() !== '' &&
    form.sourceUrl.trim() !== '';
  if (!textReady) return false;
  return form.status === 'CONFIRMED'
    ? form.occurrenceDate.trim() !== ''
    : form.expectedWindow.trim() !== '';
}

export default function CalendarEventsConsole({ locale }: { locale: string }) {
  const t = consoleLabels(locale, {
    fi: {
      title: 'Veromuutoskalenteri',
      intro:
        'Lähteeseen sitotut vuosirytmin tapahtumat: listaa, luo ja päivitä. Rivillä on aina virallinen lähde ja tekstit molemmilla kielillä; muutokset kirjataan auditointilokiin. Poistoa ei ole — julkinen kalenteririvi ei katoa kesken vuoden.',
      operator: 'Operaattori',
      token: 'Ops-tunnus (bearer)',
      load: 'Nouda tapahtumat',
      loading: 'Noudetaan…',
      createTitle: 'Uusi tapahtuma',
      createIntro:
        'Täyden rivin sisältö — vahvistettu tapahtuma vie tarkan päivän, odotettu jaksoikkunan (esim. 2027-03 tai 2027-Q2).',
      year: 'Vuosi',
      eventType: 'Tapahtumatyyppi',
      status: 'Tila',
      occurrenceDate: 'Tarkka päivä (VVVV-KK-PP)',
      expectedWindow: 'Odotettu ikkuna (VVVV-KK tai VVVV-Qn)',
      titleFiLabel: 'Otsikko (fi)',
      titleEnLabel: 'Otsikko (en)',
      summaryFiLabel: 'Yhteenveto (fi)',
      summaryEnLabel: 'Yhteenveto (en)',
      sourceUrl: 'Lähde (http(s)-osoite)',
      note: 'Merkintä (valinnainen)',
      create: 'Luo tapahtuma',
      creating: 'Luodaan…',
      listTitle: 'Kalenterin tapahtumat',
      listIntro: 'Kaikki vuodet aikajärjestyksessä; sisäinen järjestys on julkinen deterministinen järjestys.',
      empty: 'Ei tapahtumia.',
      edit: 'Muokkaa',
      editorTitle: 'Muokkaa tapahtumaa',
      save: 'Tallenna',
      saving: 'Tallennetaan…',
      cancel: 'Peruuta',
      noDate: '—',
      actionFailed: 'Toiminto epäonnistui',
    },
    en: {
      title: 'Tax-change calendar',
      intro:
        'Sourced annual-rhythm events: list, create, and update. Every row carries an official source and both locale texts; every change is audited. There is no delete — a public calendar row never disappears mid-year.',
      operator: 'Operator',
      token: 'Ops bearer token',
      load: 'Load events',
      loading: 'Loading…',
      createTitle: 'New event',
      createIntro:
        'Full-row content — a confirmed event carries the exact date, an expected one the window (e.g. 2027-03 or 2027-Q2).',
      year: 'Year',
      eventType: 'Event type',
      status: 'Status',
      occurrenceDate: 'Exact date (YYYY-MM-DD)',
      expectedWindow: 'Expected window (YYYY-MM or YYYY-Qn)',
      titleFiLabel: 'Title (fi)',
      titleEnLabel: 'Title (en)',
      summaryFiLabel: 'Summary (fi)',
      summaryEnLabel: 'Summary (en)',
      sourceUrl: 'Source (http(s) URL)',
      note: 'Note (optional)',
      create: 'Create event',
      creating: 'Creating…',
      listTitle: 'Calendar events',
      listIntro: 'All years in order; the in-year order is the public deterministic one.',
      empty: 'No events.',
      edit: 'Edit',
      editorTitle: 'Edit event',
      save: 'Save',
      saving: 'Saving…',
      cancel: 'Cancel',
      noDate: '—',
      actionFailed: 'Action failed',
    },
  });

  const [operator, setOperator] = useState('');
  const [token, setToken] = useState('');
  const [items, setItems] = useState<OpsCalendarEventItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<EventFormState>(EMPTY_FORM);
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);

  // The one event being edited inline (full-content editor, pre-filled).
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EventFormState>(EMPTY_FORM);
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);

  const ready = operator.trim() !== '' && token.trim() !== '';

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listCalendarEvents(token);
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.actionFailed);
    } finally {
      setLoading(false);
    }
  }, [t.actionFailed, token]);

  /** Runs one mutation and refreshes; keeps the editor open with the
   * error shown when the action fails (GuidesConsole parity). */
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof OpsApiError || err instanceof Error ? err.message : t.actionFailed);
      return false;
    }
  };

  const create = async () => {
    setCreating(true);
    const ok = await run(() =>
      createCalendarEvent(token, payloadFromForm(form, operator.trim(), note)),
    );
    setCreating(false);
    if (ok) {
      setForm(EMPTY_FORM);
      setNote('');
    }
  };

  const save = async (id: number) => {
    setSaving(true);
    const ok = await run(() =>
      updateCalendarEvent(token, id, payloadFromForm(editForm, operator.trim(), editNote)),
    );
    setSaving(false);
    if (ok) {
      setEditingId(null);
      setEditNote('');
    }
  };

  const events = items ?? [];

  const renderForm = (
    value: EventFormState,
    onChange: (patch: Partial<EventFormState>) => void,
  ) => (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="block text-xs font-medium text-gray-700">
        {t.year}
        <input
          type="number"
          value={value.year}
          onChange={(e) => onChange({ year: e.target.value })}
          className={inputClass}
        />
      </label>
      <label className="block text-xs font-medium text-gray-700">
        {t.eventType}
        <select
          value={value.eventType}
          onChange={(e) => onChange({ eventType: e.target.value })}
          className={inputClass}
        >
          {EVENT_TYPES.map((eventType) => (
            <option key={eventType} value={eventType}>
              {eventType}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-medium text-gray-700">
        {t.status}
        <select
          value={value.status}
          onChange={(e) => onChange({ status: e.target.value === 'CONFIRMED' ? 'CONFIRMED' : 'EXPECTED' })}
          className={inputClass}
        >
          <option value="CONFIRMED">CONFIRMED</option>
          <option value="EXPECTED">EXPECTED</option>
        </select>
      </label>
      {value.status === 'CONFIRMED' ? (
        <label className="block text-xs font-medium text-gray-700">
          {t.occurrenceDate}
          <input
            type="date"
            value={value.occurrenceDate}
            onChange={(e) => onChange({ occurrenceDate: e.target.value })}
            className={inputClass}
          />
        </label>
      ) : (
        <label className="block text-xs font-medium text-gray-700">
          {t.expectedWindow}
          <input
            type="text"
            placeholder="2027-03 / 2027-Q2"
            value={value.expectedWindow}
            onChange={(e) => onChange({ expectedWindow: e.target.value })}
            className={inputClass}
          />
        </label>
      )}
      <label className="block text-xs font-medium text-gray-700">
        {t.titleFiLabel}
        <input
          type="text"
          value={value.titleFi}
          onChange={(e) => onChange({ titleFi: e.target.value })}
          className={inputClass}
        />
      </label>
      <label className="block text-xs font-medium text-gray-700">
        {t.titleEnLabel}
        <input
          type="text"
          value={value.titleEn}
          onChange={(e) => onChange({ titleEn: e.target.value })}
          className={inputClass}
        />
      </label>
      <label className="block text-xs font-medium text-gray-700 sm:col-span-2">
        {t.summaryFiLabel}
        <textarea
          value={value.summaryFi}
          onChange={(e) => onChange({ summaryFi: e.target.value })}
          rows={2}
          className={inputClass}
        />
      </label>
      <label className="block text-xs font-medium text-gray-700 sm:col-span-2">
        {t.summaryEnLabel}
        <textarea
          value={value.summaryEn}
          onChange={(e) => onChange({ summaryEn: e.target.value })}
          rows={2}
          className={inputClass}
        />
      </label>
      <label className="block text-xs font-medium text-gray-700 sm:col-span-2">
        {t.sourceUrl}
        <input
          type="url"
          value={value.sourceUrl}
          onChange={(e) => onChange({ sourceUrl: e.target.value })}
          className={inputClass}
        />
      </label>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">{t.title}</h1>
        <p className="mt-1 text-sm text-gray-600">{t.intro}</p>
      </header>

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">{t.operator} / {t.token}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-gray-700">
            {t.operator}
            <input
              type="text"
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              autoComplete="off"
              className={inputClass}
            />
          </label>
          <label className="block text-xs font-medium text-gray-700">
            {t.token}
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              className={inputClass}
            />
          </label>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={!ready || loading}
          className="mt-3 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {loading ? t.loading : t.load}
        </button>
        {error !== null && (
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
      </section>

      <ConsoleSection title={t.createTitle} intro={t.createIntro}>
        {renderForm(form, (patch) => setForm((prev) => ({ ...prev, ...patch })))}
        <label className="mt-3 block text-xs font-medium text-gray-700">
          {t.note}
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={inputClass}
          />
        </label>
        <button
          type="button"
          onClick={create}
          disabled={!ready || creating || !formReady(form)}
          className="mt-3 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {creating ? t.creating : t.create}
        </button>
      </ConsoleSection>

      <ConsoleSection title={t.listTitle} intro={t.listIntro}>
        {events.length === 0 && !loading && (
          <p className="mt-3 text-xs text-gray-500">{t.empty}</p>
        )}
        {events.length > 0 && (
          <ul className="mt-3 space-y-2">
            {events.map((event) => (
              <li key={event.id} className="rounded border border-gray-200 p-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">
                      #{event.id} · {event.year} · {event.titleFi}
                    </p>
                    <p className="text-gray-500">
                      {event.eventType} ·{' '}
                      {event.occurrenceDate ?? event.expectedWindow ?? t.noDate}
                    </p>
                    <p className="text-gray-400">{event.sourceUrl}</p>
                  </div>
                  <StatusBadge status={event.status} />
                  <button
                    type="button"
                    onClick={() => {
                      if (editingId === event.id) {
                        setEditingId(null);
                      } else {
                        setEditingId(event.id);
                        setEditForm(formFromEvent(event));
                        setEditNote('');
                      }
                    }}
                    className="rounded bg-gray-600 px-2 py-1 font-medium text-white hover:bg-gray-700"
                  >
                    {editingId === event.id ? t.cancel : t.edit}
                  </button>
                </div>
                {editingId === event.id && (
                  <form
                    className="mt-3 space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save(event.id);
                    }}
                  >
                    <p className="text-xs font-semibold text-gray-700">{t.editorTitle}</p>
                    {renderForm(editForm, (patch) =>
                      setEditForm((prev) => ({ ...prev, ...patch })),
                    )}
                    <label className="block text-xs font-medium text-gray-700">
                      {t.note}
                      <input
                        type="text"
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        className={inputClass}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={!ready || saving || !formReady(editForm)}
                      className="rounded bg-primary-600 px-3 py-1.5 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                    >
                      {saving ? t.saving : t.save}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </ConsoleSection>
    </div>
  );
}
