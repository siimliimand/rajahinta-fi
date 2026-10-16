'use client';

/**
 * CalendarCandidatesConsole — the source-watcher's review queue (task
 * 4.1, change calendar-event-automation): the PENDING announcements the
 * daily watcher queued from the verified feeds. Accept turns a
 * candidate into a publicly visible calendar event through the
 * operator's calendar framing (type, status CONFIRMED/EXPECTED,
 * date-or-window, optional FI/EN text overrides — the watcher's drafts
 * pre-fill them); reject is terminal and retains the row so its URL
 * keeps deduplicating. The server validates every accept through the
 * persistence-boundary event contract — an invalid combination answers
 * 400 and the candidate stays queued. Realm model and string strategy
 * mirror CalendarEventsConsole (bearer token in component state;
 * locale-selected literals, no catalog keys).
 *
 * @module CalendarCandidatesConsole
 */

import React, { useCallback, useState } from 'react';
import {
  OpsApiError,
  acceptCalendarCandidate,
  listCalendarCandidates,
  rejectCalendarCandidate,
  type OpsCalendarCandidateAcceptInput,
  type OpsCalendarCandidateItem,
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

/** One candidate's accept form — exactly one of the two precision
 * fields travels per the chosen status (the validator forbids the
 * other). Empty override fields mean "use the watcher's draft". */
interface AcceptFormState {
  eventType: string;
  status: 'CONFIRMED' | 'EXPECTED';
  occurrenceDate: string;
  expectedWindow: string;
  titleFi: string;
  titleEn: string;
  summaryFi: string;
  summaryEn: string;
  note: string;
}

function formFromCandidate(candidate: OpsCalendarCandidateItem): AcceptFormState {
  return {
    eventType: 'RATE_DECISION',
    status: 'CONFIRMED',
    occurrenceDate: '',
    expectedWindow: '',
    titleFi: candidate.draftFi ?? '',
    titleEn: candidate.draftEn ?? '',
    summaryFi: candidate.draftFi ?? '',
    summaryEn: candidate.draftEn ?? '',
    note: '',
  };
}

/** The payload one accept submission carries — the status decides which
 * precision field travels; blank override fields are omitted so the
 * server falls back to the candidate's drafts. */
function acceptPayload(form: AcceptFormState, operator: string): OpsCalendarCandidateAcceptInput {
  const override = (value: string): string | undefined => {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  };
  const payload: OpsCalendarCandidateAcceptInput = {
    operator,
    eventType: form.eventType,
    status: form.status,
    occurrenceDate: form.status === 'CONFIRMED' ? form.occurrenceDate.trim() : null,
    expectedWindow: form.status === 'EXPECTED' ? form.expectedWindow.trim() : null,
  };
  const titleFi = override(form.titleFi);
  if (titleFi !== undefined) payload.titleFi = titleFi;
  const titleEn = override(form.titleEn);
  if (titleEn !== undefined) payload.titleEn = titleEn;
  const summaryFi = override(form.summaryFi);
  if (summaryFi !== undefined) payload.summaryFi = summaryFi;
  const summaryEn = override(form.summaryEn);
  if (summaryEn !== undefined) payload.summaryEn = summaryEn;
  const note = form.note.trim();
  if (note !== '') payload.note = note;
  return payload;
}

/** The precision field a submission needs filled per its status; the
 * texts may legally ride the drafts, so only precision gates here. */
function formReady(form: AcceptFormState): boolean {
  return form.status === 'CONFIRMED'
    ? form.occurrenceDate.trim() !== ''
    : form.expectedWindow.trim() !== '';
}

export default function CalendarCandidatesConsole({ locale }: { locale: string }) {
  const t = consoleLabels(locale, {
    fi: {
      title: 'Kalenteriehdotukset',
      intro:
        'Lähdevalvonnan löytämät julkaisut odottavat käsittelyä. Hyväksyntä luo julkisen kalenteritapahtuman valitsemillasi tiedoilla ja kirjataan auditointilokiin; hylkäys jättää rivin jonoon tunnisteena, ettei sama ilmoitus palaa. Ehdotukset eivät ole koskaan julkisia.',
      operator: 'Operaattori',
      token: 'Ops-tunnus (bearer)',
      load: 'Nouda ehdotukset',
      loading: 'Noudetaan…',
      listTitle: 'Odottavat ehdotukset',
      listIntro:
        'Uusin havaittu ensin. Rivi kertoo lähteen, osoitteen, otsikon ja havaintopäivän.',
      empty: 'Ei odottavia ehdotuksia.',
      acceptTitle: 'Hyväksy kalenteritapahtumaksi',
      acceptIntro:
        'Valitse tyyppi ja tila: vahvistettu tapahtuma vie tarkan päivän, odotettu jaksoikkunan (esim. 2027-03 tai 2027-Q2). Tyhjä tekstikenttä käyttää lähdevalvonnan luonnosta.',
      eventType: 'Tapahtumatyyppi',
      status: 'Tila',
      occurrenceDate: 'Tarkka päivä (VVVV-KK-PP)',
      expectedWindow: 'Odotettu ikkuna (VVVV-KK tai VVVV-Qn)',
      titleFiLabel: 'Otsikko (fi) — tyhjä = luonnos',
      titleEnLabel: 'Otsikko (en) — tyhjä = luonnos',
      summaryFiLabel: 'Yhteenveto (fi) — tyhjä = luonnos',
      summaryEnLabel: 'Yhteenveto (en) — tyhjä = luonnos',
      note: 'Merkintä (valinnainen)',
      open: 'Hyväksy',
      accept: 'Hyväksy',
      accepting: 'Hyväksytään…',
      reject: 'Hylkää',
      rejecting: 'Hylätään…',
      cancel: 'Peruuta',
      draft: 'Luonnos',
      noDraft: 'Ei luonnosta',
      detected: 'Havaittu',
      source: 'Lähde',
      donePrefix: 'Hyväksytty: julkinen tapahtuma',
      actionFailed: 'Toiminto epäonnistui',
    },
    en: {
      title: 'Calendar candidates',
      intro:
        "Announcements the source watcher detected, awaiting review. Accepting creates a public calendar event from the framing you choose and is audited; rejecting keeps the row as a marker so the same announcement never returns. Candidates are never public.",
      operator: 'Operator',
      token: 'Ops bearer token',
      load: 'Load candidates',
      loading: 'Loading…',
      listTitle: 'Pending candidates',
      listIntro:
        'Newest detected first. Each row carries the source, URL, title, and detected date.',
      empty: 'No pending candidates.',
      acceptTitle: 'Accept as a calendar event',
      acceptIntro:
        'Choose the type and status: a confirmed event carries the exact date, an expected one the window (e.g. 2027-03 or 2027-Q2). An empty text field uses the watcher\'s draft.',
      eventType: 'Event type',
      status: 'Status',
      occurrenceDate: 'Exact date (YYYY-MM-DD)',
      expectedWindow: 'Expected window (YYYY-MM or YYYY-Qn)',
      titleFiLabel: 'Title (fi) — blank = draft',
      titleEnLabel: 'Title (en) — blank = draft',
      summaryFiLabel: 'Summary (fi) — blank = draft',
      summaryEnLabel: 'Summary (en) — blank = draft',
      note: 'Note (optional)',
      open: 'Accept',
      accept: 'Accept',
      accepting: 'Accepting…',
      reject: 'Reject',
      rejecting: 'Rejecting…',
      cancel: 'Cancel',
      draft: 'Draft',
      noDraft: 'No draft',
      detected: 'Detected',
      source: 'Source',
      donePrefix: 'Accepted: public event',
      actionFailed: 'Action failed',
    },
  });

  const [operator, setOperator] = useState('');
  const [token, setToken] = useState('');
  const [items, setItems] = useState<OpsCalendarCandidateItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  // The one candidate being accepted inline (form pre-filled from its
  // drafts); rejecting needs no form, only the operator identity.
  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const [form, setForm] = useState<AcceptFormState | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = operator.trim() !== '' && token.trim() !== '';

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listCalendarCandidates(token);
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.actionFailed);
    } finally {
      setLoading(false);
    }
  }, [t.actionFailed, token]);

  /** Runs one mutation and refreshes; keeps the row's state visible with
   * the error shown when the action fails (CalendarEventsConsole parity). */
  const run = async (action: () => Promise<string | null>): Promise<boolean> => {
    setError(null);
    setDoneMessage(null);
    try {
      const message = await action();
      await refresh();
      if (message !== null) setDoneMessage(message);
      return true;
    } catch (err) {
      setError(err instanceof OpsApiError || err instanceof Error ? err.message : t.actionFailed);
      return false;
    }
  };

  const accept = async (id: number) => {
    if (form === null) return;
    setBusy(true);
    const ok = await run(async () => {
      const res = await acceptCalendarCandidate(token, id, acceptPayload(form, operator.trim()));
      return `${t.donePrefix} #${res.eventId}`;
    });
    setBusy(false);
    if (ok) {
      setAcceptingId(null);
      setForm(null);
    }
  };

  const reject = async (id: number) => {
    setBusy(true);
    const ok = await run(() =>
      rejectCalendarCandidate(token, id, { operator: operator.trim() }).then(() => null),
    );
    setBusy(false);
    if (ok && acceptingId === id) {
      setAcceptingId(null);
      setForm(null);
    }
  };

  const candidates = items ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">{t.title}</h1>
        <p className="mt-1 text-sm text-gray-600">{t.intro}</p>
      </header>

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">
          {t.operator} / {t.token}
        </h2>
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
        {doneMessage !== null && (
          <p className="mt-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
            {doneMessage}
          </p>
        )}
      </section>

      <ConsoleSection title={t.listTitle} intro={t.listIntro}>
        {candidates.length === 0 && !loading && (
          <p className="mt-3 text-xs text-gray-500">{t.empty}</p>
        )}
        {candidates.length > 0 && (
          <ul className="mt-3 space-y-2">
            {candidates.map((candidate) => (
              <li key={candidate.id} className="rounded border border-gray-200 p-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">
                      #{candidate.id} · {candidate.title}
                    </p>
                    <p className="text-gray-500">
                      {t.source}: {candidate.source} · {t.detected}: {candidate.publishedAt}
                    </p>
                    <a
                      href={candidate.url}
                      className="break-all text-gray-400 underline"
                      rel="noreferrer"
                      target="_blank"
                    >
                      {candidate.url}
                    </a>
                    <p className="text-gray-400">
                      {t.draft}: {candidate.draftFi ?? t.noDraft} /{' '}
                      {candidate.draftEn ?? t.noDraft}
                    </p>
                  </div>
                  <StatusBadge status={candidate.status} />
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (acceptingId === candidate.id) {
                          setAcceptingId(null);
                          setForm(null);
                        } else {
                          setAcceptingId(candidate.id);
                          setForm(formFromCandidate(candidate));
                        }
                      }}
                      className="rounded bg-gray-600 px-2 py-1 font-medium text-white hover:bg-gray-700"
                    >
                      {acceptingId === candidate.id ? t.cancel : t.open}
                    </button>
                    <button
                      type="button"
                      onClick={() => void reject(candidate.id)}
                      disabled={!ready || busy}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {busy ? t.rejecting : t.reject}
                    </button>
                  </div>
                </div>
                {acceptingId === candidate.id && form !== null && (
                  <form
                    className="mt-3 space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void accept(candidate.id);
                    }}
                  >
                    <p className="text-xs font-semibold text-gray-700">{t.acceptTitle}</p>
                    <p className="text-xs text-gray-500">{t.acceptIntro}</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-xs font-medium text-gray-700">
                        {t.eventType}
                        <select
                          value={form.eventType}
                          onChange={(e) => setForm({ ...form, eventType: e.target.value })}
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
                          value={form.status}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              status: e.target.value === 'CONFIRMED' ? 'CONFIRMED' : 'EXPECTED',
                            })
                          }
                          className={inputClass}
                        >
                          <option value="CONFIRMED">CONFIRMED</option>
                          <option value="EXPECTED">EXPECTED</option>
                        </select>
                      </label>
                      {form.status === 'CONFIRMED' ? (
                        <label className="block text-xs font-medium text-gray-700">
                          {t.occurrenceDate}
                          <input
                            type="date"
                            value={form.occurrenceDate}
                            onChange={(e) =>
                              setForm({ ...form, occurrenceDate: e.target.value })
                            }
                            className={inputClass}
                          />
                        </label>
                      ) : (
                        <label className="block text-xs font-medium text-gray-700">
                          {t.expectedWindow}
                          <input
                            type="text"
                            placeholder="2027-03 / 2027-Q2"
                            value={form.expectedWindow}
                            onChange={(e) =>
                              setForm({ ...form, expectedWindow: e.target.value })
                            }
                            className={inputClass}
                          />
                        </label>
                      )}
                      <label className="block text-xs font-medium text-gray-700">
                        {t.titleFiLabel}
                        <input
                          type="text"
                          value={form.titleFi}
                          onChange={(e) => setForm({ ...form, titleFi: e.target.value })}
                          className={inputClass}
                        />
                      </label>
                      <label className="block text-xs font-medium text-gray-700">
                        {t.titleEnLabel}
                        <input
                          type="text"
                          value={form.titleEn}
                          onChange={(e) => setForm({ ...form, titleEn: e.target.value })}
                          className={inputClass}
                        />
                      </label>
                      <label className="block text-xs font-medium text-gray-700 sm:col-span-2">
                        {t.summaryFiLabel}
                        <textarea
                          value={form.summaryFi}
                          onChange={(e) => setForm({ ...form, summaryFi: e.target.value })}
                          rows={2}
                          className={inputClass}
                        />
                      </label>
                      <label className="block text-xs font-medium text-gray-700 sm:col-span-2">
                        {t.summaryEnLabel}
                        <textarea
                          value={form.summaryEn}
                          onChange={(e) => setForm({ ...form, summaryEn: e.target.value })}
                          rows={2}
                          className={inputClass}
                        />
                      </label>
                    </div>
                    <label className="block text-xs font-medium text-gray-700">
                      {t.note}
                      <input
                        type="text"
                        value={form.note}
                        onChange={(e) => setForm({ ...form, note: e.target.value })}
                        className={inputClass}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={!ready || busy || !formReady(form)}
                      className="rounded bg-primary-600 px-3 py-1.5 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                    >
                      {busy ? t.accepting : t.accept}
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
