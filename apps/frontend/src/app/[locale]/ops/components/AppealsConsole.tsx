'use client';

/**
 * AppealsConsole — the blacklist appeal inbox (task 2.3, change
 * trust-and-reach-roadmap): REOPENED entries awaiting re-review with
 * REPUBLISH/REJECT resolution actions, recording of out-of-band appeals
 * against PUBLISHED entries, and the full entry list. Realm model and
 * string strategy mirror ReportsConsole (bearer token in component
 * state; locale-selected literals, no catalog keys).
 *
 * @module AppealsConsole
 */

import React, { useCallback, useState } from 'react';
import {
  OpsApiError,
  listBlacklistEntries,
  listAppeals,
  recordAppeal,
  resolveAppeal,
  type OpsBlacklistEntry,
  type OpsBlacklistListResponse,
} from '../api';
import { ConsoleSection, StatusBadge, consoleLabels, inputClass } from './console-ui';

export default function AppealsConsole({ locale }: { locale: string }) {
  const t = consoleLabels(locale, {
    fi: {
      title: 'Valitusjonan käsittely',
      intro:
        'Uudelleenkäsiteltävät rivit (REOPENED poistuu julkisista varoituksista välittömästi). Ratkaisu palauttaa rivin julkaistuksi tai hylkää sen lopullisesti; molemmat kirjataan lokiin.',
      operator: 'Operaattori',
      token: 'Ops-tunnus (bearer)',
      load: 'Lataa',
      loading: 'Lataa…',
      inboxTitle: 'Valitusposti',
      inboxIntro: 'Vain REOPENED-tilassa olevat rivit odottavat ratkaisua.',
      republish: 'Palauta julkaistuksi',
      reject: 'Hylkää (lopullinen)',
      empty: 'Ei avoimia valituksia.',
      recordTitle: 'Kirjaa valitus',
      recordIntro: 'Kauppias valittaa muulla kanavalla — kirjaa se julkaistua riviä vastaan.',
      entryId: 'Rivin tunnus (entryId)',
      appealReason: 'Valituksen peruste',
      record: 'Kirjaa',
      entriesTitle: 'Kaikki rivit',
      actionOk: 'Toimenpide kirjattu',
      actionFailed: 'Toimenpide epäonnistui',
    },
    en: {
      title: 'Appeal inbox',
      intro:
        'Entries awaiting re-review (REOPENED disappears from public warnings immediately). A resolution republishes or finally rejects; both are audited.',
      operator: 'Operator',
      token: 'Ops bearer token',
      load: 'Load',
      loading: 'Loading…',
      inboxTitle: 'Appeals awaiting resolution',
      inboxIntro: 'Exactly the REOPENED entries.',
      republish: 'Republish',
      reject: 'Reject (terminal)',
      empty: 'No open appeals.',
      recordTitle: 'Record an appeal',
      recordIntro: 'The merchant disputes out-of-band — record it against a PUBLISHED entry.',
      entryId: 'Entry id',
      appealReason: 'Appeal reason',
      record: 'Record',
      entriesTitle: 'All entries',
      actionOk: 'Action recorded',
      actionFailed: 'Action failed',
    },
  });

  const [operator, setOperator] = useState('');
  const [token, setToken] = useState('');
  const [inbox, setInbox] = useState<OpsBlacklistListResponse | null>(null);
  const [entries, setEntries] = useState<OpsBlacklistListResponse | null>(null);
  const [recordEntryId, setRecordEntryId] = useState('');
  const [appealReason, setAppealReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = useCallback(
    async (activeToken: string) => {
      setLoading(true);
      setError(null);
      try {
        const [appeals, all] = await Promise.all([
          listAppeals(activeToken),
          listBlacklistEntries(activeToken),
        ]);
        setInbox(appeals);
        setEntries(all);
      } catch (err) {
        setInbox(null);
        setEntries(null);
        setError(err instanceof Error ? err.message : t.actionFailed);
      } finally {
        setLoading(false);
      }
    },
    [t.actionFailed],
  );

  const runAction = useCallback(
    async (action: () => Promise<unknown>) => {
      setError(null);
      setFlash(null);
      try {
        await action();
        await refresh(token);
        setFlash(t.actionOk);
      } catch (err) {
        setError(
          err instanceof OpsApiError || err instanceof Error ? err.message : t.actionFailed,
        );
      }
    },
    [refresh, t.actionFailed, t.actionOk, token],
  );

  const ready = operator.trim() !== '' && token.trim() !== '';

  const entryRow = (entry: OpsBlacklistEntry) => (
    <li key={entry.id} className="rounded border border-gray-200 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-gray-900">
            #{entry.id} · {entry.merchantDomain} · {entry.merchantNameNormalized}
          </p>
          <p className="text-gray-500">
            {entry.standardMet} · {entry.publishedBy} · {entry.publishedAt}
          </p>
          {entry.appealReason !== null && (
            <p className="mt-1 text-gray-600">“{entry.appealReason}”</p>
          )}
        </div>
        <StatusBadge status={entry.status} />
      </div>
    </li>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">{t.title}</h1>
        <p className="mt-1 text-sm text-gray-600">{t.intro}</p>
      </header>

      <ConsoleSection title={t.operator} intro={t.token}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-gray-700">
            {t.operator}
            <input type="text" value={operator} onChange={(e) => setOperator(e.target.value)} autoComplete="off" className={inputClass} />
          </label>
          <label className="block text-xs font-medium text-gray-700">
            {t.token}
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" className={inputClass} />
          </label>
        </div>
        <button
          type="button"
          onClick={() => refresh(token)}
          disabled={!ready || loading}
          className="mt-3 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {loading ? t.loading : t.load}
        </button>
        {error !== null && (
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}
        {flash !== null && (
          <p className="mt-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">{flash}</p>
        )}
      </ConsoleSection>

      {inbox !== null && (
        <ConsoleSection title={t.inboxTitle} intro={t.inboxIntro}>
          <ul className="mt-3 space-y-2">
            {inbox.items.map((entry) => (
              <li key={entry.id} className="rounded border border-gray-200 p-3 text-xs">
                {entryRow(entry)}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      runAction(() =>
                        resolveAppeal(token, entry.id, { operator, resolution: 'REPUBLISH' }),
                      )
                    }
                    className="rounded bg-green-600 px-2 py-1 font-medium text-white hover:bg-green-700"
                  >
                    {t.republish}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      runAction(() =>
                        resolveAppeal(token, entry.id, { operator, resolution: 'REJECT' }),
                      )
                    }
                    className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700"
                  >
                    {t.reject}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {inbox.items.length === 0 && <p className="mt-3 text-xs text-gray-500">{t.empty}</p>}
        </ConsoleSection>
      )}

      {inbox !== null && (
        <ConsoleSection title={t.recordTitle} intro={t.recordIntro}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-gray-700">
              {t.entryId}
              <input type="text" value={recordEntryId} onChange={(e) => setRecordEntryId(e.target.value)} className={inputClass} />
            </label>
            <label className="block text-xs font-medium text-gray-700">
              {t.appealReason}
              <input type="text" value={appealReason} onChange={(e) => setAppealReason(e.target.value)} className={inputClass} />
            </label>
          </div>
          <button
            type="button"
            disabled={recordEntryId.trim() === '' || appealReason.trim() === ''}
            onClick={() =>
              runAction(() =>
                recordAppeal(token, Number.parseInt(recordEntryId, 10), {
                  operator,
                  appealReason: appealReason.trim(),
                }),
              )
            }
            className="mt-3 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {t.record}
          </button>
        </ConsoleSection>
      )}

      {entries !== null && (
        <ConsoleSection title={t.entriesTitle} intro={t.empty}>
          <ul className="mt-3 space-y-2">{entries.items.map(entryRow)}</ul>
          {entries.items.length === 0 && <p className="mt-2 text-xs text-gray-500">{t.empty}</p>}
        </ConsoleSection>
      )}
    </div>
  );
}
